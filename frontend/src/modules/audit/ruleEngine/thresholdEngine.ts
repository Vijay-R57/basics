/**
 * src/modules/audit/ruleEngine/thresholdEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.3 — Deterministic Rule Engine: Threshold Evaluation Engine
 *
 * ROLE:
 *   Evaluates matched evidence counts against configured thresholds.
 *   Uses a unified, direction-agnostic algorithm that supports both presence-is-good
 *   and absence-is-good questions without any custom question or pillar branching.
 */

import type { AuditRating, ThresholdEvaluationResult } from './ruleTypes';
import type { ScoringThresholds } from '../ruleConfiguration';

/** Maps the threshold configuration keys to the standardized AuditRating union. */
const THRESHOLD_TO_RATING: Record<keyof ScoringThresholds, AuditRating> = {
  veryGood: 'VERY_GOOD',
  good:     'GOOD',
  average:  'AVERAGE',
  bad:      'BAD',
  veryBad:  'VERY_BAD',
};

/**
 * Evaluates matchedCount against scoring thresholds deterministically.
 *
 * UNIFIED ALGORITHM:
 *   1. Map thresholds to a flat list of { rating, matchedEvidence, originalKey }.
 *   2. Sort the list by matchedEvidence in ascending order.
 *   3. Filter for entries where matchedEvidence <= matchedCount.
 *   4. Select the last entry in the sorted list (the highest matchedEvidence that is still <= matchedCount).
 *
 * This works perfectly for:
 *   - Presence-is-good: e.g. 0=VERY_BAD, 4=VERY_GOOD. Count 2 -> candidates: [0, 1, 2] -> pick 2 (AVERAGE).
 *   - Absence-is-good:  e.g. 0=VERY_GOOD, 4=VERY_BAD. Count 2 -> candidates: [0, 1, 2] -> pick 2 (AVERAGE).
 *
 * @param matchedCount - The count of matched required evidence keys.
 * @param thresholds   - The threshold configuration for the question.
 */
export function evaluateThresholds(
  matchedCount: number,
  thresholds:   ScoringThresholds,
): ThresholdEvaluationResult {
  // 1. Map to array
  const entries = (Object.keys(thresholds) as Array<keyof ScoringThresholds>).map(key => ({
    ratingKey:       key,
    rating:          THRESHOLD_TO_RATING[key],
    matchedEvidence: thresholds[key].matchedEvidence,
  }));

  // 2. Sort ascending by matchedEvidence count
  entries.sort((a, b) => a.matchedEvidence - b.matchedEvidence);

  // 3. Filter candidates: matchedEvidence must be <= matchedCount
  const candidates = entries.filter(e => e.matchedEvidence <= matchedCount);

  // Since at least one threshold must define matchedEvidence: 0, and matchedCount >= 0,
  // candidates will never be empty under a valid registry configuration.
  if (candidates.length === 0) {
    // Defensive fallback: default to lowest sorted rating (usually VERY_BAD / VERY_GOOD depending on config)
    return {
      rating:      entries[0].rating,
      matchedRule: entries[0].ratingKey,
    };
  }

  // 4. Return the last matching candidate (highest matchedEvidence count <= matchedCount)
  const bestMatch = candidates[candidates.length - 1];

  return {
    rating:      bestMatch.rating,
    matchedRule: bestMatch.ratingKey,
  };
}
