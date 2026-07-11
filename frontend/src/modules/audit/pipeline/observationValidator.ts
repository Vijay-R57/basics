/**
 * src/modules/audit/pipeline/observationValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline V3 — Phase 4: Observation Validator
 *
 * ROLE:
 *   Quality Control gate for the AI pipeline.
 *   Validates every observation produced by the Structured Observation Engine
 *   before it is allowed to enter the Visibility Decision Engine.
 *
 * RESPONSIBILITIES:
 *   ✓ Run all 12 validation checks on StructuredObservationResult[]
 *   ✓ Produce a structured ObservationValidationResult report
 *   ✓ Stop the pipeline when any blocking check fails
 *
 * STRICT PROHIBITIONS:
 *   ✗ No scoring, rating, or compliance judgement
 *   ✗ No modification of observations (read-only)
 *   ✗ No Gemini API calls — fully deterministic
 *   ✗ No adding or removing observations
 *   ✗ No recommendations
 *
 * DESIGN:
 *   - Single exported entry point: validateObservations()
 *   - Synchronous and pure — no side effects
 *   - Deterministic: same input always produces same output
 *   - Check 10 (CONFIDENCE_INCONSISTENCY) is advisory — non-blocking
 *   - All other 11 checks are blocking
 *
 * PIPELINE POSITION:
 *   Structured Observation Engine → [Observation Validator] → Visibility Decision Engine
 *
 * PIPELINE CONTRACT:
 *   result.validated === true  → PASS_TO_VISIBILITY_ENGINE
 *   result.validated === false → STOP_PIPELINE
 */

import type {
  GeminiVisionResult,
  StructuredObservationResult,
  QuestionObservation,
  ObservationValidationError,
  ObservationValidationResult,
  ValidationErrorCode,
} from '@/types/analysis';
import type { AuditQuestion } from './questions';
import {
  debugLog,
  debugGroup,
  debugGroupEnd,
} from './debug';

// ── Banned evidence words (Check 6) ──────────────────────────────────────────
//
// Evidence sentences must never contain these subjective or assumption-based words.
// Mirrors the banned list in observationEngine.ts for consistency.

const BANNED_EVIDENCE_WORDS: string[] = [
  'probably',
  'maybe',
  'likely',
  'appears unnecessary',
  'workers seem',
  'company probably',
  'management',
  'culture',
  'compliance',
];

function evidenceContainsBannedWord(sentence: string): string | null {
  const lower = sentence.toLowerCase();
  for (const word of BANNED_EVIDENCE_WORDS) {
    if (lower.includes(word)) return word;
  }
  return null;
}

// ── Error builder ─────────────────────────────────────────────────────────────

function makeError(
  questionId: string,
  code:       ValidationErrorCode,
  message:    string,
): ObservationValidationError {
  return { questionId, code, message };
}

// ── Field presence + type guard ───────────────────────────────────────────────
//
// Returns an error if a required field is missing or has the wrong type.
// Returns null when the field is present and correct.

function checkField(
  obs:       Record<string, unknown>,
  field:     string,
  expected:  'string' | 'boolean' | 'number' | 'array',
  questionId: string,
): ObservationValidationError | null {
  if (!(field in obs)) {
    return makeError(questionId, 'INVALID_FIELD', `Required field "${field}" is missing.`);
  }

  const value = obs[field];

  if (expected === 'array') {
    if (!Array.isArray(value)) {
      return makeError(questionId, 'INVALID_DATA_TYPE',
        `Field "${field}" must be an array but got ${typeof value}.`);
    }
  } else if (typeof value !== expected) {
    return makeError(questionId, 'INVALID_DATA_TYPE',
      `Field "${field}" must be ${expected} but got ${typeof value}.`);
  }

  return null;
}

// ── Per-observation checks (Checks 3–12) ─────────────────────────────────────

