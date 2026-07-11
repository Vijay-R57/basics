/**
 * src/modules/audit/ruleEngine/ruleTypes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.3 — Deterministic Rule Engine: Types
 *
 * ROLE:
 *   Internal and external types for rule engine execution.
 */

import type {
  AuditRating,
  RuleEvaluationResult,
  StandardizedObservation,
  VisibilityDecision,
} from '@/types/analysis';
import type { EnrichedAuditQuestion } from '../ruleConfiguration';

export type {
  AuditRating,
  RuleEvaluationResult,
  StandardizedObservation,
  VisibilityDecision,
  EnrichedAuditQuestion,
};

/** Output of the match stage. */
export interface EvidenceMatchResult {
  matchedEvidence:   string[]; // Required evidence keys found
  missingEvidence:   string[]; // Required evidence keys not found
  forbiddenEvidence: string[]; // Forbidden evidence keys found (and excluded)
  matchedOptional:   string[]; // Optional evidence keys found
  matchedCount:      number;   // Count of matched required evidence keys
}

/** Result of the threshold evaluation. */
export interface ThresholdEvaluationResult {
  rating:      AuditRating;
  matchedRule: string; // The threshold configuration key, e.g. "average"
}
