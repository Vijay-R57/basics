/**
 * src/modules/audit/ruleEngine/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.3 — Deterministic Rule Engine: Public API
 *
 * ROLE:
 *   Orchestrates evaluation of deterministic rules across all standard audit questions.
 *   Consumes StandardizedObservations, VisibilityDecisions, and AuditConfiguration.
 *   Produces a flat collection of RuleEvaluationResults.
 */

import type {
  RuleEvaluationResult,
  StandardizedObservation,
  VisibilityDecision,
} from '@/types/analysis';
import type { AuditConfiguration } from '../ruleConfiguration';
import { evaluateQuestionRules } from './evaluator';
import { debugGroup, debugGroupEnd, debugLog } from '../pipeline/debug';

export type { RuleEvaluationResult, AuditRating } from './ruleTypes';

/**
 * Evaluates deterministic rules for all questions in the audit template.
 *
 * @param observations - Standardized observations containing evidenceIds.
 * @param visDecisions - Visibility decisions for each question.
 * @param config       - The validated AuditConfiguration (from Registry).
 * @returns Array of RuleEvaluationResults — one per question.
 */
export function evaluateAllQuestions(
  observations: StandardizedObservation[],
  visDecisions: VisibilityDecision[],
  config:       AuditConfiguration,
): RuleEvaluationResult[] {
  const startTime = Date.now();

  debugGroup('Rule Engine Started');
  debugLog('Total Questions:', config.allQuestions.length);

  // Fast lookups
  const obsMap = new Map<string, StandardizedObservation>();
  for (const entry of observations) {
    obsMap.set(entry.questionId, entry);
  }

  const visMap = new Map<string, string>();
  for (const entry of visDecisions) {
    visMap.set(entry.questionId, entry.visibility);
  }

  const results: RuleEvaluationResult[] = [];

  for (const q of config.allQuestions) {
    const obs = obsMap.get(q.id);
    const vis = visMap.get(q.id) ?? 'NOT_VISIBLE'; // Default to NOT_VISIBLE if missing

    // Extract evidence IDs. If observation is missing or invisible, pool is empty.
    const evidenceIds = (obs && obs.visible) ? obs.evidenceIds : [];

    const result = evaluateQuestionRules(q.id, vis, evidenceIds, q);
    results.push(result);
  }

  const elapsed = Date.now() - startTime;
  debugLog('Rule Engine Execution Complete.');
  debugLog(`Total scored: ${results.filter(r => r.rating !== 'NOT_SCORED').length}`);
  debugLog(`Total excluded: ${results.filter(r => r.rating === 'NOT_SCORED').length}`);
  debugLog(`Execution Time (ms): ${elapsed}`);
  debugGroupEnd();

  return results;
}
