/**
 * src/modules/comparison/hooks/useComparisonPipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone Gemini-Only 5S Comparison Analysis Pipeline hook.
 * Adheres to 5S_Audit_Structured_Prompting_Philosophy.md.
 *
 * Features:
 *  • Gemini 3.6 Flash / Flash-Latest Vision AI as single source of truth for 5S evaluation
 *  • Multi-model & multi-key automatic fallback
 *  • Local audit history persistence in localStorage (`arcolab_analysis_logs`)
 *  • Storage log persistence via Supabase Edge Function `save-comparison-log`
 */

import { useCallback, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { AnalysisData, AnalysisPipelineState, AnalysisStage } from "../types/comparison";
import type { GeoMeta } from "@/components/ImageUploader";
import { supabase } from "@/integrations/supabase/client";

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

// ── Image utilities ───────────────────────────────────────────────────────────
export const resizeImage = (base64: string, maxDim = 1024): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const cw = Math.round(img.naturalWidth * scale);
      const ch = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext("2d")!.drawImage(img, 0, 0, cw, ch);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("Failed to load image for resizing"));
    img.src = base64;
  });

// ── Response validator ────────────────────────────────────────────────────────
function validateAnalysisResponse(data: unknown): data is AnalysisData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  const hasScores =
    typeof d.beforeScores === "object" &&
    typeof d.afterScores === "object" &&
    d.beforeScores !== null &&
    d.afterScores !== null;
  const hasContent =
    typeof d.overview === "string" &&
    Array.isArray(d.recommendations) &&
    Array.isArray(d.improvements);
  return hasScores && hasContent;
}

