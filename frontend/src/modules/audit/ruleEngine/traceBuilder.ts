/**
 * src/modules/audit/ruleEngine/traceBuilder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.3 — Deterministic Rule Engine: Rule Trace Builder
 *
 * ROLE:
 *   Constructs a detailed, step-by-step trace of the rule engine evaluation.
 *   Used only for debugging when VITE_AI_DEBUG is enabled.
 */

import type { EnrichedAuditQuestion } from '../ruleConfiguration';
import type { PrecedenceResult } from './precedenceEngine';

/**
 * Fills in the evaluation trace array step-by-step.
 *
 * @param questionId   - The question ID being evaluated.
 * @param visibility   - The visibility decision.
 * @param evidenceIds  - The input evidence IDs.
 * @param config       - The question's configuration.
 * @param result       - The precedence evaluation results.
 * @returns An array of string descriptions of each step.
 */
export function buildRuleTrace(
  questionId:   string,
  visibility:   string,
  evidenceIds:   string[],
  config:        EnrichedAuditQuestion,
  result:        PrecedenceResult,
): string[] {
  const trace: string[] = [];

  trace.push(`[Rule Engine Trace] Starting evaluation for question ${questionId}`);

  // 1. Visibility Check
  trace.push(`Step 1 (Visibility): Status is "${visibility}".`);
  if (visibility === 'NOT_VISIBLE') {
    trace.push(`Step 1 Bypass: Question is NOT_VISIBLE. Bypassing remaining steps. Rating forced to "NOT_SCORED".`);
    return trace;
  }

  // 2. Input list
  trace.push(`Input Evidence IDs: [${evidenceIds.join(', ')}]`);

  // 3. Forbidden Check
  const forbiddenConfig = config.evidence.forbidden;
  trace.push(`Step 2 (Forbidden): Configuration forbidden list: [${forbiddenConfig.join(', ')}]`);
  if (result.forbiddenEvidence.length > 0) {
    trace.push(`Step 2 Match: Detected forbidden keys: [${result.forbiddenEvidence.join(', ')}]. Excluded from match pool.`);
  } else {
    trace.push(`Step 2 Match: No forbidden keys detected.`);
  }

  // 4. Required Check
  const requiredConfig = config.evidence.required;
  trace.push(`Step 3 (Required): Configuration required list: [${requiredConfig.join(', ')}]`);
  trace.push(`Step 3 Match: Matched required keys: [${result.matchedEvidence.join(', ')}]. ` +
             `Missing keys: [${result.missingEvidence.join(', ')}]. ` +
             `Matched count: ${result.matchedCount}`);

  // 5. Optional Check
  const optionalConfig = config.evidence.optional;
  trace.push(`Step 4 (Optional): Configuration optional list: [${optionalConfig.join(', ')}]`);
  if (result.matchedOptional.length > 0) {
    trace.push(`Step 4 Match: Matched optional keys: [${result.matchedOptional.join(', ')}]`);
  } else {
    trace.push(`Step 4 Match: No optional keys matched.`);
  }

  // 6. Thresholds Check
  trace.push(`Step 5 (Threshold): Evaluating matched count ${result.matchedCount} against thresholds.`);
  const th = config.scoring.thresholds;
  trace.push(`Threshold Levels: veryGood=${th.veryGood.matchedEvidence}, good=${th.good.matchedEvidence}, ` +
             `average=${th.average.matchedEvidence}, bad=${th.bad.matchedEvidence}, veryBad=${th.veryBad.matchedEvidence}`);
  trace.push(`Step 5 Match: Matched rule "${result.matchedRule}". Assigned Rating: "${result.rating}".`);

  return trace;
}
