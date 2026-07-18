/**
 * src/types/analysis.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for analysis-related types.
 * Phase 3A: Removed after-image fields; added ImageValidationResult.
 */

import type { AuditPillar } from '@/modules/audit/constants/pillars';

// ── Answer State (mirrors DB enum audit_answer_state) ─────────────────────────
export type AuditAnswerState =
  | 'YES'
  | 'NO'
  | 'PARTIAL'
  | 'NOT_VISIBLE'
  | 'NOT_APPLICABLE';

export type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR';

// ── Per-question AI response ──────────────────────────────────────────────────
export interface AuditQuestionResponse {
  question_id:     string;
  ai_answer:       AuditAnswerState;
  confidence:      number;   // metadata only — never used in scoring
  evidence:        string;   // observation supporting the answer
  evidenceSource?: 'IMAGE' | 'USER';
}

// ── Explainability detail per deduction ──────────────────────────────────────
export interface DeductionDetail {
  question_id:   string;
  question_text: string;
  severity:      Severity;
  evidence:      string;
  points_lost:   number;
}

// ── Per-pillar score result ───────────────────────────────────────────────────
export interface PillarScoreResult {
  pillar:         AuditPillar;
  score:          number;
  maximum:        number;
  percentage:     number;
  raw_percentage: number;
  passed:         number;
  partial:        number;
  failed:         number;
  not_visible:    number;
  not_applicable: number;
  critical:       number;         // count of CRITICAL severity failures
  cap_applied:    boolean;
  cap_value?:     number;
  cap_reason?:    string;
  top_deductions: DeductionDetail[];
}

// ── Full session score ────────────────────────────────────────────────────────
export interface SessionScoreResult {
  pillar_scores:       PillarScoreResult[];
  overall_score:       number;
  overall_maximum:     number;
  overall_percentage:  number;
  grade:               string;
  grade_color:         string;
  total_answered:      number;
  total_questions:     number;
  critical_failures:   number;
  computed_at:         string;
}

// ── Recommendation ────────────────────────────────────────────────────────────
export interface AuditRecommendation {
  pillar:             string;
  severity:           Severity;
  priority:           number;
  priority_label?:    'Immediate Action' | 'High Priority' | 'Medium Priority' | 'Long-Term Improvement';
  title:              string;
  description:        string;
  problem?:           string;
  root_cause:         string;
  corrective_action:  string;
  expected_benefit?:  string;
  estimated_impact?:  string;
  linked_question_id: string;
}

// ── Full analysis result (edge function response) ────────────────────────────
export interface AuditAnalysisResult {
  template: {
    id:      string;
    name:    string;
    version: string;
  };
  prompt_version:    string;
  vision_model:      string;
  schema_version:    string;
  audit_confidence:  number;
  before: {
    score:     SessionScoreResult;
    responses: AuditQuestionResponse[];
  };
  /** Phase 3A: after-image removed from primary workflow. Field kept for
   *  backward-compat with history records; always null in new audits. */
  after?: {
    image_base64: string;
    score:        SessionScoreResult;
    responses:    AuditQuestionResponse[];
  } | null;
  recommendations:    AuditRecommendation[];
  improvement_prompt: string | null;
  explainability_report?: unknown;
  scoringMethod?:     string;
}

// ── Image Validation (Phase 3A) ───────────────────────────────────────────────

export type ImageQualityLevel = 'Excellent' | 'Good' | 'Fair' | 'Poor';

export interface ImageValidationCheck {
  pass:   boolean;
  points: number;
  detail: string;
}

export interface ImageValidationResult {
  /** false = at least one CRITICAL check failed; audit blocked */
  passed:           boolean;
  /** 0–100 composite quality score */
  qualityScore:     number;
  qualityLevel:     ImageQualityLevel;
  checks: {
    resolution: ImageValidationCheck & { width: number; height: number };
    brightness: ImageValidationCheck & { value: number };
    sharpness:  ImageValidationCheck & { value: number };
    fileSize:   ImageValidationCheck & { sizeKb: number };
    format:     ImageValidationCheck & { mimeType: string };
  };
  /** Blocking failures — non-empty means Start button is disabled */
  criticalFailures: string[];
  /** Advisory warnings — non-empty shows caution but audit allowed */
  warnings:         string[];
}

// ── Analysis pipeline stages (for progress UX) ───────────────────────────────
export type AnalysisStage =
  | 'idle'
  | 'compressing'
  | 'loading-template'
  | 'analyzing-sort'
  | 'analyzing-set-in-order'
  | 'analyzing-shine'
  | 'analyzing-standardize'
  | 'analyzing-sustain'
  | 'scoring'
  | 'recommendations'
  | 'saving'
  | 'preparing-report'
  | 'complete'
  | 'error';

export interface AnalysisPipelineState {
  stage:      AnalysisStage;
  progress:   number;   // 0–100
  message:    string;
  retryCount: number;
}

// ── Audit Timeline (Phase 3A) ─────────────────────────────────────────────────
export interface AuditTimeline {
  imageUploaded:      string | null;
  validationComplete: string | null;
  auditStarted:       string | null;
  auditCompleted:     string | null;
  reportGenerated:    string | null;
}
