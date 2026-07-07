/**
 * supabase/functions/analyze-5s/audit-engine/EvidenceCapabilityMatrix.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Evidence Capability Matrix (ECM) — Recommendation 11 / Engine v5.0
 *
 * Defines WHAT evidence is permitted to influence each audit question.
 * The EvidenceFilterService enforces these rules before any reasoning begins,
 * preventing evidence leakage between unrelated questions.
 *
 * Each entry defines:
 *  - allowedCategories:    Object category codes (A/B/C/D) permitted as evidence
 *  - requiredObjectTypes:  Objects that MUST be visible to fully evaluate the question
 *  - primaryEvidence:      High-weight (1.0) directly relevant objects
 *  - supportingEvidence:   Medium-weight (0.7) contextually relevant objects
 *  - forbiddenObjectTypes: Objects that must NEVER influence this question's rating
 *  - objectAliases:        Canonical label → list of alternative phrasings (Stage 3 matching)
 *  - evidencePriority:     Tiered confidence model (L1→L4)
 *
 * Matrix version: 1.0
 *
 * Design invariants:
 *  - Zero prompt content
 *  - Zero score values
 *  - Zero zone names
 *  - All 20 questions must have exactly one entry
 *  - Forbidden sets must not overlap with allowed sets for the same question
 */

import type { EvidenceCapabilityEntry, ObjectCategory } from './types.ts';

export const ECM_VERSION = '1.0';

// ── Object vocabulary shared across multiple questions ─────────────────────────
// Used for alias mapping and Stage 3 semantic matching

const FLOOR_MARKING_ALIASES = ['floor tape', 'floor line', 'aisle line', 'floor stripe', 'painted line', 'floor boundary', 'aisle marking', 'walkway line'];
const LABEL_ALIASES         = ['tag', 'sticker', 'identifier', 'nameplate', 'marking', 'placard', 'identification plate', 'engraved name'];
const CLEANING_TOOL_ALIASES = ['broom', 'mop', 'brush', 'squeegee', 'wipe', 'dustpan', 'vacuum cleaner', 'cleaning cloth', 'scrubber', 'dust brush'];
const DOCUMENT_ALIASES      = ['SOP', 'work instruction', 'procedure', 'manual', 'form', 'checklist', 'notice', 'instruction sheet', 'visual aid'];
const AUDIT_BOARD_ALIASES   = ['5S board', '5s chart', 'performance board', 'quality board', 'KPI board', 'metric board', 'results board'];
const KAIZEN_BOARD_ALIASES  = ['improvement board', 'action board', 'suggestion board', 'change board', 'PDCA board', 'problem board'];
const DRUM_ALIASES          = ['barrel', 'container', 'IBC', 'tank', 'tote', 'canister', 'vessel', 'bin'];
const MACHINE_ALIASES       = ['equipment', 'apparatus', 'device', 'unit', 'press', 'conveyor', 'pump', 'motor', 'lathe', 'grinder'];

// ── Complete 20-question ECM ───────────────────────────────────────────────────

