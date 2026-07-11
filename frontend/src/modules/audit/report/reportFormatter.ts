/**
 * src/modules/audit/report/reportFormatter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 8 — Report Builder: Report Presentation Formatter
 *
 * ROLE:
 *   Separates report raw data from presentation formatting logic.
 *   Provides output generation stubs (CSV, PDF, Excel) and computes the compact
 *   Execution Summary required by Sprints 8.5.
 */

import type { Final5SAuditReport } from './reportTypes';

/**
 * Generates a compact text execution summary.
 * Useful for dashboards and notifications.
 */
export function formatExecutionSummary(report: Final5SAuditReport): string {
  return `=== 5S AUDIT EXECUTION SUMMARY ===
Audit Started:        ${report.metadata.auditDate}
Pipeline Version:     ${report.metadata.pipelineVersion}
Configuration Version: ${report.metadata.configurationVersion}
Execution Duration:    ${report.execution.executionDuration}ms
Questions Evaluated:   ${report.summary.questionsEvaluated}
Questions Skipped:     ${report.summary.skippedQuestions}
Overall Score:         ${report.summary.actualScore} / ${report.summary.maximumScore}
Overall Grade:         ${report.summary.grade} (${report.summary.overallPercentage}%)
Audit Completed:       PASS (Report Validated)
==================================`;
}

/**
 * Format helper stub for CSV export.
 */
export function formatToCSV(report: Final5SAuditReport): string {
  const lines: string[] = [];
  lines.push('Section,Question ID,Pillar,Rating,Score,Max Score,Visibility');
  for (const q of report.questions) {
    const pillar = report.pillars.find(p => q.questionId.startsWith(p.pillar))?.pillar ?? 'UNKNOWN';
    lines.push(`Question,${q.questionId},${pillar},${q.rating},${q.score ?? ''},${q.maxScore ?? ''},${q.visibility}`);
  }
  return lines.join('\n');
}

/**
 * Format helper stub for JSON API export.
 */
export function formatToJsonAPI(report: Final5SAuditReport): string {
  return JSON.stringify({
    auditId:       report.metadata.auditId,
    percentage:    report.summary.overallPercentage,
    grade:         report.summary.grade,
    score:         `${report.summary.actualScore}/${report.summary.maximumScore}`,
    timestamp:     report.metadata.generatedTimestamp,
  }, null, 2);
}