// ── Direct Gemini Vision Client with Verified Active Models ───────────────────
async function analyzeWithGeminiDirect(
  before: string,
  after: string,
  officeName: string,
  zone: string
): Promise<AnalysisData> {
  const keys = Array.from(new Set([
    import.meta.env.VITE_GEMINI_API_KEY,
    import.meta.env.GEMINI_API_KEY,
    import.meta.env.NEXT_PUBLIC_GEMINI_API_KEY,
    localStorage.getItem("arcolab_gemini_api_key")
  ].filter(Boolean))) as string[];

  const models = [
    "gemini-3.6-flash",
    "gemini-flash-latest"
  ];

  const cleanBefore = before.includes(",") ? before.split(",")[1] : before;
  const cleanAfter = after.includes(",") ? after.split(",")[1] : after;

  const systemPrompt = `
SYSTEM PERSONA:
You are a Senior Industrial 5S Auditor & Lean Manufacturing Specialist conducting a 5S Comparison Analysis.

GLOBAL RULES:
1. EMPIRICAL VISUAL EVIDENCE ONLY: Every score, explanation, improvement, regression, and recommendation must be grounded strictly in visually observable evidence from the uploaded Before and After images. Never infer conditions outside the visible scene.
2. WORKSPACE CONTEXT BOUNDARY: Workspace Context (Facility/Office, Zone) is provided solely for contextual understanding of operational purpose. It MUST NEVER become visual evidence. Never assume an object, label, eyewash, or tool exists or is missing simply because of the Workspace Context.
3. COMPARATIVE EVIDENCE & UNCERTAINTY DIRECTIVES:
   - Compare only visually observable differences between Image 1 (Before) and Image 2 (After).
   - If an item or area cannot be visually confirmed in one or both images due to lighting, angle, or occlusion, do NOT infer improvement, deterioration, compliance, or non-compliance. State explicitly that it cannot be determined from visual evidence.
   - Categorize findings into Improvements, Regressions, Unchanged Conditions, and Remaining Issues.
4. ZERO SCORING OFFLOADING CONSTRAINTS: Evaluate 5S pillars directly on a scale of 0 to 20 points per pillar (0=Critical Non-Compliance, 20=World-Class Excellence):
   - Sort (Seiri): Clutter removal, unnecessary items, obstruction elimination.
   - Set in Order (Seiton): Tool indexing, shadow boards, designated storage, visible labels.
   - Shine (Seiso): Surface cleanliness, dust/spill removal, equipment hygiene.
   - Standardize (Seiketsu): Visual controls, color coding, standardized layout.
   - Sustain (Shitsuke): Discipline, habituation, safety compliance, hazard elimination.
5. RECOMMENDATION RULES: Ground all recommendations in visible defects or remaining issues. Prioritize practical, actionable corrective steps.

WORKSPACE CONTEXT:
- Facility/Office: ${officeName || "General Industrial Workplace"}
- Audit Zone: ${zone || "General Production/Lab Area"}

Return structured JSON adhering strictly to the required format:
{
  "overview": "High-level summary of 5S changes",
  "before_scores": { "sort": 12, "set_in_order": 12, "shine": 12, "standardize": 12, "sustain": 12 },
  "after_scores": { "sort": 16, "set_in_order": 16, "shine": 16, "standardize": 16, "sustain": 16 },
  "before_explanations": { "sort": "...", "set_in_order": "...", "shine": "...", "standardize": "...", "sustain": "..." },
  "after_explanations": { "sort": "...", "set_in_order": "...", "shine": "...", "standardize": "...", "sustain": "..." },
  "recommendations": ["..."],
  "improvements": ["..."],
  "root_cause_observations": ["..."],
  "safety_recommendations": ["..."],
  "lean_maintenance_score": 15,
  "lean_maintenance_score_after": 18,
  "lean_maintenance_explanation": "..."
}
`;

  let lastError: Error | null = null;

  for (const apiKey of keys) {
    for (const model of models) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        console.log(`[useComparisonPipeline] Calling Gemini API (Model: ${model})...`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: systemPrompt },
                  { inlineData: { mimeType: "image/jpeg", data: cleanBefore } },
                  { inlineData: { mimeType: "image/jpeg", data: cleanAfter } }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[useComparisonPipeline] Model ${model} returned HTTP ${res.status}:`, errText);
          continue;
        }

        const resData = await res.json();
        const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        const parsed = JSON.parse(rawText);
        const toPercent = (score: number) => Math.round(Math.min(100, Math.max(0, (score ?? 0) * 5)));

        return {
          overview: parsed.overview || "5S workplace comparison complete.",
          scoringMethod: `Gemini Vision (${model})`,
          beforeScores: {
            sort: toPercent(parsed.before_scores?.sort ?? parsed.beforeScores?.sort ?? 12),
            setInOrder: toPercent(parsed.before_scores?.set_in_order ?? parsed.beforeScores?.setInOrder ?? 12),
            shine: toPercent(parsed.before_scores?.shine ?? parsed.beforeScores?.shine ?? 12),
            standardize: toPercent(parsed.before_scores?.standardize ?? parsed.beforeScores?.standardize ?? 12),
            sustain: toPercent(parsed.before_scores?.sustain ?? parsed.beforeScores?.sustain ?? 12),
          },
          afterScores: {
            sort: toPercent(parsed.after_scores?.sort ?? parsed.afterScores?.sort ?? 16),
            setInOrder: toPercent(parsed.after_scores?.set_in_order ?? parsed.afterScores?.setInOrder ?? 16),
            shine: toPercent(parsed.after_scores?.shine ?? parsed.afterScores?.shine ?? 16),
            standardize: toPercent(parsed.after_scores?.standardize ?? parsed.afterScores?.standardize ?? 16),
            sustain: toPercent(parsed.after_scores?.sustain ?? parsed.afterScores?.sustain ?? 16),
          },
          beforeExplanations: {
            sort: parsed.before_explanations?.sort ?? parsed.beforeExplanations?.sort ?? "",
            setInOrder: parsed.before_explanations?.set_in_order ?? parsed.beforeExplanations?.setInOrder ?? "",
            shine: parsed.before_explanations?.shine ?? parsed.beforeExplanations?.shine ?? "",
            standardize: parsed.before_explanations?.standardize ?? parsed.beforeExplanations?.standardize ?? "",
            sustain: parsed.before_explanations?.sustain ?? parsed.beforeExplanations?.sustain ?? "",
          },
          afterExplanations: {
            sort: parsed.after_explanations?.sort ?? parsed.afterExplanations?.sort ?? "",
            setInOrder: parsed.after_explanations?.set_in_order ?? parsed.afterExplanations?.setInOrder ?? "",
            shine: parsed.after_explanations?.shine ?? parsed.afterExplanations?.shine ?? "",
            standardize: parsed.after_explanations?.standardize ?? parsed.afterExplanations?.standardize ?? "",
            sustain: parsed.after_explanations?.sustain ?? parsed.afterExplanations?.sustain ?? "",
          },
          recommendations: parsed.recommendations || [],
          improvements: parsed.improvements || [],
          rootCauseObservations: parsed.root_cause_observations ?? parsed.rootCauseObservations ?? [],
          safetyRecommendations: parsed.safety_recommendations ?? parsed.safetyRecommendations ?? [],
          leanMaintenanceScore: toPercent(parsed.lean_maintenance_score ?? parsed.leanMaintenanceScore ?? 15),
          leanMaintenanceScoreAfter: toPercent(parsed.lean_maintenance_score_after ?? parsed.leanMaintenanceScoreAfter ?? 18),
          leanMaintenanceExplanation: parsed.lean_maintenance_explanation ?? parsed.leanMaintenanceExplanation ?? "",
          comparisonSummary: parsed.comparison_summary ?? parsed.comparisonSummary ?? ""
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[useComparisonPipeline] Error with ${model}:`, lastError.message);
      }
    }
  }

  throw lastError || new Error("Gemini API call failed. Please check your network connection and retry.");
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function invokeWithRetry(
  before: string,
  after: string,
  officeName: string,
  zone: string,
  onAttempt?: (attempt: number) => void,
  attempt = 0
): Promise<AnalysisData> {
  if (onAttempt && attempt > 0) {
    onAttempt(attempt);
  }

  try {
    const directData = await analyzeWithGeminiDirect(before, after, officeName, zone);
    if (validateAnalysisResponse(directData)) {
      return directData;
    }
  } catch (err: unknown) {
    console.warn(`[useComparisonPipeline] Gemini attempt ${attempt + 1} failed:`, err);
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      return invokeWithRetry(before, after, officeName, zone, onAttempt, attempt + 1);
    }
    throw err;
  }

  throw new Error("Unable to complete Gemini 5S analysis.");
}

