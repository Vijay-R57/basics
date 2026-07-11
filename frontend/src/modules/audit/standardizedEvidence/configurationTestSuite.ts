/**
 * src/modules/audit/standardizedEvidence/configurationTestSuite.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.2 — Standardized Evidence Engine: Configuration Test Suite
 *
 * ROLE:
 *   Runs 8 deterministic validation tests against the Audit Registry before
 *   the Standardized Evidence Engine starts processing observations.
 *
 *   If ANY test fails → status: 'FAIL' → pipeline MUST stop.
 *   All 8 pass       → status: 'PASS' → proceed to buildEvidenceIds().
 *
 * TESTS:
 *   1. Configuration Loading  — registry loads without throwing
 *   2. Question Count         — each pillar has exactly EXPECTED_QUESTIONS_PER_PILLAR questions
 *   3. Unique Question IDs    — no duplicate IDs across pillars
 *   4. Evidence Vocabulary    — all required[] keys exist in EVIDENCE_VOCABULARY
 *   5. Threshold Config       — all 5 scoring levels defined per question
 *   6. Metadata Validation    — version, enabled, tags present
 *   7. Schema Validation      — each question has all 7 required top-level fields
 *   8. Registry Integrity     — allQuestions.length == sum of per-pillar lengths
 */

import type { ConfigTestSuiteResult, ConfigTestError } from './evidenceTypes';
import { loadQuestionConfiguration, getAllEnabledQuestions } from '../ruleConfiguration';
import { isValidEvidenceKey, VOCABULARY_SIZE } from '../ruleConfiguration/evidenceVocabulary';

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPECTED_QUESTIONS_PER_PILLAR = 4;
const EXPECTED_PILLARS = ['SORT', 'SET_IN_ORDER', 'SHINE', 'STANDARDIZE', 'SUSTAIN'] as const;
const REQUIRED_THRESHOLD_KEYS = ['veryGood', 'good', 'average', 'bad', 'veryBad'] as const;
const REQUIRED_TOP_LEVEL_FIELDS = ['id', 'pillar', 'question', 'guidance', 'evidence', 'scoring', 'metadata'] as const;

// ── Helper ────────────────────────────────────────────────────────────────────

function addError(
  errors:     ConfigTestError[],
  testNumber: number,
  code:       ConfigTestError['code'],
  questionId: string,
  message:    string,
): void {
  errors.push({ testNumber, code, questionId, message });
}

// ── The 8 Tests ───────────────────────────────────────────────────────────────

/**
 * Runs the complete Configuration Test Suite.
 * Synchronous, pure, deterministic — no API calls.
 *
 * @returns ConfigTestSuiteResult with pass/fail status and full error report.
 */
