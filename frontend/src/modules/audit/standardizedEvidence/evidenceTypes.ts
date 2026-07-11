/**
 * src/modules/audit/standardizedEvidence/evidenceTypes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.2 — Standardized Evidence Engine: Internal Types
 *
 * ROLE:
 *   Types specific to the Standardized Evidence Engine and Configuration Test Suite.
 *   StandardizedObservation (the public output type) lives in @/types/analysis.ts.
 */

// ── Configuration Test Suite types ────────────────────────────────────────────

/** Error codes for each of the 8 configuration tests. */
export type ConfigTestErrorCode =
  | 'CONFIG_LOAD_FAILED'       // Test 1 — registry failed to load
  | 'QUESTION_COUNT_MISMATCH'  // Test 2 — wrong number of questions per pillar
  | 'DUPLICATE_QUESTION_ID'    // Test 3 — non-unique question IDs
  | 'UNKNOWN_EVIDENCE_KEY'     // Test 4 — required evidence key not in vocabulary
  | 'MISSING_THRESHOLD'        // Test 5 — scoring threshold incomplete
  | 'MISSING_METADATA'         // Test 6 — metadata field absent
  | 'SCHEMA_VIOLATION'         // Test 7 — question missing a required top-level field
  | 'REGISTRY_INTEGRITY';      // Test 8 — allQuestions count mismatch

/** A single failure from the Configuration Test Suite. */
export interface ConfigTestError {
  /** Test number that failed (1–8). */
  testNumber: number;
  /** Error category code. */
  code:       ConfigTestErrorCode;
  /** The question ID involved, or "GLOBAL" for registry-level failures. */
  questionId: string;
  /** Human-readable description of the failure. */
  message:    string;
}

/** Full result of the Configuration Test Suite. */
export interface ConfigTestSuiteResult {
  /** true = all 8 tests passed; false = at least one failed. */
  passed:   boolean;
  /** 'PASS' or 'FAIL' for easy pipeline switching. */
  status:   'PASS' | 'FAIL';
  /** Number of tests that passed (max 8). */
  passing:  number;
  /** Number of tests that failed. */
  failing:  number;
  /** All errors found across all tests. Empty when passed === true. */
  errors:   ConfigTestError[];
  /** Summary counts for the debug report. */
  report: {
    configurationVersion: string;
    totalQuestions:       number;
    enabledQuestions:     number;
    pillarsVerified:      string[];
    vocabularySize:       number;
  };
}

// ── Evidence mapping types ────────────────────────────────────────────────────

/** Result of mapping a single object name to vocabulary identifiers. */
export interface ObjectMappingResult {
  /** Original object name as received from the Observation Engine. */
  originalName: string;
  /**
   * The mapped EvidenceKey, or 'UNKNOWN_OBJECT' if no match was found.
   * 'UNKNOWN_OBJECT' is a sentinel — it is not in EVIDENCE_VOCABULARY.
   */
  mappedKey:    string;
  /** How the match was achieved. */
  matchType:    'exact' | 'contains' | 'contained_in' | 'keyword' | 'unknown';
  /** Confidence in this specific mapping (0–100). Not related to audit confidence. */
  matchScore:   number;
}

/** Result of mapping all objects in one observation. */
export interface ObservationMappingResult {
  /** All mapped keys (EvidenceKey values), deduplicated, sorted alphabetically. */
  evidenceIds:    string[];
  /** Object names that produced no vocabulary match. */
  unknownObjects: string[];
  /** Per-object mapping details (for debug logging). */
  mappings:       ObjectMappingResult[];
}
