import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "5s-images";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      employeeId,
      employeeName,
      department,
      officeName,
      beforeImage,
      afterImage,
      analysisResult,
      scoringMethod,
      cvMetrics,
      beforeGeo,
      afterGeo,
      capturedAt,
    } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeDept = (department || "unknown").replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const safeEmpId = (employeeId || "unknown").replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const pathPrefix = `${safeDept}/${safeEmpId}/${timestamp}`;

    let beforeImagePath: string | null = null;
    let afterImagePath: string | null = null;
    let uploadStatus = "uploaded";
    let uploadErrorStr: string | null = null;

    const uploadImage = async (base64: string, label: "before" | "after") => {
      // Strip data URL prefix and decode
      const raw = base64.includes(",") ? base64.split(",")[1] : base64;
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const path = `${pathPrefix}/${label}.jpg`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (error) {
        throw error;
      }
      return path;
    };

    // ── Upload images to Storage (Data Flywheel) ─────────────────────────────
    try {
      if (beforeImage && afterImage) {
        const [beforePath, afterPath] = await Promise.all([
          uploadImage(beforeImage, "before"),
          uploadImage(afterImage, "after"),
        ]);
        beforeImagePath = beforePath;
        afterImagePath = afterPath;
      } else {
        throw new Error("Missing beforeImage or afterImage base64 payloads");
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[save-log] Image storage upload failed:", errMsg);
      beforeImagePath = null;
      afterImagePath = null;
      uploadStatus = "pending";
      uploadErrorStr = errMsg;
    }

    // ── Insert log row into PostgreSQL (NEVER persist base64 blobs) ──────────
    const { error } = await supabase.from("analysis_logs").insert({
      employee_id: employeeId,
      employee_name: employeeName,
      department: department,
      office_name: officeName ?? null,
      before_image: null, // Purge all base64 relational persistence plans
      after_image: null,
      before_image_path: beforeImagePath,
      after_image_path: afterImagePath,
      analysis_result: analysisResult,
      scoring_method: scoringMethod ?? "CV Engine",
      cv_metrics: cvMetrics ?? null,
      before_latitude: beforeGeo?.latitude ?? null,
      before_longitude: beforeGeo?.longitude ?? null,
      before_captured_at: beforeGeo?.capturedAt ?? null,
      after_latitude: afterGeo?.latitude ?? null,
      after_longitude: afterGeo?.longitude ?? null,
      after_captured_at: afterGeo?.capturedAt ?? null,
      captured_at: capturedAt ?? null,
      upload_status: uploadStatus,
      retry_count: 0,
      upload_error: uploadErrorStr,
    });

    if (error) throw error;

    return new Response(
      JSON.stringify({
        success: true,
        beforeImagePath,
        afterImagePath,
        uploadStatus,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Failed to save analysis log";
    console.error("Save analysis log error:", err);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
