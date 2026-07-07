/**
 * supabase/functions/analyze-5s/audit-engine/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete shared type contract for the ARCOLAB 5S Audit Engine (Phase 4).
 *
 * Phase 4 additions:
 *  - AuditEvidenceModel + sub-types (Stage A output)
 *  - QuestionDecisionConfig (ADM entry)
 *  - Decision strategy, rating, evidence, confidence policy key types
 *  - QuestionExplainability metadata
 *  - decisionMatrixVersion in AuditEngineVersions
 *  - evidenceModel + decisionMatrixVersion in AuditSessionResult
 *
 * Phase 4.1 additions:
 *  - CRITICAL added to ViolationSeverity
 *  - CalibrationSeverity, QuestionCalibrationConfig, CalibrationRuleKey
 *  - EvidenceCoverage, BalanceResult (calibration layer outputs)
 *  - ConsistencyFlag (cross-question consistency)
 *  - ReliabilityScore (overall audit reliability)
 *  - AuditSessionResult extended with calibration + reliability fields
 *
 * Phase 4.2 additions:
 *  - ReliabilityScore extended with positiveFactors + limitingFactors
 *  - AuditSessionResult extended with decisionTraces (optional, internal)
 *  - AUDIT_ENGINE_VERSIONS updated to '4.2'
 *
 * Design invariants:
 *  - No pillar-specific logic
 *  - No zone-specific logic
 *  - No prompt content
 *  - AI never receives RATING_TO_SCORE
 */

// ── Engine Versions ────────────────────────────────────────────────────────────

export const AUDIT_ENGINE_VERSIONS = {
  engineVersion:         '5.0',   // Knowledge Architecture Upgrade (R11)
  promptVersion:         '5.0',
  knowledgeBaseVersion:  '3B.0',
  decisionMatrixVersion: '2.0',   // Now served by QuestionEvaluationRegistry
  calibrationVersion:    '2.0',   // Now served by QuestionEvaluationRegistry
  ecmVersion:            '1.0',   // Evidence Capability Matrix
  qerVersion:            '1.0',   // Question Evaluation Registry
} as const;

export type AuditEngineVersions = typeof AUDIT_ENGINE_VERSIONS;

// ── Ratings ────────────────────────────────────────────────────────────────────

export type AuditRating =
  | 'Very Bad'
  | 'Bad'
  | 'Average'
  | 'Good'
  | 'Very Good'
  | 'NOT_VISIBLE';

export const VALID_RATINGS: readonly AuditRating[] = [
  'Very Bad',
  'Bad',
  'Average',
  'Good',
  'Very Good',
  'NOT_VISIBLE',
];

/**
 * Backend-owned scoring map. Never sent to the AI.
 * The AI returns only the rating label.
 */
export const RATING_TO_SCORE: Readonly<Record<AuditRating, number>> = {
  'Very Bad':    0,
  'Bad':         1,
  'Average':     2,
  'Good':        3,
  'Very Good':   4,
  'NOT_VISIBLE': 0,
};

// ── Pillar Identifiers ─────────────────────────────────────────────────────────

export type PillarKey =
  | 'SORT'
  | 'SET_IN_ORDER'
  | 'SHINE'
  | 'STANDARDIZE'
  | 'SUSTAIN';

// ── Zone Knowledge Dimensions ──────────────────────────────────────────────────

export interface ZoneKnowledge {
  zoneName:                 string;
  expectedEquipment:        string[];
  expectedDocuments:        string[];
  expectedSafetyAssets:     string[];
  expectedLayout:           string[];
  expectedVisualControls:   string[];
  expectedCleanliness:      string[];
  expectedStoragePractices: string[];
}

export type ZoneDimension =
  | 'expectedEquipment'
  | 'expectedDocuments'
  | 'expectedSafetyAssets'
  | 'expectedLayout'
  | 'expectedVisualControls'
  | 'expectedCleanliness'
  | 'expectedStoragePractices';

export type PillarDimensionMap = Readonly<Record<PillarKey, ZoneDimension[]>>;

