import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { beforeImage, afterImage } = await req.json();

    if (!beforeImage || !afterImage) {
      return new Response(
        JSON.stringify({ error: "Both before and after images are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const CV_ENGINE_URL = Deno.env.get("CV_ENGINE_URL");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    // ── Phase 1: Call FastAPI Deterministic CV Engine ────────────────────────
    if (CV_ENGINE_URL) {
      console.log(`[analyze-5s] Calling CV Engine at: ${CV_ENGINE_URL}`);

      try {
        const cvResponse = await fetch(`${CV_ENGINE_URL}/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "bypass-tunnel-reminder": "true",   // required for localtunnel dev tunnels
          },
          body: JSON.stringify({
            before_image: beforeImage,
            after_image: afterImage,
            gemini_api_key: GEMINI_API_KEY,
          }),
        });

        if (!cvResponse.ok) {
          const errorText = await cvResponse.text();
          console.error(`[analyze-5s] CV Engine error: ${cvResponse.status} ${errorText}`);
          return new Response(
            JSON.stringify({ error: "Deterministic CV Engine temporarily unavailable." }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const cvData = await cvResponse.json();
        console.log(`[analyze-5s] CV Engine success — scoring method: ${cvData.scoring_method}`);

        const transformed = transformCVResponse(cvData);
        return new Response(JSON.stringify(transformed), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      } catch (err: unknown) {
        console.error(`[analyze-5s] Network error connecting to CV Engine:`, err);
        return new Response(
          JSON.stringify({ error: "Deterministic CV Engine temporarily unavailable." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      console.error("[analyze-5s] CV_ENGINE_URL is not set.");
      return new Response(
        JSON.stringify({ error: "Deterministic CV Engine temporarily unavailable." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (e) {
    console.error("analyze-5s error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

interface CVEngineResponse {
  overview?: string;
  scoring_method?: string;
  before_scores?: Record<string, number>;
  after_scores?: Record<string, number>;
  before_explanations?: Record<string, string>;
  after_explanations?: Record<string, string>;
  recommendations?: string[];
  improvements?: string[];
  root_cause_observations?: string[];
  safety_recommendations?: string[];
  lean_maintenance_explanation?: string;
  before_metrics?: unknown;
  after_metrics?: unknown;
}

/**
 * Transforms the CV Engine's snake_case response into the camelCase schema
 * the existing frontend already expects.
 */
function transformCVResponse(cv: CVEngineResponse): Record<string, unknown> {
  const toPercent = (score20: number) => Math.round(Math.min(100, score20 * 5));

  const mapScores = (s?: Record<string, number>) => ({
    sort: s ? toPercent(s.sort ?? 0) : 0,
    setInOrder: s ? toPercent(s.set_in_order ?? 0) : 0,
    shine: s ? toPercent(s.shine ?? 0) : 0,
    standardize: s ? toPercent(s.standardize ?? 0) : 0,
    sustain: s ? toPercent(s.sustain ?? 0) : 0,
  });

  const mapExplanations = (e?: Record<string, string>) => ({
    sort: e?.sort ?? "",
    setInOrder: e?.set_in_order ?? "",
    shine: e?.shine ?? "",
    standardize: e?.standardize ?? "",
    sustain: e?.sustain ?? "",
  });

  return {
    overview: cv.overview,
    beforeScores: mapScores(cv.before_scores),
    afterScores: mapScores(cv.after_scores),
    beforeExplanations: mapExplanations(cv.before_explanations),
    afterExplanations: mapExplanations(cv.after_explanations),
    recommendations: cv.recommendations ?? [],
    improvements: cv.improvements ?? [],
    rootCauseObservations: cv.root_cause_observations ?? [],
    safetyRecommendations: cv.safety_recommendations ?? [],
    leanMaintenanceScore: cv.before_scores?.lean_maintenance ?? 0,
    leanMaintenanceScoreAfter: cv.after_scores?.lean_maintenance ?? 0,
    leanMaintenanceExplanation: cv.lean_maintenance_explanation ?? "",
    scoringMethod: "CV Engine",
    rawScoringMethod: cv.scoring_method || "CV Engine (Deterministic)",
    beforeMetrics: cv.before_metrics,
    afterMetrics: cv.after_metrics,
  };
}
