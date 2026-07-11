/**
 * src/modules/audit/report/__tests__/report.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest Unit Tests for Report Builder (Sprint 8)
 */

import { describe, it, expect } from 'vitest';
import { buildAuditReport, ReportIntegrityError } from '../reportBuilder';
import { validateReport } from '../reportValidator';
import { formatExecutionSummary, formatToCSV } from '../reportFormatter';

describe('Report Builder Unit Tests', () => {

  const mockConfig = {
    pillars:  ['SORT', 'SET_IN_ORDER'],
    metadata: {
      supportedPipelineVersion: 'V3',
      configurationVersion:     '1.0',
      auditTemplate:            'Industrial_5S',
    },
    gradingConfig: {
      version: '1.0',
      thresholds: [
        { grade: 'A', minPercentage: 80, maxPercentage: 100 },
        { grade: 'B', minPercentage: 0,  maxPercentage: 79.99 },
      ],
    },
  };

  const createMockParams = () => ({
    auditId:       'audit-123',
    overallScore: {
      actualScore:        7,
      maximumScore:       8,
      percentage:         87.50,
      evaluatedQuestions: 2,
      skippedQuestions:   0,
      evaluatedPillars:   2,
    },
    gradeResult: {
      grade:            'A',
      matchedThreshold: '80-100',
      gradingVersion:    '1.0',
    },
    pillarScores: [
      { pillar: 'SORT', questionCount: 1, eligibleQuestions: 1, skippedQuestions: 0, actualScore: 3, maximumScore: 4, percentage: 75.00 },
      { pillar: 'SET_IN_ORDER', questionCount: 1, eligibleQuestions: 1, skippedQuestions: 0, actualScore: 4, maximumScore: 4, percentage: 100.00 },
    ],
    questionScores: [
      { questionId: 'SORT_Q1', pillar: 'SORT', visibility: 'VISIBLE', rating: 'GOOD', score: 3, maxScore: 4, scoreEligible: true, evaluationTrace: [] },
      { questionId: 'SET_IN_ORDER_Q1', pillar: 'SET_IN_ORDER', visibility: 'VISIBLE', rating: 'VERY_GOOD', score: 4, maxScore: 4, scoreEligible: true, evaluationTrace: [] },
    ],
    recommendations: {
      questionRecommendations: [], // Both are GOOD/VERY_GOOD -> no recs
      pillarRecommendations:   [],
      overallRecommendation:   { summary: 'ok', strengths: ['tidy'], improvements: ['none'], nextSteps: ['stay tidy'] },
    },
    observations: [
      { questionId: 'SORT_Q1', visible: true, evidence: ['Sort evidence'], evidenceIds: ['BOX'], confidence: 90 },
      { questionId: 'SET_IN_ORDER_Q1', visible: true, evidence: ['Order evidence'], evidenceIds: ['LABEL'], confidence: 95 },
    ],
    trace: { auditId: 'trace-123' },
    config: mockConfig,
    executionDuration: 120,
  });

  // ── 1. Complete Report Generation and Structure ─────────────────────────────
  it('successfully compiles, validates, and deep-freezes a valid report', () => {
    const params = createMockParams();
    const report = buildAuditReport(params);

    expect(report.metadata.auditId).toBe('audit-123');
    expect(report.summary.grade).toBe('A');
    expect(report.summary.overallPercentage).toBe(87.50);
    expect(report.pillars.length).toBe(2);
    expect(report.questions.length).toBe(2);
    expect(report.execution.executionDuration).toBe(120);

    // Verify immutability
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.metadata)).toBe(true);
    expect(Object.isFrozen(report.summary)).toBe(true);
  });

  // ── 2. Section Ordering ─────────────────────────────────────────────────────
  it('guarantees deterministic section ordering in output JSON', () => {
    const params = createMockParams();
    const report = buildAuditReport(params);

    const keys = Object.keys(report);
    expect(keys[0]).toBe('metadata');
    expect(keys[1]).toBe('summary');
    expect(keys[2]).toBe('pillars');
    expect(keys[3]).toBe('questions');
    expect(keys[4]).toBe('recommendations');
    expect(keys[5]).toBe('statistics');
    expect(keys[6]).toBe('execution');
  });

  // ── 3. Score Inconsistency Validation (Question vs Pillar) ───────────────────
  it('throws ReportIntegrityError if question scores do not sum to pillar totals', () => {
    const params = createMockParams();
    // Modify SORT_Q1 score to 2, but keep SORT pillar actualScore at 3 (causes inconsistency!)
    params.questionScores[0].score = 2;

    expect(() => {
      buildAuditReport(params);
    }).toThrow(ReportIntegrityError);
  });

  // ── 4. Score Inconsistency Validation (Pillar vs Overall) ────────────────────
  it('throws ReportIntegrityError if pillar scores do not sum to overall total', () => {
    const params = createMockParams();
    // Modify overall score to 6, but keep pillar sum at 3 + 4 = 7 (causes inconsistency!)
    params.overallScore.actualScore = 6;

    expect(() => {
      buildAuditReport(params);
    }).toThrow(ReportIntegrityError);
  });

  // ── 5. Grade Inconsistency Validation ──────────────────────────────────────
  it('throws ReportIntegrityError if grade is inconsistent with configured thresholds', () => {
    const params = createMockParams();
    // 87.5% should be 'A' based on mockConfig thresholds. Let's modify grade to 'B' (causes inconsistency!)
    params.gradeResult.grade = 'B';

    expect(() => {
      buildAuditReport(params);
    }).toThrow(ReportIntegrityError);
  });

  // ── 6. Recommendation Consistency Validation ────────────────────────────────
  it('throws ReportIntegrityError if high-rated question has a recommendation action', () => {
    const params = createMockParams();
    // SORT_Q1 is rated GOOD. Let's add an action recommendation for it (causes inconsistency!)
    params.recommendations.questionRecommendations.push({
      questionId: 'SORT_Q1',
      rating:     'GOOD',
      issue:      'Fabricated issue',
      action:     'Fabricated action',
    });

    expect(() => {
      buildAuditReport(params);
    }).toThrow(ReportIntegrityError);
  });

  // ── 7. Presentation Decoupling Formatters ───────────────────────────────────
  it('formats execution summaries and CSV exports correctly', () => {
    const params = createMockParams();
    const report = buildAuditReport(params);

    const summaryStr = formatExecutionSummary(report);
    expect(summaryStr).toContain('Audit Started:');
    expect(summaryStr).toContain('Overall Grade:         A (87.5%)');

    const csvStr = formatToCSV(report);
    expect(csvStr).toContain('Section,Question ID,Pillar,Rating,Score,Max Score,Visibility');
    expect(csvStr).toContain('Question,SORT_Q1,SORT,GOOD,3,4,VISIBLE');
  });

});