export const PILLAR_DIMENSION_MAP: PillarDimensionMap = {
  SORT:         ['expectedEquipment', 'expectedDocuments', 'expectedLayout'],
  SET_IN_ORDER: ['expectedEquipment', 'expectedLayout', 'expectedVisualControls', 'expectedStoragePractices'],
  SHINE:        ['expectedCleanliness', 'expectedEquipment', 'expectedLayout'],
  STANDARDIZE:  ['expectedVisualControls', 'expectedDocuments', 'expectedStoragePractices'],
  SUSTAIN:      ['expectedDocuments', 'expectedVisualControls', 'expectedSafetyAssets'],
};

// ── Pillar Configuration ───────────────────────────────────────────────────────

export interface AuditQuestion {
  questionId:   string;
  question:     string;
  displayOrder: number;
}

export interface PillarConfig {
  pillar:          PillarKey;
  label:           string;
  jpLabel:         string;
  displayOrder:    number;
  benchmarkScore:  number;
  questions:       AuditQuestion[];
}

// ── Prompt Templates ───────────────────────────────────────────────────────────

export interface PillarPromptTemplate {
  role:                 string;
  evaluationPrinciples: string;
}

// ── Workspace Context ──────────────────────────────────────────────────────────

export interface WorkspaceContext {
  industry:               string;
  department:             string;
  selected_zone:          string;
  area_name:              string;
  workspace_type:         string;
  expected_equipment:     string;
  expected_safety_assets: string;
}

// ── Phase 4: AuditEvidenceModel ────────────────────────────────────────────────

/** Whether an observation is unambiguously visible, plausible, or indeterminate */
export type ObservationType = 'DIRECT' | 'INFERENCE' | 'UNKNOWN';

/** Object category for the 4-category classification + UNKNOWN */
export type ObjectCategory = 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';
// A = Expected Equipment  / critical / directly observable  (never penalize for presence)
// B = Expected Support    / zone-dependent / contextual      (never penalize for presence)
// C = Temporary Work Item / inferred / indirect only         (penalize only if clearly abandoned)
// D = Clearly Unnecessary / explicit violation artifact      (may reduce score)
// UNKNOWN = indeterminate                                    (never penalize)

export type EvidenceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Violation severity — CRITICAL added in Phase 4.1.
 * CRITICAL: blocked emergency access, major chemical spill, exposed live electrical,
 *           or any hazard requiring immediate corrective action.
 * Stage A (EvidenceGenerator) may classify CRITICAL violations.
 * CalibrationService enforces CRITICAL → Very Bad override post-Stage B.
 */
export type ViolationSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

/**
 * Calibration severity — used internally by CalibrationRules and
 * AuditCalibrationMatrix. Separate from ViolationSeverity to allow
 * calibration rules to reference categories that don't map 1:1 to violations.
 */
export type CalibrationSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

export interface VisibleObject {
  description:     string;            // e.g. "blue chemical drum, 200L"
  category:        ObjectCategory;
  observationType: ObservationType;   // Only DIRECT objects may generate violations
  quantity?:       string;            // e.g. "three", "several"
  location?:       string;            // e.g. "left foreground", "rear aisle"
}

export interface PositiveObservation {
  dimension:       string;            // e.g. "layout", "cleanliness", "labelling"
  observation:     string;
  observationType: 'DIRECT' | 'INFERENCE';
  confidence:      EvidenceConfidence;
}

export interface ViolationObservation {
  dimension:       string;
  observation:     string;
  severity:        ViolationSeverity;
  evidence:        string;            // Must reference a specific visible object
  imageLocation:   string;           // e.g. "left foreground", "centre aisle"
  observationType: 'DIRECT';         // Violations are DIRECT-only
  confidence:      EvidenceConfidence;
}

export interface AuditEvidenceModel {
  generatedAt:        string;                   // ISO timestamp
  zone:               string;                   // Resolved zone name
  expectedObjects:    string[];                 // From AuditKnowledgeBase
  visibleObjects:     VisibleObject[];          // All classified objects
  positiveCompliance: PositiveObservation[];    // All visible compliance
  violations:         ViolationObservation[];   // All visible non-compliance
  overallConfidence:  EvidenceConfidence;
  imageNotes:         string;                   // Image quality notes
  // Populated after Stage B runs:
  questionExplainability?: QuestionExplainability[];
}

