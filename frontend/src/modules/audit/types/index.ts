/**
 * src/modules/audit/types/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Domain types for the 5S Audit Module (Phase 2 — AI-Driven Scoring).
 * Extends Phase 1 manual checklist types with AI answer states, severity,
 * evidence, score breakdown and explainability fields.
 */

import type { AuditPillar, AuditStatus } from '../constants/pillars';

// ── Answer State (Refinement #1 — replaces boolean) ───────────────────────────
export type AuditAnswerState =
  | 'YES'           // clearly compliant → full points
  | 'NO'            // clearly non-compliant → 0 points, included in max
  | 'PARTIAL'       // partially compliant → 50% points
  | 'NOT_VISIBLE'   // element not in camera frame → excluded from scoring
  | 'NOT_APPLICABLE'; // not relevant to this area → excluded from scoring

// ── Severity (Refinement #4) ──────────────────────────────────────────────────
export type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR';

// ── Templates ─────────────────────────────────────────────────────────────────

export type TemplateStatus = 'ACTIVE' | 'DEPRECATED' | 'ARCHIVED';

export interface AuditTemplate {
  id:          string;
  name:        string;
  description: string | null;
  version:     string;
  status:      TemplateStatus;
  is_default:  boolean;
  created_by:  string | null;
  created_at:  string;
  updated_at:  string;
  industry?:    string;
  department?:  string;
  workspace_type?: string;
  /** Computed client-side */
  item_count?: number;
}

// ── Checklist Items ───────────────────────────────────────────────────────────

export interface AuditChecklistItem {
  id:            string;
  template_id:   string;
  pillar:        AuditPillar;
  question_id:   string;           // e.g. 'SORT_001'
  question_text: string;
  description:   string | null;
  max_points:    number;
  weight:        number;
  display_order: number;
  is_mandatory:  boolean;
  severity:      Severity;         // Refinement #4
  category:      string;           // Phase 2A categories
  created_at:    string;
}

// ── Session Items (snapshot — immutable per-session history) ──────────────────

export interface AuditSessionItem {
  id:                         string;
  audit_session_id:           string;
  original_checklist_item_id: string | null;
  pillar:                     AuditPillar;
  question_id:                string;
  question_text:              string;
  description:                string | null;
  max_points:                 number;
  weight:                     number;
  display_order:              number;
  is_mandatory:               boolean;
  severity:                   Severity;   // Refinement #4
  category:                   string;     // Phase 2A categories
  created_at:                 string;
}

// ── Item Responses ────────────────────────────────────────────────────────────

export interface AuditItemResponse {
  id:                string;
  audit_session_id:  string;
  session_item_id:   string;
  // Phase 1: manual scoring (0–4 integer)
  manual_score:      number | null;
  // Phase 2: AI-driven fields
  ai_answer:         AuditAnswerState | null;   // Refinement #1
  evidence:          string | null;             // Refinement #2
  ai_question_id:    string | null;
  confidence:        number | null;             // metadata only — never used in scoring (Refinement #3)
  final_score:       number | null;             // computed by ScoringService and written here
  reasoning:         string | null;             // Internal audit reasoning (Phase 2A)
  observation:       string | null;             // Structured finding (Phase 2A)
  reviewer_comment:  string | null;
  notes:             string | null;
  created_at:        string;
  updated_at:        string;
  evidenceSource?:   'IMAGE' | 'USER';
}

// ── Critical Rules (Refinement #5) ───────────────────────────────────────────

export interface AuditCriticalRule {
  id:                string;
  template_id:       string | null;
  checklist_item_id: string;
  pillar:            AuditPillar;
  trigger_answer:    AuditAnswerState;
  score_cap:         number;   // 0–100 percentage cap
  description:       string;
  is_active:         boolean;
  created_at:        string;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface AuditSession {
  id:                    string;
  audit_number:          string;
  template_id:           string;
  template_name:         string;
  template_version:      string;
  auditor_id:            string;
  auditor_name:          string;
  area_id:               string | null;
  area_name:             string | null;
  department_name:       string | null;
  plant_name:            string | null;
  analysis_log_id:       string | null;
  audit_date:            string;
  status:                AuditStatus;
  total_score:           number;
  max_score:             number;
  percentage:            number;
  notes:                 string | null;
  // Phase 2 fields
  score_breakdown:       ScoreBreakdown | null;
  generated_after_image_url: string | null;
  improvement_prompt:    string | null;
  prompt_version_id:     string | null;
  vision_model_used:     string | null;
  prompt_schema_version: string | null;
  analysis_mode:         'MANUAL' | 'AI_ASSISTED' | 'FULL_AI';
  // Phase 2A Context & Report fields
  industry?:             string | null;
  department?:           string | null;
  workspace_type?:       string | null;
  expected_equipment?:   string | null;
  expected_safety_assets?: string | null;
  audit_confidence?:     number | null;
  explainability_report?: unknown;
  completed_at:          string | null;
  created_at:            string;
  updated_at:            string;
}

// ── Score Breakdown (stored as JSONB in audit_sessions) ───────────────────────

export interface DeductionDetail {
  question_id:   string;
  question_text: string;
  severity:      Severity;
  evidence:      string;
  points_lost:   number;
}

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
  critical:       number;         // CRITICAL severity failure count
  cap_applied:    boolean;        // true if a critical rule capped this pillar
  cap_value?:     number;
  cap_reason?:    string;
  top_deductions: DeductionDetail[];
}

