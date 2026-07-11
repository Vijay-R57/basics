/**
 * src/modules/audit/questions/shine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — SHINE Pillar: Enriched Question Configuration
 *
 * 4 questions (SHINE_Q1 – SHINE_Q4).
 * All original question text, IDs, guidance, and pillar assignments are preserved.
 * Each question is enriched with: evidence, scoring.thresholds, metadata.
 *
 * SCORING NOTE (for the Rule Engine, Sprint 6.2):
 *   SHINE questions are "presence-is-good" — more cleanliness evidence = better.
 *   thresholds: veryGood=4 matches (fully visible cleanliness), veryBad=0 (none).
 */

import type { EnrichedAuditQuestion } from '../ruleConfiguration/questionTypes';

export const SHINE_QUESTIONS: EnrichedAuditQuestion[] = [

  // ── SHINE_Q1 ──────────────────────────────────────────────────────────────
  {
    id:       'SHINE_Q1',
    pillar:   'SHINE',
    question: 'Are cleaning tools, cleaning equipment, or cleaning materials visibly available, properly stored, and easily accessible for maintaining workplace cleanliness?',
    guidance: {
      evaluate: [
        'Cleaning tools',
        'Brooms',
        'Mops',
        'Cleaning kits',
        'Cleaning equipment',
        'Cleaning material storage',
        'Easily accessible cleaning supplies',
      ],
      ignore: [
        'Hidden storage',
        'Cleaning schedules',
        'Cleaning equipment outside the image',
      ],
      notes: [
        'Evaluate only the visible availability and accessibility of cleaning tools.',
        'Do not assume cleaning tools are missing simply because they are not visible.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No cleaning tools or cleaning equipment are visible in the image.',
      },
    },
    evidence: {
      required:  ['CLEANING_TOOL', 'BROOM', 'MOP'],
      optional:  ['WASTE_BIN', 'STORAGE_RACK', 'CABINET'],
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
      tags:    ['shine', 'cleaning-tools', 'cleanliness', 'broom', 'mop'],
    },
  },

  // ── SHINE_Q2 ──────────────────────────────────────────────────────────────
  {
    id:       'SHINE_Q2',
    pillar:   'SHINE',
    question: 'Do machines, workstations, piping, cabinets, shelves, and surrounding equipment appear visibly clean and free from excessive dust, dirt, spills, stains, leaks, or contamination?',
    guidance: {
      evaluate: [
        'Dust',
        'Dirt',
        'Oil stains',
        'Chemical spills',
        'Rust',
        'Surface cleanliness',
        'Equipment cleanliness',
        'Visible leaks',
      ],
      ignore: [
        'Maintenance history',
        'Cleaning schedules',
        'Internal contamination',
        'Equipment outside the image',
      ],
      notes: [
        'Evaluate only visible cleanliness.',
        'Do not assume equipment is dirty because it is old.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Equipment cleanliness cannot be assessed from the provided image.',
      },
    },
    evidence: {
      required:  ['MACHINE', 'WORKSTATION', 'SHELF'],
      optional:  ['PIPE', 'CABINET', 'STORAGE_RACK', 'SPILL_PALLET'],
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
      tags:    ['shine', 'equipment', 'machines', 'cleanliness', 'contamination'],
    },
  },

  // ── SHINE_Q3 ──────────────────────────────────────────────────────────────
  {
    id:       'SHINE_Q3',
    pillar:   'SHINE',
    question: 'Do floors, walls, aisles, walkways, mezzanine areas, and scrap areas appear visibly clean, well maintained, and free from excessive dirt, waste, spills, or debris?',
    guidance: {
      evaluate: [
        'Floor cleanliness',
        'Walls',
        'Walkways',
        'Scrap areas',
        'Debris',
        'Waste',
        'Dust',
        'Visible spills',
      ],
      ignore: [
        'Hidden areas',
        'Areas outside the captured image',
        'Cleaning schedules',
      ],
      notes: [
        'Evaluate only the visible portion of the workplace.',
        'Missing visibility should not automatically reduce the rating.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Floor and wall cleanliness cannot be assessed from the provided image.',
      },
    },
    evidence: {
      required:  ['WALKWAY', 'FLOOR_MARKING'],
      optional:  ['WASTE_BIN', 'SPILL_PALLET'],
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
      tags:    ['shine', 'floors', 'walkways', 'cleanliness', 'debris'],
    },
  },

  // ── SHINE_Q4 ──────────────────────────────────────────────────────────────
  {
    id:       'SHINE_Q4',
    pillar:   'SHINE',
    question: 'Does the workplace visually indicate that cleanliness is consistently maintained through visible housekeeping practices and the absence of accumulated waste or neglected areas?',
    guidance: {
      evaluate: [
        'General housekeeping',
        'Maintained appearance',
        'No accumulated waste',
        'No neglected areas',
        'Overall visible cleanliness',
      ],
      ignore: [
        'Employee behaviour',
        'Team discipline',
        'Cleaning frequency',
        'Cleaning culture',
      ],
      notes: [
        'Never infer employee behaviour.',
        'Evaluate only the visible condition of the workplace.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Overall housekeeping condition cannot be assessed from the provided image.',
      },
    },
    evidence: {
      required:  ['WASTE_BIN', 'CLEANING_TOOL'],
      optional:  ['WALKWAY', 'FLOOR_MARKING', 'STORAGE_RACK'],
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
      tags:    ['shine', 'housekeeping', 'cleanliness', 'maintenance', 'overall'],
    },
  },

];