export interface QuestionExplainability {
  questionId:          string;
  questionType:        1 | 2 | 3;
  evidenceCategory:    'A' | 'B' | 'C';
  decisionStrategy:    string;
  visibleObjectsUsed:  VisibleObject[];
  positiveEvidence:    PositiveObservation[];
  violationsApplied:   ViolationObservation[];
  deductionsJustified: boolean;
  confidence:          EvidenceConfidence;
  rating:              AuditRating;
  reasoning:           string;
}

// ── Phase 4: Audit Decision Matrix Types ───────────────────────────────────────

export type DecisionStrategy =
  | 'VIOLATION_BASED'         // Deduct only on directly visible violations
  | 'COMPLIANCE_BASED'        // Score derives from observable compliance indicators
  | 'CONDITION_ASSESSMENT'    // Score reflects visible physical condition
  | 'PRESENCE_DETECTION'      // Score reflects presence/absence of visible elements
  | 'VISUAL_CONTEXT'          // Requires visible evidence + zone knowledge
  | 'CONSERVATIVE_INFERENCE'; // Type 3: neutral rating, LOW confidence, no deductions

export type RatingPolicyKey    = 'STANDARD' | 'CONSERVATIVE' | 'NEUTRAL_ONLY';
export type EvidencePolicyKey  = 'DIRECT_ONLY' | 'POSITIVE_FIRST' | 'ZONE_AWARE' | 'NO_ABSENCE_REASONING' | 'CONSERVATIVE';
export type ConfidencePolicyKey = 'STANDARD' | 'CONSERVATIVE' | 'FORCED_LOW';

export interface QuestionDecisionConfig {
  questionId:        string;
  pillar:            PillarKey;
  questionType:      1 | 2 | 3;
  evidenceCategory:  'A' | 'B' | 'C';
  decisionStrategy:  DecisionStrategy;
  requiredEvidence:  string[];    // What must be visible to fully evaluate
  forbiddenEvidence: string[];    // Phrases that must NOT appear as violation evidence
  contextRequired:   boolean;
  ratingPolicy:      RatingPolicyKey;
  evidencePolicy:    EvidencePolicyKey;
  confidencePolicy:  ConfidencePolicyKey;
}

// ── Phase 4.1: Calibration Types ───────────────────────────────────────────────────

export type CalibrationRuleKey =
  | 'ISOLATED_ITEM_NO_PENALTY'
  | 'SINGLE_DUSTY_SURFACE_MINOR'
  | 'BLOCKED_EMERGENCY_ACCESS_CRITICAL'
  | 'SINGLE_UNLABELED_CONTAINER_MODERATE'
  | 'LOOSE_ITEM_IN_ACTIVE_ZONE_MINOR'
  | 'MULTIPLE_UNLABELED_EQUIPMENT_MAJOR'
  | 'CHEMICAL_SPILL_VISIBLE_MAJOR'
  | 'RUST_OR_CORROSION_MODERATE'
  | 'ABSENT_CLEANING_TOOLS_MODERATE'
  | 'ABSENT_FLOOR_MARKINGS_MODERATE'
  | 'ABSENT_ALL_LABELS_MAJOR'
  | 'ABSENT_SOP_AT_WORKSTATION_MODERATE';

export interface SeverityThreshold {
  /** How many violations of this severity trigger a rating cap */
  triggersAt: number;
  /** Maximum rating once this threshold is triggered */
  ratingCap:  AuditRating;
}

export interface PositiveInfluenceRule {
  /** Minimum positive findings to partially offset violations */
  minimumPositiveCount: number;
  /** Rating floor guaranteed when positive minimum is met */
  ratingFloor:          AuditRating;
  /** If true, isolated MINOR violations are suppressed when positive evidence is strong */
  suppressMinor:        boolean;
}

export interface EscalationRule {
  /** Observation fragment that triggers escalation */
  pattern:      string;
  forcedRating: 'Very Bad';
  reason:       string;
}

export interface QuestionCalibrationConfig {
  questionId:        string;
  /** How many MINOR violations are tolerated before rating drops */
  minorTolerance:    number;
  thresholds:        Partial<Record<CalibrationSeverity, SeverityThreshold>>;
  positiveInfluence: PositiveInfluenceRule;
  escalationRules:   EscalationRule[];
  calibrationRules:  CalibrationRuleKey[];
}

