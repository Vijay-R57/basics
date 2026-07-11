/**
 * src/modules/audit/report/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 8 — Report Builder: Public API
 *
 * ROLE:
 *   Public barrel for the Report Builder.
 */

export { buildAuditReport, ReportIntegrityError } from './reportBuilder';
export { validateReport } from './reportValidator';
export { assembleReport } from './reportAssembler';
export {
  formatExecutionSummary,
  formatToCSV,
  formatToJsonAPI,
} from './reportFormatter';

export type {
  ReportMetadata,
  ReportOverallSummary,
  ReportPillarSummary,
  ReportQuestionResult,
  ReportExecutionInformation,
  Final5SAuditReport,
} from './reportTypes';