export interface SessionScoreResult {
  pillar_scores:      PillarScoreResult[];
  overall_score:      number;
  overall_maximum:    number;
  overall_percentage: number;
  grade:              string;
  grade_color:        string;
  total_answered:     number;
  total_questions:    number;
  critical_failures:  number;
  computed_at:        string;
}

export interface ScoreBreakdown {
  before: SessionScoreResult;
  after:  SessionScoreResult;
}

// ── Aggregate / Detail Views ──────────────────────────────────────────────────

export interface AuditSessionWithDetails extends AuditSession {
  items:     AuditSessionItem[];
  responses: AuditItemResponse[];
}

// ── UI Score Summary (used by AuditSessionSummary component) ──────────────────

/** Per-pillar summary for UI — derived from PillarScoreResult or manual calc */
export interface PillarScore {
  pillar:        AuditPillar;
  total:         number;
  max:           number;
  percentage:    number;
  answeredCount: number;
  totalCount:    number;
  // Phase 2 explainability fields (optional — present when AI analysis run)
  passed?:         number;
  partial?:        number;
  failed?:         number;
  critical?:       number;
  cap_applied?:    boolean;
  cap_value?:      number;
  cap_reason?:     string;
  top_deductions?: DeductionDetail[];
}

/** Full score summary — all pillars + overall */
export interface AuditScoreSummary {
  pillarScores:       PillarScore[];
  overallTotal:       number;
  overallMax:         number;
  overallPercentage:  number;
  grade:              string;
  gradeColor:         string;
  answeredCount:      number;
  totalCount:         number;
  criticalFailures?:  number;
}

// ── Recommendations (Refinement #5 output) ────────────────────────────────────

export interface AuditRecommendation {
  id?:               string;
  audit_session_id?: string;
  pillar:            string;
  severity:          Severity;
  priority:          number;
  title:             string;
  description:       string;
  root_cause:        string;
  corrective_action: string;
  linked_question_id: string;
  created_at?:       string;
}

// ── Form state ────────────────────────────────────────────────────────────────

/** Map from session_item_id → current draft (manual audit mode) */
export type ResponseDraft = Record<string, { score: number | null; notes: string }>;

/** Payload for creating a new session */
export interface CreateSessionPayload {
  template_id:      string;
  template_name:    string;
  template_version: string;
  auditor_id:       string;
  auditor_name:     string;
  area_id?:         string | null;
  area_name?:       string | null;
  department_name?: string | null;
  plant_name?:      string | null;
  audit_date?:      string;
  notes?:           string;
  industry?:        string | null;
  workspace_type?:  string | null;
  expected_equipment?: string | null;
  expected_safety_assets?: string | null;
}

/** Payload for upserting a batch of manual responses */
export interface UpsertResponsesPayload {
  audit_session_id: string;
  responses: Array<{
    session_item_id: string;
    manual_score:    number;
    notes?:          string;
  }>;
}

// ── Target Future-Compatible AuditResult Contracts ───────────────────────────

export interface FutureAuditQuestion {
  id: string; // e.g. "SORT_001"
  question: string;
  rating: 'Very Bad' | 'Bad' | 'Average' | 'Good' | 'Very Good';
  score: number; // 0–4
  benchmark: string;
  evidence: string;
  reason: string;
  supportingObservation?: string;
  evidenceSource?: 'IMAGE' | 'USER';
}

export interface FuturePillar {
  name: string; // SORT, SET_IN_ORDER, SHINE, STANDARDIZE, SUSTAIN
  label: string; // e.g. "Sort"
  jpName: string; // e.g. "Seiri"
  score: number; // 0–16
  maxScore: number; // 16
  percentage: number;
  rating: string;
  questions: FutureAuditQuestion[];
}

export interface FutureAuditRecommendation {
  id: string;
  priority: 'Immediate' | 'High' | 'Medium' | 'Low';
  /** Key of the AuditPillar enum — used for sorting */
  pillarKey: string;
  pillarName: string;
  problem: string;
  recommendation: string;
  expectedBenefit: string;
  scoreGain: number; // e.g. 2 (+2 points)
  linkedQuestionId: string;
}

export interface FutureAuditSummary {
  // Existing fields
  strengths:            string[];
  weaknesses:           string[];
  highestPillar:        string;
  lowestPillar:         string;
  totalRecommendations: number;
  potentialImprovement: number;

  // Phase 3A — expanded executive summary fields
  overallScore:         number;
  overallMaxScore:      number;
  overallPercentage:    number;
  overallRating:        string;
  criticalFindings:     number;
  /** null when ImageValidationPanel has not yet run (e.g. history records) */
  imageQualityScore:    number | null;
  imageQualityLevel:    string | null;
  /** 0–100 audit_confidence from the edge function response */
  auditConfidence:      number | null;
}

export interface FutureAuditResult {
  overallScore: number;
  overallMaxScore: number;
  overallPercentage: number;
  overallRating: 'Excellent' | 'Good' | 'Average' | 'Needs Improvement' | 'Poor';
  pillars: FuturePillar[];
  recommendations: FutureAuditRecommendation[];
  summary: FutureAuditSummary;
  areaInfo: {
    companyName: string;
    auditDate: string;
    areaName: string;
    department: string;
    industry: string;
    workspaceType: string;
    auditor: string;
  };
}

