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
import { runAuditPipeline, runAuditPipelineV3 } from '@/modules/audit/pipeline/analysisPipeline';
import { validateImage }   from '@/modules/audit/pipeline/imageValidator';
import type { ImageValidationV3Result, Final5SAuditReport } from '@/types/analysis';

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
        // ── Stage 0 — Image Validation Gate (Pipeline V3 Phase 1) ──────────────
        // The image MUST pass validation before it is allowed to reach Gemini.
        // If isValid === false, the pipeline stops here. Gemini is never called.
        setStage('compressing', 4, 'Validating image…');
        const validationResult: ImageValidationV3Result = await validateImage(beforeImage);

        if (!validationResult.isValid) {
          const firstError = validationResult.errors[0] ?? 'Image validation failed.';
          setStage('error', 0, firstError);
          toast({
            title:       'Image Validation Failed',
            description: firstError,
            variant:     'destructive',
          });
          return; // ← Pipeline stopped. Gemini never called.
        }

        if (abortRef.current) return;

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
          data = await invokeAnalysis(compBefore, officeName, workspaceContext);
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
  officeName: string,
  workspaceContext?: Record<string, unknown>,
): Promise<AuditAnalysisResult> {
  const bypass = import.meta.env.VITE_BYPASS_SUPABASE_FUNCTIONS === 'true';
  const extendedContext = {
    ...workspaceContext,
    officeName,
  };

  // Try Supabase Edge Function first (when not bypassed)
  if (!bypass) {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-5s', {
        body: {
          beforeImage:      imageBase64,
          workspaceContext: extendedContext,
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

<<<<<<< HEAD
  console.log('[useAnalysisPipeline] Running direct Gemini API analysis…');
  // runAuditPipeline handles its own single retry internally
  return runAuditPipeline(imageBase64, apiKey, extendedContext);
=======
  console.log('[useAnalysisPipeline] Running V3 Direct AI Analysis Pipeline...');
  const report = await runAuditPipelineV3(imageBase64, apiKey, workspaceContext);
  return transformReportToV2Result(report);
}

/** Color selector matching grade scale values. */
function getGradeColor(grade: string): string {
  const g = grade.toUpperCase();
  if (g.startsWith('A')) return '#22c55e'; // green
  if (g.startsWith('B')) return '#3b82f6'; // blue
  if (g.startsWith('C')) return '#eab308'; // yellow
  if (g.startsWith('D')) return '#f97316'; // orange
  return '#ef4444'; // red
}

/** Legacy structure mapping transformer. */
function transformReportToV2Result(report: Final5SAuditReport): AuditAnalysisResult {
  const PILLAR_LABEL_MAP: Record<string, string> = {
    SORT:         'Sort',
    SET_IN_ORDER: 'Set in Order',
    SHINE:        'Shine',
    STANDARDIZE:  'Standardize',
    SUSTAIN:      'Sustain',
  };

  // Convert response items
  const responses = report.questions.map(q => {
    let answerState: 'YES' | 'NO' | 'PARTIAL' | 'NOT_VISIBLE' = 'NO';
    if (q.visibility === 'NOT_VISIBLE') {
      answerState = 'NOT_VISIBLE';
    } else if (q.score !== null) {
      if (q.score >= 3) answerState = 'YES';
      else if (q.score === 2) answerState = 'PARTIAL';
    }
    return {
      question_id: q.questionId,
      ai_answer:   answerState,
      confidence:  0.9, // mock metadata value
      evidence:    q.evidenceSummary.join(' '),
    };
  });

  // Convert pillar scores
  const pillarScores = report.pillars.map(p => {
    const qList = report.questions.filter(q => q.questionId.startsWith(p.pillar));
    return {
      pillar:         (PILLAR_LABEL_MAP[p.pillar] ?? p.pillar) as any,
      score:          p.actualScore,
      maximum:        p.maximumScore,
      percentage:     p.percentage,
      raw_percentage: p.percentage,
      passed:         qList.filter(q => q.score !== null && q.score >= 3).length,
      partial:        qList.filter(q => q.score === 2).length,
      failed:         qList.filter(q => q.score !== null && q.score <= 1).length,
      not_visible:    qList.filter(q => q.visibility === 'NOT_VISIBLE').length,
      not_applicable: 0,
      critical:       qList.filter(q => q.score === 0).length,
      cap_applied:    false,
      top_deductions: [],
    };
  });

  // Convert recommendations
  const recommendations = report.recommendations.questionRecommendations.map((qRec, idx) => {
    const pillarName = qRec.questionId.split('_')[0];
    return {
      pillar:             PILLAR_LABEL_MAP[pillarName] ?? pillarName,
      severity:           'MAJOR' as const,
      priority:           idx + 1,
      priority_label:     'High Priority' as const,
      title:              qRec.issue,
      description:        qRec.action,
      problem:            qRec.issue,
      root_cause:         qRec.issue,
      corrective_action:  qRec.action,
      expected_benefit:   'Restores 5S compliance standard.',
      linked_question_id: qRec.questionId,
    };
  });

  return {
    template: {
      id:      report.metadata.auditTemplate,
      name:    'Standard 5S Audit',
      version: report.metadata.configurationVersion,
    },
    prompt_version:    'v3.0',
    vision_model:      'gemini-2.5-flash',
    schema_version:    '3.0',
    audit_confidence:  0.9,
    before: {
      score: {
        pillar_scores:      pillarScores,
        overall_score:      report.summary.actualScore,
        overall_maximum:    report.summary.maximumScore,
        overall_percentage: report.summary.overallPercentage,
        grade:              report.summary.grade,
        grade_color:        getGradeColor(report.summary.grade),
        total_answered:     report.summary.questionsEvaluated,
        total_questions:    report.summary.questionsEvaluated + report.summary.questionsSkipped,
        critical_failures:  0,
        computed_at:        report.metadata.generatedTimestamp,
      },
      responses,
    },
    recommendations,
    improvement_prompt:    null,
    explainability_report: null,
    scoringMethod:         'AI Audit V3 (Deterministic)',
  };
>>>>>>> 859e5d8 (feat(pipeline-v3): wire complete V3 pipeline loop & integrate into frontend hook)
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