export function runConfigurationTestSuite(): ConfigTestSuiteResult {
  const errors: ConfigTestError[] = [];

  // ── Test 1: Configuration Loading ──────────────────────────────────────
  let config;
  try {
    config = loadQuestionConfiguration();
    if (!config) throw new Error('loadQuestionConfiguration() returned null.');
  } catch (err) {
    addError(errors, 1, 'CONFIG_LOAD_FAILED', 'GLOBAL',
      `Audit Registry failed to load: ${err instanceof Error ? err.message : String(err)}`);
    // Cannot run remaining tests without a config
    return buildResult(errors, {
      configurationVersion: 'UNKNOWN',
      totalQuestions:       0,
      enabledQuestions:     0,
      pillarsVerified:      [],
      vocabularySize:       VOCABULARY_SIZE,
    });
  }

  // ── Test 2: Question Count per Pillar ──────────────────────────────────
  const pillarsVerified: string[] = [];
  for (const pillar of EXPECTED_PILLARS) {
    const pillarQuestions = config.questions[pillar];
    if (!pillarQuestions || pillarQuestions.length !== EXPECTED_QUESTIONS_PER_PILLAR) {
      addError(errors, 2, 'QUESTION_COUNT_MISMATCH', 'GLOBAL',
        `Pillar "${pillar}" has ${pillarQuestions?.length ?? 0} questions. ` +
        `Expected ${EXPECTED_QUESTIONS_PER_PILLAR}.`);
    } else {
      pillarsVerified.push(pillar);
    }
  }

  // ── Test 3: Unique Question IDs ────────────────────────────────────────
  const seenIds = new Map<string, number>();
  for (const q of config.allQuestions) {
    seenIds.set(q.id, (seenIds.get(q.id) ?? 0) + 1);
  }
  for (const [id, count] of seenIds.entries()) {
    if (count > 1) {
      addError(errors, 3, 'DUPLICATE_QUESTION_ID', id,
        `Question ID "${id}" appears ${count} times in the registry.`);
    }
  }

  // ── Test 4: Evidence Vocabulary Keys ──────────────────────────────────
  for (const q of config.allQuestions) {
    for (const evidenceKey of q.evidence.required) {
      if (!isValidEvidenceKey(evidenceKey)) {
        addError(errors, 4, 'UNKNOWN_EVIDENCE_KEY', q.id,
          `Required evidence key "${evidenceKey}" does not exist in the shared vocabulary.`);
      }
    }
    for (const evidenceKey of q.evidence.optional) {
      if (!isValidEvidenceKey(evidenceKey)) {
        addError(errors, 4, 'UNKNOWN_EVIDENCE_KEY', q.id,
          `Optional evidence key "${evidenceKey}" does not exist in the shared vocabulary.`);
      }
    }
    for (const evidenceKey of q.evidence.forbidden) {
      if (!isValidEvidenceKey(evidenceKey)) {
        addError(errors, 4, 'UNKNOWN_EVIDENCE_KEY', q.id,
          `Forbidden evidence key "${evidenceKey}" does not exist in the shared vocabulary.`);
      }
    }
  }

  // ── Test 5: Threshold Configuration ────────────────────────────────────
  for (const q of config.allQuestions) {
    for (const level of REQUIRED_THRESHOLD_KEYS) {
      const threshold = q.scoring?.thresholds?.[level];
      if (!threshold || typeof threshold.matchedEvidence !== 'number') {
        addError(errors, 5, 'MISSING_THRESHOLD', q.id,
          `Scoring threshold "${level}" is missing or has invalid matchedEvidence value.`);
      }
    }
  }

  // ── Test 6: Metadata Validation ────────────────────────────────────────
  for (const q of config.allQuestions) {
    if (!q.metadata?.version || typeof q.metadata.version !== 'string') {
      addError(errors, 6, 'MISSING_METADATA', q.id,
        'metadata.version is missing or not a string.');
    }
    if (typeof q.metadata?.enabled !== 'boolean') {
      addError(errors, 6, 'MISSING_METADATA', q.id,
        'metadata.enabled is missing or not a boolean.');
    }
    if (!Array.isArray(q.metadata?.tags)) {
      addError(errors, 6, 'MISSING_METADATA', q.id,
        'metadata.tags is missing or not an array.');
    }
  }

  // ── Test 7: Schema Validation ──────────────────────────────────────────
  for (const q of config.allQuestions) {
    for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
      if (!(field in q) || (q as Record<string, unknown>)[field] === undefined) {
        addError(errors, 7, 'SCHEMA_VIOLATION', q.id,
          `Required top-level field "${field}" is missing from the question schema.`);
      }
    }
  }

  // ── Test 8: Registry Integrity ─────────────────────────────────────────
  const pillarSum = EXPECTED_PILLARS.reduce(
    (acc, pillar) => acc + (config.questions[pillar]?.length ?? 0), 0,
  );
  if (config.allQuestions.length !== pillarSum) {
    addError(errors, 8, 'REGISTRY_INTEGRITY', 'GLOBAL',
      `allQuestions.length (${config.allQuestions.length}) does not equal ` +
      `the sum of per-pillar lengths (${pillarSum}).`);
  }

  // ── Build final result ─────────────────────────────────────────────────
  const enabledCount = getAllEnabledQuestions().length;

  return buildResult(errors, {
    configurationVersion: config.metadata.configurationVersion,
    totalQuestions:       config.allQuestions.length,
    enabledQuestions:     enabledCount,
    pillarsVerified,
    vocabularySize:       VOCABULARY_SIZE,
  });
}

// ── Result builder ────────────────────────────────────────────────────────────

function buildResult(
  errors:  ConfigTestError[],
  report:  ConfigTestSuiteResult['report'],
): ConfigTestSuiteResult {
  const TOTAL_TESTS = 8;
  const failingCount = new Set(errors.map(e => e.testNumber)).size;
  const passingCount = TOTAL_TESTS - failingCount;

  return {
    passed:  errors.length === 0,
    status:  errors.length === 0 ? 'PASS' : 'FAIL',
    passing: passingCount,
    failing: failingCount,
    errors,
    report,
  };
}
