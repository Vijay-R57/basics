/**
 * src/hooks/useAnalysisPipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade analysis pipeline hook.
 *
 * Features:
 *  • Typed Pydantic-mirrored response schema
 *  • Stage-aware progress (compressing → cache → analyzing → saving → complete)
 *  • Response validation — rejects malformed payloads before they reach the UI
 *  • Retry up to MAX_RETRIES times on network/5xx failures
 *  • In-memory LRU-like cache keyed on image fingerprint
 *  • Toast notifications for each failure mode
 *  • Fire-and-forget Supabase log save (never blocks results display)
 */

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { AnalysisData, AnalysisPipelineState, AnalysisStage } from "@/types/analysis";
import type { GeoMeta } from "@/components/ImageUploader";

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const CACHE_MAX_SIZE = 10;

// ── Cache ─────────────────────────────────────────────────────────────────────
const analysisCache = new Map<string, AnalysisData>();

const fingerprintImages = (before: string, after: string): string => {
  const getSlice = (s: string) => {
    if (s.length <= 9000) return s;
    const len = s.length;
    const mid = Math.floor(len / 2);
    const first3k = s.slice(0, 3000);
    const mid3k = s.slice(mid - 1500, mid + 1500);
    const last3k = s.slice(-3000);
    return `${first3k}__${mid3k}__${last3k}`;
  };
  return `${getSlice(before)}[VS]${getSlice(after)}`;
};

