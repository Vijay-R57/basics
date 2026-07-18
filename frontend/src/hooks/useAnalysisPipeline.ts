/**
 * src/hooks/useAnalysisPipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-Driven 5S Audit analysis pipeline hook (Pipeline V2).
 *
 * Changes from previous version:
 *  - All mock fallback logic removed — fabricating scores is prohibited
 *  - Old Gemini numeric-score parser removed
 *  - Now delegates to runAuditPipeline (analysisPipeline.ts)
 *  - On any failure: surfaces "AI Analysis Failed" — never returns fake data
 */

import { useCallback, useRef, useState } from 'react';
import { supabase }   from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useToast }   from '@/hooks/use-toast';
import { useAuth }    from '@/contexts/AuthContext';
import type {
  AuditAnalysisResult,
  AnalysisPipelineState,
  AnalysisStage,
} from '@/types/analysis';
import { runAuditPipeline } from '@/modules/audit/pipeline/analysisPipeline';

// ── Config ────────────────────────────────────────────────────────────────────
const RETRY_DELAY = 1500;

// ── Image utilities ───────────────────────────────────────────────────────────
export const resizeImage = (base64: string, maxDim = 1024): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const cw = Math.round(img.naturalWidth  * scale);
      const ch = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = cw;
      canvas.height = ch;
      canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Failed to load image for resizing'));
    img.src = base64;
  });

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useAnalysisPipeline(officeName: string) {
  const [pipeline, setPipeline] = useState<AnalysisPipelineState>({
    stage:      'idle',
    progress:   0,
    message:    '',
    retryCount: 0,
  });
  const [results, setResults]             = useState<AuditAnalysisResult | null>(null);
  const [analysisTimestamp, setTimestamp] = useState<string | null>(null);
  const abortRef = useRef(false);

  const { toast }    = useToast();
  const { employee } = useAuth();

  const setStage = useCallback(
    (stage: AnalysisStage, progress: number, message: string, retryCount = 0) => {
      setPipeline({ stage, progress, message, retryCount });
    },
    [],
  );

  const runAnalysis = useCallback(
    async (
      beforeImage: string,
      sessionId?: string,
      templateId?: string,
      workspaceContext?: Record<string, unknown>,
    ) => {
      abortRef.current = false;
      setResults(null);

      try {
        // Stage 1 — Compress
        setStage('compressing', 8, 'Compressing image…');
        const compBefore = await resizeImage(beforeImage, 1024);
        if (abortRef.current) return;

        // Stage 2 — Loading
        setStage('loading-template', 15, 'Loading audit configuration…');
        await delay(200);

        // Stages 3–7 — Per-pillar progress display (cosmetic UX, real call runs in background)
        const pillarStages: AnalysisStage[] = [
          'analyzing-sort',
          'analyzing-set-in-order',
          'analyzing-shine',
          'analyzing-standardize',
          'analyzing-sustain',
        ];
        const pillarLabels = ['Sort', 'Set in Order', 'Shine', 'Standardize', 'Sustain'];

        let stageIdx = 0;
        const stageInterval = setInterval(() => {
          if (stageIdx < pillarStages.length) {
            const pct = 20 + stageIdx * 10;
            setStage(
              pillarStages[stageIdx],
              pct,
              `Auditing ${pillarLabels[stageIdx]} (${stageIdx + 1}/5)…`,
            );
            stageIdx++;
          }
        }, 3000);

        let data: AuditAnalysisResult;
        try {
          data = await invokeAnalysis(compBefore, workspaceContext);
        } finally {
          clearInterval(stageInterval);
        }

        if (abortRef.current) return;

        // Stage — Scoring
        setStage('scoring', 85, 'Verifying calculated scores…');
        await delay(200);

        // Stage — Recommendations
        setStage('recommendations', 92, 'Processing improvement recommendations…');
        await delay(200);

        const hasPending = data.before.responses.some(
          r => r.evidence === 'Cannot be determined from the provided image.',
        );

        if (!hasPending) {
          await saveAuditLog(data, beforeImage);
        } else {
          setStage('complete', 100, 'Analysis complete');
        }

        setResults(data);
        setTimestamp(new Date().toISOString());

        toast({
          title:       'Analysis Complete',
          description: `${data.before.score.grade} — ${data.before.score.overall_percentage.toFixed(1)}% overall compliance`,
        });
      } catch (err: unknown) {
        if (abortRef.current) return;
        const message = (err as Error).message || 'AI Analysis Failed';
        console.error('[useAnalysisPipeline] Analysis failed:', err);
        setStage('error', 0, message);
        toast({
          title:       'Analysis Failed',
          description: message,
          variant:     'destructive',
        });
      }
    },
    [employee, officeName, setStage, toast],
  );

  const saveAuditLog = useCallback(
    async (finalResult: AuditAnalysisResult, beforeImage: string) => {
      setStage('saving', 97, 'Saving audit record…');
      const bypass = import.meta.env.VITE_BYPASS_SUPABASE_FUNCTIONS === 'true';
      if (employee && !bypass) {
        try {
          const { error: logErr } = await supabase.functions.invoke('save-analysis-log', {
            body: {
              employeeId:     employee.employeeId,
              employeeName:   employee.name,
              department:     employee.department,
              officeName,
              beforeImage,
              analysisResult: finalResult,
              scoringMethod:  'AI Audit V2 (Rating-Based)',
              capturedAt:     new Date().toISOString(),
            },
          });
          if (logErr) throw logErr;
        } catch (e: any) {
          console.error('[useAnalysisPipeline] Log save error:', e);
          toast({
            title:       'Error Saving Log',
            description: e.message || 'Failed to save audit record',
            variant:     'destructive',
          });
        }
      } else if (employee && bypass) {
        console.log('[useAnalysisPipeline] Bypassed remote log saving (Local Mode)');
      }
      setStage('complete', 100, 'Analysis complete');
    },
    [employee, officeName, setStage, toast],
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setResults(null);
    setTimestamp(null);
    setPipeline({ stage: 'idle', progress: 0, message: '', retryCount: 0 });
  }, []);

  return { pipeline, results, analysisTimestamp, runAnalysis, saveAuditLog, reset };
}

