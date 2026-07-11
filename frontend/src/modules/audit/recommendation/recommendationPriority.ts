/**
 * src/modules/audit/recommendation/recommendationPriority.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 7 — Recommendation Generator: Priority Sorter
 *
 * ROLE:
 *   Handles deterministic prioritization and sorting of question-level recommendations.
 *
 * SORTING RULES:
 *   1. Rating level: VERY_BAD > BAD > AVERAGE
 *   2. Category level: Impact > Safety > Operational Efficiency > Visual Management > Housekeeping
 *   3. Secondary tiebreaker: Alphabetical questionId
 */

import type { QuestionRecommendation } from './recommendationTypes';

// ── Rating Priority Map ──────────────────────────────────────────────────────

const RATING_PRIORITY: Record<string, number> = {
  VERY_BAD: 1,
  BAD:      2,
  AVERAGE:  3,
};

// ── Category Priority Map ────────────────────────────────────────────────────

type CategoryKey = 'IMPACT' | 'SAFETY' | 'OPERATIONAL_EFFICIENCY' | 'VISUAL_MANAGEMENT' | 'HOUSEKEEPING';

const CATEGORY_PRIORITY: Record<CategoryKey, number> = {
  IMPACT:                 1,
  SAFETY:                 2,
  OPERATIONAL_EFFICIENCY: 3,
  VISUAL_MANAGEMENT:      4,
  HOUSEKEEPING:           5,
};

// ── Question ID to Category Map ──────────────────────────────────────────────
//
// Hardcoded mapping to assign each of the 20 standard questions to one category
// to ensure 100% deterministic sorting matching the spec.

const QUESTION_CATEGORY: Record<string, CategoryKey> = {
  // SORT
  SORT_Q1: 'OPERATIONAL_EFFICIENCY', // raw materials clutter
  SORT_Q2: 'OPERATIONAL_EFFICIENCY', // tools/equipment
  SORT_Q3: 'OPERATIONAL_EFFICIENCY', // large equipment/shelves
  SORT_Q4: 'VISUAL_MANAGEMENT',      // outdated docs/visuals

  // SET IN ORDER
  SET_IN_ORDER_Q1: 'VISUAL_MANAGEMENT',      // labelling
  SET_IN_ORDER_Q2: 'VISUAL_MANAGEMENT',      // tool shadow boards
  SET_IN_ORDER_Q3: 'SAFETY',                 // floor markings/safety zones
  SET_IN_ORDER_Q4: 'VISUAL_MANAGEMENT',      // neat operating procedures

  // SHINE
  SHINE_Q1: 'HOUSEKEEPING', // cleaning tools
  SHINE_Q2: 'HOUSEKEEPING', // machinery dust/dirt
  SHINE_Q3: 'HOUSEKEEPING', // walkways/scrap area dirt
  SHINE_Q4: 'HOUSEKEEPING', // overall housekeeping adherence

  // STANDARDIZE
  STANDARDIZE_Q1: 'VISUAL_MANAGEMENT',      // standardized labels
  STANDARDIZE_Q2: 'VISUAL_MANAGEMENT',      // visual work standards
  STANDARDIZE_Q3: 'SAFETY',                 // PPE/emergency procedures
  STANDARDIZE_Q4: 'OPERATIONAL_EFFICIENCY', // standardized storage bins

  // SUSTAIN
  SUSTAIN_Q1: 'VISUAL_MANAGEMENT', // 5S audit boards
  SUSTAIN_Q2: 'VISUAL_MANAGEMENT', // Kaizen/continuous boards
  SUSTAIN_Q3: 'HOUSEKEEPING',      // preserved floor markings/labels
  SUSTAIN_Q4: 'HOUSEKEEPING',      // overall condition
};

// ── Priority Sorter ──────────────────────────────────────────────────────────

/**
 * Deterministically sorts question recommendations by rating and category.
 *
 * @param recommendations - Unsorted question recommendations.
 * @returns Prioritized question recommendations.
 */
export function sortQuestionRecommendations(
  recommendations: QuestionRecommendation[],
): QuestionRecommendation[] {
  return [...recommendations].sort((a, b) => {
    // 1. Rating Priority (VERY_BAD > BAD > AVERAGE)
    const ratingPriA = RATING_PRIORITY[a.rating] ?? 99;
    const ratingPriB = RATING_PRIORITY[b.rating] ?? 99;

    if (ratingPriA !== ratingPriB) {
      return ratingPriA - ratingPriB;
    }

    // 2. Category Priority (Impact > Safety > Operational Efficiency > Visual Management > Housekeeping)
    const catKeyA = QUESTION_CATEGORY[a.questionId] ?? 'IMPACT';
    const catKeyB = QUESTION_CATEGORY[b.questionId] ?? 'IMPACT';

    const catPriA = CATEGORY_PRIORITY[catKeyA];
    const catPriB = CATEGORY_PRIORITY[catKeyB];

    if (catPriA !== catPriB) {
      return catPriA - catPriB;
    }

    // 3. Alphabetical tiebreaker
    return a.questionId.localeCompare(b.questionId);
  });
}
