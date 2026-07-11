/**
 * src/modules/audit/standardizedEvidence/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.2 — Standardized Evidence Engine: Public API
 *
 * ROLE:
 *   The ONLY entry point for the Standardized Evidence Engine.
 *   Exposes buildEvidenceIds() — the single public function.
 *
 * PIPELINE CONTRACT:
 *   1. Run Configuration Test Suite.
 *   2. If any test fails → return null (caller must stop pipeline).
 *   3. For each validated observation → map objects → build evidenceIds.
 *   4. Validate the full StandardizedObservation collection.
 *   5. Return the collection.
 *
 * PIPELINE POSITION:
 *   Visibility Decision Engine → [Standardized Evidence Engine] → Rule Engine
 */

import type { StandardizedObservation } from '@/types/analysis';
import type { GeminiVisionResult, StructuredObservationResult } from '@/types/analysis';
import type { ConfigTestSuiteResult } from './evidenceTypes';
import { runConfigurationTestSuite }  from './configurationTestSuite';
import { mapObservationObjects }      from './evidenceMapper';
import { validateEvidenceCollection } from './evidenceValidator';
import {
  debugLog,
  debugGroup,
  debugGroupEnd,
  debugError,
} from '../pipeline/debug';

// ── Re-exports for consumers ──────────────────────────────────────────────────

export { runConfigurationTestSuite } from './configurationTestSuite';
export type { ConfigTestSuiteResult, ConfigTestError } from './evidenceTypes';
export type { EvidenceValidationResult } from './evidenceValidator';

// ── Engine result ─────────────────────────────────────────────────────────────

export interface StandardizedEvidenceResult {
  observations:      StandardizedObservation[];
  configTestResult:  ConfigTestSuiteResult;
  hasUnknownObjects: boolean;
  unknownObjectCount: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Converts validated observations into standardized machine-readable evidence.
 *
 * This is the ONLY public function of the Standardized Evidence Engine.
 *
 * @param observations - Validated output of the Observation Engine (Sprint 3/4).
 * @param _visionResult - Gemini Vision output (reserved for future use).
 * @returns StandardizedEvidenceResult, or null if Configuration Test Suite fails.
 *
 * IMPORTANT: If this returns null, the pipeline MUST stop.
 *            The Rule Engine must NEVER run without standardized evidence.
 */
export function buildEvidenceIds(
  observations:  StructuredObservationResult[],
  _visionResult: GeminiVisionResult,
): StandardizedEvidenceResult | null {
  const startTime = Date.now();

  // ── Phase 1: Configuration Test Suite ──────────────────────────────────
  debugGroup('Configuration Test Suite Started');

  const testResult = runConfigurationTestSuite();

  debugGroup('Configuration Validation Results');
  debugLog(`Status:          ${testResult.status}`);
  debugLog(`Tests Passing:   ${testResult.passing} / 8`);
  debugLog(`Tests Failing:   ${testResult.failing}`);
  debugLog(`Question Count:  ${testResult.report.totalQuestions}`);
  debugLog(`Enabled:         ${testResult.report.enabledQuestions}`);
  debugLog(`Pillars OK:      ${testResult.report.pillarsVerified.join(', ')}`);
  debugLog(`Vocab Size:      ${testResult.report.vocabularySize}`);

  if (testResult.errors.length > 0) {
    debugLog('Errors:');
    testResult.errors.forEach(e =>
      debugLog(`  [Test ${e.testNumber}] [${e.code}] ${e.questionId}: ${e.message}`),
    );
  }
  debugGroupEnd();

  if (testResult.status === 'FAIL') {
    debugLog('Pipeline Decision: STOP_PIPELINE');
    debugGroupEnd(); // close 'Configuration Test Suite Started'
    debugError('Configuration Test Suite FAILED — Standardized Evidence Engine will not start.', testResult.errors);
    return null;
  }

  debugLog('Pipeline Decision: PASS_TO_STANDARDIZED_EVIDENCE_ENGINE');
  debugGroupEnd(); // close 'Configuration Test Suite Started'

  // ── Phase 2: Build Standardized Observations ───────────────────────────
  debugGroup('Standardized Evidence Engine Started');
  debugLog(`Processing ${observations.length} observations…`);

  const standardized: StandardizedObservation[] = [];
  let totalUnknownObjects = 0;

  for (const entry of observations) {
    const obs = entry.observation;

    debugGroup(`Question: ${entry.questionId}`);
    debugLog('Observation:', {
      visible:    obs.visible,
      objects:    obs.objects,
      confidence: obs.confidence,
    });

    // If not visible — produce empty evidenceIds
    if (!obs.visible || obs.objects.length === 0) {
      const result: StandardizedObservation = {
        questionId:  entry.questionId,
        visible:     obs.visible,
        evidence:    obs.evidence,
        evidenceIds: [],
        confidence:  obs.confidence,
      };

      debugLog('Extracted Objects:          (none visible)');
      debugLog('Mapped Evidence Identifiers:', []);
      debugLog('Vocabulary Matches:          0');
      debugLog('Unknown Objects:            0');
      debugLog('Pipeline Decision:          PASS_TO_RULE_ENGINE');
      debugGroupEnd();

      standardized.push(result);
      continue;
    }

    // Map objects → EvidenceKey identifiers
    const mappingResult = mapObservationObjects(obs.objects);

    debugLog('Extracted Objects:          ', obs.objects);
    debugLog('Mapped Evidence Identifiers:', mappingResult.evidenceIds);
    debugLog('Vocabulary Matches:         ', mappingResult.mappings.filter(m => m.matchType !== 'unknown').length);
    debugLog('Unknown Objects:            ', mappingResult.unknownObjects);

    if (mappingResult.unknownObjects.length > 0) {
      totalUnknownObjects += mappingResult.unknownObjects.length;
    }

    const result: StandardizedObservation = {
      questionId:  entry.questionId,
      visible:     obs.visible,
      evidence:    obs.evidence,
      evidenceIds: mappingResult.evidenceIds,
      confidence:  obs.confidence,
      ...(mappingResult.unknownObjects.length > 0
        ? { _unknownObjects: mappingResult.unknownObjects }
        : {}),
    };

    debugLog('Pipeline Decision: PASS_TO_RULE_ENGINE');
    debugGroupEnd();

    standardized.push(result);
  }

  // ── Phase 3: Validate the full collection ──────────────────────────────
  const validationResult = validateEvidenceCollection(standardized);

  if (!validationResult.valid) {
    debugLog('Evidence Validation: WARNINGS');
    validationResult.errors.forEach(e =>
      debugLog(`  [Check ${e.check}] ${e.questionId}: ${e.message}`),
    );
  } else {
    debugLog('Evidence Validation: PASS — All identifiers are canonical and deterministic.');
  }

  const elapsed = Date.now() - startTime;
  debugLog(`Execution Time (ms): ${elapsed}`);
  debugLog(`Pipeline Decision: PASS_TO_RULE_ENGINE (${standardized.length} observations standardized)`);
  debugGroupEnd(); // close 'Standardized Evidence Engine Started'

  return {
    observations:       standardized,
    configTestResult:   testResult,
    hasUnknownObjects:  totalUnknownObjects > 0,
    unknownObjectCount: totalUnknownObjects,
  };
}
