/**
 * src/modules/audit/questions/standardize.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — STANDARDIZE Pillar: Enriched Question Configuration
 *
 * 4 questions (STANDARDIZE_Q1 – STANDARDIZE_Q4).
 * All original question text, IDs, guidance, and pillar assignments are preserved.
 * Each question is enriched with: evidence, scoring.thresholds, metadata.
 *
 * SCORING NOTE (for the Rule Engine, Sprint 6.2):
 *   STANDARDIZE questions are "presence-is-good" — more standardisation evidence = better.
 *   thresholds: veryGood=4 matches (comprehensive standards), veryBad=0 (none visible).
 */

import type { EnrichedAuditQuestion } from '../ruleConfiguration/questionTypes';

export const STANDARDIZE_QUESTIONS: EnrichedAuditQuestion[] = [

  // ── STANDARDIZE_Q1 ────────────────────────────────────────────────────────
  {
    id:       'STANDARDIZE_Q1',
    pillar:   'STANDARDIZE',
    question: 'Are areas, tools, machines, piping, equipment, and storage locations consistently identified using visible labels, color coding, markings, or standardized visual identification systems?',
    guidance: {
      evaluate: [
        'Area labels',
        'Equipment labels',
        'Machine identification',
        'Pipe identification',
        'Color coding',
        'Storage labels',
        'Shelf labels',
        'Standardized markings',
      ],
      ignore: [
        'Labels too small to read',
        'Hidden equipment',
        'Areas outside the captured image',
      ],
      notes: [
        'Evaluate the consistency and visibility of the identification system.',
        'Labels do not need to be readable if they are clearly visible.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No consistent visual identification system is visible in the image.',
      },
    },
    evidence: {
      required:  ['LABEL', 'FLOOR_MARKING', 'INVENTORY_LABEL'],
      optional:  ['MACHINE', 'PIPE', 'SHELF', 'STORAGE_RACK', 'SHADOW_BOARD'],
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
      tags:    ['standardize', 'labels', 'color-coding', 'identification', 'markings'],
    },
  },

  // ── STANDARDIZE_Q2 ────────────────────────────────────────────────────────
  {
    id:       'STANDARDIZE_Q2',
    pillar:   'STANDARDIZE',
    question: 'Are cleaning instructions, inspection checklists, visual standards, or workplace organization standards visibly displayed and easily identifiable within the workplace?',
    guidance: {
      evaluate: [
        'Cleaning instruction boards',
        'Inspection checklists',
        'Visual work standards',
        'Organization standards',
        'Visual management boards',
        'Standard operating boards',
      ],
      ignore: [
        'Whether employees follow them',
        'Cleaning frequency',
        'Hidden documents',
      ],
      notes: [
        'Evaluate only whether visible standards are present.',
        'Do not evaluate compliance with those standards.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No cleaning instructions or visual standards are visible in the image.',
      },
    },
    evidence: {
      required:  ['INSPECTION_CHECKLIST', 'VISUAL_BOARD', 'SOP_BOARD'],
      optional:  ['AUDIT_BOARD', 'LABEL', 'DOCUMENT'],
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
      tags:    ['standardize', 'cleaning-instructions', 'checklists', 'visual-standards'],
    },
  },

  // ── STANDARDIZE_Q3 ────────────────────────────────────────────────────────
  {
    id:       'STANDARDIZE_Q3',
    pillar:   'STANDARDIZE',
    question: 'Are operating procedures, production rules, safety instructions, PPE requirements, or emergency information visibly displayed, organized, and accessible within the workplace?',
    guidance: {
      evaluate: [
        'SOP boards',
        'Production rules',
        'Safety signs',
        'PPE instructions',
        'Emergency procedures',
        'Operating procedures',
        'Safety posters',
      ],
      ignore: [
        'Whether workers follow them',
        'Small unreadable text',
        'Document contents',
      ],
      notes: [
        'Evaluate visibility and accessibility only.',
        'Do not judge procedural compliance.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No operating procedures or safety information is visible in the image.',
      },
    },
    evidence: {
      required:  ['SOP_BOARD', 'SAFETY_SIGN', 'PPE_STATION'],
      optional:  ['FIRE_EXTINGUISHER', 'VISUAL_BOARD', 'DOCUMENT'],
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
      tags:    ['standardize', 'sop', 'safety', 'ppe', 'procedures', 'emergency'],
    },
  },

  // ── STANDARDIZE_Q4 ────────────────────────────────────────────────────────
  {
    id:       'STANDARDIZE_Q4',
    pillar:   'STANDARDIZE',
    question: 'Are consumables, raw materials, storage containers, or inventory locations visibly organized using standardized labels, quantity indicators, storage methods, or visual inventory controls?',
    guidance: {
      evaluate: [
        'Inventory labels',
        'Quantity labels',
        'Storage labels',
        'Bin labels',
        'Material identification',
        'Standardized storage',
        'Inventory markings',
      ],
      ignore: [
        'Stock levels',
        'Replenishment process',
        'Supply chain',
        'Internal inventory management',
      ],
      notes: [
        'Evaluate only visible inventory standardization.',
        'Never assume inventory management practices.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No standardized inventory labels or storage systems are visible in the image.',
      },
    },
    evidence: {
      required:  ['INVENTORY_LABEL', 'LABEL', 'STORAGE_RACK'],
      optional:  ['RAW_MATERIAL', 'CONTAINER', 'BOX', 'SHELF', 'PALLET'],
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
      tags:    ['standardize', 'inventory', 'labels', 'storage', 'consumables'],
    },
  },

];