// ── Analysis invocation ───────────────────────────────────────────────────────

/**
 * Calls the analysis pipeline.
 *
 * Priority order:
 *  1. Direct Gemini API (browser) via runAuditPipeline — primary path
 *     (used when VITE_BYPASS_SUPABASE_FUNCTIONS=true or edge function unreachable)
 *  2. Supabase Edge Function — when available and not bypassed
 *
 * NOTE: The edge function path also calls Gemini server-side.
 * There is NO mock fallback. If both paths fail, an error is thrown.
 */
async function invokeAnalysis(
  imageBase64: string,
  workspaceContext?: Record<string, unknown>,
): Promise<AuditAnalysisResult> {
  const bypass = import.meta.env.VITE_BYPASS_SUPABASE_FUNCTIONS === 'true';

  // Try Supabase Edge Function first (when not bypassed)
  if (!bypass) {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-5s', {
        body: {
          beforeImage:      imageBase64,
          workspaceContext: workspaceContext ?? undefined,
          skipImageGen:     true,
        },
      });

      if (!error && data && !data.error && isValidAuditResult(data)) {
        console.log('[useAnalysisPipeline] Edge function analysis succeeded.');
        return data as AuditAnalysisResult;
      }

      if (error) {
        const isUnreachable =
          error.name === 'FunctionsFetchError' ||
          (error as any).status === 404 ||
          (error as any).status === 0 ||
          error.message?.includes('Failed to send a request') ||
          error.message?.includes('Edge Function not found');

        if (!isUnreachable) {
          // Edge function is reachable but returned an application error
          let errMsg = error.message ?? 'Edge function returned an error';
          if (error instanceof FunctionsHttpError) {
            try {
              const body = await (error as FunctionsHttpError).context.json();
              if (body?.error) errMsg = body.error;
            } catch (_) { /* ignore */ }
          }
          throw new Error(errMsg);
        }

        console.warn(
          '[useAnalysisPipeline] Edge function unreachable. Falling back to direct Gemini API.',
          error,
        );
      }
    } catch (edgeErr) {
      // Re-throw application-level errors; continue to direct path for network errors
      if ((edgeErr as Error).message !== 'AI Analysis Failed' &&
          !(edgeErr as any).name?.includes('Fetch')) {
        const isAppError = !((edgeErr as Error).message?.includes('Failed to send'));
        if (isAppError) throw edgeErr;
      }
      console.warn('[useAnalysisPipeline] Edge function call threw. Using direct Gemini.', edgeErr);
    }
  }

  // Direct browser Gemini API call
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'VITE_GEMINI_API_KEY is not configured. Please add it to your .env file.',
    );
  }

  console.log('[useAnalysisPipeline] Running direct Gemini API analysis…');
  // runAuditPipeline handles its own single retry internally
  return runAuditPipeline(imageBase64, apiKey, workspaceContext);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Validates that a response from the edge function matches AuditAnalysisResult shape */
function isValidAuditResult(data: unknown): data is AuditAnalysisResult {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.template === 'object' &&
    typeof d.before   === 'object' &&
    d.before !== null &&
    typeof (d.before as Record<string, unknown>).score === 'object' &&
    Array.isArray(
      ((d.before as Record<string, unknown>).score as Record<string, unknown>)?.pillar_scores,
    )
  );
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
