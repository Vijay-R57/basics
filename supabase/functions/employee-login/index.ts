import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { employeeId, password } = await req.json();

    if (!employeeId || !password) {
      return new Response(
        JSON.stringify({ error: "Employee ID and Password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error("Missing Supabase configuration environment variables.");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authClient = createClient(supabaseUrl, anonKey);

    const empCode = employeeId.trim().toUpperCase();

    // 1. Retrieve the employee profile
    const { data: initialProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, failed_attempts, locked_until, first_name, last_name, role, office_id")
      .eq("employee_code", empCode)
      .maybeSingle();

    let profile = initialProfile;

    if (profileError || !profile) {
      // Try resolving by email directly as a fallback
      const { data: profileByEmail } = await supabase
        .from("profiles")
        .select("id, email, failed_attempts, locked_until, first_name, last_name, role, office_id")
        .eq("email", employeeId.trim().toLowerCase())
        .maybeSingle();
      
      profile = profileByEmail;
    }

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Invalid Employee ID or Password" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Validate brute-force lockout
    const now = new Date();
    if (profile.locked_until && new Date(profile.locked_until) > now) {
      const waitMs = new Date(profile.locked_until).getTime() - now.getTime();
      const waitMin = Math.ceil(waitMs / 60000);
      return new Response(
        JSON.stringify({ error: `Account locked due to multiple failures. Try again in ${waitMin} minute(s).` }),
        { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Authenticate user against Supabase Auth
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password: password
    });

    if (authError || !authData.session) {
      console.warn(`Failed login attempt for ${profile.email}: ${authError?.message}`);
      
      const nextAttempts = (profile.failed_attempts ?? 0) + 1;
      const updateData: Record<string, string | number | null> = { failed_attempts: nextAttempts };
      
      if (nextAttempts >= 5) {
        updateData.locked_until = new Date(now.getTime() + 15 * 60000).toISOString();
      }

      await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", profile.id);

      const errorMsg = nextAttempts >= 5
        ? "Too many failed attempts. Account locked for 15 minutes."
        : "Invalid Employee ID or Password";

      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. On success: Reset attempts and return token session
    await supabase
      .from("profiles")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("id", profile.id);

    return new Response(
      JSON.stringify({
        success: true,
        session: authData.session,
        employee: {
          employeeId: empCode,
          name: `${profile.first_name} ${profile.last_name}`.trim() || "Employee",
          department: "Operational Excellence",
          office_id: profile.office_id,
          role: profile.role,
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Login edge function error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected server error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
