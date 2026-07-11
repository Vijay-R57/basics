/**
 * src/modules/audit/standardizedEvidence/evidenceValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.2 — Standardized Evidence Engine: Evidence Validation
 *
 * ROLE:
 *   Validates the output of the evidenceMapper.ts for each StandardizedObservation.
 *   Ensures identifiers are canonical, non-duplicate, and deterministically ordered.
 *
 * VALIDATION CHECKS:
 *   1. Every non-sentinel evidenceId exists in the shared vocabulary.
 *   2. No duplicate identifiers exist in evidenceIds.
 *   3. evidenceIds are sorted alphabetically (determinism guarantee).
 *   4. visible=true observations have at least one evidenceId.
 *   5. visible=false observations have empty evidenceIds.
 */

import type { StandardizedObservation } from '@/types/analysis';
import { isKnownKey, UNKNOWN_OBJECT_SENTINEL } from './vocabularyRegistry';

// ── Validation error ──────────────────────────────────────────────────────────

export interface EvidenceValidationError {
  questionId: string;
  check:      number;
  message:    string;
}

// ── Observation validator ─────────────────────────────────────────────────────

function validateSingle(
  obs:    StandardizedObservation,
  errors: EvidenceValidationError[],
): void {
  const id = obs.questionId;

  // ── Check 1: All non-sentinel IDs exist in vocabulary ─────────────────
  for (const eid of obs.evidenceIds) {
    if (eid !== UNKNOWN_OBJECT_SENTINEL && !isKnownKey(eid)) {
      errors.push({
        questionId: id,
        check:      1,
        message:    `Evidence ID "${eid}" is not in the shared vocabulary.`,
      });
    }
  }

  // ── Check 2: No duplicate IDs ──────────────────────────────────────────
  const seen = new Set<string>();
  for (const eid of obs.evidenceIds) {
    if (seen.has(eid)) {
      errors.push({
        questionId: id,
        check:      2,
        message:    `Duplicate evidence ID "${eid}" found in evidenceIds.`,
      });
    }
    seen.add(eid);
  }

  // ── Check 3: Alphabetically sorted (determinism) ───────────────────────
  const sorted = [...obs.evidenceIds].sort();
  const isOrdered = obs.evidenceIds.every((eid, i) => eid === sorted[i]);
  if (!isOrdered) {
    errors.push({
      questionId: id,
      check:      3,
      message:    `evidenceIds are not in alphabetical order. Expected: [${sorted.join(', ')}]`,
    });
  }

  // ── Check 4: visible=true → at least one evidenceId ───────────────────
  if (obs.visible && obs.evidenceIds.length === 0) {
    errors.push({
      questionId: id,
      check:      4,
      message:    'Observation is marked visible=true but evidenceIds is empty.',
    });
  }

  // ── Check 5: visible=false → evidenceIds must be empty ────────────────
  if (!obs.visible && obs.evidenceIds.length > 0) {
    errors.push({
      questionId: id,
      check:      5,
      message:    `Observation is visible=false but contains evidenceIds: [${obs.evidenceIds.join(', ')}]`,
    });
  }
}

// ── Collection validator ──────────────────────────────────────────────────────

export interface EvidenceValidationResult {
  valid:  boolean;
  errors: EvidenceValidationError[];
  /** Count of observations with at least one unknown object. */
  unknownObjectWarnings: number;
}

/**
 * Validates the complete StandardizedObservation collection.
 * All 5 checks are applied to every observation.
 *
 * @param observations - Output of the Standardized Evidence Engine.
 * @returns Validation result. Errors are advisory — the pipeline continues.
 */
export function validateEvidenceCollection(
  observations: StandardizedObservation[],
): EvidenceValidationResult {
  const errors: EvidenceValidationError[] = [];

  for (const obs of observations) {
    validateSingle(obs, errors);
  }

  const unknownObjectWarnings = observations.filter(
    o => o._unknownObjects && o._unknownObjects.length > 0,
  ).length;

  return {
    valid:  errors.length === 0,
    errors,
    unknownObjectWarnings,
  };
}
