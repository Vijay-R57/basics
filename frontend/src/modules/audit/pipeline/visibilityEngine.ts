/**
 * src/modules/audit/pipeline/visibilityEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline V3 — Phase 5: Visibility Decision Engine
 *
 * ROLE:
 *   Determines whether each audit question has sufficient visible evidence
 *   to proceed to deterministic scoring in the Rule Engine.
 *
 * RESPONSIBILITIES:
 *   ✓ Evaluate every validated observation against three visibility tiers
 *   ✓ Produce one VisibilityDecision per question — no question is skipped
 *   ✓ Generate a factual reason string for every decision
 *   ✓ Mark NOT_VISIBLE questions for exclusion from scoring
 *   ✓ Allow VISIBLE and PARTIALLY_VISIBLE questions to continue
 *
 * STRICT PROHIBITIONS:
 *   ✗ No Gemini API calls — fully deterministic
 *   ✗ No compliance judgements (VISIBLE ≠ compliant, NOT_VISIBLE ≠ failed)
 *   ✗ No ratings, scores, grades, or recommendations
 *   ✗ No modification of observations
 *   ✗ Reason strings must never mention compliance, rating, score, or grade
 *
 * DECISION TIERS (applied in order, first match wins):
 *
 *   Tier 1 → NOT_VISIBLE
 *     • observation.visible === false
 *     • observation.confidence < 25
 *     • evidence AND objects are both empty (regardless of visible flag)
 *
 *   Tier 2 → PARTIALLY_VISIBLE
 *     • confidence 25–64 (inclusive)
 *     • only 1 object matched where guidance lists ≥3 evaluate terms
 *     • evidence exists but objects array is empty (text-only match)
 *
 *   Tier 3 → VISIBLE (default when Tiers 1 & 2 don't apply)
 *     • visible === true AND confidence ≥ 65
 *
 * PIPELINE CONTRACT:
 *   VISIBLE | PARTIALLY_VISIBLE → PASS_TO_RULE_ENGINE
 *   NOT_VISIBLE                 → EXCLUDE_FROM_SCORING
 *   The pipeline NEVER stops because one question is NOT_VISIBLE.
 *
 * PIPELINE POSITION:
 *   Observation Validator → [Visibility Decision Engine] → Rule Engine
 */

import type {
  GeminiVisionResult,
  StructuredObservationResult,
  VisibilityDecision,
  VisibilityStatus,
} from '@/types/analysis';
import type { AuditQuestion } from './questions';
import {
  debugLog,
  debugGroup,
  debugGroupEnd,
} from './debug';

// ── Reason builders ───────────────────────────────────────────────────────────
//
// Each function produces a factual reason string explaining WHY the status
// was assigned. Reasons reference only visible objects and locations.
// Reasons NEVER mention compliance, ratings, scores, or judgements.

function buildNotVisibleReason(
  objects:  string[],
  question: AuditQuestion,
): string {
  if (objects.length === 0) {
    const firstEvaluate = question.guidance?.evaluate?.[0] ?? 'the required items';
    return (
      `No objects matching the evaluation criteria for this question ` +
      `(e.g. "${firstEvaluate}") were detected in the captured image area.`
    );
  }
  // Objects were detected but confidence is too low
  const listed = objects.slice(0, 2).join(', ');
  return (
    `Detected objects (${listed}) were identified with insufficient certainty ` +
    `to support a reliable visibility assessment for this question.`
  );
}

function buildPartiallyVisibleReason(
  objects:    string[],
  confidence: number,
  reason:     'low_confidence' | 'single_object' | 'text_only',
): string {
  switch (reason) {
    case 'low_confidence': {
      const listed = objects.length > 0 ? objects.slice(0, 2).join(', ') : 'relevant items';
      return (
        `${listed} ${objects.length === 1 ? 'is' : 'are'} detectable in the image ` +
        `but with limited certainty (${confidence}%). ` +
        `Only partial visual evidence is available for this question.`
      );
    }
    case 'single_object': {
      const obj = objects[0] ?? 'one relevant object';
      return (
        `Only "${obj}" is visible in the captured area, ` +
        `while this question requires evidence of multiple item types. ` +
        `The available visual evidence is partial.`
      );
    }
    case 'text_only': {
      return (
        `Relevant text is readable in the image but no matching physical objects ` +
        `were identified. Visual evidence is limited to text references only.`
      );
    }
  }
}

