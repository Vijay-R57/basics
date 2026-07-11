/**
 * src/modules/audit/ruleEngine/evidenceMatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.3 — Deterministic Rule Engine: Evidence Matcher
 *
 * ROLE:
 *   Performs pure, structured matching of evidenceIds against a question's
 *   configured required, optional, and forbidden lists.
 *   Enforces that forbidden evidence is identified first and excluded.
 *   Safely warns and ignores unknown evidence keys.
 */

import type { EvidenceKey } from '../ruleConfiguration';
import { isValidEvidenceKey } from '../ruleConfiguration/evidenceVocabulary';
import type { EvidenceMatchResult } from './ruleTypes';
import type { EnrichedAuditQuestion } from '../ruleConfiguration';
import { debugLog } from '../pipeline/debug';

/**
 * Matches a list of detected evidenceIds against the question's evidence configuration.
 *
 * MATCHING RULES:
 *   1. Filter & warn on invalid evidence keys (e.g. unknown strings).
 *   2. Identify forbidden evidence keys detected. These are excluded from matches.
 *   3. Match remaining keys against required evidence list.
 *   4. Match remaining keys against optional evidence list.
 *
 * @param evidenceIds - The machine-readable evidence keys from the observation.
 * @param config      - The question's evidence configuration.
 * @param questionId  - For logging warnings.
 */
export function matchEvidence(
  evidenceIds: string[],
  config:      EnrichedAuditQuestion['evidence'],
  questionId:  string,
): EvidenceMatchResult {
  const matchedRequired: string[] = [];
  const missingRequired: string[] = [];
  const detectedForbidden: string[] = [];
  const detectedOptional: string[] = [];

  // Sets for O(1) lookups
  const requiredSet  = new Set<string>(config.required);
  const optionalSet  = new Set<string>(config.optional);
  const forbiddenSet = new Set<string>(config.forbidden);

  // 1. Validate keys & warn on unknown/invalid keys (except UNKNOWN_OBJECT sentinel)
  const validEvidenceIds: string[] = [];
  for (const id of evidenceIds) {
    if (id === 'UNKNOWN_OBJECT') {
      // Sentinel from Sprint 6.2 Standardized Evidence Engine. Log a warning and ignore.
      debugLog(`[Warning] Question ${questionId}: Encountered UNKNOWN_OBJECT sentinel in evidence. Ignoring.`);
      continue;
    }
    if (!isValidEvidenceKey(id as EvidenceKey)) {
      debugLog(`[Warning] Question ${questionId}: Invalid/unknown evidence key "${id}" encountered. Ignoring.`);
      continue;
    }
    validEvidenceIds.push(id);
  }

  // 2. Step 1: Detect forbidden evidence.
  // Any key in validEvidenceIds that matches the forbidden list is isolated.
  for (const id of validEvidenceIds) {
    if (forbiddenSet.has(id)) {
      detectedForbidden.push(id);
    }
  }

  // Set of forbidden keys found, to exclude them from required/optional matches
  const forbiddenFoundSet = new Set<string>(detectedForbidden);

  // 3. Step 2: Match against Required evidence
  for (const reqKey of config.required) {
    // If the required key was detected AND was not identified as forbidden
    if (validEvidenceIds.includes(reqKey) && !forbiddenFoundSet.has(reqKey)) {
      matchedRequired.push(reqKey);
    } else {
      missingRequired.push(reqKey);
    }
  }

  // 4. Step 3: Match against Optional evidence
  for (const optKey of config.optional) {
    if (validEvidenceIds.includes(optKey) && !forbiddenFoundSet.has(optKey)) {
      detectedOptional.push(optKey);
    }
  }

  return {
    matchedEvidence:   matchedRequired,
    missingEvidence:   missingRequired,
    forbiddenEvidence: detectedForbidden,
    matchedOptional:   detectedOptional,
    matchedCount:      matchedRequired.length,
  };
}
