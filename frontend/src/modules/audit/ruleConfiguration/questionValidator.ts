/**
 * src/modules/audit/ruleConfiguration/questionValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — Rule Configuration Engine: Configuration Validator
 *
 * ROLE:
 *   Validates the merged AuditConfiguration object at application startup.
 *   Runs 7 checks. Returns a structured ConfigurationValidationResult.
 *
 * DESIGN:
 *   - Synchronous and pure.
 *   - Never modifies the configuration.
 *   - Called by questions/registry.ts immediately after building the config.
 *   - If validation fails, registry.ts throws — the pipeline cannot start.
 *
 * VALIDATION CHECKS:
 *   1. Unique question IDs across all pillars.
 *   2. All required fields present (id, pillar, question, guidance, evidence, scoring, metadata).
 *   3. Valid pillar key (one of the 5 known pillars).
 *   4. Scoring thresholds — all 5 levels defined.
 *   5. Evidence configuration — required array non-empty.
 *   6. Metadata version present (non-empty string).
 *   7. Metadata enabled flag is a boolean.
 */

import type {
  AuditConfiguration,
  AuditPillarKey,
  ConfigurationValidationResult,
  ConfigurationValidationError,
  EnrichedAuditQuestion,
} from './questionTypes';

// ── Valid pillars ─────────────────────────────────────────────────────────────

const VALID_PILLARS = new Set<AuditPillarKey>([
  'SORT',
  'SET_IN_ORDER',
  'SHINE',
  'STANDARDIZE',
  'SUSTAIN',
]);

// ── Required scoring levels ───────────────────────────────────────────────────

const REQUIRED_THRESHOLD_KEYS = ['veryGood', 'good', 'average', 'bad', 'veryBad'] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function addError(
  errors:     ConfigurationValidationError[],
  questionId: string,
  field:      string,
  message:    string,
): void {
  errors.push({ questionId, field, message });
}

// ── Per-question validation ───────────────────────────────────────────────────

function validateQuestion(
  q:      EnrichedAuditQuestion,
  errors: ConfigurationValidationError[],
): void {
  const qid = q.id ?? 'UNKNOWN';

  // ── Check 2: Required top-level fields ─────────────────────────────────
  if (!q.id || typeof q.id !== 'string' || q.id.trim() === '') {
    addError(errors, qid, 'id', 'Question id is missing or empty.');
  }
  if (!q.pillar) {
    addError(errors, qid, 'pillar', 'Question pillar is missing.');
  }
  if (!q.question || typeof q.question !== 'string' || q.question.trim() === '') {
    addError(errors, qid, 'question', 'Question text is missing or empty.');
  }
  if (!q.guidance) {
    addError(errors, qid, 'guidance', 'Guidance block is missing.');
  }
  if (!q.evidence) {
    addError(errors, qid, 'evidence', 'Evidence configuration block is missing.');
  }
  if (!q.scoring) {
    addError(errors, qid, 'scoring', 'Scoring configuration block is missing.');
  }
  if (!q.metadata) {
    addError(errors, qid, 'metadata', 'Metadata block is missing.');
  }

  // ── Check 3: Valid pillar key ───────────────────────────────────────────
  if (q.pillar && !VALID_PILLARS.has(q.pillar)) {
    addError(errors, qid, 'pillar',
      `Invalid pillar "${q.pillar}". Must be one of: ${[...VALID_PILLARS].join(', ')}.`);
  }

  // ── Check 4: Scoring thresholds — all 5 levels defined ─────────────────
  if (q.scoring?.thresholds) {
    for (const level of REQUIRED_THRESHOLD_KEYS) {
      const threshold = q.scoring.thresholds[level];
      if (!threshold || typeof threshold.matchedEvidence !== 'number') {
        addError(errors, qid, `scoring.thresholds.${level}`,
          `Scoring threshold "${level}" is missing or has invalid matchedEvidence.`);
      }
    }
  } else if (q.scoring) {
    addError(errors, qid, 'scoring.thresholds', 'Scoring thresholds block is missing.');
  }

  // ── Check 5: Evidence — required array must be non-empty ───────────────
  if (q.evidence) {
    if (!Array.isArray(q.evidence.required) || q.evidence.required.length === 0) {
      addError(errors, qid, 'evidence.required',
        'Evidence required array is missing or empty. At least one required evidence key must be specified.');
    }
    if (!Array.isArray(q.evidence.optional)) {
      addError(errors, qid, 'evidence.optional', 'Evidence optional must be an array.');
    }
    if (!Array.isArray(q.evidence.forbidden)) {
      addError(errors, qid, 'evidence.forbidden', 'Evidence forbidden must be an array.');
    }
  }

  // ── Check 6: Metadata version ───────────────────────────────────────────
  if (q.metadata) {
    if (!q.metadata.version || typeof q.metadata.version !== 'string' || q.metadata.version.trim() === '') {
      addError(errors, qid, 'metadata.version', 'Metadata version is missing or empty.');
    }
    // ── Check 7: Metadata enabled flag ─────────────────────────────────────
    if (typeof q.metadata.enabled !== 'boolean') {
      addError(errors, qid, 'metadata.enabled', 'Metadata enabled flag must be a boolean.');
    }
  }
}

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * Validates a complete AuditConfiguration object.
 * Called by questions/registry.ts at module load time.
 *
 * Returns a ConfigurationValidationResult — the caller decides what to do on failure.
 *
 * @param config - The merged AuditConfiguration to validate.
 * @returns Validation result with errors and a summary report.
 */
export function validateQuestionConfiguration(
  config: AuditConfiguration,
): ConfigurationValidationResult {
  const errors: ConfigurationValidationError[] = [];

  // ── Check 1: Unique question IDs ──────────────────────────────────────
  const seenIds = new Map<string, number>();
  const duplicateIds: string[] = [];

  for (const q of config.allQuestions) {
    const id = q.id ?? '';
    seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
  }

  for (const [id, count] of seenIds.entries()) {
    if (count > 1) {
      duplicateIds.push(id);
      addError(errors, id, 'id', `Duplicate question ID "${id}" found ${count} times.`);
    }
  }

  // ── Checks 2–7: Per-question validation ──────────────────────────────
  const missingEvidenceRules: string[] = [];
  const missingThresholds:    string[] = [];

  for (const q of config.allQuestions) {
    const prevCount = errors.length;
    validateQuestion(q, errors);

    // Track which questions failed evidence / threshold checks
    const newErrors = errors.slice(prevCount);
    if (newErrors.some(e => e.field.startsWith('evidence'))) {
      missingEvidenceRules.push(q.id);
    }
    if (newErrors.some(e => e.field.startsWith('scoring.thresholds'))) {
      missingThresholds.push(q.id);
    }
  }

  // ── Build validation report ───────────────────────────────────────────
  const enabledQuestions  = config.allQuestions.filter(q => q.metadata?.enabled === true).length;
  const disabledQuestions = config.allQuestions.length - enabledQuestions;

  return {
    valid:  errors.length === 0,
    errors,
    report: {
      configurationVersion: config.metadata.configurationVersion,
      questionCount:        config.allQuestions.length,
      pillarCount:          Object.keys(config.questions).length,
      enabledQuestions,
      disabledQuestions,
      duplicateIds,
      missingEvidenceRules,
      missingThresholds,
    },
  };
}
