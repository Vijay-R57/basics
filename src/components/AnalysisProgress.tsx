/**
 * src/components/AnalysisProgress.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Animated multi-step progress indicator for the 5S analysis pipeline.
 * Shows the current stage with a pulsing bar and status message.
 * Displays a retry badge when the pipeline retries failed requests.
 */

import { Loader2, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import type { AnalysisPipelineState, AnalysisStage } from "@/types/analysis";

interface Props {
  pipeline: AnalysisPipelineState;
}

const STAGE_LABELS: Record<AnalysisStage, string> = {
  idle: "Ready",
  compressing: "Compressing images",
  "checking-cache": "Checking cache",
  analyzing: "Running CV engine",
  saving: "Saving audit record",
  complete: "Analysis complete",
  error: "Analysis failed",
};

const STAGES: AnalysisStage[] = [
  "compressing",
  "checking-cache",
  "analyzing",
  "saving",
  "complete",
];

export default function AnalysisProgress({ pipeline }: Props) {
  const { stage, progress, message, retryCount } = pipeline;

  if (stage === "idle") return null;

  const isError = stage === "error";
  const isComplete = stage === "complete";
  const isActive = !isError && !isComplete;

  const activeIdx = STAGES.indexOf(stage);

  return (
    <div
      className={`rounded-xl border p-5 mb-8 transition-all duration-300 ${
        isError
          ? "bg-destructive/5 border-destructive/30"
          : isComplete
          ? "bg-primary/5 border-primary/20"
          : "bg-card border-border"
      }`}
      role="status"
      aria-live="polite"
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : isComplete ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {isError ? "Analysis Failed" : isComplete ? "Complete" : "Analyzing…"}
          </span>
        </div>

        {retryCount > 0 && isActive && (
          <span className="flex items-center gap-1 text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full border border-warning/20">
            <RefreshCw className="h-3 w-3" />
            Retry {retryCount}/{2}
          </span>
        )}

        {!isError && (
          <span className="text-xs text-muted-foreground tabular-nums">{progress}%</span>
        )}
      </div>

      {/* Progress bar */}
      {!isError && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-4">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              isComplete ? "bg-primary" : "bg-primary/70"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Step dots */}
      {!isError && (
        <div className="flex items-center gap-1 mb-3">
          {STAGES.map((s, idx) => {
            const done = activeIdx > idx || isComplete;
            const current = activeIdx === idx && !isComplete;
            return (
              <div key={s} className="flex items-center gap-1">
                <div
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    done
                      ? "bg-primary"
                      : current
                      ? "bg-primary/60 ring-2 ring-primary/30 scale-125"
                      : "bg-muted"
                  }`}
                />
                {idx < STAGES.length - 1 && (
                  <div
                    className={`h-px w-6 transition-colors duration-300 ${
                      done ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Status message */}
      <p
        className={`text-xs ${
          isError ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {isError ? message : (STAGE_LABELS[stage] ?? message)}
        {isActive && message && message !== STAGE_LABELS[stage] && (
          <span className="ml-1 opacity-70">— {message}</span>
        )}
      </p>
    </div>
  );
}
