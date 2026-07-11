/**
 * src/modules/audit/pipeline/questions.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all audit questions sent to Gemini.
 *
 * ARCHITECTURE:
 *  - Questions are organized by pillar (SORT, SET_IN_ORDER, SHINE, etc.)
 *  - Each question optionally includes evaluation guidance for the AI
 *  - The prompt builder in analysisPipeline.ts reads this configuration
 *    and dynamically constructs the Gemini prompt
 *  - No evaluation logic should be hardcoded anywhere else in the project
 *
 * GUIDANCE FIELDS:
 *  - evaluate:             What to look for in the image
 *  - ignore:               What should NOT be treated as a problem
 *  - notes:                Optional additional context for ambiguous situations
 *  - uncertaintyResponse:  What to return when evidence is insufficient
 */

export type AuditPillarKey =
  | 'SORT'
  | 'SET_IN_ORDER'
  | 'SHINE'
  | 'STANDARDIZE'
  | 'SUSTAIN';

// ── Guidance types ────────────────────────────────────────────────────────────

export interface AuditUncertaintyResponse {
  rating: 'AVERAGE';
  confidence: number;
  reason: string;
}

export interface AuditQuestionGuidance {
  /** What to evaluate — visible evidence the AI should look for */
  evaluate: string[];
  /** What to ignore — items that should NOT be flagged */
  ignore: string[];
  /** Optional contextual notes to improve AI reasoning */
  notes?: string[];
  /** Response to use when the question cannot be assessed from the image */
  uncertaintyResponse: AuditUncertaintyResponse;
}

// ── Question type ─────────────────────────────────────────────────────────────

export interface AuditQuestion {
  pillar: AuditPillarKey;
  id: string;
  question: string;
  /** Optional per-question evaluation guidance for the AI prompt */
  guidance?: AuditQuestionGuidance;
}

// ── Pillar-keyed question definitions ─────────────────────────────────────────
//
// Each pillar contains only its own question definitions.
// SORT has full guidance; other pillars use simple questions (guidance TBD).

export const AUDIT_QUESTIONS: Record<AuditPillarKey, AuditQuestion[]> = {

  // ── SORT ──────────────────────────────────────────────────────────────────
  SORT: [
    {
      pillar: 'SORT',
      id: 'SORT_Q1',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SORT',
      id: 'SORT_Q2',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SORT',
      id: 'SORT_Q3',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SORT',
      id: 'SORT_Q4',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
  ],

  // ── SET IN ORDER ──────────────────────────────────────────────────────────
  SET_IN_ORDER: [
    {
      pillar: 'SET_IN_ORDER',
      id: 'SET_IN_ORDER_Q1',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SET_IN_ORDER',
      id: 'SET_IN_ORDER_Q2',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SET_IN_ORDER',
      id: 'SET_IN_ORDER_Q3',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SET_IN_ORDER',
      id: 'SET_IN_ORDER_Q4',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
  ],

  // ── SHINE ─────────────────────────────────────────────────────────────────
  SHINE: [
    {
      pillar: 'SHINE',
      id: 'SHINE_Q1',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SHINE',
      id: 'SHINE_Q2',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SHINE',
      id: 'SHINE_Q3',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SHINE',
      id: 'SHINE_Q4',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
  ],

  // ── STANDARDIZE ───────────────────────────────────────────────────────────
  STANDARDIZE: [
    {
      pillar: 'STANDARDIZE',
      id: 'STANDARDIZE_Q1',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'STANDARDIZE',
      id: 'STANDARDIZE_Q2',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'STANDARDIZE',
      id: 'STANDARDIZE_Q3',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'STANDARDIZE',
      id: 'STANDARDIZE_Q4',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
  ],

  // ── SUSTAIN ───────────────────────────────────────────────────────────────
  SUSTAIN: [
    {
      pillar: 'SUSTAIN',
      id: 'SUSTAIN_Q1',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SUSTAIN',
      id: 'SUSTAIN_Q2',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SUSTAIN',
      id: 'SUSTAIN_Q3',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
    {
      pillar: 'SUSTAIN',
      id: 'SUSTAIN_Q4',
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
          rating: 'AVERAGE',
          confidence: 30,
          reason: 'Cannot be determined from the provided image.',
        },
      },
    },
  ],
};

// ── Ordered pillar keys ───────────────────────────────────────────────────────

/** Ordered list of pillar keys — controls prompt and validation order */
export const PILLAR_ORDER: AuditPillarKey[] = [
  'SORT',
  'SET_IN_ORDER',
  'SHINE',
  'STANDARDIZE',
  'SUSTAIN',
];

/** Map pillar key → JSON key used in Gemini response */
export const PILLAR_TO_JSON_KEY: Record<AuditPillarKey, string> = {
  SORT: 'sort',
  SET_IN_ORDER: 'set_in_order',
  SHINE: 'shine',
  STANDARDIZE: 'standardize',
  SUSTAIN: 'sustain',
};

// ── Helper: Flatten to array ──────────────────────────────────────────────────

/**
 * Returns all audit questions as a flat array, ordered by PILLAR_ORDER.
 * Backward-compatible replacement for the old `AUDIT_QUESTIONS: AuditQuestion[]`.
 * Used by consumers that need a simple iterable list (auditMapper, execution panel).
 */
export function getAllQuestions(): AuditQuestion[] {
  return PILLAR_ORDER.flatMap(pillar => AUDIT_QUESTIONS[pillar]);
}

/** Total expected questions (used in validation) */
export const TOTAL_QUESTIONS = PILLAR_ORDER.reduce(
  (sum, pillar) => sum + AUDIT_QUESTIONS[pillar].length,
  0,
); // 20

/** Questions per pillar (used in validation) */
export const QUESTIONS_PER_PILLAR = 4;

// ── Sprint 6.1 — Backward Compatibility Bridge ───────────────────────────────
//
// All modules that import from this file continue to work unchanged.
//
// New modules should import from:
//   @/modules/audit/ruleConfiguration (the public API)
//
// This bridge is intentionally minimal — it does NOT re-export the new
// EnrichedAuditQuestion type or registry functions, to avoid circular imports.
// Consumers that need the enriched configuration should migrate to
// the ruleConfiguration/index.ts public API.
//
// The following export is provided for validation and testing convenience only:

/** @deprecated Use loadQuestionConfiguration() from ruleConfiguration/index.ts */
export { getAllEnabledQuestions as getEnabledQuestionsFromRegistry } from '../ruleConfiguration/questionLoader';