const MATRIX: EvidenceCapabilityEntry[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // SORT (Seiri)
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId: 'SORT-01',
    allowedCategories: ['C', 'D'] as ObjectCategory[],
    requiredObjectTypes: ['item', 'material', 'container', 'inventory', 'document pile'],
    primaryEvidence: [
      'clutter', 'unnecessary item', 'raw material', 'drum', 'barrel', 'container', 'pallet',
      'finished product', 'waste material', 'stacked documents', 'abandoned item',
    ],
    supportingEvidence: [
      'crowded shelf', 'overloaded rack', 'excess stock', 'overflow storage', 'floor obstruction',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'floor tape', 'label', 'sign', 'cleaning tool', 'mop', 'broom',
      'audit board', 'kaizen board', 'SOP', 'work instruction', 'machine', 'equipment',
    ],
    objectAliases: {
      'drum':      DRUM_ALIASES,
      'container': ['bin', 'box', 'crate', 'tote', 'carton', 'package', 'drum', 'barrel', ...DRUM_ALIASES],
      'document pile': ['paper stack', 'file pile', 'binder stack', 'loose papers'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Directly visible unnecessary item (Category D)',          examples: ['chemical drum in walkway', 'loose pallet blocking aisle'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Item appears displaced or out of designated area',       examples: ['box on floor outside storage zone', 'excess raw material stack'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Item visible but purpose unclear',                       examples: ['partially visible container'], maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No unnecessary items visible',                           examples: [],                             maxRating: 'NOT_VISIBLE' },
    ],
  },

  {
    questionId: 'SORT-02',
    allowedCategories: ['B', 'C', 'D'] as ObjectCategory[],
    requiredObjectTypes: ['tool', 'tray', 'accessory'],
    primaryEvidence: [
      'hand tool', 'power tool', 'tray', 'mould', 'die', 'jig', 'fixture', 'accessory',
      'portable equipment', 'toolbox', 'maintenance kit',
    ],
    supportingEvidence: [
      'shadow board', 'tool rack', 'peg board', 'tool storage', 'tool holder',
    ],
    forbiddenObjectTypes: [
      'chemical drum', 'raw material', 'pallet', 'machine', 'floor marking', 'SOP',
      'audit board', 'cleaning tool', 'label', 'safety sign',
    ],
    objectAliases: {
      'hand tool':  ['spanner', 'wrench', 'screwdriver', 'hammer', 'pliers', 'file', 'chisel'],
      'tray':       ['part tray', 'component tray', 'work tray', 'sorting tray'],
      'accessory':  ['attachment', 'adapter', 'insert', 'chuck', 'collet'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Clearly unnecessary tool or tray outside designated storage', examples: ['loose spanner on floor', 'empty tray outside shadow board'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Tool visible outside expected location',                      examples: ['toolbox on floor away from workstation'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Tool visible, purpose ambiguous',                             examples: ['partially visible tool rack'], maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No tools visible',                                            examples: [],                             maxRating: 'NOT_VISIBLE' },
    ],
  },

  {
    questionId: 'SORT-03',
    allowedCategories: ['A', 'B', 'C'] as ObjectCategory[],
    requiredObjectTypes: ['machine', 'equipment'],
    primaryEvidence: [
      'machine', 'equipment', 'press', 'conveyor', 'pump', 'lathe', 'grinder',
      'production unit', 'processing unit', 'apparatus',
    ],
    supportingEvidence: [
      'utility connection', 'product material', 'oil stain', 'operating panel',
    ],
    forbiddenObjectTypes: [
      'hand tool', 'tray', 'label', 'floor marking', 'SOP', 'audit board', 'cleaning tool',
      'chemical drum', 'raw material', 'document', 'pallet',
    ],
    objectAliases: {
      'machine':    MACHINE_ALIASES,
      'equipment':  ['plant', 'installation', 'unit', 'station', 'rig', 'assembly'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Machine clearly not in use and taking valuable space',     examples: ['idle press with no material', 'disconnected conveyor'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Machine visible but operational status ambiguous',          examples: ['machine with no product but utility connected'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Machine partially visible',                                examples: ['partially obscured equipment'],  maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No machines visible',                                      examples: [],                               maxRating: 'NOT_VISIBLE' },
    ],
  },

  {
    questionId: 'SORT-04',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['document', 'instruction', 'signage'],
    primaryEvidence: [
      'document', 'instruction sheet', 'SOP', 'notice', 'poster', 'sign', 'visual aid',
      'revision label', 'expiry date', 'version number', 'date stamp',
    ],
    supportingEvidence: [
      'document rack', 'binder', 'clipboard', 'notice board', 'information board',
    ],
    forbiddenObjectTypes: [
      'hand tool', 'machine', 'floor marking', 'audit board', 'cleaning tool',
      'raw material', 'pallet', 'drum', 'label on equipment',
    ],
    objectAliases: {
      'document':         DOCUMENT_ALIASES,
      'instruction sheet': ['job card', 'route card', 'work order', 'traveller'],
      'sign':              ['placard', 'notice', 'board notice', 'posted notice'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Visibly outdated document with expired date or superseded label', examples: ['SOP with date 3 years ago', 'notice marked "superseded"'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Document without visible revision date',                          examples: ['instruction sheet with no date visible'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Document partially visible, date not readable',                   examples: ['partially obscured notice'],           maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No documents visible',                                            examples: [],                                     maxRating: 'NOT_VISIBLE' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SET IN ORDER (Seiton)
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId: 'SIO-01',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['machine', 'label', 'area sign'],
    primaryEvidence: [
      'machine label', 'equipment label', 'area sign', 'zone marker', 'machine nameplate',
      'unit number', 'identification tag', 'department sign', 'workstation label',
    ],
    supportingEvidence: [
      'asset number', 'QR code', 'barcode', 'machine code plate', 'numbered marker',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'SOP', 'audit board', 'kaizen board', 'cleaning tool',
      'raw material', 'chemical drum', 'pallet', 'hand tool',
    ],
    objectAliases: {
      'label':      LABEL_ALIASES,
      'area sign':  ['zone sign', 'department sign', 'area marker', 'station sign'],
      'machine':    MACHINE_ALIASES,
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Machine or area has clear, readable identification label',    examples: ['machine nameplate clearly visible', 'department sign with name'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Label present but partially obscured or difficult to read',  examples: ['faded label still legible'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'No label visible but machine otherwise identifiable',         examples: ['machine with model number plate only'], maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No identification of any machine or area visible',           examples: [],                                      maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'SIO-02',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['tool', 'tool storage'],
    primaryEvidence: [
      'shadow board', 'pegboard', 'tool rack', 'tool holder', 'tool drawer', 'tool trolley',
      'toolbox with organisation', 'frequency-ordered tools', 'labelled tool position',
    ],
    supportingEvidence: [
      'hand tool', 'power tool', 'tray', 'tool organiser', 'marked tool position',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'label on machine', 'SOP', 'audit board', 'cleaning tool',
      'raw material', 'chemical drum', 'pallet', 'document',
    ],
    objectAliases: {
      'shadow board':  ['tool silhouette board', 'shadow peg board', 'foam shadow insert'],
      'tool rack':     ['wall rack', 'hanging rack', 'tool rail', 'storage rail'],
      'hand tool':     ['spanner', 'wrench', 'screwdriver', 'hammer', 'pliers'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Shadow board or organised tool system clearly visible',      examples: ['shadow board with all tools in position'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Tools stored in labelled location, frequency not confirmed', examples: ['tools on rack with labels'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Tools visible, organisation method unclear',                 examples: ['tools in drawer, arrangement not visible'], maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No tools or tool storage visible',                          examples: [],                                          maxRating: 'NOT_VISIBLE' },
    ],
  },

  {
    questionId: 'SIO-03',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['floor marking', 'storage label'],
    primaryEvidence: [
      'floor marking', 'floor tape', 'aisle line', 'walkway marking', 'storage zone boundary',
      'shelf label', 'rack label', 'location marker', 'bin label',
    ],
    supportingEvidence: [
      'safety marking', 'hazard stripe', 'equipment footprint outline', 'yellow line', 'painted zone',
    ],
    forbiddenObjectTypes: [
      'machine label', 'SOP', 'audit board', 'cleaning tool', 'raw material',
      'chemical drum', 'hand tool', 'shadow board',
    ],
    objectAliases: {
      'floor marking': FLOOR_MARKING_ALIASES,
      'aisle line':    ['aisle tape', 'walkway tape', 'corridor marking'],
      'shelf label':   ['rack label', 'bin label', 'location tag', 'position label'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Floor markings clearly visible and intact',              examples: ['yellow aisle lines clearly visible', 'storage zone outlined in tape'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Floor markings visible but worn or faded',              examples: ['faded floor tape still visible'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Partial markings or only shelf labels visible',         examples: ['shelf labels only, no floor markings'], maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No floor markings or storage labels of any kind visible', examples: [],                                    maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'SIO-04',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['document', 'file', 'binder'],
    primaryEvidence: [
      'document', 'binder', 'file', 'record folder', 'labelled document rack', 'document storage',
      'file label', 'document index', 'accessible record',
    ],
    supportingEvidence: [
      'notice board with documents', 'clipboard', 'document holder', 'digital terminal',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'machine', 'cleaning tool', 'hand tool', 'raw material',
      'chemical drum', 'pallet', 'audit board', 'shadow board',
    ],
    objectAliases: {
      'document': DOCUMENT_ALIASES,
      'binder':   ['ring binder', 'lever arch file', 'folder', 'ring folder'],
      'file':     ['folder', 'document file', 'sleeve', 'wallet'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Labelled document storage clearly accessible',             examples: ['labelled binder on rack within reach'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Documents present but labelling or accessibility unclear', examples: ['unlabelled binders on shelf'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Document storage partially visible',                       examples: ['file rack partially visible'],             maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No documents or document storage visible',                 examples: [],                                         maxRating: 'NOT_VISIBLE' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SHINE (Seiso)
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId: 'SHN-01',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['cleaning tool', 'cleaning station'],
    primaryEvidence: [
      'broom', 'mop', 'brush', 'vacuum cleaner', 'cleaning cloth', 'wipes', 'squeegee',
      'cleaning station', 'mop bucket', 'cleaning equipment rack', 'dustpan',
    ],
    supportingEvidence: [
      'cleaning product', 'disinfectant', 'cleaning chemical', 'spray bottle', 'cleaning trolley',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'label', 'SOP', 'audit board', 'machine', 'hand tool',
      'raw material', 'chemical drum', 'pallet',
    ],
    objectAliases: {
      'cleaning tool':    CLEANING_TOOL_ALIASES,
      'cleaning station': ['cleaning cupboard', 'cleaning bay', 'hygiene station', 'janitor station'],
      'mop bucket':       ['bucket', 'mop pail', 'floor mop system'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Cleaning tools clearly present and in good condition at point of use', examples: ['mop and bucket at designated cleaning station'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Cleaning tools present but condition unclear',                         examples: ['broom visible but condition not assessable'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Cleaning supplies partially visible',                                  examples: ['spray bottle partially visible'],           maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No cleaning tools or station visible',                                 examples: [],                                          maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'SHN-02',
    allowedCategories: ['A', 'B', 'C'] as ObjectCategory[],
    requiredObjectTypes: ['floor surface', 'aisle'],
    primaryEvidence: [
      'floor surface', 'aisle', 'walkway', 'floor area', 'concrete floor',
      'floor stain', 'liquid pool', 'debris', 'waste', 'dust', 'dirt on floor',
    ],
    supportingEvidence: [
      'wall surface', 'skirting', 'drain', 'spill containment', 'floor drain',
    ],
    forbiddenObjectTypes: [
      'machine surface', 'label', 'SOP', 'audit board', 'cleaning tool',
      'hand tool', 'shadow board', 'chemical drum content',
    ],
    objectAliases: {
      'floor surface': ['floor', 'ground', 'floor area', 'flooring'],
      'debris':        ['rubbish', 'waste', 'litter', 'scrap', 'off-cut'],
      'liquid pool':   ['puddle', 'spill', 'standing liquid', 'oil pool', 'water pool'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Floor contamination directly visible (staining, pooling, debris)',    examples: ['oil pool on floor', 'scattered debris in aisle'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Floor surface partially dirty or slightly contaminated',             examples: ['light dust on floor surface'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Floor partially visible, condition inconclusive',                    examples: ['floor partially obscured by equipment'],         maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No floor surface visible',                                          examples: [],                                               maxRating: 'NOT_VISIBLE' },
    ],
  },

  {
    questionId: 'SHN-03',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['machine surface', 'equipment surface'],
    primaryEvidence: [
      'machine surface', 'equipment surface', 'workstation surface', 'shelf surface',
      'dust on machine', 'oil on equipment', 'rust', 'corrosion', 'residue', 'grease',
    ],
    supportingEvidence: [
      'piping surface', 'cabinet surface', 'conveyor surface', 'panel surface',
    ],
    forbiddenObjectTypes: [
      'floor surface', 'label on machine', 'SOP', 'audit board', 'cleaning tool',
      'hand tool', 'raw material', 'chemical drum', 'floor marking',
    ],
    objectAliases: {
      'machine surface': ['machine body', 'equipment body', 'machine casing', 'machine housing'],
      'rust':            ['corrosion', 'oxidation', 'rust spots', 'surface rust'],
      'grease':          ['lubricant', 'oil film', 'grease marks', 'oily residue'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Machine surface contamination clearly visible (oil, rust, residue)', examples: ['oil stain on machine body', 'rust on shelf surface'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Light surface contamination visible',                               examples: ['dust layer on equipment surface'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Machine surface partially visible, condition inconclusive',          examples: ['machine partially obscured'],                       maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No machine surfaces visible',                                       examples: [],                                                  maxRating: 'NOT_VISIBLE' },
    ],
  },

  {
    questionId: 'SHN-04',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: [],   // Type 3 — no required objects; cannot verify directly
    primaryEvidence: [],       // Type 3 — no primary evidence; conservative only
    supportingEvidence: [
      'clean floor', 'clean machine surface', 'clean workstation', 'tidy area',
    ],
    forbiddenObjectTypes: [
      'cleaning schedule text', 'employee behaviour', 'culture indicator',
      'historical information', 'frequency claim',
    ],
    objectAliases: {},
    evidencePriority: [
      { level: 1, label: 'CONTEXTUAL', weight: 0.4, description: 'Overall cleanliness suggests regular routine (indirect only)',   examples: ['consistently clean floor throughout zone'] },
      { level: 2, label: 'NONE',       weight: 0.0, description: 'Cannot verify cleaning routine from visual evidence',            examples: [],                                              maxRating: 'Average' },
      { level: 3, label: 'NONE',       weight: 0.0, description: 'No evidence available',                                         examples: [],                                              maxRating: 'NOT_VISIBLE' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No evidence',                                                   examples: [],                                              maxRating: 'NOT_VISIBLE' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // STANDARDIZE (Seiketsu)
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId: 'STD-01',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['label', 'colour code', 'marking'],
    primaryEvidence: [
      'colour coded label', 'colour coding system', 'consistent label format',
      'equipment label', 'container label', 'storage label', 'colour band', 'coloured tag',
    ],
    supportingEvidence: [
      'area marking', 'identification sign', 'zone colour', 'coloured floor tape',
    ],
    forbiddenObjectTypes: [
      'SOP', 'work instruction', 'audit board', 'cleaning tool', 'machine (unlabelled)',
      'raw material', 'chemical drum', 'floor marking without colour code',
    ],
    objectAliases: {
      'label':        LABEL_ALIASES,
      'colour code':  ['color code', 'colour band', 'coloured stripe', 'colour marker'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Consistent colour coding system clearly visible across area',      examples: ['blue labels on all electrical panels', 'red containers for hazardous materials'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Labels present but colour consistency unclear',                    examples: ['mixed label formats but all areas labelled'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Some labelling but no consistent colour system visible',           examples: ['scattered labels with no clear standard'], maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No labelling or colour coding of any kind visible',               examples: [],                                          maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'STD-02',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['work instruction', 'SOP'],
    primaryEvidence: [
      'work instruction', 'SOP', 'posted procedure', 'visual standard', 'operating guide',
      'process chart', 'task card', 'instruction poster', 'laminated procedure',
    ],
    supportingEvidence: [
      'quick reference guide', 'photo instruction', 'illustrated guide', 'flowchart',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'label on machine', 'audit board', 'cleaning tool', 'machine',
      'hand tool', 'raw material', 'chemical drum', 'pallet',
    ],
    objectAliases: {
      'work instruction': ['WI', 'job instruction', 'task instruction', 'method sheet'],
      'SOP':              DOCUMENT_ALIASES,
      'visual standard':  ['visual aid', 'visual guide', 'picture standard', 'photo standard'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Work instruction or SOP visibly posted at workstation',          examples: ['laminated SOP on machine frame', 'A3 work instruction on wall'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Document posted nearby but not directly at workstation',         examples: ['instruction sheet on adjacent notice board'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Document holder visible but content not readable',               examples: ['document holder with obscured content'],                maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No work instructions or SOPs visible anywhere near workstation', examples: [],                                                      maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'STD-03',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['storage label', 'position marker'],
    primaryEvidence: [
      'storage location label', 'position marker', 'designated position outline',
      'shelf label', 'bin label', 'visual control marker', 'item quantity marker',
    ],
    supportingEvidence: [
      'floor zone label', 'rack marker', 'cabinet label', 'equipment footprint',
    ],
    forbiddenObjectTypes: [
      'SOP', 'work instruction', 'audit board', 'cleaning tool', 'machine',
      'raw material', 'chemical drum', 'floor aisle marking',
    ],
    objectAliases: {
      'storage label':   ['location label', 'bin label', 'shelf tag', 'rack tag'],
      'position marker': ['position outline', 'position tape', 'shadow outline', 'footprint'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'All storage locations labelled with designated items and quantities',  examples: ['shelf label with item name and max quantity'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Storage locations labelled but quantities not specified',              examples: ['bin labels with item name only'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Some storage areas designated but not all labelled',                  examples: ['half of shelves labelled'],                          maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No storage location labelling or position designation visible',       examples: [],                                                   maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'STD-04',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['cleaning standard', 'inspection checklist'],
    primaryEvidence: [
      'cleaning standard', 'cleaning checklist', 'cleaning schedule poster',
      'inspection standard', 'inspection checklist', 'maintenance standard', 'maintenance schedule',
    ],
    supportingEvidence: [
      'sign-off sheet', 'inspection record', 'cleaning log', 'maintenance log',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'label on equipment', 'audit board', 'machine', 'hand tool',
      'raw material', 'chemical drum', 'pallet', 'SOP for production process',
    ],
    objectAliases: {
      'cleaning standard':    ['cleaning procedure', 'hygiene standard', 'sanitation standard'],
      'cleaning checklist':   ['cleaning form', 'cleaning sign-off', 'cleaning record'],
      'inspection checklist': ['inspection form', 'audit checklist', 'check sheet'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Cleaning and inspection standards clearly posted and current',      examples: ['laminated cleaning standard on wall', 'inspection checklist in holder'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Standards present but location or currency unclear',               examples: ['cleaning schedule posted but date not visible'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Standard partially visible',                                       examples: ['checklist holder visible but form not readable'],    maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No cleaning, inspection, or maintenance standards posted anywhere', examples: [],                                                   maxRating: 'Very Bad' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SUSTAIN (Shitsuke)
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId: 'SUS-01',
    allowedCategories: ['A', 'B', 'C', 'D'] as ObjectCategory[],
    requiredObjectTypes: ['visible workspace area'],
    primaryEvidence: [
      'overall workspace condition', 'storage condition', 'work area organisation',
      'visible cleanliness', 'visual control condition', 'label condition', 'marking condition',
    ],
    supportingEvidence: [
      'general tidiness', 'item placement in designated areas', 'maintained visual management',
    ],
    forbiddenObjectTypes: [
      'employee behaviour', 'cultural inference', 'historical claim', 'frequency claim',
    ],
    objectAliases: {
      'visual control condition': ['label condition', 'sign condition', 'marking condition'],
      'storage condition':        ['shelf condition', 'rack condition', 'storage state'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Overall 5S condition visibly high across multiple dimensions', examples: ['clean floor, intact labels, organised storage all visible'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Most 5S dimensions appear maintained',                        examples: ['generally tidy area with minor deficiencies'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Partial 5S compliance visible, condition mixed',              examples: ['some areas organised, others cluttered'],              maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'Overall condition suggests poor 5S compliance',               examples: ['widespread clutter, damaged labels, contamination'],   maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'SUS-02',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['audit board', '5S board'],
    primaryEvidence: [
      '5S audit board', 'performance board', 'audit result chart', '5S score display',
      'audit record', 'improvement action board', 'results display',
    ],
    supportingEvidence: [
      'KPI board', 'metric board', 'quality board', 'performance chart',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'SOP', 'cleaning tool', 'machine', 'hand tool',
      'raw material', 'chemical drum', 'kaizen board (separate)', 'production board',
    ],
    objectAliases: {
      '5S audit board': AUDIT_BOARD_ALIASES,
      'audit record':   ['audit sheet', 'audit form', 'audit log', 'inspection record'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: '5S audit board clearly visible with current results displayed',    examples: ['5S score board with current month scores'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Board visible but content update status unclear',                  examples: ['5S board present but scores not clearly current'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Board-like structure visible but content not readable',            examples: ['board visible but too far to read'],               maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No 5S audit board or improvement board of any kind visible',      examples: [],                                                 maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'SUS-03',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['kaizen board', 'improvement board'],
    primaryEvidence: [
      'kaizen board', 'improvement board', 'action item board', 'PDCA board',
      'suggestion board', 'improvement card', 'action card',
    ],
    supportingEvidence: [
      'continuous improvement chart', 'problem-solving board', 'correction board',
    ],
    forbiddenObjectTypes: [
      'floor marking', 'SOP', 'cleaning tool', 'machine', 'hand tool',
      'raw material', 'chemical drum', 'audit score board',
    ],
    objectAliases: {
      'kaizen board':     KAIZEN_BOARD_ALIASES,
      'improvement card': ['action card', 'kaizen card', 'change card', 'improvement slip'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Kaizen or improvement board visible with active action items',       examples: ['improvement board with populated action cards'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Improvement board present but activity level unclear',              examples: ['improvement board visible but no items readable'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Board-like structure visible, improvement focus unclear',            examples: ['board visible but type unclear'],                   maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'No kaizen or improvement board of any kind visible',               examples: [],                                                  maxRating: 'Very Bad' },
    ],
  },

  {
    questionId: 'SUS-04',
    allowedCategories: ['A', 'B'] as ObjectCategory[],
    requiredObjectTypes: ['label', 'floor marking', 'sign'],
    primaryEvidence: [
      'label condition', 'floor marking condition', 'sign condition',
      'intact label', 'intact floor tape', 'legible sign', 'maintained marking',
    ],
    supportingEvidence: [
      'visual control element', 'visual management element', 'posted standard',
    ],
    forbiddenObjectTypes: [
      'machine', 'hand tool', 'raw material', 'chemical drum', 'pallet',
      'cleaning tool', 'audit board content', 'employee behaviour',
    ],
    objectAliases: {
      'label condition':         ['label state', 'label quality', 'tag condition'],
      'floor marking condition': ['floor tape condition', 'floor line condition', 'marking state'],
    },
    evidencePriority: [
      { level: 1, label: 'PRIMARY',    weight: 1.0, description: 'Visual management elements consistently maintained and in good condition', examples: ['all labels legible', 'floor markings intact and bright'] },
      { level: 2, label: 'SUPPORTING', weight: 0.7, description: 'Most visual management elements maintained, minor degradation',            examples: ['some faded labels, floor markings mostly intact'] },
      { level: 3, label: 'CONTEXTUAL', weight: 0.4, description: 'Mixed condition — some elements maintained, others degraded',               examples: ['half labels faded, some markings missing'],              maxRating: 'Average' },
      { level: 4, label: 'NONE',       weight: 0.0, description: 'Visual management elements largely absent or severely degraded',             examples: ['labels missing, markings worn away'],                    maxRating: 'Very Bad' },
    ],
  },

];

// ── Indexed lookup ─────────────────────────────────────────────────────────────

const MATRIX_BY_ID: Map<string, EvidenceCapabilityEntry> =
  new Map(MATRIX.map((entry) => [entry.questionId, entry]));

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the Evidence Capability entry for a single question ID.
 * Throws if the question is not registered.
 */
export function getEvidenceCapability(questionId: string): EvidenceCapabilityEntry {
  const entry = MATRIX_BY_ID.get(questionId);
  if (!entry) {
    throw new Error(
      `[ECM] Question ID "${questionId}" has no Evidence Capability entry. ` +
      `All 20 questions must have an ECM entry.`,
    );
  }
  return entry;
}

/** Returns all 20 Evidence Capability entries. */
export function getAllCapabilities(): EvidenceCapabilityEntry[] {
  return [...MATRIX];
}

/** Returns the number of registered questions (must always be 20). */
export function getECMCount(): number {
  return MATRIX.length;
}
