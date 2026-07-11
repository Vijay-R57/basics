/**
 * src/modules/audit/ruleConfiguration/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — Rule Configuration Engine: Public API
 *
 * ROLE:
 *   The ONLY entry point that other modules may import from.
 *   Exposes a clean, stable public interface for the Rule Configuration Engine.
 *
 * DEPENDENCY BOUNDARY:
 *   Every engine must import from here. NEVER import directly from:
 *   - questions/registry.ts
 *   - questions/sort.ts (or any pillar file)
 *   - ruleConfiguration/questionLoader.ts
 *   - ruleConfiguration/configurationRegistry.ts
 *
 * USAGE:
 *   import { loadQuestionConfiguration } from '@/modules/audit/ruleConfiguration';
 */

// ── Primary function ──────────────────────────────────────────────────────────

export {
  loadQuestionConfiguration,
  isConfigurationLoaded,
  getConfigurationLoadedAt,
} from './configurationRegistry';

// ── Accessor helpers (for engines that need specific lookups) ─────────────────

export {
  getQuestionById,
  getQuestionsByPillar,
  getAllQuestions,
  getAllEnabledQuestions,
  getTotalQuestionCount,
  getAllTags,
} from './questionLoader';

// ── Shared types (re-exported for consumer convenience) ───────────────────────

export type {
  EnrichedAuditQuestion,
  AuditConfiguration,
  AuditConfigMetadata,
  AuditPillarKey,
  AuditQuestionGuidance,
  EvidenceConfiguration,
  ScoringConfiguration,
  ScoringThresholds,
  RatingThreshold,
  QuestionMetadata,
  UncertaintyResponse,
  VisibilityStatusEnum,
  RatingEnum,
  PipelineDecisionEnum,
  QuestionStatusEnum,
  ConfigurationValidationResult,
  ConfigurationValidationError,
} from './questionTypes';

// ── Evidence vocabulary (re-exported for Rule Engine and Observation Engine) ──

export {
  EVIDENCE_VOCABULARY,
  displayName,
  isValidEvidenceKey,
  VOCABULARY_SIZE,
} from './evidenceVocabulary';

export type { EvidenceKey } from './evidenceVocabulary';
