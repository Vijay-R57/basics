/**
 * supabase/functions/analyze-5s/audit-engine/QuestionEvaluationRegistry.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Question Evaluation Registry (QER) — Recommendation 11 / Engine v5.0
 *
 * The single source of truth for HOW every audit question is evaluated.
 *
 * Each entry unifies what previously lived in:
 *  - AuditDecisionMatrix.ts         (decision strategy, evidence policy)
 *  - AuditCalibrationMatrix.ts      (thresholds, escalation, positive influence)
 *  - RecommendationPriorityService  (category maps)
 *  - CrossQuestionConsistencyService (dependency lists)
 *  - NEW: inspectionProcedure       (structured JSON decision tree steps)
 *  - NEW: recommendationTemplate    (corrective action, benefit, time estimate)
 *  - NEW: consistencyDependencies   (explicit per-question cross-checks)
 *
 * Registry version: 1.0
 *
 * Design invariants:
 *  - Zero prompt content
 *  - Zero score values (ratings only)
 *  - Zero zone names
 *  - All 20 questions must have exactly one entry
 *  - AuditDecisionMatrix + AuditCalibrationMatrix are NOW READ-ONLY ADAPTERS
 *    that delegate to this registry
 */

import type {
  QuestionEvaluationConfig,
  PillarKey,
} from './types.ts';

// ── Common escalation rules (shared across multiple questions) ─────────────────

const EMERGENCY_ESCALATION = {
  pattern:      'blocked',
  forcedRating: 'Very Bad' as const,
  reason:       'Blocked emergency access is a CRITICAL safety violation — automatic Very Bad.',
};

const CHEMICAL_SPILL_ESCALATION = {
  pattern:      'spill',
  forcedRating: 'Very Bad' as const,
  reason:       'Visible chemical spill not in containment is a MAJOR safety hazard.',
};

// ── Question Evaluation Registry — all 20 questions ───────────────────────────