/** Per-question coverage report (deterministic, computed from AuditEvidenceModel) */
export interface EvidenceCoverage {
  questionId:             string;
  relevantObjectsFound:   number;
  expectedObjectTypes:    number;
  positiveCount:          number;
  violationCount:         number;
  evidenceQuality:        'HIGH' | 'MEDIUM' | 'LOW';
  contextCompleteness:    'FULL' | 'PARTIAL' | 'MINIMAL';
  coveragePercentage:     number;           // 0–100
  recommendedConfidence:  EvidenceConfidence;

  // Added in R11.1
  requiredCoverage?:          number; // 0–100
  primaryEvidenceCoverage?:   number; // 0–100
  supportingEvidenceCoverage?: number; // 0–100
  capabilityScore?:           number; // 0–100
}

/** Per-question positive vs violation balance result */
export interface BalanceResult {
  questionId:         string;
  positiveScore:      number;
  violationScore:     number;
  balanceRatio:       number;           // 0.0–1.0
  suppressMinor:      boolean;
  ratingGuidance:     AuditRating;
  balanceExplanation: string;
}

/** Detected cross-question logical inconsistency */
export interface ConsistencyFlag {
  flagId:          string;
  questionIds:     string[];     // The two questions that are inconsistent
  description:     string;
  confidenceDrop:  number;       // Percentage points to deduct from affected questions
  severity:        'MINOR' | 'MODERATE' | 'MAJOR';
}

/** Overall audit reliability score */
export type ReliabilityLevel = 'EXCELLENT' | 'HIGH' | 'MODERATE' | 'LOW';

export interface ReliabilityScore {
  level:                 ReliabilityLevel;
  label:                 string;
  score:                 number;      // 0–100
  evidenceCoverageAvg:   number;      // Average coverage % across all questions
  imageQualityScore:     number;      // 0–100 from AuditEvidenceModel.overallConfidence
  consistencyScore:      number;      // 0–100 (penalised by ConsistencyFlags)
  contextCompleteScore:  number;      // 0–100 from FULL/PARTIAL/MINIMAL across questions
  reasons:               string[];    // Combined positive + limiting (backwards compat)
  /** Phase 4.2: Strengths of this audit (displayed as ✓ bullet points) */
  positiveFactors:       string[];
  /** Phase 4.2: Limiting factors / caveats (displayed as ⚠ bullet points) */
  limitingFactors:       string[];
}

/** Recommendation priority category and ordering */
export type RecommendationCategory =
  | 'Safety'
  | 'Compliance'
  | 'Organization'
  | 'Housekeeping'
  | 'Continuous Improvement';

export type RecommendationPriority = 'Immediate' | 'High' | 'Medium' | 'Low';

export interface PrioritizedRecommendation {
  questionId:     string;
  pillar:         PillarKey;
  category:       RecommendationCategory;
  priority:       RecommendationPriority;
  title:          string;
  description:    string;
  evidence:       string;    // Specific object reference from AuditEvidenceModel
  rating:         AuditRating;
  severityBasis:  CalibrationSeverity;
  sortKey:        number;    // Lower = higher priority (used for ordered output)
}

// ── Question Result ────────────────────────────────────────────────────────────

export interface QuestionResult {
  questionId:      string;
  question:        string;
  rating:          AuditRating;
  score:           number;
  benchmarkScore:  number;
  evidence:        string;
  assessment:      string;
  confidence:      string;
  improvementHint: null;
}

// ── Pillar Result ──────────────────────────────────────────────────────────────

export interface PillarResult {
  pillar:      PillarKey;
  label:       string;
  jpLabel:     string;
  questions:   QuestionResult[];
  pillarScore: number;
  maxScore:    number;
  percentage:  number;
  rating:      string;
}

// ── Audit Session Result ───────────────────────────────────────────────────────

export interface AuditSessionResult {
  context:               WorkspaceContext;
  pillars:               PillarResult[];
  overallScore:          number;
  overallMaxScore:       number;
  overallPercentage:     number;
  overallRating:         string;
  recommendations:       PrioritizedRecommendation[] | null;
  summary:               null;
  versions:              AuditEngineVersions;
  metrics:               AuditMetrics[];
  modelUsed:             string;
  analyzedAt:            string;
  evidenceModel:         AuditEvidenceModel;           // Phase 4: Stage A output
  decisionMatrixVersion: string;                       // Phase 4: '1.0'
  // Phase 4.1 fields
  calibration?: {
    coverageResults:     EvidenceCoverage[];            // Per-question coverage
    balanceResults:      BalanceResult[];               // Per-question positive/violation balance
    consistencyFlags:    ConsistencyFlag[];             // Cross-question inconsistencies
    reliabilityScore:    ReliabilityScore;              // Overall audit reliability
  };
  /**
   * Phase 4.2: Internal decision traces for every question.
   * NOT displayed by default — internal audit record for debugging and replay.
   * Serialised as a plain object (not Map) for JSON compatibility.
   */
  decisionTraces?: Record<string, unknown>;            // DecisionTrace[] keyed by questionId
}

