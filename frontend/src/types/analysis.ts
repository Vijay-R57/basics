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

// ── Image Validation V3 (Pipeline V3 — Phase 1) ───────────────────────────────
//
// Output of imageValidator.ts. Consumed by the pipeline gate in
// useAnalysisPipeline.ts. Independent of the UI-level ImageValidationResult above.

export type ImageValidationStatus = 'VALID' | 'INVALID';

export interface ImageValidationV3Metadata {
  /** Image width in pixels. 0 if decode failed. */
  width:       number;
  /** Image height in pixels. 0 if decode failed. */
  height:      number;
  /** Simplified aspect ratio string, e.g. "16:9". "Unknown" if decode failed. */
  aspectRatio: string;
  /** MIME type detected from the data URI prefix or magic bytes. */
  fileType:    string;
  /** Estimated decoded file size in bytes. */
  fileSize:    number;
}

export interface ImageValidationV3Result {
  /**
   * Pipeline gate flag.
   * false → pipeline must stop immediately; do NOT call Gemini.
   * true  → image passed all checks; pipeline may proceed.
   */
  isValid:      boolean;
  /** Human-readable status string. */
  status:       ImageValidationStatus;
  /**
   * Technical image quality score (0–100).
   * Based ONLY on resolution, decode success, file size, and format.
   * Never evaluates workplace conditions or audit quality.
   */
  qualityScore: number;
  /** Image metadata captured during validation. */
  metadata:     ImageValidationV3Metadata;
  /**
   * Blocking validation errors.
   * Non-empty only when isValid === false.
   * Empty array when isValid === true.
   */
  errors:       string[];
}

// ── Gemini Vision Analyzer (Pipeline V3 — Phase 2) ───────────────────────────
//
// Output of geminiVisionAnalyzer.ts.
// Represents pure visual perception — no audit, no scoring, no recommendations.
// Consumed by the Structured Observation Engine (Sprint 3).

/** The scene / environment type detected in the image. */
export interface GeminiVisionScene {
  /**
   * Human-readable environment description.
   * Examples: "Industrial Chemical Storage Area", "Manufacturing Workshop Floor"
   * Gemini infers this from visible context. Never hardcoded.
   */
  environment: string;
  /** Gemini's confidence in the scene classification (0–100). */
  confidence:  number;
}

/** A single visually detected object in the image. */
export interface GeminiVisionObject {
  /** Sequential identifier starting from 1. */
  id:         number;
  /** Descriptive name of the object as observed. Never evaluated for compliance. */
  name:       string;
  /** Estimated visual count of this object type in the image. */
  count:      number;
  /**
   * Approximate location in the image frame.
   * Examples: "Left", "Center walkway", "Background", "Upper right", "Foreground"
   */
  location:   string;
  /** Gemini's confidence in this detection (0–100). */
  confidence: number;
}

/**
 * Full output of the Gemini Vision Analyzer.
 *
 * IMPORTANT: This object contains ONLY visual observations.
 * It MUST NOT contain any of:
 *   - Audit scores
 *   - 5S ratings
 *   - Compliance judgements
 *   - Recommendations
 *   - Rule evaluations
 *
 * The downstream Observation Engine (Sprint 3) consumes this object.
 */
export interface GeminiVisionResult {
  /** Detected scene / environment classification. */
  scene:       GeminiVisionScene;
  /**
   * All major visible workplace objects.
   * Only objects that are visibly present — never invented.
   */
  objects:     GeminiVisionObject[];
  /**
   * All text strings readable in the image (OCR output).
   * Raw strings only — meaning is never interpreted here.
   * Examples: ["CHEMICAL STORAGE AREA", "LIME", "FIRE EXIT"]
   */
  visibleText: string[];
  /**
   * Present only when both Gemini attempts failed.
   * Downstream stages must check for this field and handle gracefully.
   */
  _error?: string;
}

// ── Structured Observation Engine (Pipeline V3 — Phase 3) ────────────────────
//
// Output of observationEngine.ts.
// One StructuredObservationResult is produced for each audit question.
// Contains ONLY factual visual descriptions — no ratings, scores, or compliance.
// Consumed by the Observation Validator (Sprint 4).

/**
 * A single structured observation for one audit question.
 *
 * IMPORTANT: This object MUST NOT contain:
 *   - Ratings (VERY_GOOD, GOOD, etc.)
 *   - Numeric scores (0–4)
 *   - Compliance judgements
 *   - Recommendations
 *   - Subjective language
 *
 * Confidence here measures observation certainty — NOT compliance level.
 */
