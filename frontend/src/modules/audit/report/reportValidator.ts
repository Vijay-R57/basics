/**
 * src/modules/audit/report/reportValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 8 — Report Builder: Central Report Validator
 *
 * ROLE:
 *   Validates the final assembled report against strict mathematical consistency
 *   and integrity constraints.
 *   Verifies:
 *     - Required sections presence.
 *     - Question and Pillar score totals are consistent.
 *     - Overall totals and percentage match aggregates.
 *     - Grading alignment matches thresholds.
 *     - Recommendation references are valid and non-contradictory.
 *     - Execution and metadata details are complete.
 */

import type { Final5SAuditReport } from './reportTypes';
import { getGradingConfig } from '../grade';

export interface ReportValidationResult {
  status: 'PASS' | 'FAIL';
  errors: string[];
}

/**
 * Validates the complete Final 5S Audit Report object.
 * Returns PASS or FAIL with structured errors.
 *
 * @param report - The assembled final report.
 * @param config - The global audit config (for grading thresholds).
 */
export function validateReport(
  report: Final5SAuditReport,
  config: any,
): ReportValidationResult {
  const errors: string[] = [];

  // ── 1. Validate Required Sections ──────────────────────────────────────────
  if (!report) {
    errors.push('Report object is null or undefined.');
    return { status: 'FAIL', errors };
  }

  const requiredSections = [
    'metadata',
    'summary',
    'pillars',
    'questions',
    'recommendations',
    'statistics',
    'execution',
  ] as const;

  for (const sec of requiredSections) {
    if (!report[sec] || typeof report[sec] !== 'object') {
      errors.push(`Missing or invalid required section: "${sec}".`);
    }
  }

  if (errors.length > 0) {
    return { status: 'FAIL', errors };
  }

  // ── 2. Metadata & Execution Completeness ───────────────────────────────────
  const meta = report.metadata;
  if (!meta.auditId) errors.push('metadata.auditId is missing.');
  if (!meta.auditDate) errors.push('metadata.auditDate is missing.');
  if (!meta.pipelineVersion) errors.push('metadata.pipelineVersion is missing.');
  if (!meta.configurationVersion) errors.push('metadata.configurationVersion is missing.');
  if (!meta.auditTemplate) errors.push('metadata.auditTemplate is missing.');
  if (!meta.reportVersion) errors.push('metadata.reportVersion is missing.');
  if (!meta.generatedTimestamp) errors.push('metadata.generatedTimestamp is missing.');

  const exec = report.execution;
  if (!exec.pipelineVersion) errors.push('execution.pipelineVersion is missing.');
  if (!exec.configurationVersion) errors.push('execution.configurationVersion is missing.');
  if (typeof exec.executionDuration !== 'number') errors.push('execution.executionDuration is invalid.');
  if (!exec.auditTraceReference) errors.push('execution.auditTraceReference is missing.');

  // ── 3. Question Integrity ──────────────────────────────────────────────────
  const seenQIds = new Set<string>();
  const questionMap = new Map<string, typeof report.questions[number]>();

  for (const q of report.questions) {
    if (seenQIds.has(q.questionId)) {
      errors.push(`Duplicate questionId "${q.questionId}" detected in questions list.`);
    }
    seenQIds.add(q.questionId);
    questionMap.set(q.questionId, q);

    if (!q.questionId) errors.push('Question is missing questionId.');
    if (!q.question) errors.push(`Question "${q.questionId}" is missing question text.`);
    if (!q.visibility) errors.push(`Question "${q.questionId}" is missing visibility.`);
    if (!q.rating) errors.push(`Question "${q.questionId}" is missing rating.`);
  }

  // Question counts check
  const evaluatedCount = report.questions.filter(q => q.score !== null).length;
  const skippedCount   = report.questions.filter(q => q.score === null).length;

  if (evaluatedCount !== report.statistics.eligibleQuestions) {
    errors.push(`Evaluated questions count mismatch. Questions list: ${evaluatedCount}, Statistics: ${report.statistics.eligibleQuestions}.`);
  }
  if (skippedCount !== report.statistics.skippedQuestions) {
    errors.push(`Skipped questions count mismatch. Questions list: ${skippedCount}, Statistics: ${report.statistics.skippedQuestions}.`);
  }

  // ── 4. Pillar Integrity ────────────────────────────────────────────────────
  const seenPillars = new Set<string>();
  for (const p of report.pillars) {
    if (seenPillars.has(p.pillar)) {
      errors.push(`Duplicate pillar "${p.pillar}" detected in pillars list.`);
    }
    seenPillars.add(p.pillar);
  }

  // ── 5. Score Integrity (Questions vs Pillars vs Overall) ───────────────────
  // Sum up question scores grouped by pillar
  const pillarSumActual = new Map<string, number>();
  const pillarSumMax    = new Map<string, number>();

  // Fetch pillar names from configuration to verify grouping completeness
  const configPillars = config?.pillars ?? report.pillars.map(p => p.pillar);
  for (const pillar of configPillars) {
    pillarSumActual.set(pillar, 0);
    pillarSumMax.set(pillar, 0);
  }

  // Fetch question scores to check registry-pillar configurations
  for (const q of report.questions) {
    // Dynamically retrieve pillar key from configured questions or standard prefix mapping
    const pillarName = report.pillars.find(p => q.questionId.startsWith(p.pillar))?.pillar;
    if (!pillarName) {
      errors.push(`Question "${q.questionId}" cannot be mapped to any summary pillar.`);
      continue;
    }

    if (q.score !== null) {
      pillarSumActual.set(pillarName, (pillarSumActual.get(pillarName) ?? 0) + q.score);
    }
    if (q.maxScore !== null) {
      pillarSumMax.set(pillarName, (pillarSumMax.get(pillarName) ?? 0) + q.maxScore);
    }
  }

  // Compare Question aggregates against Pillar summaries
  let aggregatedPillarActual = 0;
  let aggregatedPillarMax    = 0;

  for (const p of report.pillars) {
    const actSum = pillarSumActual.get(p.pillar) ?? 0;
    const maxSum = pillarSumMax.get(p.pillar) ?? 0;

    if (p.actualScore !== actSum) {
      errors.push(`Pillar "${p.pillar}" actualScore (${p.actualScore}) does not match question aggregates (${actSum}).`);
    }
    if (p.maximumScore !== maxSum) {
      errors.push(`Pillar "${p.pillar}" maximumScore (${p.maximumScore}) does not match question aggregates (${maxSum}).`);
    }

    // Verify pillar percentage calculation consistency
    const expectedPillarPct = p.maximumScore === 0 ? 0 : Math.round((p.actualScore / p.maximumScore) * 100 * 100) / 100;
    if (Math.abs(p.percentage - expectedPillarPct) > 0.05) {
      errors.push(`Pillar "${p.pillar}" percentage (${p.percentage}) is mathematically inconsistent with scores.`);
    }

    aggregatedPillarActual += p.actualScore;
    aggregatedPillarMax    += p.maximumScore;
  }

  // Compare Pillar aggregates against Overall summary
  if (report.summary.actualScore !== aggregatedPillarActual) {
    errors.push(`Overall actualScore (${report.summary.actualScore}) does not match pillar aggregates (${aggregatedPillarActual}).`);
  }
  if (report.summary.maximumScore !== aggregatedPillarMax) {
    errors.push(`Overall maximumScore (${report.summary.maximumScore}) does not match pillar aggregates (${aggregatedPillarMax}).`);
  }

  // Verify overall percentage calculation consistency
  const expectedOverallPct = report.summary.maximumScore === 0
    ? 0
    : Math.round((report.summary.actualScore / report.summary.maximumScore) * 100 * 100) / 100;
  if (Math.abs(report.summary.overallPercentage - expectedOverallPct) > 0.05) {
    errors.push(`Overall percentage (${report.summary.overallPercentage}) is mathematically inconsistent with scores.`);
  }

  // ── 6. Grade Integrity ─────────────────────────────────────────────────────
  const gradingConfig = getGradingConfig(config);
  let expectedGrade = '';
  for (const t of gradingConfig.thresholds) {
    if (report.summary.overallPercentage >= t.minPercentage && report.summary.overallPercentage <= t.maxPercentage) {
      expectedGrade = t.grade;
      break;
    }
  }
  if (expectedGrade && report.summary.grade !== expectedGrade) {
    errors.push(`Overall grade "${report.summary.grade}" does not match configured boundaries for percentage ${report.summary.overallPercentage}%. Expected: "${expectedGrade}".`);
  }

  // ── 7. Recommendation Integrity ────────────────────────────────────────────
  const recs = report.recommendations;
  for (const qRec of recs.questionRecommendations) {
    const q = questionMap.get(qRec.questionId);
    if (!q) {
      errors.push(`Question recommendation references unlisted questionId "${qRec.questionId}".`);
      continue;
    }

    // Recommendation constraints checking: no recommendations allowed for GOOD or VERY_GOOD ratings
    const isLowRated = q.rating === 'VERY_BAD' || q.rating === 'BAD' || q.rating === 'AVERAGE';
    if (!isLowRated) {
      errors.push(`Contradiction: Question "${q.questionId}" has recommendation but is rated high ("${q.rating}").`);
    }

    // Check action text matches what is inside ReportQuestionResult.recommendation
    if (q.recommendation !== qRec.action) {
      errors.push(`Inconsistency: Recommendation action for "${q.questionId}" in summary does not match question result action.`);
    }
  }

  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    errors,
  };
}
