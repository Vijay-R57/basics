/**
 * src/modules/audit/ruleEngine/__tests__/ruleEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest Unit Tests for Deterministic Rule Engine (Sprint 6.3)
 */

import { describe, it, expect } from 'vitest';
import type { EnrichedAuditQuestion } from '../../ruleConfiguration';
import { executePrecedenceChain } from '../precedenceEngine';

// ── Mock Question Configuration Builder ──────────────────────────────────────

function createMockQuestion(options: {
  id:         string;
  required:   string[];
  optional:   string[];
  forbidden:  string[];
  thresholds: {
    veryGood:  number;
    good:      number;
    average:   number;
    bad:       number;
    veryBad:   number;
  };
}): EnrichedAuditQuestion {
  return {
    id:       options.id,
    pillar:   'SORT',
    question: 'Mock Question Text',
    guidance: {
      evaluate:            [],
      ignore:              [],
      uncertaintyResponse: { visibility: 'NOT_VISIBLE' },
    },
    evidence: {
      required:  options.required as any[],
      optional:  options.optional as any[],
      forbidden: options.forbidden as any[],
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: options.thresholds.veryGood },
        good:     { matchedEvidence: options.thresholds.good },
        average:  { matchedEvidence: options.thresholds.average },
        bad:      { matchedEvidence: options.thresholds.bad },
        veryBad:  { matchedEvidence: options.thresholds.veryBad },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    [],
    },
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Deterministic Rule Engine Unit Tests', () => {

  // Mock SORT-like question: absence is good (0 matches = VERY_GOOD)
  const sortQuestion = createMockQuestion({
    id:        'SORT_Q1',
    required:  ['RAW_MATERIAL', 'CONTAINER', 'BOX'],
    optional:  ['PALLET'],
    forbidden: ['SHADOW_BOARD'],
    thresholds: {
      veryGood: 0,
      good:     1,
      average:  2,
      bad:      3,
      veryBad:  4,
    },
  });

  // Mock SET_IN_ORDER-like question: presence is good (4 matches = VERY_GOOD)
  const setInOrderQuestion = createMockQuestion({
    id:        'SET_IN_ORDER_Q1',
    required:  ['LABEL', 'MACHINE', 'VISUAL_BOARD', 'TOOL'],
    optional:  ['WALKWAY'],
    forbidden: ['WASTE_BIN'],
    thresholds: {
      veryGood: 4,
      good:     3,
      average:  2,
      bad:      1,
      veryBad:  0,
    },
  });

  // ── Test Case 1: Normal Case — SORT no clutter ─────────────────────────────
  it('assigns VERY_GOOD to SORT question when no clutter evidence is detected', () => {
    const res = executePrecedenceChain('VISIBLE', [], sortQuestion, 'SORT_Q1');
    expect(res.rating).toBe('VERY_GOOD');
    expect(res.matchedCount).toBe(0);
  });

  // ── Test Case 2: Normal Case — SET_IN_ORDER all present ─────────────────────
  it('assigns VERY_GOOD to SET_IN_ORDER when all required organization evidence is detected', () => {
    const evidenceIds = ['LABEL', 'MACHINE', 'VISUAL_BOARD', 'TOOL'];
    const res = executePrecedenceChain('VISIBLE', evidenceIds, setInOrderQuestion, 'SET_IN_ORDER_Q1');
    expect(res.rating).toBe('VERY_GOOD');
    expect(res.matchedCount).toBe(4);
  });

  // ── Test Case 3: Boundary Case — exactly at average threshold ───────────────
  it('assigns AVERAGE when exactly 2 required items are detected (presence-is-good)', () => {
    const evidenceIds = ['LABEL', 'MACHINE'];
    const res = executePrecedenceChain('VISIBLE', evidenceIds, setInOrderQuestion, 'SET_IN_ORDER_Q1');
    expect(res.rating).toBe('AVERAGE');
    expect(res.matchedCount).toBe(2);
  });

  // ── Test Case 4: Missing Evidence ──────────────────────────────────────────
  it('correctly tracks missing required evidence keys', () => {
    const evidenceIds = ['LABEL', 'MACHINE'];
    const res = executePrecedenceChain('VISIBLE', evidenceIds, setInOrderQuestion, 'SET_IN_ORDER_Q1');
    expect(res.matchedEvidence).toEqual(['LABEL', 'MACHINE']);
    expect(res.missingEvidence).toEqual(['VISUAL_BOARD', 'TOOL']);
  });

  // ── Test Case 5: Forbidden Evidence excluded ────────────────────────────────
  it('isolates forbidden evidence and excludes it from counts', () => {
    // MACHINE and LABEL are required. WASTE_BIN is forbidden.
    const evidenceIds = ['LABEL', 'MACHINE', 'WASTE_BIN'];
    const res = executePrecedenceChain('VISIBLE', evidenceIds, setInOrderQuestion, 'SET_IN_ORDER_Q1');
    // Matched count should still be 2 (WASTE_BIN is forbidden so excluded)
    expect(res.matchedCount).toBe(2);
    expect(res.forbiddenEvidence).toEqual(['WASTE_BIN']);
    expect(res.rating).toBe('AVERAGE');
  });

  // ── Test Case 6: Unknown Evidence ──────────────────────────────────────────
  it('ignores invalid/unknown evidence and logs a warning without crashing', () => {
    const evidenceIds = ['LABEL', 'MACHINE', 'INVALID_KEY_XYZ', 'UNKNOWN_OBJECT'];
    const res = executePrecedenceChain('VISIBLE', evidenceIds, setInOrderQuestion, 'SET_IN_ORDER_Q1');
    expect(res.matchedCount).toBe(2);
    expect(res.rating).toBe('AVERAGE');
  });

  // ── Test Case 7: NOT_VISIBLE ────────────────────────────────────────────────
  it('returns NOT_SCORED immediately if the question is marked NOT_VISIBLE', () => {
    const evidenceIds = ['LABEL', 'MACHINE', 'VISUAL_BOARD', 'TOOL'];
    const res = executePrecedenceChain('NOT_VISIBLE', evidenceIds, setInOrderQuestion, 'SET_IN_ORDER_Q1');
    expect(res.rating).toBe('NOT_SCORED');
    expect(res.matchedCount).toBe(0);
    expect(res.matchedRule).toBe('visibility_bypass');
  });

});