export interface QuestionObservation {
  /**
   * true  → at least one relevant object was visible and matched.
   * false → no relevant evidence found in the image for this question.
   */
  visible:     boolean;
  /**
   * One factual sentence per matched visible object.
   * Each sentence describes what was seen, where, and how many.
   * Never evaluates compliance. Never uses subjective wording.
   * Empty array when visible === false.
   */
  evidence:    string[];
  /**
   * Names of the matched GeminiVisionObjects that contributed to this observation.
   * Taken verbatim from GeminiVisionResult.objects[].name — never invented.
   */
  objects:     string[];
  /**
   * Relevant readable text strings found in the image for this question.
   * Subset of GeminiVisionResult.visibleText — raw strings, no interpretation.
   */
  visibleText: string[];
  /**
   * Observation certainty: average confidence of matched objects (0–100).
   * Falls back to 30 (uncertainty default) when no objects match.
   * This is NOT a compliance or quality score.
   */
  confidence:  number;
}

/**
 * The complete observation output for one audit question.
 * The Observation Validator (Sprint 4) consumes an array of these.
 */
export interface StructuredObservationResult {
  /** Audit question ID, e.g. "SORT_Q1". Matches AuditQuestion.id in questions.ts. */
  questionId:  string;
  /** The structured observation produced for this question. */
  observation: QuestionObservation;
}

// ── Observation Validator (Pipeline V3 — Phase 4) ────────────────────────────
//
// Output of observationValidator.ts.
// Produced after running all 12 quality checks on StructuredObservationResult[].
// Consumed by the Visibility Decision Engine (Sprint 5) and the orchestrator.

/**
 * Standardised error codes for the 12 observation validation checks.
 * Each code maps to exactly one category of failure.
 * Reusable across the project — do not add codes specific to one check.
 */
export type ValidationErrorCode =
  | 'MISSING_QUESTION'        // Check 1 — an expected question has no observation
  | 'DUPLICATE_QUESTION'      // Check 2 — the same questionId appears more than once
  | 'INVALID_FIELD'           // Check 3 — a required field is absent
  | 'INVALID_DATA_TYPE'       // Check 4 — a field value has the wrong data type
  | 'INVALID_CONFIDENCE'      // Check 5 — confidence is outside the 0–100 range
  | 'INVALID_JSON'            // Check 11 — the collection fails JSON serialisation
  | 'OBJECT_NOT_FOUND'        // Check 7 — an object name is not in the Vision output
  | 'VISIBLE_FLAG_MISMATCH'   // Checks 8 & 9 — visible flag inconsistent with content
  | 'EMPTY_OBSERVATION'       // Check 12 — visible=true but all arrays are empty
  | 'INVALID_EVIDENCE'        // Check 6 — evidence contains banned subjective words
  | 'SCHEMA_ERROR'            // Generic — observation does not match expected schema
  | 'CONFIDENCE_INCONSISTENCY'; // Check 10 — advisory: visible=true but confidence=0

/**
 * A single validation error entry in the validation report.
 * Collection-level errors use questionId = "GLOBAL".
 */
export interface ObservationValidationError {
  /** The questionId of the failing observation, or "GLOBAL" for collection-level errors. */
  questionId: string;
  /** Standardised error code identifying the category of failure. */
  code:       ValidationErrorCode;
  /** Human-readable description of the specific failure. */
  message:    string;
}

/**
 * Full validation report produced by the Observation Validator.
 *
 * Pipeline contract:
 *   validated === true  → PASS_TO_VISIBILITY_ENGINE
 *   validated === false → STOP_PIPELINE — do NOT proceed to scoring
 *
 * Note: CONFIDENCE_INCONSISTENCY errors are advisory and do NOT set validated=false.
 */
export interface ObservationValidationResult {
  /** true = all blocking checks passed; false = at least one blocking check failed. */
  validated: boolean;
  /** Human-readable pass/fail status. */
  status:    'PASS' | 'FAIL';
  summary: {
    /** Total expected observations (equals total audit questions). */
    totalQuestions:     number;
    /** Observations that passed all blocking checks. */
    validatedQuestions: number;
    /** Observations with at least one blocking failure. */
    failedQuestions:    number;
  };
  /**
   * All validation errors found.
   * Empty when validated === true.
   * May contain CONFIDENCE_INCONSISTENCY entries even when validated === true
   * (advisory only — does not block the pipeline).
   */
  errors: ObservationValidationError[];
}