function buildVisibleReason(
  objects:    string[],
  confidence: number,
): string {
  if (objects.length === 0) {
    return (
      `Sufficient visual evidence is present in the captured area ` +
      `to support evaluation of this question (confidence: ${confidence}%).`
    );
  }
  const listed = objects.length > 2
    ? objects.slice(0, 2).join(', ') + ` and ${objects.length - 2} more`
    : objects.join(', ');
  return (
    `${listed} ${objects.length === 1 ? 'is' : 'are'} clearly visible ` +
    `in the captured area with sufficient certainty (${confidence}%) ` +
    `to support evaluation of this question.`
  );
}

// ── Tier evaluation ───────────────────────────────────────────────────────────

interface TierResult {
  status:     VisibilityStatus;
  reason:     string;
  confidence: number;
}

function evaluateTiers(
  observation: StructuredObservationResult['observation'],
  question:    AuditQuestion,
): TierResult {
  const { visible, evidence, objects, visibleText, confidence } = observation;
  const evaluateCount = question.guidance?.evaluate?.length ?? 0;

  // ── Tier 1: NOT_VISIBLE ───────────────────────────────────────────────────

  // 1a. Observation engine found no relevant evidence
  if (!visible) {
    return {
      status:     'NOT_VISIBLE',
      reason:     buildNotVisibleReason(objects, question),
      confidence: Math.max(confidence, 30), // use at least the uncertainty default
    };
  }

  // 1b. Both evidence AND objects are empty (despite visible=true — defensive check)
  if (evidence.length === 0 && objects.length === 0) {
    return {
      status:     'NOT_VISIBLE',
      reason:     buildNotVisibleReason([], question),
      confidence: 30,
    };
  }

  // 1c. Confidence below minimum threshold (25)
  if (confidence < 25) {
    return {
      status:     'NOT_VISIBLE',
      reason:     buildNotVisibleReason(objects, question),
      confidence,
    };
  }

  // ── Tier 2: PARTIALLY_VISIBLE ─────────────────────────────────────────────

  // 2a. Confidence in the 25–64 range
  if (confidence < 65) {
    return {
      status:     'PARTIALLY_VISIBLE',
      reason:     buildPartiallyVisibleReason(objects, confidence, 'low_confidence'),
      confidence,
    };
  }

  // 2b. Only one object matched where three or more evaluate terms exist
  if (objects.length === 1 && evaluateCount >= 3) {
    return {
      status:     'PARTIALLY_VISIBLE',
      reason:     buildPartiallyVisibleReason(objects, confidence, 'single_object'),
      confidence,
    };
  }

  // 2c. Text matched but no objects identified
  if (visibleText.length > 0 && objects.length === 0 && evidence.length > 0) {
    return {
      status:     'PARTIALLY_VISIBLE',
      reason:     buildPartiallyVisibleReason(objects, confidence, 'text_only'),
      confidence,
    };
  }

  // ── Tier 3: VISIBLE (default) ─────────────────────────────────────────────
  return {
    status:     'VISIBLE',
    reason:     buildVisibleReason(objects, confidence),
    confidence,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Determines the visibility status for every audit question.
 *
 * This is the single entry point for the Visibility Decision Engine.
 * Call this AFTER validateObservations() passes.
 *
 * Every question always produces exactly one VisibilityDecision.
 * The pipeline NEVER stops because one question is NOT_VISIBLE.
 *
 * @param observations - Validated output of observationEngine.ts (Sprint 3).
 * @param visionResult - Output of geminiVisionAnalyzer.ts (Sprint 2).
 *                       Available for future enhancements; not yet used in Tier logic.
 * @param questions    - All audit questions from getAllQuestions().
 * @returns One VisibilityDecision per question — always 20 for a standard audit.
 *          Ready for consumption by the Deterministic Rule Engine (Sprint 6).
 */
export function determineVisibility(
  observations: StructuredObservationResult[],
  visionResult: GeminiVisionResult,   // reserved for future scene-level checks
  questions:    AuditQuestion[],
): VisibilityDecision[] {
  const startTime = Date.now();

  debugGroup('Visibility Decision Engine Started');
  debugLog('Total questions to evaluate:', questions.length);
  debugLog('Scene environment:', visionResult.scene.environment);

  // Build a fast lookup from questionId → observation
  const obsMap = new Map<string, StructuredObservationResult['observation']>();
  for (const entry of observations) {
    obsMap.set(entry.questionId, entry.observation);
  }

  const decisions: VisibilityDecision[] = [];
  let visibleCount         = 0;
  let partiallyVisibleCount = 0;
  let notVisibleCount      = 0;

  for (const question of questions) {
    // ── Debug: per-question header ──────────────────────────────────────────
    debugGroup(`Question: ${question.id}`);
    debugLog('Current Question:', question.question.slice(0, 80) + (question.question.length > 80 ? '…' : ''));

    // Retrieve the validated observation for this question
    const observation = obsMap.get(question.id);

    // Defensive: if somehow missing (validator should have caught this), use no-match default
    if (!observation) {
      const fallback: VisibilityDecision = {
        questionId:  question.id,
        visibility:  'NOT_VISIBLE',
        reason:      'No observation was found for this question in the validated collection.',
        confidence:  0,
      };

      debugLog('Observation:', '(missing — using NOT_VISIBLE fallback)');
      debugLog('Visibility Status:', fallback.visibility);
      debugLog('Reason:', fallback.reason);
      debugLog('Confidence:', fallback.confidence + '%');
      debugLog('Pipeline Decision: EXCLUDE_FROM_SCORING');
      debugGroupEnd();

      decisions.push(fallback);
      notVisibleCount++;
      continue;
    }

    // ── Debug: observation summary ──────────────────────────────────────────
    debugGroup('Observation');
    debugLog('visible:    ', observation.visible);
    debugLog('objects:    ', observation.objects);
    debugLog('evidence:   ', observation.evidence.length + ' sentence(s)');
    debugLog('confidence: ', observation.confidence + '%');
    debugGroupEnd();

    debugLog('Relevant Objects:', observation.objects);

    // ── Apply tier evaluation ───────────────────────────────────────────────
    const { status, reason, confidence } = evaluateTiers(observation, question);

    const decision: VisibilityDecision = {
      questionId:  question.id,
      visibility:  status,
      reason,
      confidence:  Math.min(100, Math.max(0, confidence)),
    };

    // ── Debug: decision result ──────────────────────────────────────────────
    debugLog('Visibility Status:', status);
    debugLog('Reason:', reason);
    debugLog('Confidence:', confidence + '%');

    const pipelineDecision = status === 'NOT_VISIBLE'
      ? 'EXCLUDE_FROM_SCORING'
      : 'PASS_TO_RULE_ENGINE';
    debugLog('Pipeline Decision:', pipelineDecision);
    debugGroupEnd(); // close question group

    decisions.push(decision);

    // Tally
    if (status === 'VISIBLE')           visibleCount++;
    else if (status === 'PARTIALLY_VISIBLE') partiallyVisibleCount++;
    else                                notVisibleCount++;
  }

  // ── Debug: summary ────────────────────────────────────────────────────────
  const elapsed = Date.now() - startTime;

  debugGroup('Visibility Summary');
  debugLog('VISIBLE:          ', visibleCount);
  debugLog('PARTIALLY_VISIBLE:', partiallyVisibleCount);
  debugLog('NOT_VISIBLE:      ', notVisibleCount);
  debugLog('Total:            ', decisions.length);
  debugGroupEnd();

  const passing = visibleCount + partiallyVisibleCount;
  debugLog(
    `Pipeline Decision: ${passing} question(s) → PASS_TO_RULE_ENGINE, ` +
    `${notVisibleCount} question(s) → EXCLUDE_FROM_SCORING`,
  );
  debugLog(`Execution Time (ms): ${elapsed}`);
  debugGroupEnd(); // close 'Visibility Decision Engine Started'

  return decisions;
}
