/**
 * src/modules/audit/ruleConfiguration/evidenceVocabulary.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 6.1 — Rule Configuration Engine: Standardised Evidence Vocabulary
 *
 * ROLE:
 *   Defines the canonical set of identifiers for every type of workplace object
 *   that the pipeline may detect, reference, or evaluate.
 *
 * USAGE:
 *   • Gemini Vision Analyzer uses these as the authoritative reference for objects.
 *   • Structured Observation Engine references these when matching objects.
 *   • Evidence Configuration in each question uses EvidenceKey values.
 *   • Rule Engine consumes these to match detected objects deterministically.
 *
 * DESIGN:
 *   - EVIDENCE_VOCABULARY maps every key to a human-readable display name.
 *   - EvidenceKey is the TypeScript type derived from that map.
 *   - No module should create custom object identifiers outside this vocabulary.
 *   - To add new object types, add them here first — never inline.
 *
 * CATEGORIES:
 *   Furniture & Workstations      — OFFICE_CHAIR, WORKSTATION, CABINET, STORAGE_RACK
 *   Equipment & Machinery         — MACHINE, PIPE, SPILL_PALLET, PALLET, SHELF
 *   Storage & Materials           — RAW_MATERIAL, BOX, CONTAINER, INVENTORY_LABEL
 *   Tools & Accessories           — TOOL, TRAY, SHADOW_BOARD, TOOL_HOLDER
 *   Cleaning Supplies             — CLEANING_TOOL, BROOM, MOP
 *   Visual Management             — LABEL, DOCUMENT, VISUAL_BOARD, AUDIT_BOARD, KAIZEN_BOARD
 *                                   SOP_BOARD, INSPECTION_CHECKLIST
 *   Safety & Compliance           — SAFETY_SIGN, PPE_STATION, FIRE_EXTINGUISHER
 *   Transport & Logistics         — MOBILE_TROLLEY, CHEMICAL_CONTAINER
 *   Floor & Space                 — FLOOR_MARKING, WALKWAY, WASTE_BIN
 */

// ── Vocabulary map ────────────────────────────────────────────────────────────

export const EVIDENCE_VOCABULARY = {

  // Furniture & Workstations
  OFFICE_CHAIR:          'Office Chair',
  WORKSTATION:           'Workstation',
  CABINET:               'Cabinet',
  STORAGE_RACK:          'Storage Rack',

  // Equipment & Machinery
  MACHINE:               'Machine',
  PIPE:                  'Pipe',
  SPILL_PALLET:          'Spill Pallet',
  PALLET:                'Pallet',
  SHELF:                 'Shelf',

  // Storage & Materials
  RAW_MATERIAL:          'Raw Material',
  BOX:                   'Box',
  CONTAINER:             'Container',
  INVENTORY_LABEL:       'Inventory Label',

  // Tools & Accessories
  TOOL:                  'Tool',
  TRAY:                  'Tray',
  SHADOW_BOARD:          'Shadow Board',
  TOOL_HOLDER:           'Tool Holder',

  // Cleaning Supplies
  CLEANING_TOOL:         'Cleaning Tool',
  BROOM:                 'Broom',
  MOP:                   'Mop',

  // Visual Management
  LABEL:                 'Label',
  DOCUMENT:              'Document',
  VISUAL_BOARD:          'Visual Board',
  AUDIT_BOARD:           'Audit Board',
  KAIZEN_BOARD:          'Kaizen Board',
  SOP_BOARD:             'SOP Board',
  INSPECTION_CHECKLIST:  'Inspection Checklist',

  // Safety & Compliance
  SAFETY_SIGN:           'Safety Sign',
  PPE_STATION:           'PPE Station',
  FIRE_EXTINGUISHER:     'Fire Extinguisher',

  // Transport & Logistics
  MOBILE_TROLLEY:        'Mobile Trolley',
  CHEMICAL_CONTAINER:    'Chemical Container',

  // Floor & Space
  FLOOR_MARKING:         'Floor Marking',
  WALKWAY:               'Walkway',
  WASTE_BIN:             'Waste Bin',

} as const;

// ── Derived type ──────────────────────────────────────────────────────────────

/**
 * TypeScript type representing any valid evidence key.
 * Used in EvidenceConfiguration.required / optional / forbidden arrays.
 *
 * Example: 'FLOOR_MARKING', 'MACHINE', 'LABEL'
 */
export type EvidenceKey = keyof typeof EVIDENCE_VOCABULARY;

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns the human-readable display name for an EvidenceKey.
 * Example: displayName('FLOOR_MARKING') → 'Floor Marking'
 */
export function displayName(key: EvidenceKey): string {
  return EVIDENCE_VOCABULARY[key];
}

/**
 * Returns true if the given string is a valid EvidenceKey.
 * Used by validators to reject unknown identifiers.
 */
export function isValidEvidenceKey(value: string): value is EvidenceKey {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_VOCABULARY, value);
}

/** Total number of registered evidence keys. */
export const VOCABULARY_SIZE = Object.keys(EVIDENCE_VOCABULARY).length;