// ── Visibility Decision Engine (Pipeline V3 — Phase 5) ───────────────────────
//
// Output of visibilityEngine.ts.
// One VisibilityDecision is produced for every audit question.
// Consumed by the Deterministic Rule Engine (Sprint 6).
//
// IMPORTANT: visibility describes evidence availability — NOT compliance.
//   VISIBLE          → sufficient evidence exists; question proceeds to Rule Engine.
//   PARTIALLY_VISIBLE → limited evidence; Rule Engine receives it with reduced confidence.
//   NOT_VISIBLE      → insufficient evidence; question is excluded from deterministic scoring.

/**
 * The three possible visibility statuses for an audit question.
 *
 * These describe whether the IMAGE contains enough evidence to evaluate the question.
 * They do NOT describe whether the workplace is compliant or non-compliant.
 */
export type VisibilityStatus = 'VISIBLE' | 'PARTIALLY_VISIBLE' | 'NOT_VISIBLE';

/**
 * The visibility determination for a single audit question.
 *
 * Pipeline contract:
 *   VISIBLE | PARTIALLY_VISIBLE → PASS_TO_RULE_ENGINE
 *   NOT_VISIBLE                 → EXCLUDE_FROM_SCORING (pipeline continues for other questions)
 *
 * IMPORTANT: reason must NEVER mention compliance, rating, score, or grade.
 * It must ONLY describe WHY the visibility status was assigned.
 */
export interface VisibilityDecision {
  /** Audit question ID, e.g. "SORT_Q1". */
  questionId:  string;
  /** Visibility status — describes evidence availability, not compliance. */
  visibility:  VisibilityStatus;
  /**
   * Human-readable explanation of why this visibility status was assigned.
   * References actual visible objects when available.
   * Never mentions compliance, ratings, or scores.
   */
  reason:      string;
  /**
   * Certainty of the visibility determination (0–100).
   * Derived from the matched object confidence values in the observation.
   * This is NOT a compliance score.
   */
  confidence:  number;
}

// ── Standardized Evidence Engine (Pipeline V3 — Phase 6.2) ──────────────────
//
// Output of standardizedEvidence/index.ts.
// One StandardizedObservation is produced for every audit question.
// Consumed by the Deterministic Rule Engine (Sprint 6.3).
//
// Dual representation:
//   evidence    → human-readable sentences (preserved from Sprint 3)
//   evidenceIds → machine-readable EvidenceKey identifiers (added in Sprint 6.2)

/**
 * A single standardized observation for one audit question.
 *
 * Contains BOTH representations:
 *   - evidence: original human-readable sentences from the Observation Engine
 *   - evidenceIds: machine-readable identifiers from the Evidence Vocabulary
 *
 * The Rule Engine must ONLY evaluate evidenceIds — never inspect evidence strings.
 * Human-readable evidence is preserved for UI display and audit report generation.
 */
export interface StandardizedObservation {
  /** Audit question ID, e.g. "SORT_Q1". */
  questionId:        string;
  /**
   * true  → relevant objects were visible; evidenceIds will be populated.
   * false → no relevant evidence; evidenceIds will be empty.
   */
  visible:           boolean;
  /**
   * Human-readable evidence sentences preserved from the Observation Engine.
   * Used by the audit report — never evaluated by the Rule Engine.
   */
  evidence:          string[];
  /**
   * Machine-readable evidence identifiers from the shared Evidence Vocabulary.
   * These are the ONLY input the Rule Engine may use for evaluation.
   * May contain 'UNKNOWN_OBJECT' for objects that had no vocabulary match.
   * Always deduplicated. Always sorted alphabetically for determinism.
   */
  evidenceIds:       string[];
  /**
   * Observation certainty inherited from the Structured Observation Engine (0–100).
   * Not a compliance score.
   */
  confidence:        number;
  /**
   * Object names from the observation that could not be mapped to a vocabulary key.
   * Present only when at least one unknown object was encountered.
   * Useful for vocabulary extension decisions.
   */
  _unknownObjects?:  string[];
}

// ── Deterministic Rule Engine (Pipeline V3 — Phase 6.3) ──────────────────────
//
// Output of ruleEngine/index.ts.
// One RuleEvaluationResult is produced for every audit question.
// Consumed by the Question Score Calculator (Sprint 6.4).

/** Possible rating levels returned by the Deterministic Rule Engine. */
export type AuditRating = 'VERY_GOOD' | 'GOOD' | 'AVERAGE' | 'BAD' | 'VERY_BAD' | 'NOT_SCORED';

