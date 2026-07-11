/**
 * src/modules/audit/questions/sort.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — SORT Pillar: Enriched Question Configuration
 *
 * 4 questions (SORT_Q1 – SORT_Q4).
 * All original question text, IDs, guidance, and pillar assignments are preserved.
 * Each question is enriched with: evidence, scoring.thresholds, metadata.
 *
 * SCORING NOTE (for the Rule Engine, Sprint 6.2):
 *   SORT questions are "absence-is-good" — fewer clutter items = better rating.
 *   thresholds: veryGood=0 matches (no clutter), veryBad=4+ matches (heavy clutter).
 */

import type { EnrichedAuditQuestion } from '../ruleConfiguration/questionTypes';

export const SORT_QUESTIONS: EnrichedAuditQuestion[] = [

  // ── SORT_Q1 ──────────────────────────────────────────────────────────────
  {
    id:       'SORT_Q1',
    pillar:   'SORT',
    question: 'Are unnecessary raw materials, containers, or miscellaneous items cluttering the workplace or occupying valuable working space?',
    guidance: {
      evaluate: [
        'Loose raw materials',
        'Excess inventory',
        'Unnecessary containers',
        'Miscellaneous items creating clutter',
        'Materials occupying valuable working space unnecessarily',
      ],
      ignore: [
        'Materials clearly required for production',
        'Properly stored production inventory',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Cannot determine presence of clutter from the provided image.',
      },
    },
    evidence: {
      required:  ['RAW_MATERIAL', 'CONTAINER', 'BOX'],
      optional:  ['PALLET', 'TRAY', 'MOBILE_TROLLEY'],
      forbidden: [],
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 0 },
        good:     { matchedEvidence: 1 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 3 },
        veryBad:  { matchedEvidence: 4 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sort', 'clutter', 'raw-materials', 'containers'],
    },
  },

  // ── SORT_Q2 ──────────────────────────────────────────────────────────────
  {
    id:       'SORT_Q2',
    pillar:   'SORT',
    question: 'Are unnecessary tools, trays, laboratory items, accessories, or portable equipment left in the work area instead of being stored in their designated locations?',
    guidance: {
      evaluate: [
        'Loose tools',
        'Empty trays',
        'Laboratory accessories',
        'Portable equipment',
        'Gloves',
        'Wrenches',
        'Scrapers',
        'Other accessories left unnecessarily',
      ],
      ignore: [
        'Tools currently being used',
        'Properly stored equipment',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Cannot determine tool placement from the provided image.',
      },
    },
    evidence: {
      required:  ['TOOL', 'TRAY'],
      optional:  ['MOBILE_TROLLEY', 'CONTAINER', 'STORAGE_RACK'],
      forbidden: ['SHADOW_BOARD', 'TOOL_HOLDER'],   // organised tools are not clutter
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 0 },
        good:     { matchedEvidence: 1 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 3 },
        veryBad:  { matchedEvidence: 4 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sort', 'tools', 'accessories', 'portable-equipment'],
    },
  },

  // ── SORT_Q3 ──────────────────────────────────────────────────────────────
  {
    id:       'SORT_Q3',
    pillar:   'SORT',
    question: 'Are unused, abandoned, or non-operational machines, furniture, worktables, shelving, packing equipment, or other large equipment occupying valuable workspace?',
    guidance: {
      evaluate: [
        'Old machines',
        'Idle equipment',
        'Empty shelving',
        'Unused worktables',
        'Packing equipment',
        'Furniture occupying unnecessary space',
      ],
      ignore: [
        'Machines actively being used',
      ],
      notes: [
        'Operational status cannot always be determined from a single image.',
        'Evaluate only visible evidence of abandonment or unnecessary occupation of workspace.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Cannot determine equipment operational status from the provided image.',
      },
    },
    evidence: {
      required:  ['MACHINE', 'SHELF', 'WORKSTATION'],
      optional:  ['CABINET', 'STORAGE_RACK', 'PALLET'],
      forbidden: [],
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 0 },
        good:     { matchedEvidence: 1 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 3 },
        veryBad:  { matchedEvidence: 4 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sort', 'equipment', 'machines', 'furniture', 'workspace'],
    },
  },

  // ── SORT_Q4 ──────────────────────────────────────────────────────────────
  {
    id:       'SORT_Q4',
    pillar:   'SORT',
    question: 'Are unnecessary, outdated, damaged, duplicate, or excessive documents, notices, procedures, drawings, or visual displays visible in the workplace?',
    guidance: {
      evaluate: [
        'Duplicate notices',
        'Damaged documents',
        'Excess paperwork',
        'Outdated visual displays',
        'Unnecessary posted instructions',
      ],
      ignore: [
        'Current, authorized documents',
        'Required safety postings',
      ],
      notes: [
        'Do NOT assume a document is obsolete simply because it exists.',
        'If there is no visible evidence of damage, duplication, or obsolescence, use the uncertainty response.',
      ],
      uncertaintyResponse: {
        visibility: 'NOT_VISIBLE',
        reason:     'Cannot determine document currency or necessity from the provided image.',
      },
    },
    evidence: {
      required:  ['DOCUMENT'],
      optional:  ['VISUAL_BOARD', 'SOP_BOARD', 'LABEL'],
      forbidden: ['AUDIT_BOARD', 'KAIZEN_BOARD', 'SAFETY_SIGN'],  // valid postings
    },
    scoring: {
      thresholds: {
        veryGood: { matchedEvidence: 0 },
        good:     { matchedEvidence: 1 },
        average:  { matchedEvidence: 2 },
        bad:      { matchedEvidence: 3 },
        veryBad:  { matchedEvidence: 4 },
      },
    },
    metadata: {
      version: '1.0',
      enabled: true,
      tags:    ['sort', 'documents', 'notices', 'visual-displays'],
    },
  },

];
