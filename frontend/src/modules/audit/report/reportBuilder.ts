/**
 * src/modules/audit/report/reportBuilder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 8 — Report Builder: Orchestrator
 *
 * ROLE:
 *   Orchestrates assembly, validation, freezing, and debug logging for the
 *   Final 5S Audit Report. Enforces strict pipeline integrity checks.
 */

import type { Final5SAuditReport } from './reportTypes';
import { assembleReport } from './reportAssembler';
import { validateReport } from './reportValidator';
import { debugLog, debugGroup, debugGroupEnd, debugError } from '../pipeline/debug';

/** Custom Error class for report validation issues. */
export class ReportIntegrityError extends Error {
  public errors: string[];

  constructor(message: string, errors: string[]) {
    super(message);
    this.name   = 'ReportIntegrityError';
    this.errors = errors;
  }
}

/** Recursively deep-freezes an object to make it completely immutable. */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.getOwnPropertyNames(obj).forEach(name => {
    const value = (obj as Record<string, unknown>)[name];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  });
  return Object.freeze(obj);
}

/**
 * Builds, validates, and deep-freezes the Final 5S Audit Report.
 *
 * This is the PRIMARY PUBLIC API of the Report Builder stage.
 *
 * @param params - Individual outputs gathered from all previous stages.
 * @returns Readonly Final5SAuditReport.
 * @throws ReportIntegrityError if any consistency checks fail.
 */
export function buildAuditReport(params: {
  auditId:              string;
  overallScore:         any;
  gradeResult:          any;
  pillarScores:         any[];
  questionScores:       any[];
  recommendations:      any;
  observations:         any[];
  trace:                any;
  config:               any;
  executionDuration:    number;
}): Readonly<Final5SAuditReport> {
  const startTime = Date.now();

  debugGroup('Report Builder Started');

  // 1. Assemble the report object declaratively
  const report = assembleReport(params);
  debugLog('Sections Added:       ', 'metadata, summary, pillars, questions, recommendations, statistics, execution');

  // 2. Perform the Central Validation check
  const valResult = validateReport(report, params.config);

  debugLog('Validation Result:    ', valResult.status);
  if (valResult.status === 'FAIL') {
    debugLog('Validation Errors:    ', valResult.errors);
    debugLog('Pipeline Decision:     STOP_PIPELINE');
    debugGroupEnd();
    debugError('Report integrity checks failed. Audit report build cancelled.', valResult.errors);
    throw new ReportIntegrityError(
      `Report integrity checks failed: ${valResult.errors.join('; ')}`,
      valResult.errors,
    );
  }

  // 3. Deep freeze to guarantee immutability
  const frozenReport = deepFreeze(report);

  const reportSize = JSON.stringify(frozenReport).length;
  const elapsed    = Date.now() - startTime;

  debugLog('Report Size:          ', `${reportSize} bytes`);
  debugLog('Execution Time:       ', `${elapsed}ms`);
  debugLog('Pipeline Decision:     AUDIT_COMPLETED');
  debugGroupEnd(); // close 'Report Builder Started'

  return frozenReport;
}
