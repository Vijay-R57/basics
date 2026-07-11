/**
 * src/modules/audit/recommendation/recommendationValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 7 — Recommendation Generator: Content Validator
 *
 * ROLE:
 *   Validates the structure and content of the generated recommendations.
 *   Enforces that:
 *     - No score or rating has been altered or injected.
 *     - Only un-scored or low-rated questions have recommendations.
 *     - All required fields and arrays are populated.
 *     - Factual alignment with inputs is preserved (no unknown objects).
 *     - Hallucination detection: checks if objects not present in the audit are mentioned.
 */

import type { AuditRecommendationResult, QuestionRecommendation } from './recommendationTypes';
import type { QuestionScore, StandardizedObservation } from '@/types/analysis';
import { EVIDENCE_VOCABULARY } from '../ruleConfiguration/evidenceVocabulary';

/**
 * Validates the Gemini recommendation outputs against the input audit results.
 * Throws a structured Error if any check fails.
 *
 * @param result        - The parsed recommendations output from Gemini.
 * @param questionScores - The input question scores.
 * @param observations   - Standardized observations (containing evidenceIds).
 */
export function validateRecommendations(
  result:         any,
  questionScores: QuestionScore[],
  observations:   StandardizedObservation[],
): void {
  // 1. Validate top-level structure
  if (!result || typeof result !== 'object') {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: Result is missing or not an object.');
  }

  if (!Array.isArray(result.questionRecommendations)) {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: "questionRecommendations" is missing or not an array.');
  }

  if (!Array.isArray(result.pillarRecommendations)) {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: "pillarRecommendations" is missing or not an array.');
  }

  if (!result.overallRecommendation || typeof result.overallRecommendation !== 'object') {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: "overallRecommendation" is missing or not an object.');
  }

  // 2. Validate overall recommendation fields
  const overall = result.overallRecommendation;
  if (!overall.summary || typeof overall.summary !== 'string' || overall.summary.trim() === '') {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: "overallRecommendation.summary" is missing or empty.');
  }

  if (!Array.isArray(overall.strengths) || overall.strengths.length === 0) {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: "overallRecommendation.strengths" must be a non-empty array.');
  }

  if (!Array.isArray(overall.improvements) || overall.improvements.length === 0) {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: "overallRecommendation.improvements" must be a non-empty array.');
  }

  if (!Array.isArray(overall.nextSteps) || overall.nextSteps.length === 0) {
    throw new Error('RECOMMENDATION_VALIDATION_ERROR: "overallRecommendation.nextSteps" must be a non-empty array.');
  }

  // Helper lookups
  const scoreMap = new Map<string, QuestionScore>();
  for (const q of questionScores) {
    scoreMap.set(q.questionId, q);
  }

  // Compile the set of ALL objects observed in the audit (by ID and by display name)
  const observedKeys = new Set<string>();
  const observedDisplayNames = new Set<string>();

  for (const obs of observations) {
    if (obs.visible) {
      for (const id of obs.evidenceIds) {
        observedKeys.add(id);
        const name = (EVIDENCE_VOCABULARY as any)[id];
        if (name) {
          observedDisplayNames.add(name.toLowerCase());
        }
      }
    }
  }

  // Compile the set of UNOBSERVED objects (present in vocabulary but NOT observed in the audit)
  const unobservedDisplayNames = new Map<string, string>(); // lowercase name -> key
  for (const [key, displayName] of Object.entries(EVIDENCE_VOCABULARY)) {
    const lowerDisplayName = displayName.toLowerCase();
    
    // If the key was not observed, check if it's a substring of any observed display name
    // (to prevent "chemical container" from flagging "container" as unobserved)
    if (!observedKeys.has(key)) {
      const isSubOfObserved = [...observedDisplayNames].some(obsName => 
        obsName.includes(lowerDisplayName)
      );
      if (!isSubOfObserved) {
        unobservedDisplayNames.set(lowerDisplayName, key);
      }
    }
  }

  // 3. Helper to detect hallucinated vocabulary objects in a text block
  const checkHallucination = (text: string, questionId: string) => {
    const lowerText = text.toLowerCase();
    for (const [displayName, key] of unobservedDisplayNames.entries()) {
      // Use word boundary to avoid partial word matches (e.g. "shelves" matching "shelf" is okay,
      // but let's make sure we check the term accurately)
      const regex = new RegExp('\\b' + displayName + '\\b', 'i');
      if (regex.test(lowerText) || lowerText.includes(key.toLowerCase())) {
        throw new Error(
          `RECOMMENDATION_VALIDATION_ERROR: Question "${questionId}" recommendation contains a reference ` +
          `to unobserved object "${displayName}" (${key}). This violates the hallucination prevention rule.`,
        );
      }
    }
  };

  // 4. Validate Question Recommendations
  const seenQIds = new Set<string>();
  for (let i = 0; i < result.questionRecommendations.length; i++) {
    const rec = result.questionRecommendations[i] as QuestionRecommendation;

    if (!rec.questionId || typeof rec.questionId !== 'string') {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Question recommendation at index ${i} is missing a questionId.`);
    }

    if (seenQIds.has(rec.questionId)) {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Duplicate recommendation for question "${rec.questionId}".`);
    }
    seenQIds.add(rec.questionId);

    const inputScore = scoreMap.get(rec.questionId);
    if (!inputScore) {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Recommendation references unknown questionId "${rec.questionId}".`);
    }

    // Check 1: No Rating Modifications
    if (rec.rating !== inputScore.rating) {
      throw new Error(
        `RECOMMENDATION_VALIDATION_ERROR: Rating mismatch for "${rec.questionId}". ` +
        `Expected: "${inputScore.rating}". Received: "${rec.rating}". Rating modifications are forbidden.`,
      );
    }

    // Check 2: Only low-rated/skipped questions (AVERAGE, BAD, VERY_BAD)
    const isLowRated = inputScore.rating === 'VERY_BAD' || inputScore.rating === 'BAD' || inputScore.rating === 'AVERAGE';
    if (!isLowRated) {
      throw new Error(
        `RECOMMENDATION_VALIDATION_ERROR: Question "${rec.questionId}" is rated "${inputScore.rating}". ` +
        `Recommendations are restricted to AVERAGE, BAD, and VERY_BAD ratings only.`,
      );
    }

    // Check 3: Factual non-empty fields
    if (!rec.issue || typeof rec.issue !== 'string' || rec.issue.trim() === '') {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Recommendation for "${rec.questionId}" has an empty issue string.`);
    }
    if (!rec.action || typeof rec.action !== 'string' || rec.action.trim() === '') {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Recommendation for "${rec.questionId}" has an empty action string.`);
    }

    // Check 4: Hallucination Detection
    checkHallucination(rec.issue, rec.questionId);
    checkHallucination(rec.action, rec.questionId);
  }

  // 5. Validate Pillar Recommendations
  for (let i = 0; i < result.pillarRecommendations.length; i++) {
    const pRec = result.pillarRecommendations[i];

    if (!pRec.pillar || typeof pRec.pillar !== 'string') {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Pillar recommendation at index ${i} is missing a pillar name.`);
    }

    if (!pRec.summary || typeof pRec.summary !== 'string' || pRec.summary.trim() === '') {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Pillar recommendation for "${pRec.pillar}" has an empty summary.`);
    }

    if (!pRec.strategy || typeof pRec.strategy !== 'string' || pRec.strategy.trim() === '') {
      throw new Error(`RECOMMENDATION_VALIDATION_ERROR: Pillar recommendation for "${pRec.pillar}" has an empty strategy.`);
    }

    checkHallucination(pRec.summary, pRec.pillar);
    checkHallucination(pRec.strategy, pRec.pillar);
  }

  // 6. Validate Overall Recommendations for Hallucination
  checkHallucination(overall.summary, 'OVERALL');
  overall.strengths.forEach((s: string) => checkHallucination(s, 'OVERALL'));
  overall.improvements.forEach((s: string) => checkHallucination(s, 'OVERALL'));
  overall.nextSteps.forEach((s: string) => checkHallucination(s, 'OVERALL'));
}