/**
 * The evaluation result for a single audit question.
 *
 * This is the pure, deterministic output of the Rule Engine.
 * It contains NO scores, percentages, or grades. It only maps the visible evidence
 * to a rating according to the question configuration.
 */
export interface RuleEvaluationResult {
  /** Audit question ID, e.g. "SORT_Q1". */
  questionId:        string;
  /** Visibility status of the question: 'VISIBLE' | 'PARTIALLY_VISIBLE' | 'NOT_VISIBLE' */
  visibility:        string;
  /** Assigned rating based on deterministic rule evaluation. */
  rating:            AuditRating;
  /** Required evidence keys that were actually detected in the observation. */
  matchedEvidence:   string[];
  /** Required evidence keys that were NOT detected in the observation. */
  missingEvidence:   string[];
  /** Forbidden evidence keys that were detected in the observation (and excluded). */
  forbiddenEvidence: string[];
  /** Optional evidence keys that were detected in the observation. */
  matchedOptional:   string[];
  /** Count of matched required evidence keys. */
  matchedCount:      number;
  /** The specific threshold configuration key that matched, e.g. "average". */
  matchedRule:       string;
  /** Step-by-step trace of the rule execution, populated in debug mode. */
  evaluationTrace:   string[];
}

// ── Question Score Calculator (Pipeline V3 — Phase 6.4) ──────────────────────
//
// Output of questionScore/index.ts.
// One QuestionScore is produced for every audit question.
// Consumed by the Pillar Score Calculator (Sprint 6.5).

/**
 * Numeric scoring result for a single question.
 *
 * Immutably wraps the rule engine output and adds:
 *   - score: number | null (null if NOT_SCORED)
 *   - maxScore: number | null (null if NOT_SCORED)
 *   - scoreEligible: boolean
 */
export interface QuestionScore {
  /** Audit question ID, e.g. "SORT_Q1". */
  questionId:      string;
  /** Visibility status: 'VISIBLE' | 'PARTIALLY_VISIBLE' | 'NOT_VISIBLE' */
  visibility:      string;
  /** Rating resolved from rule engine: 'VERY_GOOD' | 'GOOD' | 'AVERAGE' | 'BAD' | 'VERY_BAD' | 'NOT_SCORED' */
  rating:          AuditRating;
  /** Factual numeric score (0-4), or null if rating is 'NOT_SCORED'. */
  score:           number | null;
  /** Maximum score possible for this question (usually 4), or null if rating is 'NOT_SCORED'. */
  maxScore:        number | null;
  /** true if rating !== 'NOT_SCORED' (question has visible evidence and is scored). */
  scoreEligible:   boolean;
  /** Step-by-step trace of execution. */
  evaluationTrace: string[];
}

// ── Score Aggregator Engine (Pipeline V3 — Phase 6.5) ────────────────────────
//
// Output of scoreAggregation/index.ts.
// Aggregates QuestionScore[] into PillarScore[] and one OverallScore.

/** Aggregated scoring result for a single 5S pillar. */
export interface PillarScore {
  /** The 5S pillar name, e.g. "SORT". */
  pillar:            string;
  /** Total questions configured for this pillar. */
  questionCount:     number;
  /** Count of questions that were evaluated (scoreEligible = true). */
  eligibleQuestions: number;
  /** Count of questions that were not evaluated (scoreEligible = false). */
  skippedQuestions:  number;
  /** Combined actual score of all eligible questions. */
  actualScore:       number;
  /** Combined maximum possible score of all eligible questions. */
  maximumScore:      number;
  /** Percentage score for this pillar (rounded consistently, e.g. 83.33). */
  percentage:        number;
}

/** Complete overall scoring result for the audit. */
export interface OverallScore {
  /** Combined actual score of all evaluated questions across all pillars. */
  actualScore:        number;
  /** Combined maximum score of all evaluated questions across all pillars. */
  maximumScore:       number;
  /** Overall percentage score (rounded consistently, e.g. 78.95). */
  percentage:         number;
  /** Total count of evaluated (scoreEligible = true) questions. */
  evaluatedQuestions: number;
  /** Total count of skipped (scoreEligible = false) questions. */
  skippedQuestions:   number;
  /** Total count of evaluated pillars (pillars containing at least one question). */
  evaluatedPillars:   number;
}

// ── Grade Engine & Audit Debug Trace (Pipeline V3 — Phase 6.6) ───────────────
//
// Outputs of grade/index.ts and trace/index.ts.