// ── Local Log Saver ───────────────────────────────────────────────────────────
function saveLocalAuditLog(log: Record<string, unknown>) {
  try {
    const existingStr = localStorage.getItem("arcolab_analysis_logs");
    const existing = existingStr ? JSON.parse(existingStr) : [];
    existing.unshift(log);
    localStorage.setItem("arcolab_analysis_logs", JSON.stringify(existing.slice(0, 50)));
  } catch (err) {
    console.error("Failed to save audit log locally:", err);
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useComparisonPipeline(officeName: string) {
  const [pipeline, setPipeline] = useState<AnalysisPipelineState>({
    stage: "idle",
    progress: 0,
    message: "",
    retryCount: 0,
  });
  const [results, setResults] = useState<AnalysisData | null>(null);
  const [analysisTimestamp, setAnalysisTimestamp] = useState<string | null>(null);
  const abortRef = useRef(false);

  const { toast } = useToast();
  const { employee } = useAuth();

  const setStage = useCallback(
    (stage: AnalysisStage, progress: number, message: string, retryCount = 0) => {
      setPipeline({ stage, progress, message, retryCount });
    },
    []
  );

  const runAnalysis = useCallback(
    async (
      beforeImage: string,
      afterImage: string,
      beforeGeo: GeoMeta | null,
      afterGeo: GeoMeta | null
    ) => {
      abortRef.current = false;
      setResults(null);

      try {
        // ── Stage 1: Compress ────────────────────────────────────────────
        setStage("compressing", 15, "Compressing high-resolution images…");
        const [compBefore, compAfter] = await Promise.all([
          resizeImage(beforeImage, 1024),
          resizeImage(afterImage, 1024),
        ]);
        if (abortRef.current) return;

        // ── Stage 2: Analyze via Gemini Vision AI ────────────────────────
        setStage("analyzing", 45, "Running Gemini Vision 5S comparison analysis…");
        const zone = beforeGeo?.zone || afterGeo?.zone || "General Workplace";
        const data = await invokeWithRetry(compBefore, compAfter, officeName, zone, (attempt) => {
          setStage("analyzing", 45 + attempt * 15, `Retrying Gemini analysis (attempt ${attempt + 1})…`, attempt);
        });

        if (abortRef.current) return;

        setResults(data);
        const ts = new Date().toISOString();
        setAnalysisTimestamp(ts);

        // ── Stage 3: Save log (Local Storage & Supabase DB) ────────────────
        setStage("saving", 85, "Saving audit record…");
        
        const logPayload = {
          id: `audit_${Date.now()}`,
          employee_id: employee?.employeeId || "ARC100",
          employee_name: employee?.name || "Operational Auditor",
          department: employee?.department || "Quality Assurance",
          office_name: officeName || "Arcolab Corporate HQ",
          before_image: compBefore,
          after_image: compAfter,
          analysis_result: data,
          scoring_method: data.scoringMethod || "Gemini Vision",
          before_latitude: beforeGeo?.latitude ?? null,
          before_longitude: beforeGeo?.longitude ?? null,
          before_captured_at: beforeGeo?.capturedAt ?? null,
          after_latitude: afterGeo?.latitude ?? null,
          after_longitude: afterGeo?.longitude ?? null,
          after_captured_at: afterGeo?.capturedAt ?? null,
          captured_at: ts,
        };

        // Save locally
        saveLocalAuditLog(logPayload);

        // Save to Supabase database via Edge Function or direct client fallback
        try {
          const { error: fnErr } = await supabase.functions.invoke("save-comparison-log", {
            body: {
              employeeId: employee?.employeeId || "ARC100",
              employeeName: employee?.name || "Operational Auditor",
              department: employee?.department || "Quality Assurance",
              officeName: officeName || "Arcolab Corporate HQ",
              beforeImage: compBefore,
              afterImage: compAfter,
              analysisResult: data,
              scoringMethod: data.scoringMethod || "Gemini Vision",
              beforeGeo,
              afterGeo,
              capturedAt: ts,
            },
          });

          if (fnErr) {
            console.warn("[useComparisonPipeline] Edge function save-comparison-log failed. Inserting directly to DB...", fnErr);
            await (supabase.from("analysis_logs" as never) as any).insert({
              employee_id: employee?.employeeId || "ARC100",
              employee_name: employee?.name || "Operational Auditor",
              department: employee?.department || "Quality Assurance",
              office_name: officeName || "Arcolab Corporate HQ",
              before_image: compBefore,
              after_image: compAfter,
              analysis_result: data,
              scoring_method: data.scoringMethod || "Gemini Vision",
              created_at: ts,
            });
          }
        } catch (dbErr) {
          console.warn("[useComparisonPipeline] Direct DB log saver fallback warning:", dbErr);
        }

        setStage("complete", 100, "Analysis complete");
        toast({
          title: "Comparison Complete",
          description: `Scored using: ${data.scoringMethod || "Gemini Vision AI"}`,
        });
      } catch (err: unknown) {
        if (abortRef.current) return;
        const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
        console.error("Analysis pipeline error:", err);
        setStage("error", 0, message);
        toast({
          title: "Analysis Failed",
          description: message,
          variant: "destructive",
        });
      }
    },
    [employee, officeName, setStage, toast]
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setResults(null);
    setAnalysisTimestamp(null);
    setPipeline({ stage: "idle", progress: 0, message: "", retryCount: 0 });
  }, []);

  return { pipeline, results, analysisTimestamp, runAnalysis, reset };
}
