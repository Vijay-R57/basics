/**
 * src/modules/audit/standardizedEvidence/evidenceMapper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.2 — Standardized Evidence Engine: Object Name → EvidenceKey Mapper
 *
 * ROLE:
 *   Deterministically maps human-readable object names (from Sprint 3
 *   Observation Engine) to standardized EvidenceKey identifiers.
 *
 * MAPPING ALGORITHM (4-tier, applied in order, first match wins):
 *
 *   Tier 1 — Exact match
 *     Lowercase object name === lowercase vocabulary display name
 *     Example: "Office Chair" → OFFICE_CHAIR (score: 100)
 *
 *   Tier 2 — Contains match (longest vocabulary display name first)
 *     Vocabulary display name is a substring of the object name.
 *     Example: "Yellow Floor Marking" contains "Floor Marking" → FLOOR_MARKING (score: 85)
 *     Longest display name tried first to prefer more specific matches.
 *
 *   Tier 3 — Contained-in match
 *     Object name is a substring of a vocabulary display name.
 *     Example: "Trolley" is contained in "Mobile Trolley" → MOBILE_TROLLEY (score: 70)
 *
 *   Tier 4 — Keyword overlap
 *     Tokenise both names (words ≥3 chars). Key with most matching words wins.
 *     Tiebreak: shorter display name first, then alphabetical key.
 *     Example: "Chemical Drum Container" → CHEMICAL_CONTAINER (2 word overlaps) (score: 50)
 *
 *   Tier 5 — No match
 *     Returns UNKNOWN_OBJECT sentinel. Never crashes pipeline.
 *
 * DETERMINISM:
 *   The same object name always produces the same EvidenceKey.
 *   Final output is deduplicated and sorted alphabetically.
 *
 * PROHIBITIONS:
 *   ✗ No rule evaluation
 *   ✗ No compliance assessment
 *   ✗ No modification of the input observation
 */

import type { ObservationMappingResult, ObjectMappingResult } from './evidenceTypes';
import {
  UNKNOWN_OBJECT_SENTINEL,
  exactLookup,
  getAllEntriesByLength,
  keywordLookup,
} from './vocabularyRegistry';
import type { EvidenceKey } from '../ruleConfiguration/evidenceVocabulary';

// ── Tokeniser ─────────────────────────────────────────────────────────────────
//
// Splits a name into lowercase words with ≥3 characters.
// Used for Tier 4 keyword matching.

function tokenise(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s,\-_/]+/)
    .filter(w => w.length >= 3);
}

// ── Single object name mapper ─────────────────────────────────────────────────

/**
 * Maps one human-readable object name to a vocabulary key.
 * Returns UNKNOWN_OBJECT_SENTINEL if no match is found.
 */
function mapSingleObject(objectName: string): ObjectMappingResult {
  const lowerName = objectName.trim().toLowerCase();

  // ── Tier 1: Exact match ─────────────────────────────────────────────────
  const exactKey = exactLookup(lowerName);
  if (exactKey) {
    return {
      originalName: objectName,
      mappedKey:    exactKey,
      matchType:    'exact',
      matchScore:   100,
    };
  }

  // ── Tier 2: Contains match (vocabulary display name ⊆ object name) ──────
  // Longest display names tried first for specificity
  const entriesByLength = getAllEntriesByLength();
  for (const entry of entriesByLength) {
    if (lowerName.includes(entry.lower)) {
      return {
        originalName: objectName,
        mappedKey:    entry.key,
        matchType:    'contains',
        matchScore:   85,
      };
    }
  }

  // ── Tier 3: Contained-in match (object name ⊆ vocabulary display name) ──
  for (const entry of entriesByLength) {
    if (entry.lower.includes(lowerName)) {
      return {
        originalName: objectName,
        mappedKey:    entry.key,
        matchType:    'contained_in',
        matchScore:   70,
      };
    }
  }

  // ── Tier 4: Keyword overlap ─────────────────────────────────────────────
  const objectWords = tokenise(objectName);

  if (objectWords.length > 0) {
    // Count vocabulary key overlap for each word
    const overlapCount = new Map<EvidenceKey, number>();
    const displayLen   = new Map<EvidenceKey, number>();

    for (const word of objectWords) {
      const candidateKeys = keywordLookup(word);
      for (const key of candidateKeys) {
        overlapCount.set(key, (overlapCount.get(key) ?? 0) + 1);
      }
    }

    // Build display name length map for tiebreaking
    for (const entry of entriesByLength) {
      displayLen.set(entry.key, entry.lower.length);
    }

    if (overlapCount.size > 0) {
      // Pick key with highest overlap; tiebreak: shorter display name, then alphabetical
      const sorted = [...overlapCount.entries()].sort(([keyA, cntA], [keyB, cntB]) => {
        if (cntB !== cntA) return cntB - cntA;                              // more overlaps first
        const lenDiff = (displayLen.get(keyA) ?? 0) - (displayLen.get(keyB) ?? 0);
        if (lenDiff !== 0) return lenDiff;                                  // shorter display first
        return keyA.localeCompare(keyB);                                    // alphabetical tiebreak
      });

      const bestKey   = sorted[0][0];
      const bestCount = sorted[0][1];

      return {
        originalName: objectName,
        mappedKey:    bestKey,
        matchType:    'keyword',
        matchScore:   Math.min(50, 10 * bestCount),
      };
    }
  }

  // ── Tier 5: No match ────────────────────────────────────────────────────
  return {
    originalName: objectName,
    mappedKey:    UNKNOWN_OBJECT_SENTINEL,
    matchType:    'unknown',
    matchScore:   0,
  };
}

// ── Observation-level mapper ──────────────────────────────────────────────────

/**
 * Maps all object names from one observation to standardized EvidenceKey identifiers.
 *
 * @param objectNames - Array of object names from observation.objects (Sprint 3 output).
 * @returns ObservationMappingResult with:
 *   - evidenceIds: deduplicated, alphabetically sorted keys (+ UNKNOWN_OBJECT if needed)
 *   - unknownObjects: names that had no vocabulary match
 *   - mappings: per-object detail for debug logging
 */
export function mapObservationObjects(objectNames: string[]): ObservationMappingResult {
  if (objectNames.length === 0) {
    return { evidenceIds: [], unknownObjects: [], mappings: [] };
  }

  const mappings: ObjectMappingResult[] = objectNames.map(mapSingleObject);

  const unknownObjects = mappings
    .filter(m => m.mappedKey === UNKNOWN_OBJECT_SENTINEL)
    .map(m => m.originalName);

  // Collect all mapped keys (include UNKNOWN_OBJECT sentinel if any unknowns)
  const allKeys = mappings.map(m => m.mappedKey);

  // Deduplicate using a Set, then sort alphabetically for determinism
  const uniqueKeys = [...new Set(allKeys)].sort();

  return {
    evidenceIds:    uniqueKeys,
    unknownObjects,
    mappings,
  };
}
