/**
 * src/modules/audit/recommendation/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 7 — Recommendation Generator: Public API
 *
 * ROLE:
 *   Public barrel for the Recommendation Generator.
 */

export { generateRecommendations } from './recommendationGenerator';
export { buildRecommendationPrompt } from './promptBuilder';
export { validateRecommendations }   from './recommendationValidator';
export { safeParseJson }             from './jsonValidator';
export { sortQuestionRecommendations } from './recommendationPriority';

export type {
  QuestionRecommendation,
  PillarRecommendation,
  OverallRecommendation,
  AuditRecommendationResult,
} from './recommendationTypes';
