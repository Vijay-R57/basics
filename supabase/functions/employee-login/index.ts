import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { employeeId, password } = await req.json();

    if (!employeeId || !password) {
      return new Response(
        JSON.stringify({ error: "Employee ID and Password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const empCode = employeeId.trim().toUpperCase();
    const email = `${empCode.toLowerCase()}@arcolab.com`;

    // Sign in using Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.session) {
      return new Response(
        JSON.stringify({ error: authError?.message || "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch user profile from public.profiles
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authData.session.user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({
          success: true,
          session: authData.session,
          employee: {
            employeeId: empCode,
            name: `Employee (${empCode})`,
            department: "Operational Excellence",
            office_id: "office-1",
            role: "admin",
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        session: authData.session,
        employee: {
          employeeId: profile.employee_code || empCode,
          name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || `Employee (${empCode})`,
          department: profile.department || "Operational Excellence",
          office_id: profile.office_id,
          role: profile.role || "auditor",
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "An unexpected server error occurred";
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { port: Number(Deno.env.get("PORT") ?? 8000) });
