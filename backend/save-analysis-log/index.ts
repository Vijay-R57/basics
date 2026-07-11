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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { employeeId, employeeName, department, officeName, beforeImage, analysisResult, scoringMethod } = await req.json();

    const { data, error } = await supabase
      .from("analysis_logs")
      .insert({
        employee_id: employeeId,
        employee_name: employeeName,
        department: department,
        office_name: officeName,
        before_image: beforeImage,
        analysis_result: analysisResult,
        scoring_method: scoringMethod || "AI Audit V2 (Rating-Based)",
        upload_status: "uploaded"
      })
      .select()
      .single();

    if (error) {
      console.error("Database save failed:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        logId: data.id,
        beforeImagePath: data.before_image_path,
        uploadStatus: data.upload_status
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Failed to save analysis log";
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { port: Number(Deno.env.get("PORT") ?? 8000) });
