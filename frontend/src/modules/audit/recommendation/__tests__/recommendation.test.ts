/**
 * src/modules/audit/recommendation/__tests__/recommendation.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest Unit Tests for Recommendation Generator (Sprint 7)
 */

import { describe, it, expect } from 'vitest';
import { validateRecommendations } from '../recommendationValidator';
import { safeParseJson } from '../jsonValidator';
import { sortQuestionRecommendations } from '../recommendationPriority';
import type { QuestionScore, StandardizedObservation } from '@/types/analysis';

describe('Recommendation Generator Unit Tests', () => {

  const mockQuestionScores: QuestionScore[] = [
    {
      questionId:      'SORT_Q1',
      pillar:          'SORT',
      visibility:      'VISIBLE',
      rating:          'VERY_BAD', // low-rated -> requires rec
      score:           0,
      maxScore:        4,
      scoreEligible:   true,
      evaluationTrace: [],
    },
    {
      questionId:      'SORT_Q2',
      pillar:          'SORT',
      visibility:      'VISIBLE',
      rating:          'BAD', // low-rated -> requires rec
      score:           1,
      maxScore:        4,
      scoreEligible:   true,
      evaluationTrace: [],
    },
    {
      questionId:      'SET_IN_ORDER_Q3',
      pillar:          'SET_IN_ORDER',
      visibility:      'VISIBLE',
      rating:          'GOOD', // high-rated -> NO rec allowed!
      score:           3,
      maxScore:        4,
      scoreEligible:   true,
      evaluationTrace: [],
    },
  ];

  const mockObservations: StandardizedObservation[] = [
    {
      questionId:  'SORT_Q1',
      visible:     true,
      evidence:    ['Excess cardboard boxes block the central walkway.'],
      evidenceIds: ['BOX', 'WALKWAY', 'SHELF'],
      confidence:  90,
    },
    {
      questionId:  'SORT_Q2',
      visible:     true,
      evidence:    ['An industrial chemical container sits in the cabinet area.'],
      evidenceIds: ['CHEMICAL_CONTAINER', 'CABINET'],
      confidence:  90,
    },
    {
      questionId:  'SET_IN_ORDER_Q3',
      visible:     true,
      evidence:    ['Yellow floor markings are visible.'],
      evidenceIds: ['FLOOR_MARKING'],
      confidence:  95,
    },
  ];

  const createMockValidOutput = () => ({
    questionRecommendations: [
      {
        questionId: 'SORT_Q1',
        rating:     'VERY_BAD',
        issue:      'Excess boxes block walkways.',
        action:     'Move the boxes to shelves.',
      },
      {
        questionId: 'SORT_Q2',
        rating:     'BAD',
        issue:      'Chemical containers block the area.',
        action:     'Move chemical containers to cabinets.',
      },
    ],
    pillarRecommendations: [
      {
        pillar:   'SORT',
        summary:  'Pillar has clutter issues.',
        strategy: 'Remove boxes and chemicals.',
      },
    ],
    overallRecommendation: {
      summary:      'Workplace requires sorting improvements.',
      strengths:    ['Floor markings are tidy.'],
      improvements: ['Remove boxes.'],
      nextSteps:    ['Perform audit next week.'],
    },
  });

  // ── 1. JSON Parsing and Fence Stripping ────────────────────────────────────
  it('strips markdown backticks and parses valid JSON string', () => {
    const rawText = '```json\n{\n  "status": "ok"\n}\n```';
    const parsed = safeParseJson(rawText);
    expect(parsed).toEqual({ status: 'ok' });
  });

  // ── 2. Structural Content Validation ────────────────────────────────────────
  it('passes validation for complete, factually aligned standard output', () => {
    const valid = createMockValidOutput();
    expect(() => {
      validateRecommendations(valid, mockQuestionScores, mockObservations);
    }).not.toThrow();
  });

  it('throws validation error if overall summary is missing', () => {
    const invalid = createMockValidOutput();
    invalid.overallRecommendation.summary = ''; // Empty string
    expect(() => {
      validateRecommendations(invalid, mockQuestionScores, mockObservations);
    }).toThrow('RECOMMENDATION_VALIDATION_ERROR: "overallRecommendation.summary" is missing or empty.');
  });

  // ── 3. High Rating Constraint (No recommendations for GOOD/VERY_GOOD) ───────
  it('throws validation error if recommendation is generated for GOOD question', () => {
    const invalid = createMockValidOutput();
    invalid.questionRecommendations.push({
      questionId: 'SET_IN_ORDER_Q3', // Rated GOOD
      rating:     'GOOD',
      issue:      'Floor markings are good.',
      action:     'Keep it up.',
    });

    expect(() => {
      validateRecommendations(invalid, mockQuestionScores, mockObservations);
    }).toThrow('Recommendations are restricted to AVERAGE, BAD, and VERY_BAD ratings only.');
  });

  // ── 4. Rating Modification Prevention ───────────────────────────────────────
  it('throws validation error if Gemini modifies the assigned rating', () => {
    const invalid = createMockValidOutput();
    // In questionScores, SORT_Q1 is rated VERY_BAD. Let's modify it to BAD.
    invalid.questionRecommendations[0].rating = 'BAD';

    expect(() => {
      validateRecommendations(invalid, mockQuestionScores, mockObservations);
    }).toThrow('Rating mismatch for "SORT_Q1".');
  });

  // ── 5. Hallucination Detection (Unobserved objects) ──────────────────────────
  it('throws validation error if a recommendation references an unobserved object', () => {
    const invalid = createMockValidOutput();
    // "OFFICE_CHAIR" or "office chair" was NEVER observed in the mockObservations list.
    // Injected reference:
    invalid.questionRecommendations[0].issue = 'Excess boxes and an office chair block walkways.';

    expect(() => {
      validateRecommendations(invalid, mockQuestionScores, mockObservations);
    }).toThrow('contains a reference to unobserved object "office chair" (OFFICE_CHAIR).');
  });

  // ── 6. Deterministic Sorter ─────────────────────────────────────────────────
  it('prioritizes question recommendations correctly', () => {
    // Unsorted list: AVERAGE (lower priority) before VERY_BAD (high priority)
    const recs = [
      {
        questionId: 'SORT_Q4', // Visual Management
        rating:     'AVERAGE',
        issue:      'a',
        action:     'b',
      },
      {
        questionId: 'SORT_Q1', // Operational Efficiency
        rating:     'VERY_BAD',
        issue:      'c',
        action:     'd',
      },
      {
        questionId: 'SET_IN_ORDER_Q3', // Safety
        rating:     'VERY_BAD',
        issue:      'e',
        action:     'f',
      },
    ];

    const sorted = sortQuestionRecommendations(recs);

    // Expected order:
    // 1. VERY_BAD rating + Safety (SET_IN_ORDER_Q3)
    // 2. VERY_BAD rating + Operational Efficiency (SORT_Q1)
    // 3. AVERAGE rating + Visual Management (SORT_Q4)
    expect(sorted[0].questionId).toBe('SET_IN_ORDER_Q3');
    expect(sorted[1].questionId).toBe('SORT_Q1');
    expect(sorted[2].questionId).toBe('SORT_Q4');
  });

});
