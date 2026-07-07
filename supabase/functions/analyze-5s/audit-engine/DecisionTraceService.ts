/**
 * supabase/functions/analyze-5s/audit-engine/DecisionTraceService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Decision Trace Service (Phase 4.2).
 *
 * Persists the complete reasoning chain used for every audit question.
 * Used for debugging, audit replay, and calibration feedback.
 *
 * A DecisionTrace records:
 *  - Visible objects relevant to the question
 *  - Expected objects from zone knowledge (what should be present)
 *  - Positive findings that support the rating
 *  - Violations that were considered
 *  - Decision strategy applied (from AuditDecisionMatrix)
 *  - Calibration rules that fired (from CalibrationService)
 *  - Evidence coverage and balance summaries
 *  - Final confidence and rating after all overrides
 *
 * The trace is stored internally in AuditSessionResult (traceMap).
 * It is NOT displayed by default — it is an internal audit record.
 *
 * Design invariants:
 *  - Zero LLM calls — purely deterministic composition
 *  - Never throws — returns empty-safe structs on missing data
 *  - Zero zone-specific logic
 *  - No prompt content
 *  - Idempotent — same inputs always produce identical trace
 */

import type {
  AuditEvidenceModel,
  QuestionResult,
  QuestionDecisionConfig,
  QuestionCalibrationConfig,
  EvidenceCoverage,
  BalanceResult,
  VisibleObject,
  PositiveObservation,
  ViolationObservation,
  AuditRating,
  DecisionStrategy,
  FilteredEvidenceModel,
} from './types.ts';
import type { CalibrationOverride } from './CalibrationService.ts';
import { EvidenceFilterService }     from './EvidenceFilterService.ts';

// ── DecisionTrace ──────────────────────────────────────────────────────────────

/**
 * A single-question reasoning trace.
 * Consumed by CalibrationFeedback and debugging tools.
 */
export interface DecisionTrace {
  questionId:          string;
  question:            string;
  decisionStrategy:    DecisionStrategy | 'UNKNOWN';
  questionType:        1 | 2 | 3;
  evidenceCategory:    'A' | 'B' | 'C';
  relevantVisibleObjects:   VisibleObject[];
  expectedObjects:          string[];
  relevantPositiveFindings: PositiveObservation[];
  relevantViolations:       ViolationObservation[];
  coverageSummary:          string;
  balanceSummary:           string;
  appliedCalibrationRules:  CalibrationOverride[];
  llmRating:               AuditRating;
  llmConfidence:           string;
  llmEvidence:             string;
  llmAssessment:           string;
  finalRating:             AuditRating;
  finalConfidence:         string;
  finalScore:              number;
  wasOverridden:           boolean;
  tracedAt:                string;

  // Added in R11.1
  allowedObjects?:      VisibleObject[];
  filteredObjects?:     VisibleObject[];
  discardedObjects?:    VisibleObject[];
  discardReasons?:      string[];
}

// ── Dimension keyword map ─────────────────────────────────────────────────────

const QUESTION_DIMENSIONS: Readonly<Record<string, readonly string[]>> = {
  'SORT-01':  ['unnecessary', 'unused', 'obsolete', 'displaced'],
  'SORT-02':  ['equipment', 'machinery', 'layout', 'zone'],
  'SORT-03':  ['document', 'record', 'instruction', 'manual'],
  'SORT-04':  ['item', 'object', 'material', 'stock'],
  'SIO-01':   ['label', 'identification', 'sign', 'marking'],
  'SIO-02':   ['floor', 'marking', 'aisle', 'delineation'],
  'SIO-03':   ['storage', 'location', 'position', 'organisation'],
  'SIO-04':   ['document', 'file', 'record', 'instruction'],
  'SHN-01':   ['cleaning', 'tool', 'mop', 'broom', 'wipe'],
  'SHN-02':   ['floor', 'surface', 'dust', 'dirt', 'cleanliness'],
  'SHN-03':   ['machine', 'equipment', 'surface', 'oil', 'rust'],
  'SHN-04':   ['cleaning', 'routine', 'hygiene'],
  'STD-01':   ['label', 'identification', 'colour', 'marking'],
  'STD-02':   ['instruction', 'SOP', 'procedure', 'posted'],
  'STD-03':   ['storage', 'location', 'control', 'visual'],
  'STD-04':   ['cleaning', 'inspection', 'maintenance', 'posted'],
  'SUS-01':   ['cleanliness', 'organisation', 'maintained', 'condition'],
  'SUS-02':   ['audit', 'inspection', 'checklist', 'record'],
  'SUS-03':   ['training', 'awareness', 'procedure', 'compliance'],
  'SUS-04':   ['improvement', 'initiative', 'suggestion', 'kaizen'],
};

// ── DecisionTraceService ───────────────────────────────────────────────────────

export class DecisionTraceService {