// ── Audit Metrics ──────────────────────────────────────────────────────────────

export interface AuditEvidenceMetrics {
  responseTimeMs:     number;
  tokensUsed:         number | null;
  objectsInventoried: number;
  positiveFindings:   number;
  violations:         number;
  parseFailure:       boolean;
  confidence:         EvidenceConfidence;
  recordedAt:         string;
}

export interface AuditMetrics {
  pillar:                string;
  responseTimeMs:        number;
  modelUsed:             string;
  promptSections:        number;
  promptLengthChars:     number;
  tokensUsed:            number | null;
  parseFailures:         number;
  validationCorrections: number;
  reflectionCorrections: number;
  notVisibleCount:       number;
  recordedAt:            string;
}

// ── LLM Provider Interface ─────────────────────────────────────────────────────

export interface LLMRequest {
  systemPrompt: string;
  imageBase64:  string;   // Empty string '' for text-only Stage B calls
  temperature:  number;
}

export interface LLMResponse {
  rawText:    string;
  model:      string;
  tokensUsed: number | null;
}

export type LLMProviderType = 'gemini';

export interface LLMProviderConfig {
  provider: LLMProviderType;
  apiKey:   string;
  model:    string;
}

// ── R11: Inspection Procedure (Structured JSON) ────────────────────────────────

/**
 * A single step in a question's structured inspection procedure.
 * PromptBuilder converts these into numbered human-readable instructions.
 */
export interface InspectionStep {
  step:            number;
  action:          string;     // e.g. "Detect all visible tools and trays"
  condition?:      string;     // e.g. "If category D tool found"
  expectedOutcome: string;     // e.g. "Identify quantity and whether in designated storage"
}

// ── R11: Evidence Weight Levels ────────────────────────────────────────────────

export type EvidenceWeightLevel = 'PRIMARY' | 'SUPPORTING' | 'CONTEXTUAL';

/** Weight values used in confidence calculations */
export const EVIDENCE_WEIGHTS: Readonly<Record<EvidenceWeightLevel, number>> = {
  PRIMARY:    1.0,
  SUPPORTING: 0.7,
  CONTEXTUAL: 0.4,
} as const;

/** An evidence priority tier within a question's ECM entry */
export interface EvidencePriorityTier {
  level:       1 | 2 | 3 | 4;
  label:       EvidenceWeightLevel | 'NONE';
  weight:      number;          // 0.0–1.0
  description: string;
  examples:    string[];
  /** Only set for L3/L4 — caps the maximum achievable rating */
  maxRating?:  AuditRating;
}

// ── R11: Evidence Capability Matrix Entry ──────────────────────────────────────

/**
 * Per-question entry in the Evidence Capability Matrix.
 * Defines WHAT evidence is permitted to influence each audit question.
 * The EvidenceFilterService enforces these rules before any reasoning begins.
 */
export interface EvidenceCapabilityEntry {
  questionId:           string;
  /** Object category codes (A/B/C/D/UNKNOWN) allowed as evidence */
  allowedCategories:    ObjectCategory[];
  /** Canonical object labels that MUST be observed to fully evaluate this question */
  requiredObjectTypes:  string[];
  /** High-weight evidence — directly relevant to the question */
  primaryEvidence:      string[];
  /** Supporting evidence — relevant but lower weight */
  supportingEvidence:   string[];
  /** Object types that must NEVER influence this question's rating */
  forbiddenObjectTypes: string[];
  /** Semantic aliases: maps a canonical label to alternative descriptions */
  objectAliases:        Record<string, string[]>;
  /** Tiered evidence confidence model */
  evidencePriority:     EvidencePriorityTier[];
}

// ── R11: Filtered Evidence Model (output of EvidenceFilterService) ─────────────

