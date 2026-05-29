/**
 * src/components/ScoreExplanationCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Expandable pillar explanation card with:
 *  • Score bar with colour-coded confidence band
 *  • Delta indicator (before → after improvement)
 *  • Sub-factor grid showing what was measured
 *  • AI explanation text (collapsed by default, expandable)
 *  • Confidence visualization (derived from score value)
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PillarMeta } from "@/types/analysis";

interface Props {
  pillar: PillarMeta;
  beforeScore: number;
  afterScore: number;
  beforeExplanation?: string;
  afterExplanation?: string;
  defaultExpanded?: boolean;
}

// ── Score colour helpers ──────────────────────────────────────────────────────
const getScoreColor = (score: number) => {
  if (score >= 80) return "text-primary";
  if (score >= 60) return "text-warning";
  return "text-destructive";
};
const getBarColor = (score: number) => {
  if (score >= 80) return "bg-primary";
  if (score >= 60) return "bg-warning";
  return "bg-destructive";
};
const getConfidenceBand = (score: number): { label: string; color: string } => {
  if (score >= 85) return { label: "Excellent", color: "text-primary bg-primary/10 border-primary/20" };
  if (score >= 70) return { label: "Good", color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400" };
  if (score >= 50) return { label: "Fair", color: "text-warning bg-warning/10 border-warning/20" };
  return { label: "Needs Work", color: "text-destructive bg-destructive/10 border-destructive/20" };
};

export default function ScoreExplanationCard({
  pillar,
  beforeScore,
  afterScore,
  beforeExplanation,
  afterExplanation,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const delta = afterScore - beforeScore;
  const confidence = getConfidenceBand(afterScore);

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden transition-shadow hover:shadow-sm">
      {/* ── Header (always visible) ──────────────────────────────────────── */}
      <button
        className="w-full text-left p-4 sm:p-5"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          {/* Pillar title */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg leading-none">{pillar.icon}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">{pillar.label}</span>
                <span className="text-xs text-muted-foreground">({pillar.jp})</span>
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${confidence.color}`}
                >
                  {confidence.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{pillar.desc}</p>
            </div>
          </div>

          {/* Delta + chevron */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`text-sm font-bold ${
                delta > 0 ? "text-primary" : delta < 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {delta > 0 ? "+" : ""}
              {delta}%
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Score bars */}
        <div className="grid grid-cols-2 gap-3">
          {/* Before */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Before</span>
              <span className={`font-medium ${getScoreColor(beforeScore)}`}>{beforeScore}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${getBarColor(beforeScore)}`}
                style={{ width: `${beforeScore}%` }}
              />
            </div>
          </div>

          {/* After */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">After</span>
              <span className={`font-medium ${getScoreColor(afterScore)}`}>{afterScore}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${getBarColor(afterScore)}`}
                style={{ width: `${afterScore}%` }}
              />
            </div>
          </div>
        </div>
      </button>

      {/* ── Expanded detail ───────────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-border px-4 sm:px-5 pb-5 pt-4 bg-muted/20 space-y-4">
          {/* Sub-factors measured */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
              Measured Factors
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pillar.factors.map((f) => (
                <span
                  key={f}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-background border border-border text-muted-foreground"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Confidence visualization */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
              Score Confidence
            </p>
            <div className="grid grid-cols-5 gap-1">
              {[20, 40, 60, 80, 100].map((threshold) => (
                <div
                  key={threshold}
                  className={`h-1.5 rounded-full transition-colors ${
                    afterScore >= threshold
                      ? afterScore >= 80
                        ? "bg-primary"
                        : afterScore >= 60
                        ? "bg-warning"
                        : "bg-destructive"
                      : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">Poor</span>
              <span className="text-[10px] text-muted-foreground">Excellent</span>
            </div>
          </div>

          {/* AI Explanations */}
          {(beforeExplanation || afterExplanation) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Analysis
              </p>
              {beforeExplanation && (
                <div className="flex items-start gap-2 bg-background rounded-lg p-3 border border-border">
                  <span className="text-xs font-medium text-muted-foreground flex-shrink-0 pt-0.5 w-12">
                    Before
                  </span>
                  <p className="text-xs text-muted-foreground leading-relaxed italic">
                    {beforeExplanation}
                  </p>
                </div>
              )}
              {afterExplanation && (
                <div className="flex items-start gap-2 bg-primary/5 rounded-lg p-3 border border-primary/15">
                  <span className="text-xs font-medium text-primary flex-shrink-0 pt-0.5 w-12">
                    After
                  </span>
                  <p className="text-xs text-muted-foreground leading-relaxed italic">
                    {afterExplanation}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