  static buildTrace(
    rawQuestion:   QuestionResult,
    finalQuestion: QuestionResult,
    evidence:      AuditEvidenceModel,
    admConfig:     QuestionDecisionConfig | undefined,
    calibConfig:   QuestionCalibrationConfig | undefined,
    coverage:      EvidenceCoverage | undefined,
    balance:       BalanceResult | undefined,
    overrides:     CalibrationOverride[],
    filteredMap?:  Map<string, FilteredEvidenceModel>,
  ): DecisionTrace {
    const qId      = rawQuestion.questionId;
    const keywords = QUESTION_DIMENSIONS[qId] ?? [];

    const relevantVisibleObjects = evidence.visibleObjects.filter((obj) =>
      keywords.some((kw) => obj.description.toLowerCase().includes(kw)),
    );

    const relevantPositiveFindings = evidence.positiveCompliance.filter((pos) =>
      keywords.some(
        (kw) =>
          pos.dimension.toLowerCase().includes(kw) ||
          pos.observation.toLowerCase().includes(kw),
      ),
    );

    const relevantViolations = evidence.violations.filter((viol) =>
      keywords.some(
        (kw) =>
          viol.dimension.toLowerCase().includes(kw) ||
          viol.observation.toLowerCase().includes(kw),
      ),
    );

    const coverageSummary = coverage
      ? `Coverage: ${coverage.coveragePercentage}%, Confidence: ${coverage.recommendedConfidence}, Context: ${coverage.contextCompleteness}`
      : 'Coverage: N/A';

    const balanceSummary = balance
      ? `Balance: ${balance.balanceRatio.toFixed(2)} -> Guidance: ${balance.ratingGuidance}`
      : 'Balance: N/A';

    const questionOverrides = overrides.filter((o) => o.questionId === qId);

    // Resolve filtered model for trace
    const filtered = filteredMap?.get(qId) || EvidenceFilterService.filterForQuestion(qId, evidence);

    return {
      questionId:               qId,
      question:                 rawQuestion.question,
      decisionStrategy:         admConfig?.decisionStrategy ?? 'UNKNOWN',
      questionType:             admConfig?.questionType ?? 1,
      evidenceCategory:         admConfig?.evidenceCategory ?? 'A',
      relevantVisibleObjects,
      expectedObjects:          evidence.expectedObjects,
      relevantPositiveFindings,
      relevantViolations,
      coverageSummary,
      balanceSummary,
      appliedCalibrationRules:  questionOverrides,
      llmRating:               rawQuestion.rating,
      llmConfidence:           rawQuestion.confidence,
      llmEvidence:             rawQuestion.evidence,
      llmAssessment:           rawQuestion.assessment,
      finalRating:             finalQuestion.rating,
      finalConfidence:         finalQuestion.confidence,
      finalScore:              finalQuestion.score,
      wasOverridden:           questionOverrides.length > 0,
      tracedAt:                new Date().toISOString(),

      // R11.1
      allowedObjects:           filtered.allowedObjects,
      filteredObjects:          filtered.filteredObjects ?? filtered.allowedObjects,
      discardedObjects:         filtered.discardedObjectsList ?? [],
      discardReasons:           filtered.discardReasons ?? [],
    };
  }

  static buildAllTraces(
    rawQuestions:   QuestionResult[],
    finalQuestions: QuestionResult[],
    evidence:       AuditEvidenceModel,
    admConfigs:     QuestionDecisionConfig[],
    calibConfigs:   QuestionCalibrationConfig[],
    coverages:      EvidenceCoverage[],
    balances:       BalanceResult[],
    overrides:      CalibrationOverride[],
    filteredMap?:   Map<string, FilteredEvidenceModel>,
  ): Map<string, DecisionTrace> {
    const admMap      = new Map(admConfigs.map((c) => [c.questionId, c]));
    const calibMap    = new Map(calibConfigs.map((c) => [c.questionId, c]));
    const coverageMap = new Map(coverages.map((c) => [c.questionId, c]));
    const balanceMap  = new Map(balances.map((b) => [b.questionId, b]));
    const finalMap    = new Map(finalQuestions.map((q) => [q.questionId, q]));
    const traces      = new Map<string, DecisionTrace>();

    for (const raw of rawQuestions) {
      const final = finalMap.get(raw.questionId) ?? raw;
      const trace = DecisionTraceService.buildTrace(
        raw,
        final,
        evidence,
        admMap.get(raw.questionId),
        calibMap.get(raw.questionId),
        coverageMap.get(raw.questionId),
        balanceMap.get(raw.questionId),
        overrides,
        filteredMap,
      );
      traces.set(raw.questionId, trace);
    }

    return traces;
  }

  static toArray(traces: Map<string, DecisionTrace>): DecisionTrace[] {
    return Array.from(traces.values());
  }

  static toLogLine(trace: DecisionTrace): string {
    const override = trace.wasOverridden
      ? `OVERRIDDEN (${trace.appliedCalibrationRules.map((o) => o.rule).join(', ')})`
      : 'no override';
    return `[${trace.questionId}] ${trace.decisionStrategy} | LLM: ${trace.llmRating} -> Final: ${trace.finalRating} (${override})`;
  }
}