const REGISTRY: QuestionEvaluationConfig[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // SORT (Seiri) — SORT-01 to SORT-04
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId:   'SORT-01',
    questionText: 'Is the workplace cluttered with unnecessary raw materials, drums, inventory, laboratory items, documents or finished products?',
    pillar:       'SORT',
    auditIntent:  'Identify whether non-essential items are occupying workspace that should be clear.',
    evidenceIntent:    'ORGANIZATION_ASSESSMENT',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'VIOLATION_BASED',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible clutter on floor or surfaces',
      'excess raw materials or inventory',
      'abandoned containers or drums',
      'stacked documents',
    ],
    forbiddenEvidence: ['no red tag', 'no sorting system', 'items appear unused', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Scan all visible floor and surface areas for items that do not belong to active work.', expectedOutcome: 'List of potential unnecessary items by location.' },
      { step: 2, action: 'Classify each detected item using zone knowledge: is it expected equipment, active inventory, or clearly unnecessary?', condition: 'If item matches zone expected list', expectedOutcome: 'Item is excluded from violation consideration.' },
      { step: 3, action: 'Count directly visible clutter items (Category D only).', expectedOutcome: 'Clutter count ≥ 0.' },
      { step: 4, action: 'Apply threshold: ≤1 isolated item = minor; 2–3 items = moderate; ≥4 items or blocked aisle = major.', expectedOutcome: 'Severity classification.' },
      { step: 5, action: 'Note positive compliance: visible clear aisles, organised storage, absence of clutter.', expectedOutcome: 'Positive evidence list.' },
      { step: 6, action: 'Assign rating using calibration thresholds.', expectedOutcome: 'Final rating: Very Good → Very Bad.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
      CRITICAL: { triggersAt: 1, ratingCap: 'Very Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Good', suppressMinor: true },
    escalationRules:   [EMERGENCY_ESCALATION],
    calibrationRules:  ['ISOLATED_ITEM_NO_PENALTY', 'LOOSE_ITEM_IN_ACTIVE_ZONE_MINOR'],

    consistencyDependencies: ['SIO-01', 'SIO-03'],

    recommendationTemplate: {
      category:                'Organization',
      priority:                'High',
      title:                   'Remove Unnecessary Items from Workspace',
      corrective:              'Sort all items in the area. Tag unnecessary items with red tags and remove or relocate them within 48 hours.',
      expectedBenefit:         'Improved workspace visibility, reduced accident risk, faster operator movement.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Easy',
      timeEstimate:            '1–2 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SORT-02',
    questionText: 'Are unnecessary trays, tools, moulds, accessories or unused materials present?',
    pillar:       'SORT',
    auditIntent:  'Detect tools and accessories that are not actively used in the current work process.',
    evidenceIntent:    'ORGANIZATION_ASSESSMENT',

    questionType:     2,
    evidenceCategory: 'B',
    decisionStrategy: 'VISUAL_CONTEXT',
    contextRequired:  true,
    ratingPolicy:     'CONSERVATIVE',
    evidencePolicy:   'ZONE_AWARE',
    confidencePolicy: 'CONSERVATIVE',
    requiredEvidence: [
      'visible tools, trays, or accessories',
      'zone knowledge identifying expected vs unexpected items',
    ],
    forbiddenEvidence: ['no red tag', 'no shadow board', 'purpose unclear', 'unknown purpose', 'unidentified object'],

    inspectionProcedure: [
      { step: 1, action: 'List all visible tools, trays, moulds, and accessories.', expectedOutcome: 'Full inventory of Category B/C/D items.' },
      { step: 2, action: 'Cross-reference with zone expected equipment list.', condition: 'If tool matches expected equipment list', expectedOutcome: 'Exclude from violation consideration.' },
      { step: 3, action: 'For remaining unmatched items, assess if they are actively in use or clearly abandoned.', expectedOutcome: 'List of potentially unnecessary items.' },
      { step: 4, action: 'Apply conservative evaluation: do not assume a tool is unnecessary unless it is clearly out of place and not in active use.', expectedOutcome: 'Reduced risk of false positive violations.' },
      { step: 5, action: 'Assign rating based on count of clearly unnecessary items and their severity.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
      CRITICAL: { triggersAt: 1, ratingCap: 'Very Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  ['ISOLATED_ITEM_NO_PENALTY'],

    consistencyDependencies: ['SORT-01', 'SIO-02'],

    recommendationTemplate: {
      category:                'Organization',
      priority:                'Medium',
      title:                   'Remove Unnecessary Tools and Accessories',
      corrective:              'Audit all tools and trays in the area. Return unused items to stores or remove them from the workspace.',
      expectedBenefit:         'Reduced tool search time, cleaner workspace, better visual management.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '1 hour',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SORT-03',
    questionText: 'Are unused machines or unnecessary equipment occupying valuable workspace?',
    pillar:       'SORT',
    auditIntent:  'Determine if non-operational machines or equipment are consuming production space.',
    evidenceIntent:    'ORGANIZATION_ASSESSMENT',

    questionType:     2,
    evidenceCategory: 'B',
    decisionStrategy: 'VISUAL_CONTEXT',
    contextRequired:  true,
    ratingPolicy:     'CONSERVATIVE',
    evidencePolicy:   'ZONE_AWARE',
    confidencePolicy: 'CONSERVATIVE',
    requiredEvidence: [
      'visible machines or equipment',
      'zone knowledge confirming whether equipment is expected',
    ],
    forbiddenEvidence: ['machine appears unused', 'equipment seems old', 'no production activity', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Identify all visible machines and large equipment.', expectedOutcome: 'Machine inventory list.' },
      { step: 2, action: 'Check against zone expected equipment list.', condition: 'If machine is in expected equipment list', expectedOutcome: 'Exclude from violation consideration.' },
      { step: 3, action: 'For unexpected machines: assess visible signs of active use (recent oil stains, product material, connected utilities).', expectedOutcome: 'Activity status of unexpected machines.' },
      { step: 4, action: 'Apply conservative rating: only flag machines clearly unused with no visible justification.', expectedOutcome: 'Minimal false positive flags.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  ['ISOLATED_ITEM_NO_PENALTY'],

    consistencyDependencies: ['SORT-01', 'SIO-01'],

    recommendationTemplate: {
      category:                'Compliance',
      priority:                'Medium',
      title:                   'Remove or Relocate Unused Equipment',
      corrective:              'Tag unused machines. Arrange removal, relocation, or disposal within 1 week.',
      expectedBenefit:         'Improved workspace flow, reduced cleaning burden, better safety.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Hard',
      timeEstimate:            '2–5 days',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SORT-04',
    questionText: 'Are obsolete instructions, documents or visual displays still present?',
    pillar:       'SORT',
    auditIntent:  'Detect outdated documents, instructions, or signs that could cause process confusion.',
    evidenceIntent:    'CONDITION_ASSESSMENT',

    questionType:     2,
    evidenceCategory: 'B',
    decisionStrategy: 'CONDITION_ASSESSMENT',
    contextRequired:  true,
    ratingPolicy:     'CONSERVATIVE',
    evidencePolicy:   'POSITIVE_FIRST',
    confidencePolicy: 'CONSERVATIVE',
    requiredEvidence: [
      'visible documents, instructions, or signage',
      'observable revision dates or expiry indicators',
    ],
    forbiddenEvidence: ['no document control system', 'documents may be outdated', 'historically', 'employees may not follow'],

    inspectionProcedure: [
      { step: 1, action: 'Locate all visible documents, SOPs, notices, and instruction sheets.', expectedOutcome: 'Full list of visible documents.' },
      { step: 2, action: 'Check for visible revision dates, version numbers, or expiry indicators.', condition: 'If revision date is visible and current', expectedOutcome: 'Document classified as compliant.' },
      { step: 3, action: 'Flag documents with visibly expired dates, superseded version indicators, or conflicting instructions.', expectedOutcome: 'List of potentially obsolete documents.' },
      { step: 4, action: 'Apply positive first: note all current and legible documents before flagging deficiencies.', expectedOutcome: 'Balanced assessment.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['STD-02', 'SIO-04'],

    recommendationTemplate: {
      category:                'Compliance',
      priority:                'Medium',
      title:                   'Remove Obsolete Documents and Instructions',
      corrective:              'Review all posted documents. Remove outdated versions and replace with current controlled copies.',
      expectedBenefit:         'Reduced operator confusion, better compliance, cleaner visual environment.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '2–4 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SET IN ORDER (Seiton) — SIO-01 to SIO-04
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId:   'SIO-01',
    questionText: 'Are machines, units and areas clearly identified?',
    pillar:       'SET_IN_ORDER',
    auditIntent:  'Verify that all equipment and workspace areas have visible, readable identification.',
    evidenceIntent:    'PRESENCE_DETECTION',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible identification labels on machines or units',
      'visible signs or markings on production areas',
      'named or numbered identification visible',
    ],
    forbiddenEvidence: ['no identification system', 'workers may not know', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Survey all visible machines and equipment for identification labels.', expectedOutcome: 'Count of labelled vs unlabelled machines.' },
      { step: 2, action: 'Check area signs, zone designations, and department labels.', expectedOutcome: 'Count of marked vs unmarked areas.' },
      { step: 3, action: 'Rate based on proportion of labelled items: Very Good (all labelled), Good (most labelled), Average (partial), Bad (few), Very Bad (none or absent).', expectedOutcome: 'Rating assignment.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  ['MULTIPLE_UNLABELED_EQUIPMENT_MAJOR'],

    consistencyDependencies: ['STD-01', 'SORT-01'],

    recommendationTemplate: {
      category:                'Organization',
      priority:                'High',
      title:                   'Implement Equipment and Area Identification Labels',
      corrective:              'Install durable identification labels on all machines, units, and work areas.',
      expectedBenefit:         'Faster operator orientation, reduced errors, better audit compliance.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Easy',
      timeEstimate:            '4–8 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SIO-02',
    questionText: 'Are tools and accessories arranged by frequency of use?',
    pillar:       'SET_IN_ORDER',
    auditIntent:  'Assess whether tools are organised in a way that reflects usage frequency.',
    evidenceIntent:    'ORGANIZATION_ASSESSMENT',

    questionType:     2,
    evidenceCategory: 'B',
    decisionStrategy: 'VISUAL_CONTEXT',
    contextRequired:  true,
    ratingPolicy:     'CONSERVATIVE',
    evidencePolicy:   'ZONE_AWARE',
    confidencePolicy: 'CONSERVATIVE',
    requiredEvidence: [
      'visible tools or accessories',
      'observable arrangement order (e.g. shadow boards, frequency-of-use ordering)',
    ],
    forbiddenEvidence: ['no shadow board', 'tools appear mixed', 'workers may not return', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Identify visible tool storage systems: shadow boards, pegboards, drawers, trays.', expectedOutcome: 'Tool storage method inventory.' },
      { step: 2, action: 'Assess whether frequently-used tools are accessible from operator position without unnecessary movement.', expectedOutcome: 'Accessibility assessment.' },
      { step: 3, action: 'Note any visible tools stored far from point of use or stacked in random order.', expectedOutcome: 'Organisation deficiency list.' },
      { step: 4, action: 'Assign rating considering overall organisation quality and tool accessibility.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SORT-02', 'SIO-03'],

    recommendationTemplate: {
      category:                'Organization',
      priority:                'Medium',
      title:                   'Organise Tools by Frequency of Use',
      corrective:              'Implement shadow boards or tool trolleys. Position high-frequency tools closest to operator workstation.',
      expectedBenefit:         'Reduced operator fatigue, faster tool retrieval, improved workflow efficiency.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Medium',
      timeEstimate:            '4–8 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SIO-03',
    questionText: 'Are floor markings and storage locations clearly defined?',
    pillar:       'SET_IN_ORDER',
    auditIntent:  'Verify visible floor markings, aisle delineation, and storage location indicators.',
    evidenceIntent:    'PRESENCE_DETECTION',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible floor markings or tape',
      'visible aisle or walkway delineation',
      'visible storage location labels or shelf labels',
    ],
    forbiddenEvidence: ['no 5s floor markings', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Identify all visible floor markings: aisle lines, storage zone boundaries, safety markings.', expectedOutcome: 'Marking coverage assessment.' },
      { step: 2, action: 'Assess condition of markings: intact, faded, or absent.', expectedOutcome: 'Marking quality rating.' },
      { step: 3, action: 'Check storage location labels on shelves, racks, and cabinets.', expectedOutcome: 'Storage designation completeness.' },
      { step: 4, action: 'Assign rating: Very Good (all markings clear and intact), through to Very Bad (no markings).', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  ['ABSENT_FLOOR_MARKINGS_MODERATE'],

    consistencyDependencies: ['SORT-01', 'SIO-02'],

    recommendationTemplate: {
      category:                'Safety',
      priority:                'High',
      title:                   'Install Floor Markings and Storage Location Labels',
      corrective:              'Apply floor marking tape for aisles, storage zones, and safety areas. Label all storage locations.',
      expectedBenefit:         'Improved safety, faster product location, clearer visual management.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Easy',
      timeEstimate:            '4–8 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SIO-04',
    questionText: 'Are documents and records organised, accessible and correctly stored?',
    pillar:       'SET_IN_ORDER',
    auditIntent:  'Assess the organisation and accessibility of documents at the workstation.',
    evidenceIntent:    'DOCUMENTATION_PRESENCE',

    questionType:     2,
    evidenceCategory: 'B',
    decisionStrategy: 'COMPLIANCE_BASED',
    contextRequired:  true,
    ratingPolicy:     'CONSERVATIVE',
    evidencePolicy:   'POSITIVE_FIRST',
    confidencePolicy: 'CONSERVATIVE',
    requiredEvidence: [
      'visible documents, binders, or files',
      'observable labelling or identification of documents',
      'accessibility indicators (within reach, not buried)',
    ],
    forbiddenEvidence: ['no document management system', 'documents may be inaccessible', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Identify all visible document storage: binders, folders, racks, digital terminals.', expectedOutcome: 'Document storage inventory.' },
      { step: 2, action: 'Assess labelling: are documents labelled with title, revision, and location?', expectedOutcome: 'Labelling completeness.' },
      { step: 3, action: 'Assess accessibility: can documents be reached from operator position?', expectedOutcome: 'Accessibility rating.' },
      { step: 4, action: 'Rate overall document organisation with positive-first approach.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SORT-04', 'STD-02'],

    recommendationTemplate: {
      category:                'Compliance',
      priority:                'Medium',
      title:                   'Improve Document Organisation and Accessibility',
      corrective:              'Label all document storage locations. Ensure all documents are within easy reach of operator workstation.',
      expectedBenefit:         'Faster document retrieval, reduced search time, better audit readiness.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '2–4 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SHINE (Seiso) — SHN-01 to SHN-04
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId:   'SHN-01',
    questionText: 'Are cleaning tools available, accessible and in good condition?',
    pillar:       'SHINE',
    auditIntent:  'Verify presence and readiness of cleaning equipment at the workstation.',
    evidenceIntent:    'PRESENCE_DETECTION',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible cleaning tools (mop, broom, brush, vacuum, wipes)',
      'visible cleaning station or cleaning equipment storage',
      'accessibility and condition of cleaning tools',
    ],
    forbiddenEvidence: ['no cleaning schedule', 'cleaning may be infrequent', 'workers do not clean'],

    inspectionProcedure: [
      { step: 1, action: 'Locate all visible cleaning tools and equipment.', expectedOutcome: 'Cleaning tool inventory.' },
      { step: 2, action: 'Assess condition: are tools clean, intact, and serviceable?', expectedOutcome: 'Tool condition rating.' },
      { step: 3, action: 'Assess accessibility: are tools stored near point of use?', expectedOutcome: 'Accessibility rating.' },
      { step: 4, action: 'Assign rating based on availability and condition.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  ['ABSENT_CLEANING_TOOLS_MODERATE'],

    consistencyDependencies: ['SHN-02', 'SHN-03'],

    recommendationTemplate: {
      category:                'Housekeeping',
      priority:                'Medium',
      title:                   'Provide Cleaning Tools at Point of Use',
      corrective:              'Install a cleaning station at each work area with all required tools in good condition.',
      expectedBenefit:         'Better cleaning compliance, faster response to spills, improved hygiene.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '1–2 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SHN-02',
    questionText: 'Are floors clean and free from contamination?',
    pillar:       'SHINE',
    auditIntent:  'Assess the cleanliness and contamination status of visible floor surfaces.',
    evidenceIntent:    'CLEANLINESS_ASSESSMENT',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'CONDITION_ASSESSMENT',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible floor condition (debris, staining, pooling)',
      'visible wall or aisle surface condition',
      'presence or absence of waste material or contamination',
    ],
    forbiddenEvidence: ['historically', 'cleaning is rarely done', 'workers do not'],

    inspectionProcedure: [
      { step: 1, action: 'Survey all visible floor surfaces for debris, liquid pooling, staining, or waste material.', expectedOutcome: 'Floor contamination assessment.' },
      { step: 2, action: 'Classify contamination by severity: minor (light dust), moderate (staining, scattered debris), major (oil pooling, significant waste).', expectedOutcome: 'Severity classification.' },
      { step: 3, action: 'Note positive: clean, dry, unobstructed floor sections.', expectedOutcome: 'Positive compliance evidence.' },
      { step: 4, action: 'Assign rating using calibration thresholds.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
      CRITICAL: { triggersAt: 1, ratingCap: 'Very Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Good', suppressMinor: true },
    escalationRules:   [CHEMICAL_SPILL_ESCALATION],
    calibrationRules:  ['SINGLE_DUSTY_SURFACE_MINOR', 'CHEMICAL_SPILL_VISIBLE_MAJOR'],

    consistencyDependencies: ['SHN-01', 'SHN-03'],

    recommendationTemplate: {
      category:                'Housekeeping',
      priority:                'High',
      title:                   'Clean and Decontaminate Floor Surfaces',
      corrective:              'Schedule immediate cleaning of contaminated areas. Implement daily floor inspection routine.',
      expectedBenefit:         'Improved safety, reduced slip hazard, better visual environment.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Easy',
      timeEstimate:            '1–2 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SHN-03',
    questionText: 'Are machines and equipment clean and free from contamination?',
    pillar:       'SHINE',
    auditIntent:  'Assess cleanliness and contamination of visible machine and equipment surfaces.',
    evidenceIntent:    'CLEANLINESS_ASSESSMENT',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'CONDITION_ASSESSMENT',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible surface condition of machines, workstations, piping',
      'observable contamination (dust, oil, residue, rust)',
      'condition of shelving and cabinet surfaces',
    ],
    forbiddenEvidence: ['no cleaning schedule visible', 'cleaning has not been done recently', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Inspect all visible machine surfaces for dust, oil, residue, and rust.', expectedOutcome: 'Machine contamination inventory.' },
      { step: 2, action: 'Assess severity per machine: minor (light dust), moderate (oil staining), major (heavy contamination, corrosion).', expectedOutcome: 'Per-machine severity.' },
      { step: 3, action: 'Note clean, well-maintained machines as positive compliance.', expectedOutcome: 'Positive evidence list.' },
      { step: 4, action: 'Assign rating based on proportion of contaminated vs clean equipment.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Good', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  ['SINGLE_DUSTY_SURFACE_MINOR', 'RUST_OR_CORROSION_MODERATE'],

    consistencyDependencies: ['SHN-01', 'SHN-02'],

    recommendationTemplate: {
      category:                'Housekeeping',
      priority:                'High',
      title:                   'Clean Equipment and Machine Surfaces',
      corrective:              'Schedule machine cleaning as part of daily or shift-end routine. Assign cleaning responsibility to operators.',
      expectedBenefit:         'Extended machine life, reduced contamination risk, improved operator pride.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Easy',
      timeEstimate:            '1–4 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SHN-04',
    questionText: 'Is there evidence of a regular cleaning routine being followed?',
    pillar:       'SHINE',
    auditIntent:  'Infer whether a sustained cleaning routine is in place based on visible condition evidence.',
    evidenceIntent:    'CLEANLINESS_ASSESSMENT',

    questionType:     3,
    evidenceCategory: 'C',
    decisionStrategy: 'CONSERVATIVE_INFERENCE',
    contextRequired:  false,
    ratingPolicy:     'NEUTRAL_ONLY',
    evidencePolicy:   'NO_ABSENCE_REASONING',
    confidencePolicy: 'FORCED_LOW',
    requiredEvidence: [],
    forbiddenEvidence: ['no cleaning routine', 'no cleaning schedule', 'workers do not clean regularly', 'historically', 'typically', 'usually'],

    inspectionProcedure: [
      { step: 1, action: 'Observe overall cleanliness condition as an indirect indicator of routine.', expectedOutcome: 'General cleanliness level (high/medium/low).' },
      { step: 2, action: 'Do NOT infer cleaning frequency or schedule from absence of visible cleaning.', expectedOutcome: 'No absence-based violations.' },
      { step: 3, action: 'Return Average or NOT_VISIBLE. Never return Bad or Very Bad for this Type 3 question.', expectedOutcome: 'Neutral conservative rating.' },
    ],

    minorTolerance: 99,
    thresholds: {},
    positiveInfluence: { minimumPositiveCount: 5, ratingFloor: 'Average', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SHN-01', 'SHN-02', 'SHN-03'],

    recommendationTemplate: {
      category:                'Continuous Improvement',
      priority:                'Low',
      title:                   'Establish Visible Cleaning Routine Indicators',
      corrective:              'Post cleaning schedules and sign-off sheets at each work area.',
      expectedBenefit:         'Accountability for cleaning, improved audit scores, better compliance culture.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '1 hour',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // STANDARDIZE (Seiketsu) — STD-01 to STD-04
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId:   'STD-01',
    questionText: 'Is there a visible colour coding and labelling system in use?',
    pillar:       'STANDARDIZE',
    auditIntent:  'Verify the presence of a consistent colour coding and labelling system across the workspace.',
    evidenceIntent:    'VISUAL_STANDARD_ASSESSMENT',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible labels on equipment, containers, or storage',
      'visible colour coding system',
      'visible area markings or identification signs',
    ],
    forbiddenEvidence: ['no standardization system', 'historically', 'employees do not follow'],

    inspectionProcedure: [
      { step: 1, action: 'Identify all visible labels, colour codes, and marking systems.', expectedOutcome: 'Labelling system inventory.' },
      { step: 2, action: 'Assess consistency: are labels of the same format/colour used for the same object types?', expectedOutcome: 'Consistency assessment.' },
      { step: 3, action: 'Assign rating based on coverage and consistency of the system.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  ['ABSENT_ALL_LABELS_MAJOR', 'MULTIPLE_UNLABELED_EQUIPMENT_MAJOR', 'SINGLE_UNLABELED_CONTAINER_MODERATE'],

    consistencyDependencies: ['SIO-01', 'STD-03'],

    recommendationTemplate: {
      category:                'Organization',
      priority:                'High',
      title:                   'Implement Consistent Colour Coding and Labelling System',
      corrective:              'Define a colour coding standard. Apply consistently to all equipment, containers, and storage areas.',
      expectedBenefit:         'Faster visual recognition, reduced errors, better compliance.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Medium',
      timeEstimate:            '1–2 days',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'STD-02',
    questionText: 'Are work instructions and standard operating procedures displayed at workstations?',
    pillar:       'STANDARDIZE',
    auditIntent:  'Verify that visual work instructions and SOPs are posted and accessible at the point of use.',
    evidenceIntent:    'DOCUMENTATION_PRESENCE',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible posted work instructions or SOPs',
      'observable visual operating standards at workstations',
      'physically posted or displayed procedural documents',
    ],
    forbiddenEvidence: ['no documented procedures', 'workers may not follow sop', 'historically'],

    inspectionProcedure: [
      { step: 1, action: 'Locate all visible posted work instructions, SOPs, and visual standards.', expectedOutcome: 'Work instruction inventory.' },
      { step: 2, action: 'Assess legibility, currency, and proximity to work position.', expectedOutcome: 'Instruction quality assessment.' },
      { step: 3, action: 'Assign rating based on coverage and quality of posted instructions.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  ['ABSENT_SOP_AT_WORKSTATION_MODERATE'],

    consistencyDependencies: ['SORT-04', 'SIO-04'],

    recommendationTemplate: {
      category:                'Compliance',
      priority:                'High',
      title:                   'Post Work Instructions at All Workstations',
      corrective:              'Laminate and post current SOPs and work instructions at each workstation. Ensure they are within operator sightline.',
      expectedBenefit:         'Reduced process errors, better compliance, easier operator training.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Easy',
      timeEstimate:            '2–4 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'STD-03',
    questionText: 'Are storage locations standardised with designated positions for all items?',
    pillar:       'STANDARDIZE',
    auditIntent:  'Verify standardised storage with visible position designations for all regular items.',
    evidenceIntent:    'VISUAL_STANDARD_ASSESSMENT',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible storage location labels or markers',
      'observable visual controls on equipment positions',
      'visible designated area markings',
    ],
    forbiddenEvidence: ['no standardized storage system', 'historically', 'workers do not follow designated positions'],

    inspectionProcedure: [
      { step: 1, action: 'Identify all visible storage locations: shelves, racks, cabinets, floor zones.', expectedOutcome: 'Storage location inventory.' },
      { step: 2, action: 'Check for designated position labels, outlines, or markers.', expectedOutcome: 'Designation coverage.' },
      { step: 3, action: 'Assess whether items are in their designated positions.', expectedOutcome: 'Compliance with designated positions.' },
      { step: 4, action: 'Assign rating based on designation coverage and item placement compliance.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SIO-03', 'STD-01'],

    recommendationTemplate: {
      category:                'Organization',
      priority:                'Medium',
      title:                   'Standardise All Storage Locations with Designated Positions',
      corrective:              'Label all storage locations with item name, quantity, and position marker. Apply floor or shelf position outlines.',
      expectedBenefit:         'Faster item retrieval, immediate visual detection of out-of-place items.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '4–8 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'STD-04',
    questionText: 'Are cleaning, inspection and maintenance standards posted and visible?',
    pillar:       'STANDARDIZE',
    auditIntent:  'Verify that cleaning, inspection, and maintenance standards are visibly posted at the relevant locations.',
    evidenceIntent:    'DOCUMENTATION_PRESENCE',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible posted cleaning standards or checklists',
      'observable inspection standards displayed',
      'visible maintenance standards or schedules posted',
    ],
    forbiddenEvidence: ['no formal cleaning standard', 'historically', 'workers do not clean to standard'],

    inspectionProcedure: [
      { step: 1, action: 'Locate visible cleaning and maintenance standards, checklists, or schedules.', expectedOutcome: 'Standards inventory.' },
      { step: 2, action: 'Assess legibility, currency, and completeness of posted standards.', expectedOutcome: 'Standards quality assessment.' },
      { step: 3, action: 'Assign rating based on presence, quality, and completeness of posted standards.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 2, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SHN-01', 'SHN-04', 'SUS-01'],

    recommendationTemplate: {
      category:                'Compliance',
      priority:                'Medium',
      title:                   'Post Cleaning, Inspection and Maintenance Standards',
      corrective:              'Create and post visual standards for cleaning, inspection, and maintenance at every applicable location.',
      expectedBenefit:         'Better cleaning compliance, faster standard adoption, improved audit scores.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '2–4 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SUSTAIN (Shitsuke) — SUS-01 to SUS-04
  // ══════════════════════════════════════════════════════════════════════════

  {
    questionId:   'SUS-01',
    questionText: 'Is the overall workplace 5S condition being maintained consistently?',
    pillar:       'SUSTAIN',
    auditIntent:  'Assess the overall sustained condition of 5S compliance across the workspace.',
    evidenceIntent:    'VISUAL_STANDARD_ASSESSMENT',

    questionType:     2,
    evidenceCategory: 'B',
    decisionStrategy: 'COMPLIANCE_BASED',
    contextRequired:  true,
    ratingPolicy:     'CONSERVATIVE',
    evidencePolicy:   'POSITIVE_FIRST',
    confidencePolicy: 'CONSERVATIVE',
    requiredEvidence: [
      'overall visible organization of the workplace',
      'visible condition of storage and work areas',
      'observable maintenance of visual controls',
    ],
    forbiddenEvidence: ['no sustained 5s culture', 'workers do not maintain', 'historically', 'typically'],

    inspectionProcedure: [
      { step: 1, action: 'Assess the overall state of the workspace using all prior pillar observations.', expectedOutcome: 'Holistic 5S condition assessment.' },
      { step: 2, action: 'Identify indicators of sustained discipline: intact labels, clean surfaces, items in place.', expectedOutcome: 'Positive compliance evidence.' },
      { step: 3, action: 'Identify indicators of degraded discipline: faded markings, items out of place, accumulated clutter.', expectedOutcome: 'Deficiency list.' },
      { step: 4, action: 'Assign conservative rating reflecting overall sustained condition.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 4, ratingFloor: 'Good', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['STD-04', 'SUS-02', 'SUS-04'],

    recommendationTemplate: {
      category:                'Continuous Improvement',
      priority:                'High',
      title:                   'Strengthen 5S Sustain Culture and Discipline',
      corrective:              'Conduct regular 5S audits. Display audit scores. Celebrate improvements. Assign area ownership.',
      expectedBenefit:         'Long-term 5S sustainability, continuous improvement culture, improved audit scores.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Hard',
      timeEstimate:            'Ongoing',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SUS-02',
    questionText: 'Is there a 5S audit board or improvement board visible and updated?',
    pillar:       'SUSTAIN',
    auditIntent:  'Verify the presence of a visible, updated 5S audit or improvement board.',
    evidenceIntent:    'PRESENCE_DETECTION',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible 5S audit board or improvement board',
      'observable audit scores or results displayed',
      'physical presence and maintained condition of board',
    ],
    forbiddenEvidence: ['no audit culture', 'historically', 'employees do not participate'],

    inspectionProcedure: [
      { step: 1, action: 'Locate visible 5S audit or improvement boards.', expectedOutcome: 'Board presence confirmed or absent.' },
      { step: 2, action: 'Assess board condition: are scores updated, action items current, board legible?', expectedOutcome: 'Board quality rating.' },
      { step: 3, action: 'Assign rating: Very Good (board present, updated, clear) through Very Bad (no board).', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 1, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SUS-01', 'SUS-03'],

    recommendationTemplate: {
      category:                'Continuous Improvement',
      priority:                'Medium',
      title:                   'Install and Maintain a 5S Audit Board',
      corrective:              'Create a visual 5S audit board. Display scores, action items, and improvement history. Update after every audit.',
      expectedBenefit:         'Visible commitment to 5S, improved team engagement, accountability.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Easy',
      timeEstimate:            '2–4 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SUS-03',
    questionText: 'Is there a kaizen or continuous improvement board visible?',
    pillar:       'SUSTAIN',
    auditIntent:  'Verify the presence of a visible kaizen or continuous improvement board with active improvement items.',
    evidenceIntent:    'PRESENCE_DETECTION',

    questionType:     1,
    evidenceCategory: 'A',
    decisionStrategy: 'PRESENCE_DETECTION',
    contextRequired:  false,
    ratingPolicy:     'STANDARD',
    evidencePolicy:   'DIRECT_ONLY',
    confidencePolicy: 'STANDARD',
    requiredEvidence: [
      'visible kaizen board or improvement tracking board',
      'observable action item lists or improvement cards',
      'physically present continuous improvement visual aids',
    ],
    forbiddenEvidence: ['no kaizen culture', 'no improvement mindset', 'historically', 'employees are not engaged'],

    inspectionProcedure: [
      { step: 1, action: 'Locate visible kaizen boards, improvement cards, or action tracking boards.', expectedOutcome: 'Improvement board presence status.' },
      { step: 2, action: 'Assess active items: are action cards visible and populated?', expectedOutcome: 'Activity assessment.' },
      { step: 3, action: 'Assign rating based on presence and activity level of the improvement system.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 1,
    thresholds: {
      MINOR:    { triggersAt: 1, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 2, ratingFloor: 'Average', suppressMinor: false },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SUS-01', 'SUS-02'],

    recommendationTemplate: {
      category:                'Continuous Improvement',
      priority:                'Low',
      title:                   'Install a Kaizen or Continuous Improvement Board',
      corrective:              'Create a kaizen board with active improvement items, owners, and status tracking.',
      expectedBenefit:         'Culture of continuous improvement, visible progress, team engagement.',
      estimatedScoreGain:      '+1 point',
      implementationDifficulty: 'Easy',
      timeEstimate:            '2–4 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

  {
    questionId:   'SUS-04',
    questionText: 'Are visual management elements consistently maintained?',
    pillar:       'SUSTAIN',
    auditIntent:  'Assess whether visual management (labels, markings, signs) is consistently maintained across the workspace.',
    evidenceIntent:    'VISUAL_STANDARD_ASSESSMENT',

    questionType:     2,
    evidenceCategory: 'B',
    decisionStrategy: 'VISUAL_CONTEXT',
    contextRequired:  true,
    ratingPolicy:     'CONSERVATIVE',
    evidencePolicy:   'ZONE_AWARE',
    confidencePolicy: 'CONSERVATIVE',
    requiredEvidence: [
      'overall visible state of visual management elements',
      'condition of labels, markings, and standards in the workplace',
    ],
    forbiddenEvidence: ['no ownership culture', 'workers lack discipline', 'historically', 'typically'],

    inspectionProcedure: [
      { step: 1, action: 'Survey all visible visual management elements: labels, floor markings, signs, boards.', expectedOutcome: 'Visual management inventory.' },
      { step: 2, action: 'Assess condition: intact, faded, missing, or damaged.', expectedOutcome: 'Condition rating per category.' },
      { step: 3, action: 'Compute proportion of maintained vs degraded elements.', expectedOutcome: 'Maintenance ratio.' },
      { step: 4, action: 'Assign conservative rating reflecting overall visual management condition.', expectedOutcome: 'Final rating.' },
    ],

    minorTolerance: 2,
    thresholds: {
      MINOR:    { triggersAt: 3, ratingCap: 'Good' },
      MODERATE: { triggersAt: 1, ratingCap: 'Average' },
      MAJOR:    { triggersAt: 1, ratingCap: 'Bad' },
    },
    positiveInfluence: { minimumPositiveCount: 3, ratingFloor: 'Good', suppressMinor: true },
    escalationRules:   [],
    calibrationRules:  [],

    consistencyDependencies: ['SUS-01', 'STD-01', 'SIO-01'],

    recommendationTemplate: {
      category:                'Continuous Improvement',
      priority:                'Medium',
      title:                   'Restore and Maintain Visual Management Elements',
      corrective:              'Audit all visual management elements. Replace faded labels, re-apply worn floor markings, and update outdated signs.',
      expectedBenefit:         'Consistent visual standards, improved audit scores, better workplace discipline.',
      estimatedScoreGain:      '+1 to +2 points',
      implementationDifficulty: 'Medium',
      timeEstimate:            '4–8 hours',
    },

    outputFields: ['rating', 'evidence', 'reason', 'confidence'],
  },

];

// ── Indexed lookup ─────────────────────────────────────────────────────────────

const REGISTRY_BY_ID: Map<string, QuestionEvaluationConfig> =
  new Map(REGISTRY.map((entry) => [entry.questionId, entry]));

const REGISTRY_BY_PILLAR: Map<PillarKey, QuestionEvaluationConfig[]> =
  new Map<PillarKey, QuestionEvaluationConfig[]>();

for (const entry of REGISTRY) {
  const existing = REGISTRY_BY_PILLAR.get(entry.pillar) ?? [];
  existing.push(entry);
  REGISTRY_BY_PILLAR.set(entry.pillar, existing);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const QER_VERSION = '1.0';

/**
 * Returns the full evaluation config for a single question ID.
 * Throws if the question is not registered — all 20 questions must have an entry.
 */
export function getQuestionEvalConfig(questionId: string): QuestionEvaluationConfig {
  const config = REGISTRY_BY_ID.get(questionId);
  if (!config) {
    throw new Error(
      `[QER] Question ID "${questionId}" is not registered. ` +
      `All 20 questions must have a QuestionEvaluationConfig entry.`,
    );
  }
  return config;
}

/**
 * Returns all evaluation configs for a given pillar, in registry order.
 */
export function getPillarEvalConfigs(pillar: PillarKey): QuestionEvaluationConfig[] {
  return REGISTRY_BY_PILLAR.get(pillar) ?? [];
}

/** Returns all 20 question evaluation configs. */
export function getAllQuestionEvalConfigs(): QuestionEvaluationConfig[] {
  return [...REGISTRY];
}

/** Returns the number of registered questions (must always be 20). */
export function getQERCount(): number {
  return REGISTRY.length;
}
