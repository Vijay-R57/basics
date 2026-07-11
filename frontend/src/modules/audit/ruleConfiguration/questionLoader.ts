/**
 * src/modules/audit/ruleConfiguration/questionLoader.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — Rule Configuration Engine: Question Loader
 *
 * ROLE:
 *   Provides typed, convenience accessor functions over the AUDIT_REGISTRY.
 *   Future engines call these helpers instead of querying the registry directly.
 *
 * DESIGN:
 *   - All functions are pure and synchronous.
 *   - No modification of the registry — read-only access only.
 *   - O(1) ID lookups via a lazy-built Map cache.
 */

import { AUDIT_REGISTRY } from '../questions/registry';
import type { EnrichedAuditQuestion, AuditPillarKey, AuditConfiguration } from './questionTypes';

// ── ID lookup cache (built once on first use) ─────────────────────────────────

let _idCache: Map<string, EnrichedAuditQuestion> | null = null;

function getIdCache(): Map<string, EnrichedAuditQuestion> {
  if (_idCache === null) {
    _idCache = new Map<string, EnrichedAuditQuestion>();
    for (const q of AUDIT_REGISTRY.allQuestions) {
      _idCache.set(q.id, q);
    }
  }
  return _idCache;
}

// ── Accessor helpers ──────────────────────────────────────────────────────────

/**
 * Returns the complete validated AuditConfiguration.
 * This is the primary accessor — most engines should use this.
 */
export function getAuditConfiguration(): Readonly<AuditConfiguration> {
  return AUDIT_REGISTRY;
}

/**
 * Returns a single question by its ID. O(1) lookup.
 * Returns undefined if no question with that ID exists.
 *
 * @param id - Question ID, e.g. "SORT_Q1".
 */
export function getQuestionById(id: string): Readonly<EnrichedAuditQuestion> | undefined {
  return getIdCache().get(id);
}

/**
 * Returns all questions for a specific pillar, in their defined order.
 *
 * @param pillar - The pillar key, e.g. "SORT".
 */
export function getQuestionsByPillar(
  pillar: AuditPillarKey,
): ReadonlyArray<EnrichedAuditQuestion> {
  return AUDIT_REGISTRY.questions[pillar] ?? [];
}

/**
 * Returns all questions as a flat ordered array.
 * Order: SORT → SET_IN_ORDER → SHINE → STANDARDIZE → SUSTAIN.
 */
export function getAllQuestions(): ReadonlyArray<EnrichedAuditQuestion> {
  return AUDIT_REGISTRY.allQuestions;
}

/**
 * Returns only enabled questions (metadata.enabled === true).
 * Disabled questions are excluded from audit execution.
 */
export function getAllEnabledQuestions(): ReadonlyArray<EnrichedAuditQuestion> {
  return AUDIT_REGISTRY.allQuestions.filter(q => q.metadata.enabled);
}

/**
 * Returns the total count of questions in the registry.
 */
export function getTotalQuestionCount(): number {
  return AUDIT_REGISTRY.metadata.totalQuestions;
}

/**
 * Returns all unique tags across all questions.
 * Useful for filtering and categorisation.
 */
export function getAllTags(): string[] {
  const tagSet = new Set<string>();
  for (const q of AUDIT_REGISTRY.allQuestions) {
    q.metadata.tags.forEach(t => tagSet.add(t));
  }
  return [...tagSet].sort();
}