function validateSingleObservation(
  entry:         StructuredObservationResult,
  visionObjects: Set<string>,             // lowercase object names from Sprint 2
): { blocking: ObservationValidationError[]; advisory: ObservationValidationError[] } {
  const blocking: ObservationValidationError[] = [];
  const advisory: ObservationValidationError[] = [];
  const qid = entry.questionId;
  const obs  = entry.observation as unknown as Record<string, unknown>;

  // ── Check 3: Required fields present ───────────────────────────────────────
  const requiredFields: Array<{ field: string; type: 'string' | 'boolean' | 'number' | 'array' }> = [
    { field: 'visible',     type: 'boolean' },
    { field: 'evidence',    type: 'array'   },
    { field: 'objects',     type: 'array'   },
    { field: 'visibleText', type: 'array'   },
    { field: 'confidence',  type: 'number'  },
  ];

  for (const { field, type } of requiredFields) {
    // ── Check 4: Data types ─────────────────────────────────────────────────
    const err = checkField(obs, field, type, qid);
    if (err) { blocking.push(err); }
  }

  // Stop per-observation checks here if fundamental structure is broken
  if (blocking.length > 0) return { blocking, advisory };

  const observation: QuestionObservation = entry.observation;

  // ── Check 5: Confidence range 0–100 ────────────────────────────────────────
  if (observation.confidence < 0 || observation.confidence > 100) {
    blocking.push(makeError(qid, 'INVALID_CONFIDENCE',
      `Confidence value ${observation.confidence} is outside the valid range 0–100.`));
  }

  // ── Check 6: Evidence quality (banned words) ────────────────────────────────
  for (const sentence of observation.evidence) {
    const banned = evidenceContainsBannedWord(sentence);
    if (banned !== null) {
      blocking.push(makeError(qid, 'INVALID_EVIDENCE',
        `Evidence sentence contains banned subjective word "${banned}": "${sentence.slice(0, 80)}…"`));
    }
  }

  // ── Check 7: Object consistency — all referenced objects in Vision output ───
  for (const objName of observation.objects) {
    const lowerName = objName.toLowerCase().trim();
    // Fuzzy match: at least one Vision object name contains this object's key words
    const found = [...visionObjects].some(vObj =>
      vObj.includes(lowerName) || lowerName.includes(vObj),
    );
    if (!found) {
      blocking.push(makeError(qid, 'OBJECT_NOT_FOUND',
        `Referenced object "${objName}" was not found in the Gemini Vision output.`));
    }
  }

  // ── Check 8: visible=false → all arrays must be empty ──────────────────────
  if (!observation.visible) {
    if (observation.evidence.length > 0) {
      blocking.push(makeError(qid, 'VISIBLE_FLAG_MISMATCH',
        `visible=false but evidence array is non-empty (${observation.evidence.length} items).`));
    }
    if (observation.objects.length > 0) {
      blocking.push(makeError(qid, 'VISIBLE_FLAG_MISMATCH',
        `visible=false but objects array is non-empty (${observation.objects.length} items).`));
    }
    if (observation.visibleText.length > 0) {
      blocking.push(makeError(qid, 'VISIBLE_FLAG_MISMATCH',
        `visible=false but visibleText array is non-empty (${observation.visibleText.length} items).`));
    }
  }

  // ── Check 9: Evidence consistency with visible flag ─────────────────────────
  // If visible=false but evidence has content, that's a contradiction (covered above).
  // If visible=true but evidence explicitly says "not visible", flag it.
  if (observation.visible) {
    for (const sentence of observation.evidence) {
      const lower = sentence.toLowerCase();
      if (lower.includes('not visible') && lower.includes('captured')) {
        blocking.push(makeError(qid, 'VISIBLE_FLAG_MISMATCH',
          `visible=true but evidence sentence indicates absence: "${sentence.slice(0, 80)}"`));
        break; // one error per observation is enough for this check
      }
    }
  }

  // ── Check 10 (Advisory): Confidence consistency ─────────────────────────────
  if (observation.visible && observation.confidence === 0) {
    advisory.push(makeError(qid, 'CONFIDENCE_INCONSISTENCY',
      `visible=true but confidence is 0. Manual review recommended.`));
  }

  // ── Check 12: Empty observation — visible=true but all arrays empty ──────────
  if (
    observation.visible &&
    observation.evidence.length === 0 &&
    observation.objects.length === 0 &&
    observation.visibleText.length === 0
  ) {
    blocking.push(makeError(qid, 'EMPTY_OBSERVATION',
      `visible=true but evidence, objects, and visibleText are all empty.`));
  }

  return { blocking, advisory };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Validates all structured observations against 12 quality checks.
 *
 * This is the single entry point for the Observation Validator.
 * Call this AFTER buildStructuredObservations() and BEFORE the Visibility Engine.
 *
 * The function is synchronous, pure, and deterministic.
 * The same input always produces the same validation result.
 *
 * @param observations - Output of observationEngine.ts (Sprint 3).
 * @param visionResult - Output of geminiVisionAnalyzer.ts (Sprint 2).
 *                       Used for object consistency checks (Check 7).
 * @param allQuestions - All audit questions from getAllQuestions().
 *                       Used for coverage checks (Checks 1 & 2).
 * @returns ObservationValidationResult — the full validation report.
 *          validated=true  → PASS_TO_VISIBILITY_ENGINE
 *          validated=false → STOP_PIPELINE
 */
export function validateObservations(
  observations: StructuredObservationResult[],
  visionResult: GeminiVisionResult,
  allQuestions: AuditQuestion[],
): ObservationValidationResult {
  const startTime = Date.now();

  debugGroup('Observation Validation Started');
  debugLog('Expected questions:', allQuestions.length);
  debugLog('Received observations:', observations.length);

  const allErrors:    ObservationValidationError[] = [];
  const advisoryOnly: ObservationValidationError[] = [];
  const failedIds     = new Set<string>();

  // ── Pre-build lookup structures ───────────────────────────────────────────

  // Set of all expected question IDs (from questions.ts)
  const expectedIds = new Set<string>(allQuestions.map(q => q.id));

  // Set of all received question IDs (from observations)
  const receivedIds = observations.map(o => o.questionId);

  // Lowercase object names from Vision output — used for Check 7
  const visionObjectNames = new Set<string>(
    visionResult.objects.map(o => o.name.toLowerCase().trim()),
  );

  // ── Check 11: JSON integrity of the entire collection ─────────────────────
  debugLog('Check 11 — JSON integrity…');
  try {
    JSON.stringify(observations);
  } catch {
    allErrors.push(makeError('GLOBAL', 'INVALID_JSON',
      'The observation collection failed JSON serialisation.'));
  }

  // ── Check 1: Every expected question has exactly one observation ───────────
  debugLog('Check 1 — Question coverage…');
  for (const expected of expectedIds) {
    const count = receivedIds.filter(id => id === expected).length;
    if (count === 0) {
      const err = makeError(expected, 'MISSING_QUESTION',
        `No observation found for question "${expected}".`);
      allErrors.push(err);
      failedIds.add(expected);
    }
  }

  // ── Check 2: No duplicate questionIds ─────────────────────────────────────
  debugLog('Check 2 — Duplicate detection…');
  const seenIds = new Set<string>();
  for (const id of receivedIds) {
    if (seenIds.has(id)) {
      const err = makeError(id, 'DUPLICATE_QUESTION',
        `Duplicate observation found for question "${id}".`);
      allErrors.push(err);
      failedIds.add(id);
    }
    seenIds.add(id);
  }

  // ── Checks 3–12: Per-observation validation ───────────────────────────────
  debugLog('Checks 3–12 — Per-observation validation…');

  for (const entry of observations) {
    const qid = entry.questionId;

    // Skip observations for unknown question IDs (already caught by Check 1/2)
    if (!expectedIds.has(qid)) {
      allErrors.push(makeError(qid, 'SCHEMA_ERROR',
        `Observation has unrecognised questionId "${qid}" not found in questions.ts.`));
      failedIds.add(qid);
      continue;
    }

    // Run per-observation checks
    const { blocking, advisory } = validateSingleObservation(entry, visionObjectNames);

    if (blocking.length > 0) {
      allErrors.push(...blocking);
      failedIds.add(qid);
    }

    advisoryOnly.push(...advisory);
  }

  // ── Combine blocking + advisory errors ────────────────────────────────────
  // Advisory errors (CONFIDENCE_INCONSISTENCY) are included in the report
  // but do NOT affect the validated flag.
  const reportErrors = [...allErrors, ...advisoryOnly];

  // ── Determine pass/fail — advisory errors do not fail validation ──────────
  const validated = allErrors.length === 0;
  const status    = validated ? 'PASS' : 'FAIL';

  const totalQuestions     = allQuestions.length;
  const failedQuestions    = failedIds.size;
  const validatedQuestions = totalQuestions - failedQuestions;

  const result: ObservationValidationResult = {
    validated,
    status,
    summary: {
      totalQuestions,
      validatedQuestions,
      failedQuestions,
    },
    errors: reportErrors,
  };

  // ── Debug output ──────────────────────────────────────────────────────────
  const elapsed = Date.now() - startTime;

  debugLog('Questions Processed:', totalQuestions);

  debugGroup('Validation Checks Run');
  debugLog('Check  1 — Question Coverage');
  debugLog('Check  2 — Duplicate Detection');
  debugLog('Check  3 — Required Fields Present');
  debugLog('Check  4 — Data Types');
  debugLog('Check  5 — Confidence Range (0–100)');
  debugLog('Check  6 — Evidence Quality (banned words)');
  debugLog('Check  7 — Object Consistency (Vision output)');
  debugLog('Check  8 — visible=false → empty arrays');
  debugLog('Check  9 — Evidence Consistency with visible flag');
  debugLog('Check 10 — Confidence Consistency (advisory)');
  debugLog('Check 11 — JSON Integrity');
  debugLog('Check 12 — Empty Observation Detection');
  debugGroupEnd();

  debugGroup('Validation Results');
  debugLog('Status:              ', status);
  debugLog('Total questions:     ', totalQuestions);
  debugLog('Validated:           ', validatedQuestions);
  debugLog('Failed:              ', failedQuestions);
  debugLog('Blocking errors:     ', allErrors.length);
  debugLog('Advisory notices:    ', advisoryOnly.length);
  debugGroupEnd();

  if (failedIds.size > 0) {
    debugLog('Failed Questions:', [...failedIds]);
  }

  if (reportErrors.length > 0) {
    debugGroup('Validation Errors');
    reportErrors.forEach((err, i) => {
      debugLog(`[${i + 1}] [${err.code}] ${err.questionId}: ${err.message}`);
    });
    debugGroupEnd();
  }

  const decision = validated
    ? 'PASS_TO_VISIBILITY_ENGINE'
    : 'STOP_PIPELINE';

  debugLog(`Pipeline Decision: ${decision}`);
  debugLog(`Execution Time (ms): ${elapsed}`);
  debugGroupEnd(); // close 'Observation Validation Started'

  return result;
}
