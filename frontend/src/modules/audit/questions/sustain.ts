/**
 * src/modules/audit/questions/sustain.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — SUSTAIN Pillar: Enriched Question Configuration
 *
 * 4 questions (SUSTAIN_Q1 – SUSTAIN_Q4).
 * All original question text, IDs, guidance, and pillar assignments are preserved.
 * Each question is enriched with: evidence, scoring.thresholds, metadata.
 *
 * SCORING NOTE (for the Rule Engine, Sprint 6.2):
 *   SUSTAIN questions are "presence-is-good" — more sustainability evidence = better.
 *   thresholds: veryGood=4 matches (comprehensive visual management), veryBad=0 (none).
 */

import type { EnrichedAuditQuestion } from '../ruleConfiguration/questionTypes';

export const SUSTAIN_QUESTIONS: EnrichedAuditQuestion[] = [

  // ── SUSTAIN_Q1 ────────────────────────────────────────────────────────────
  {
    id:       'SUSTAIN_Q1',
    pillar:   'SUSTAIN',
    question: 'Are 5S audit boards, workplace performance boards, audit schedules, KPI boards, or other visual management displays visibly present and maintained?',
    guidance: {
      evaluate: [
        '5S audit boards',
        'KPI boards',
        'Daily management boards',
        'Audit schedules',
        'Performance boards',
        'Workplace information boards',
        'Visual management displays',
      ],
      ignore: [
        'Audit frequency',
        'Audit effectiveness',
        'Whether audits are actually conducted',
        'Information outside the image',
      ],
      notes: [
        'Evaluate only the visible presence and organization of these boards.',
        'Do not judge whether the information displayed is current.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No audit boards or performance boards are visible in the image.',
      },
    },
    evidence: {
      required:  ['AUDIT_BOARD', 'VISUAL_BOARD'],
      optional:  ['KAIZEN_BOARD', 'INSPECTION_CHECKLIST', 'SOP_BOARD'],
      forbidden: [],
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 4 },
        good:     { matchedEvidence: 3 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 1 },
        veryBad:  { matchedEvidence: 0 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sustain', 'audit-boards', 'kpi', 'performance', 'visual-management'],
    },
  },

  // ── SUSTAIN_Q2 ────────────────────────────────────────────────────────────
  {
    id:       'SUSTAIN_Q2',
    pillar:   'SUSTAIN',
    question: 'Are improvement boards, Kaizen boards, suggestion boards, corrective action displays, or continuous improvement information visibly displayed and organized?',
    guidance: {
      evaluate: [
        'Kaizen boards',
        'Suggestion boards',
        'Improvement boards',
        'Corrective action displays',
        'Continuous improvement boards',
        'Visual improvement tracking',
      ],
      ignore: [
        'Whether improvements are completed',
        'Employee participation',
        'Improvement effectiveness',
      ],
      notes: [
        'Evaluate only whether continuous improvement is visibly supported through visual management.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No Kaizen or improvement boards are visible in the image.',
      },
    },
    evidence: {
      required:  ['KAIZEN_BOARD', 'VISUAL_BOARD'],
      optional:  ['AUDIT_BOARD', 'DOCUMENT', 'LABEL'],
      forbidden: [],
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 4 },
        good:     { matchedEvidence: 3 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 1 },
        veryBad:  { matchedEvidence: 0 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sustain', 'kaizen', 'improvement', 'suggestion-boards', 'continuous-improvement'],
    },
  },

  // ── SUSTAIN_Q3 ────────────────────────────────────────────────────────────
  {
    id:       'SUSTAIN_Q3',
    pillar:   'SUSTAIN',
    question: 'Does the workplace visually indicate that previous 5S improvements have been consistently maintained without obvious deterioration?',
    guidance: {
      evaluate: [
        'Maintained organization',
        'Maintained cleanliness',
        'Preserved labels',
        'Preserved floor markings',
        'Maintained storage organization',
        'No obvious deterioration',
      ],
      ignore: [
        'Historical workplace condition',
        'Previous audit results',
        'Long-term maintenance history',
      ],
      notes: [
        'Evaluate only visible evidence that improvements appear to have been maintained.',
        'Never compare with an earlier state that is not available.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Cannot assess maintenance of previous improvements from the provided image.',
      },
    },
    evidence: {
      required:  ['FLOOR_MARKING', 'LABEL', 'STORAGE_RACK'],
      optional:  ['SHADOW_BOARD', 'VISUAL_BOARD', 'WALKWAY'],
      forbidden: [],
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 4 },
        good:     { matchedEvidence: 3 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 1 },
        veryBad:  { matchedEvidence: 0 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sustain', 'maintenance', 'improvements', 'preservation', 'deterioration'],
    },
  },

  // ── SUSTAIN_Q4 ────────────────────────────────────────────────────────────
  {
    id:       'SUSTAIN_Q4',
    pillar:   'SUSTAIN',
    question: 'Does the overall workplace appearance indicate continuous adherence to 5S through consistently organized, clean, standardized, and well-maintained conditions?',
    guidance: {
      evaluate: [
        'Overall organization',
        'Overall cleanliness',
        'Overall standardization',
        'Overall maintenance',
        'Visual consistency',
      ],
      ignore: [
        'Employee discipline',
        'Team behaviour',
        'Company culture',
        'Management commitment',
        'Training',
        'Historical performance',
      ],
      notes: [
        'This question evaluates only the visible condition of the workplace.',
        'Never infer organizational culture or employee discipline.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Overall workplace condition cannot be assessed from the provided image.',
      },
    },
    evidence: {
      required:  ['FLOOR_MARKING', 'LABEL', 'VISUAL_BOARD'],
      optional:  ['AUDIT_BOARD', 'KAIZEN_BOARD', 'SOP_BOARD', 'WALKWAY'],
      forbidden: [],
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 4 },
        good:     { matchedEvidence: 3 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 1 },
        veryBad:  { matchedEvidence: 0 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sustain', 'overall', 'adherence', 'consistency', 'maintenance'],
    },
  },

];
