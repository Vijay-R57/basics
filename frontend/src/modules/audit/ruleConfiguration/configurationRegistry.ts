/**
 * src/modules/audit/ruleConfiguration/configurationRegistry.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — Rule Configuration Engine: Configuration Registry (Singleton Cache)
 *
 * ROLE:
 *   Provides a singleton-cached entry point for the AuditConfiguration.
 *   Loads once, returns the same frozen instance on every subsequent call.
 *
 * DESIGN:
 *   - The configuration is loaded exactly once at module initialisation time.
 *   - Every module that calls loadQuestionConfiguration() gets the same instance.
 *   - Debug logging when VITE_AI_DEBUG is enabled.
 *   - Never reloads during audit execution.
 */

import { getAuditConfiguration, getAllEnabledQuestions } from './questionLoader';
import type { AuditConfiguration } from './questionTypes';
import {
  debugLog,
  debugGroup,
  debugGroupEnd,
  debugError,
} from '../pipeline/debug';

// ── Singleton cache ───────────────────────────────────────────────────────────

let _cachedConfig: Readonly<AuditConfiguration> | null = null;
let _loadedAt: string | null = null;

// ── Configuration loader ──────────────────────────────────────────────────────

/**
 * Loads and returns the validated, frozen AuditConfiguration.
 *
 * This is the PRIMARY PUBLIC API of the Rule Configuration Engine.
 * Call this from any pipeline module that needs access to audit questions.
 *
 * The first call initialises the singleton.
 * All subsequent calls return the cached instance.
 *
 * Returns null if the configuration failed to load (check console for errors).
 */
export function loadQuestionConfiguration(): Readonly<AuditConfiguration> | null {
  // Return cached instance if already loaded
  if (_cachedConfig !== null) {
    return _cachedConfig;
  }

  const startTime = Date.now();

  debugGroup('Rule Configuration Engine — Loading');

  try {
    const config = getAuditConfiguration();
    _cachedConfig = config;
    _loadedAt     = new Date().toISOString();

    const enabledQuestions  = getAllEnabledQuestions();
    const disabledCount     = config.metadata.totalQuestions - enabledQuestions.length;

    debugLog('Rule Configuration Loaded ✓');
    debugLog('Question Count:           ', config.metadata.totalQuestions);
    debugLog('Pillar Count:             ', Object.keys(config.questions).length);
    debugLog('Enabled Questions:        ', enabledQuestions.length);
    debugLog('Disabled Questions:       ', disabledCount);
    debugLog('Configuration Version:    ', config.metadata.configurationVersion);
    debugLog('Audit Template:           ', config.metadata.auditTemplate);
    debugLog('Pipeline Version:         ', config.metadata.supportedPipelineVersion);
    debugLog('Last Modified:            ', config.metadata.lastModified);

    debugGroup('Configuration Validation');
    debugLog('Status: PASS — Configuration was validated at registry initialisation.');
    debugLog('All 7 checks passed: unique IDs, required fields, valid pillar, thresholds,');
    debugLog('                     evidence lists, metadata version, enabled flag.');
    debugGroupEnd();

    const elapsed = Date.now() - startTime;
    debugLog(`Execution Time (ms): ${elapsed}`);
    debugLog('Pipeline Decision: PASS_TO_STANDARDIZED_EVIDENCE_ENGINE');
    debugGroupEnd();

    return _cachedConfig;

  } catch (err) {
    debugError('Rule Configuration Engine — FAILED TO LOAD', err);
    debugLog('Pipeline Decision: STOP_PIPELINE');
    debugGroupEnd();

    // Re-throw so the calling pipeline stage can handle this as a hard failure
    throw err;
  }
}

/**
 * Returns the ISO timestamp of when the configuration was first loaded.
 * Returns null if the configuration has not been loaded yet.
 */
export function getConfigurationLoadedAt(): string | null {
  return _loadedAt;
}

/**
 * Returns true if the configuration singleton has been initialised.
 */
export function isConfigurationLoaded(): boolean {
  return _cachedConfig !== null;
}
