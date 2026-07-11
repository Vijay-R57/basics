/**
 * src/modules/audit/questions/registry.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — Rule Configuration Engine: Audit Question Registry
 *
 * ROLE:
 *   Imports all 5 pillar question files, merges them into one AuditConfiguration,
 *   validates the merged configuration, and deep-freezes the result.
 *
 * USAGE:
 *   The public API (ruleConfiguration/index.ts) is the ONLY intended consumer.
 *   No other module should import directly from this file.
 *
 * DESIGN:
 *   - Deep-freezes the entire configuration object after validation.
 *   - Throws on invalid configuration — the pipeline must never start with bad config.
 *   - Exports AUDIT_REGISTRY: a frozen, validated AuditConfiguration.
 */

import type { AuditConfiguration, AuditPillarKey } from '../ruleConfiguration/questionTypes';
import { SORT_QUESTIONS }         from './sort';
import { SET_IN_ORDER_QUESTIONS } from './setInOrder';
import { SHINE_QUESTIONS }        from './shine';
import { STANDARDIZE_QUESTIONS }  from './standardize';
import { SUSTAIN_QUESTIONS }      from './sustain';
import { validateQuestionConfiguration } from '../ruleConfiguration/questionValidator';

// ── Pillar order ──────────────────────────────────────────────────────────────
//
// Determines the order in which questions appear in getAllQuestions().
// Must match the PILLAR_ORDER in pipeline/questions.ts for backward compatibility.

const PILLAR_ORDER: AuditPillarKey[] = [
  'SORT',
  'SET_IN_ORDER',
  'SHINE',
  'STANDARDIZE',
  'SUSTAIN',
];

// ── Build configuration object ────────────────────────────────────────────────

function buildConfiguration(): AuditConfiguration {
  const questions = {
    SORT:         SORT_QUESTIONS,
    SET_IN_ORDER: SET_IN_ORDER_QUESTIONS,
    SHINE:        SHINE_QUESTIONS,
    STANDARDIZE:  STANDARDIZE_QUESTIONS,
    SUSTAIN:      SUSTAIN_QUESTIONS,
  } as const;

  const allQuestions = PILLAR_ORDER.flatMap(pillar => questions[pillar]);

  const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const config: AuditConfiguration = {
    questions,
    allQuestions,
    metadata: {
      configurationVersion:     '1.0',
      auditTemplate:            'Industrial_5S',
      supportedPipelineVersion: 'V3',
      createdDate:              '2026-07-11',
      lastModified:             now,
      totalQuestions:           allQuestions.length,
    },
  };

  return config;
}

// ── Deep freeze ───────────────────────────────────────────────────────────────

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.getOwnPropertyNames(obj).forEach(name => {
    const value = (obj as Record<string, unknown>)[name];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  });
  return Object.freeze(obj);
}

// ── Build, validate and freeze ────────────────────────────────────────────────

const raw = buildConfiguration();

const validationResult = validateQuestionConfiguration(raw);

if (!validationResult.valid) {
  const messages = validationResult.errors
    .map(e => `  [${e.questionId}] ${e.field}: ${e.message}`)
    .join('\n');
  throw new Error(
    `AUDIT CONFIGURATION INVALID — pipeline cannot start.\n${messages}`,
  );
}

/**
 * The single, immutable, validated Audit Configuration object.
 *
 * This is the ONLY object that future engines should consume.
 * It is deep-frozen — no modification is possible at runtime.
 * It is produced exactly once at module load time.
 */
export const AUDIT_REGISTRY: Readonly<AuditConfiguration> = deepFreeze(raw);
