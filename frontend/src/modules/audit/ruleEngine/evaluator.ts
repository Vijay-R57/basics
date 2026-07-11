/**
 * src/modules/audit/ruleEngine/evaluator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.3 — Deterministic Rule Engine: Single Question Evaluator
 *
 * ROLE:
 *   Evaluates a single audit question against a standardized observation.
 *   Produces a RuleEvaluationResult. Pure and deterministic.
 */

import type { RuleEvaluationResult, EnrichedAuditQuestion } from './ruleTypes';
import { executePrecedenceChain } from './precedenceEngine';
import { buildRuleTrace } from './traceBuilder';
import { debugLog, debugGroup, debugGroupEnd } from '../pipeline/debug';

/**
 * Evaluates rules for a single audit question.
 *
 * @param questionId  - The ID of the question.
 * @param visibility  - The visibility status ('VISIBLE', 'PARTIALLY_VISIBLE', 'NOT_VISIBLE').
 * @param evidenceIds - The standardized evidence keys.
 * @param config      - The question configuration.
 * @returns Factual RuleEvaluationResult without scores.
 */
export function evaluateQuestionRules(
  questionId:  string,
  visibility:  string,
  evidenceIds: string[],
  config:      EnrichedAuditQuestion,
): RuleEvaluationResult {
  const startTime = Date.now();

  // Run the precedence chain
  const prec = executePrecedenceChain(visibility, evidenceIds, config, questionId);

  // Generate trace
  const trace = buildRuleTrace(questionId, visibility, evidenceIds, config, prec);

  const elapsed = Date.now() - startTime;

  // Debug logging
  debugGroup(`Question: ${questionId}`);
  debugLog('Evidence IDs:      ', evidenceIds);
  debugLog('Required Evidence: ', config.evidence.required);
  debugLog('Optional Evidence: ', config.evidence.optional);
  debugLog('Forbidden Evidence:', config.evidence.forbidden);
  debugLog('Matched Evidence:  ', prec.matchedEvidence);
  debugLog('Missing Evidence:  ', prec.missingEvidence);
  debugLog('Applied Threshold: ', prec.matchedRule);
  debugLog('Assigned Rating:   ', prec.rating);
  debugLog('Rule Trace:        ', trace);
  debugLog('Execution Time:    ', `${elapsed}ms`);
  debugLog('Pipeline Decision:  PASS_TO_SCORE_ENGINE');
  debugGroupEnd();

  return {
    questionId,
    visibility,
    rating:            prec.rating,
    matchedEvidence:   prec.matchedEvidence,
    missingEvidence:   prec.missingEvidence,
    forbiddenEvidence: prec.forbiddenEvidence,
    matchedOptional:   prec.matchedOptional,
    matchedCount:      prec.matchedCount,
    matchedRule:       prec.matchedRule,
    evaluationTrace:   trace,
  };
}