/** Result of Grade Engine evaluation. */
export interface GradeResult {
  /** Overall audit score percentage. */
  overallPercentage: number;
  /** Factual assigned grade, e.g. "A", "B", "F". */
  grade:             string;
  /** Configured boundary string matching the score, e.g. "80-89". */
  matchedThreshold:  string;
  /** Grading configuration version. */
  gradingVersion:    string;
}

/** Factual trace details recorded for a single stage in the pipeline. */
export interface PipelineStageTrace {
  /** The stage identifier, e.g. "Visibility Engine". */
  stage:            string;
  /** ISO timestamp when the stage began. */
  startTime:        string;
  /** ISO timestamp when the stage completed. */
  endTime:          string;
  /** Execution duration in milliseconds. */
  duration:         number;
  /** Execution status. */
  status:           'PASS' | 'FAIL';
  /** Factual summary of inputs received by this stage. */
  inputSummary?:    any;
  /** Factual summary of outputs produced by this stage. */
  outputSummary?:   any;
  /** Warnings emitted during execution. */
  warnings:         string[];
  /** Errors encountered during execution. */
  errors:           string[];
  /** Decision made for the pipeline flow, e.g. "PASS_TO_RULE_ENGINE". */
  pipelineDecision: string;
}

/** Factual audit lineage recorded for a single question. */
export interface QuestionExecutionTrace {
  /** The unique question identifier, e.g. "SORT_Q1". */
  questionId:     string;
  /** Visibility status: 'VISIBLE' | 'PARTIALLY_VISIBLE' | 'NOT_VISIBLE' */
  visibility:     string;
  /** Standardized evidence identifiers matched. */
  evidenceIds:    string[];
  /** Required evidence keys successfully found. */
  matchedEvidence:string[];
  /** Rating assigned: 'VERY_GOOD' | 'GOOD' | etc. */
  rating:         string;
  /** Score assigned, or null if NOT_SCORED. */
  score:          number | null;
  /** Execution duration for this question's evaluation in milliseconds. */
  processingTime: number;
}

/** Complete execution lineage and trace recorded for one audit run. */
export interface AuditDebugTrace {
  /** Unique audit identifier. */
  auditId:              string;
  /** Version of the AI Pipeline, e.g. "V3". */
  pipelineVersion:      string;
  /** Version of the questions configuration, e.g. "1.0". */
  configurationVersion: string;
  /** Name of the active audit template, e.g. "Industrial_5S". */
  auditTemplate:        string;
  /** Factual traces of each pipeline stage. */
  stages:               PipelineStageTrace[];
  /** Execution traces for each individual question. */
  questions:            QuestionExecutionTrace[];
}

// ── Recommendation Generator Engine (Pipeline V3 — Phase 7) ──────────────────
//
// Output of recommendation/index.ts.
// Contains question-level, pillar-level, and overall recommendations generated by Gemini.

/** Factual recommendation for a single low-rated question. */
export interface QuestionRecommendation {
  /** The unique question identifier, e.g. "SORT_Q1". */
  questionId: string;
  /** Rating assigned to this question: 'AVERAGE' | 'BAD' | 'VERY_BAD'. */
  rating:     string;
  /** Factual issue summary explaining why the rating was received. */
  issue:      string;
  /** Actionable recommendation to improve and resolve this issue. */
  action:     string;
}

/** Factual recommendation for a single 5S pillar. */
export interface PillarRecommendation {
  /** The 5S pillar name, e.g. "SORT". */
  pillar:   string;
  /** Factual summary of major weaknesses within this pillar. */
  summary:  string;
  /** Concise, actionable strategy to improve this pillar. */
  strategy: string;
}

/** Complete overall executive recommendations. */
export interface OverallRecommendation {
  /** Executive summary workplace assessment. */
  summary:      string;
  /** Identified key strengths of the workplace. */
  strengths:    string[];
  /** Priority improvements required. */
  improvements: string[];
  /** Suggested next steps. */
  nextSteps:    string[];
}

/** Complete structured output generated by Gemini recommendations phase. */
export interface AuditRecommendationResult {
  /** Question-level recommendations (only for AVERAGE, BAD, and VERY_BAD ratings). */
  questionRecommendations: QuestionRecommendation[];
  /** Pillar-level recommendation summaries. */
  pillarRecommendations:   PillarRecommendation[];
  /** Overall audit executive recommendations. */
  overallRecommendation:   OverallRecommendation;
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