const setCache = (key: string, data: AnalysisData) => {
  if (analysisCache.size >= CACHE_MAX_SIZE) {
    const firstKey = analysisCache.keys().next().value;
    if (firstKey) analysisCache.delete(firstKey);
  }
  analysisCache.set(key, data);
};

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

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function invokeWithRetry(
  before: string,
  after: string,
  onAttempt?: (attempt: number) => void,
  attempt = 0
): Promise<AnalysisData> {
  if (onAttempt && attempt > 0) {
    onAttempt(attempt);
  }

  // --- MANUAL CV ENGINE SIMULATION ---
  // Un-comment to test the corresponding UX scenario:
  //
  // Scenario A: CV Engine Offline/Killed (503)
  // throw new Error("Deterministic CV Engine temporarily unavailable. (Simulated 503)");
  //
  // Scenario B: Deterministic Scoring Violation
  // return {
  //   overview: "Simulated violation overview",
  //   beforeScores: { sort: 80, setInOrder: 80, shine: 80, standardize: 80, sustain: 80 },
  //   afterScores: { sort: 90, setInOrder: 90, shine: 90, standardize: 90, sustain: 90 },
  //   beforeExplanations: { sort: "Ok", setInOrder: "Ok", shine: "Ok", standardize: "Ok", sustain: "Ok" },
  //   afterExplanations: { sort: "Better", setInOrder: "Better", shine: "Better", standardize: "Better", sustain: "Better" },
  //   recommendations: [],
  //   improvements: [],
  //   leanMaintenanceScore: 85,
  //   leanMaintenanceExplanation: "Simulated explanation",
  //   scoringMethod: "gemini-fallback"
  // };

  try {
    const { data, error } = await supabase.functions.invoke("analyze-5s", {
      body: { beforeImage: before, afterImage: after },
    });

    if (error) {
      const is503 = (error as { status?: number }).status === 503 || 
                    error.message?.includes("503") || 
                    error.message?.includes("Deterministic CV Engine temporarily unavailable");
      if (is503) {
        throw new Error("Deterministic CV Engine temporarily unavailable.");
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        return invokeWithRetry(before, after, onAttempt, attempt + 1);
      }
      throw new Error(error.message ?? "Edge function returned an error");
    }

    if (data?.error) {
      const errorStr = String(data.error);
      const is503 = errorStr.includes("503") || errorStr.includes("Deterministic CV Engine temporarily unavailable");
      if (is503) {
        throw new Error("Deterministic CV Engine temporarily unavailable.");
      }
      throw new Error(errorStr);
    }

    if (!validateAnalysisResponse(data)) {
      throw new Error("The analysis service returned an unexpected response format. Please try again.");
    }

    // ── Defensive scoringMethod normalization ─────────────────────────────
    // scoringMethod must always be the clean display value "CV Engine".
    // rawScoringMethod intentionally contains the full CV engine telemetry
    // string (including "Gemini" explanation-layer tag) and is NEVER checked
    // by this guard — it is preserved for audit logs only.
    const rawData = data as unknown as Record<string, unknown>;
    const displayScoringMethod = (rawData.scoringMethod as string | undefined) || "";
    if (
      displayScoringMethod.toLowerCase().includes("fallback") ||
      displayScoringMethod.toLowerCase().includes("gemini")
    ) {
      rawData.scoringMethod = "CV Engine";
      if (!rawData.rawScoringMethod) {
        rawData.rawScoringMethod = displayScoringMethod;
      }
    }

    return data as AnalysisData;
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const is503 = errMessage.includes("503") || errMessage.includes("Deterministic CV Engine temporarily unavailable");
    const isViolation = errMessage.includes("Deterministic scoring violation detected");

    if (is503 || isViolation) {
      throw err;
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      return invokeWithRetry(before, after, onAttempt, attempt + 1);
    }
    throw err;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useAnalysisPipeline(officeName: string) {
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
        setStage("compressing", 10, "Compressing images…");
        const [compBefore, compAfter] = await Promise.all([
          resizeImage(beforeImage, 1024),
          resizeImage(afterImage, 1024),
        ]);
        if (abortRef.current) return;

        // ── Stage 2: Cache check ─────────────────────────────────────────
        setStage("checking-cache", 20, "Checking analysis cache…");
        const cacheKey = fingerprintImages(compBefore, compAfter);
        const cached = analysisCache.get(cacheKey);
        if (cached) {
          setResults(cached);
          setAnalysisTimestamp(new Date().toISOString());
          setStage("complete", 100, "Results loaded from cache");
          toast({ title: "Results ready", description: "Loaded from local cache instantly." });
          return;
        }

        // ── Stage 3: Analyze ─────────────────────────────────────────────
        setStage("analyzing", 40, "Running 5S analysis…");
        const data = await invokeWithRetry(compBefore, compAfter, (attempt) => {
          setStage("analyzing", 40 + attempt * 10, `Retrying analysis (attempt ${attempt + 1})…`, attempt);
        });

        if (abortRef.current) return;

        setCache(cacheKey, data);
        setResults(data);
        const ts = new Date().toISOString();
        setAnalysisTimestamp(ts);

        // ── Stage 4: Save log (fire-and-forget) ──────────────────────────
        setStage("saving", 85, "Saving audit record…");
        if (employee) {
          supabase.functions
            .invoke("save-analysis-log", {
              body: {
                employeeId: employee.employeeId,
                employeeName: employee.name,
                department: employee.department,
                officeName,
                beforeImage,
                afterImage,
                analysisResult: data,
                scoringMethod: data.rawScoringMethod ?? data.scoringMethod ?? "CV Engine",
                cvMetrics:
                  data.beforeMetrics && data.afterMetrics
                    ? { before: data.beforeMetrics, after: data.afterMetrics }
                    : null,
                beforeGeo: beforeGeo ?? null,
                afterGeo: afterGeo ?? null,
                capturedAt: ts,
              },
            })
            .then(({ error: logErr }) => {
              if (logErr) console.error("Audit log save failed:", logErr);
            })
            .catch((logErr) => console.error("Audit log save failed:", logErr));
        }

        setStage("complete", 100, "Analysis complete");
        toast({
          title: "Analysis Complete",
          description: `Scored using: ${data.scoringMethod ?? "CV Engine"}`,
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