/**
 * Per-question filtered view of the AuditEvidenceModel.
 * Only contains evidence approved by the Evidence Capability Matrix.
 * No forbidden objects or violations reach the reasoning stage.
 */
export interface FilteredEvidenceModel {
  questionId:           string;
  allowedObjects:       VisibleObject[];
  allowedPositive:      PositiveObservation[];
  allowedViolations:    ViolationObservation[];
  discardedObjects:     number;    // Telemetry — objects removed by ECM
  discardedViolations:  number;    // Telemetry — violations removed by ECM
  canVerify:            boolean;   // False if no required objects found
  evidenceWeightScore:  number;    // 0.0–1.0 weighted evidence quality
  ecmVersion:           string;

  // Added in R11.1
  filteredObjects?:     VisibleObject[];
  discardedObjectsList?: VisibleObject[];
  discardReasons?:      string[];
}

// ── R11: Recommendation Template (embedded in QER) ────────────────────────────

export interface RecommendationTemplate {
  category:                RecommendationCategory;
  priority:                RecommendationPriority;
  title:                   string;
  corrective:              string;
  expectedBenefit:         string;
  estimatedScoreGain:      string;
  implementationDifficulty: 'Easy' | 'Medium' | 'Hard';
  timeEstimate:            string;
}

// ── R11: Question Evaluation Registry Entry ────────────────────────────────────

/**
 * Unified per-question configuration record.
 * The single source of truth for HOW every audit question is evaluated.
 *
 * Merges:
 *  - AuditDecisionMatrix (decision strategy, evidence/confidence policy)
 *  - AuditCalibrationMatrix (thresholds, escalation, positive influence)
 *  - RecommendationPriorityService category maps
 *  - CrossQuestionConsistencyService dependency lists
 *  - New: inspectionProcedure (structured decision tree)
 *  - New: recommendationTemplate (corrective action guidance)
 *  - New: consistencyDependencies (explicit cross-question links)
 *
 * Adding a new audit question requires ONLY adding one entry here
 * and one entry in EvidenceCapabilityMatrix.
 * No other files need modification.
 */
export type EvidenceIntent =
  | 'PRESENCE_DETECTION'
  | 'ABSENCE_DETECTION'
  | 'CONDITION_ASSESSMENT'
  | 'ORGANIZATION_ASSESSMENT'
  | 'CLEANLINESS_ASSESSMENT'
  | 'DOCUMENTATION_PRESENCE'
  | 'VISUAL_STANDARD_ASSESSMENT';

export interface QuestionEvaluationConfig {
  // ── Identity ──────────────────────────────────────────────────────
  questionId:   string;
  questionText: string;
  pillar:       PillarKey;
  auditIntent:  string;          // Plain-English purpose of this question
  evidenceIntent: EvidenceIntent; // R11.1: Intent of the evidence check

  // ── Decision Strategy (from former AuditDecisionMatrix) ───────────
  questionType:     1 | 2 | 3;
  evidenceCategory: 'A' | 'B' | 'C';
  decisionStrategy: DecisionStrategy;
  contextRequired:  boolean;
  ratingPolicy:     RatingPolicyKey;
  evidencePolicy:   EvidencePolicyKey;
  confidencePolicy: ConfidencePolicyKey;
  requiredEvidence: string[];    // Evidence patterns needed for full evaluation
  forbiddenEvidence: string[];   // Phrases that must NEVER appear as violation basis

  // ── Structured Inspection Procedure (R11 Refinement 2) ───────────
  inspectionProcedure: InspectionStep[];

  // ── Calibration (from former AuditCalibrationMatrix) ─────────────
  minorTolerance:    number;
  thresholds:        Partial<Record<CalibrationSeverity, SeverityThreshold>>;
  positiveInfluence: PositiveInfluenceRule;
  escalationRules:   EscalationRule[];
  calibrationRules:  CalibrationRuleKey[];

  // ── Cross-Question Dependencies ───────────────────────────────────
  consistencyDependencies: string[];  // Question IDs this question cross-checks

  // ── Recommendation Template ───────────────────────────────────────
  recommendationTemplate: RecommendationTemplate;

  // ── Output Schema Hint ────────────────────────────────────────────
  outputFields: Array<'rating' | 'evidence' | 'reason' | 'confidence'>;
}

