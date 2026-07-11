/**
 * src/modules/audit/standardizedEvidence/vocabularyRegistry.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.2 — Standardized Evidence Engine: Vocabulary Lookup Registry
 *
 * ROLE:
 *   Builds and exposes reverse-lookup structures over EVIDENCE_VOCABULARY.
 *   Used by evidenceMapper.ts for deterministic object-name → EvidenceKey mapping.
 *
 * DESIGN:
 *   All structures are built once at module load time and cached.
 *   Every lookup is pure and synchronous.
 *
 * LOOKUP TIERS (consumed by evidenceMapper.ts):
 *   1. exactMap       — lowercased display name → EvidenceKey (fastest)
 *   2. keywordMap     — single word → EvidenceKey[] (all keys containing that word)
 *   3. allEntries     — sorted array of [key, lowerDisplayName] pairs for iteration
 */

import {
  EVIDENCE_VOCABULARY,
  type EvidenceKey,
} from '../ruleConfiguration/evidenceVocabulary';

// ── Sentinel for unknown objects ──────────────────────────────────────────────

/** Sentinel value returned when an object name matches no vocabulary entry. */
export const UNKNOWN_OBJECT_SENTINEL = 'UNKNOWN_OBJECT';

// ── Reverse lookup structures ─────────────────────────────────────────────────

type VocabEntry = { key: EvidenceKey; lower: string };

// Built once at module load time
const _allEntries: VocabEntry[] = (
  Object.entries(EVIDENCE_VOCABULARY) as [EvidenceKey, string][]
).map(([key, displayName]) => ({
  key,
  lower: displayName.toLowerCase(),
}));

// Tier 1: exact lowercase display name → EvidenceKey
const _exactMap = new Map<string, EvidenceKey>(
  _allEntries.map(e => [e.lower, e.key]),
);

// Tier 2: individual word → EvidenceKey[]
// Words shorter than 3 characters are excluded to avoid noisy matches
const _keywordMap = new Map<string, EvidenceKey[]>();

for (const { key, lower } of _allEntries) {
  const words = lower.split(/\s+/).filter(w => w.length >= 3);
  for (const word of words) {
    const existing = _keywordMap.get(word) ?? [];
    existing.push(key);
    _keywordMap.set(word, existing);
  }
}

// ── Public accessors ──────────────────────────────────────────────────────────

/**
 * Returns the EvidenceKey for an exact (case-insensitive) display name match.
 * Example: 'floor marking' → 'FLOOR_MARKING'
 */
export function exactLookup(lowerName: string): EvidenceKey | undefined {
  return _exactMap.get(lowerName);
}

/**
 * Returns all VocabEntries — sorted by display name length (longest first).
 * Used for "contains" matching — longer names should be tried first to prefer
 * more specific matches. Example: 'Spill Pallet' before 'Pallet'.
 */
export function getAllEntriesByLength(): readonly VocabEntry[] {
  return _allEntries.slice().sort((a, b) => b.lower.length - a.lower.length);
}

/**
 * Returns all EvidenceKeys whose display name contains the given word.
 * Example: 'board' → ['AUDIT_BOARD', 'KAIZEN_BOARD', 'SHADOW_BOARD', 'SOP_BOARD', 'VISUAL_BOARD']
 */
export function keywordLookup(word: string): EvidenceKey[] {
  return _keywordMap.get(word.toLowerCase()) ?? [];
}

/**
 * Returns true if the given string is a valid EvidenceKey.
 */
export function isKnownKey(key: string): key is EvidenceKey {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_VOCABULARY, key);
}

/** Total vocabulary size (number of registered EvidenceKey values). */
export const REGISTERED_VOCABULARY_SIZE = _allEntries.length;
