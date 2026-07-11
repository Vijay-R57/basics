/**
 * src/modules/audit/questions/setInOrder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — SET IN ORDER Pillar: Enriched Question Configuration
 *
 * 4 questions (SET_IN_ORDER_Q1 – SET_IN_ORDER_Q4).
 * All original question text, IDs, guidance, and pillar assignments are preserved.
 * Each question is enriched with: evidence, scoring.thresholds, metadata.
 *
 * SCORING NOTE (for the Rule Engine, Sprint 6.2):
 *   SET_IN_ORDER questions are "presence-is-good" — more organisation evidence = better.
 *   thresholds: veryGood=4 matches (extensive organisation), veryBad=0 (none visible).
 */

import type { EnrichedAuditQuestion } from '../ruleConfiguration/questionTypes';

export const SET_IN_ORDER_QUESTIONS: EnrichedAuditQuestion[] = [

  // ── SET_IN_ORDER_Q1 ───────────────────────────────────────────────────────
  {
    id:       'SET_IN_ORDER_Q1',
    pillar:   'SET_IN_ORDER',
    question: 'Are machines, production units, workstations, piping, production lines, or work areas clearly identified using visible labels, signs, markings, or other visual identification methods?',
    guidance: {
      evaluate: [
        'Machine identification labels',
        'Equipment nameplates',
        'Area identification boards',
        'Production line identification',
        'Pipe identification',
        'Department signs',
        'Workstation identification',
      ],
      ignore: [
        'Small text that cannot be read',
        'Areas outside the captured image',
        'Hidden equipment',
      ],
      notes: [
        'Labels do not need to be readable if they are clearly visible.',
        'Evaluate only whether visual identification exists.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No visible identification labels or signs detected in the image.',
      },
    },
    evidence: {
      required:  ['LABEL', 'MACHINE', 'VISUAL_BOARD'],
      optional:  ['PIPE', 'WORKSTATION', 'SOP_BOARD', 'SHADOW_BOARD'],
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
      tags:    ['set-in-order', 'labels', 'identification', 'machines', 'workstations'],
    },
  },

  // ── SET_IN_ORDER_Q2 ───────────────────────────────────────────────────────
  {
    id:       'SET_IN_ORDER_Q2',
    pillar:   'SET_IN_ORDER',
    question: 'Are tools, accessories, jigs, fixtures, and frequently used work items systematically organized so they can be easily located, accessed, and returned to their designated locations?',
    guidance: {
      evaluate: [
        'Tool organization',
        'Shadow boards',
        'Tool holders',
        'Designated storage locations',
        'Organized workstations',
        'Easily accessible equipment',
      ],
      ignore: [
        'Tools currently being used',
        'Equipment actively being operated',
      ],
      notes: [
        'Do not assume poor organization simply because tools are visible.',
        'Evaluate whether a logical storage system exists.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No tool organisation system is visible in the image.',
      },
    },
    evidence: {
      required:  ['TOOL', 'SHADOW_BOARD', 'TOOL_HOLDER'],
      optional:  ['WORKSTATION', 'SHELF', 'STORAGE_RACK', 'CABINET'],
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
      tags:    ['set-in-order', 'tools', 'shadow-board', 'storage', 'organisation'],
    },
  },

  // ── SET_IN_ORDER_Q3 ───────────────────────────────────────────────────────
  {
    id:       'SET_IN_ORDER_Q3',
    pillar:   'SET_IN_ORDER',
    question: 'Are floor markings, storage boundaries, walkways, aisles, scrap areas, safety zones, or storage locations clearly identified using visible lines, colors, labels, or signs?',
    guidance: {
      evaluate: [
        'Floor markings',
        'Yellow safety lines',
        'Walkways',
        'Storage boundaries',
        'Scrap areas',
        'Safety zones',
        'Shelf labels',
        'Quantity labels',
      ],
      ignore: [
        'Areas outside the captured image',
        'Floor areas hidden by equipment',
      ],
      notes: [
        'Evaluate only the visible portion of the floor.',
        'Missing floor visibility should not automatically reduce the rating.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Floor markings and boundary indicators are not visible in the image.',
      },
    },
    evidence: {
      required:  ['FLOOR_MARKING', 'WALKWAY'],
      optional:  ['LABEL', 'SAFETY_SIGN', 'WASTE_BIN', 'STORAGE_RACK'],
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
      tags:    ['set-in-order', 'floor-markings', 'walkways', 'boundaries', 'safety-zones'],
    },
  },

  // ── SET_IN_ORDER_Q4 ───────────────────────────────────────────────────────
  {
    id:       'SET_IN_ORDER_Q4',
    pillar:   'SET_IN_ORDER',
    question: 'Are essential work documents, operating procedures, instructions, records, or visual management materials neatly organized, clearly identified, and easily accessible?',
    guidance: {
      evaluate: [
        'SOP displays',
        'Work instructions',
        'Operating procedures',
        'Visual management boards',
        'Organized documents',
        'Clearly labelled files',
        'Information boards',
      ],
      ignore: [
        'Document contents that cannot be read',
        'Closed cabinets',
        'Areas outside the captured image',
      ],
      notes: [
        'The presence of documents alone is not sufficient.',
        'Evaluate whether they appear organized and clearly identified.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'No visual management materials or organized documents are visible.',
      },
    },
    evidence: {
      required:  ['SOP_BOARD', 'VISUAL_BOARD', 'DOCUMENT'],
      optional:  ['AUDIT_BOARD', 'INSPECTION_CHECKLIST', 'LABEL'],
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
      tags:    ['set-in-order', 'documents', 'sop', 'visual-management', 'procedures'],
    },
  },

];
