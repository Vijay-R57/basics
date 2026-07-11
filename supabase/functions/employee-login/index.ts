import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    const empCode = employeeId.trim().toUpperCase();

    // Mock response for login
    return new Response(
      JSON.stringify({
        success: true,
        session: {
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          user: {
            id: "mock-user-id",
            email: `${empCode.toLowerCase()}@arcolab.com`,
          }
        },
        employee: {
          employeeId: empCode,
          name: "Mock Employee",
          department: "Operational Excellence",
          office_id: "office-1",
          role: "admin",
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "An unexpected server error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { port: Number(Deno.env.get("PORT") ?? 8000) });
