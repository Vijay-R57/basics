/**
 * src/modules/audit/ruleEngine/precedenceEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.3 — Deterministic Rule Engine: Precedence Engine
 *
 * ROLE:
 *   Enforces the exact 5-step rule precedence for evaluating a question.
 *
 * PRECEDENCE STEPS:
 *   1. Visibility check (if NOT_VISIBLE, skip everything and return NOT_SCORED)
 *   2. Forbidden Evidence check (identify and filter out forbidden keys)
 *   3. Required Evidence matching
 *   4. Optional Evidence matching
 *   5. Threshold Evaluation (evaluate matched count to assign final rating)
 */

import type { AuditRating, EvidenceMatchResult } from './ruleTypes';
import { matchEvidence } from './evidenceMatcher';
import { evaluateThresholds } from './thresholdEngine';
import type { EnrichedAuditQuestion } from '../ruleConfiguration';

export interface PrecedenceResult {
  rating:            AuditRating;
  matchedEvidence:   string[];
  missingEvidence:   string[];
  forbiddenEvidence: string[];
  matchedOptional:   string[];
  matchedCount:      number;
  matchedRule:       string;
}

/**
 * Executes the 5 evaluation steps in strict precedence order for a single question.
 *
 * @param visibilityDec  - Visibility decision status ('VISIBLE', 'PARTIALLY_VISIBLE', 'NOT_VISIBLE')
 * @param evidenceIds    - The standardized evidence keys detected for this question.
 * @param config         - The question's configuration.
 * @param questionId     - Question ID for logging/warnings.
 */
export function executePrecedenceChain(
  visibilityDec: string,
  evidenceIds:   string[],
  config:        EnrichedAuditQuestion,
  questionId:    string,
): PrecedenceResult {

  // ── Step 1: Visibility Check ───────────────────────────────────────────────
  // If the image does not capture enough visual context for this question,
  // it MUST NOT be scored. Preemptively return NOT_SCORED.
  if (visibilityDec === 'NOT_VISIBLE') {
    return {
      rating:            'NOT_SCORED',
      matchedEvidence:   [],
      missingEvidence:   [],
      forbiddenEvidence: [],
      matchedOptional:   [],
      matchedCount:      0,
      matchedRule:       'visibility_bypass',
    };
  }

  // ── Step 2, 3, 4: Forbidden, Required & Optional Evidence ──────────────────
  // Forbidden evidence is detected, logged, and filtered out from the match pool.
  // Required and Optional items are matched against the remaining keys.
  const matchResult = matchEvidence(evidenceIds, config.evidence, questionId);

  // ── Step 5: Threshold Evaluation ───────────────────────────────────────────
  // Matched count is mapped to an AuditRating using the scoring thresholds config.
  const thresholdResult = evaluateThresholds(matchResult.matchedCount, config.scoring.thresholds);

  return {
    rating:            thresholdResult.rating,
    matchedEvidence:   matchResult.matchedEvidence,
    missingEvidence:   matchResult.missingEvidence,
    forbiddenEvidence: matchResult.forbiddenEvidence,
    matchedOptional:   matchResult.matchedOptional,
    matchedCount:      matchResult.matchedCount,
    matchedRule:       thresholdResult.matchedRule,
  };
}
