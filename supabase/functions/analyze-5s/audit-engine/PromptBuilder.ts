/**
 * supabase/functions/analyze-5s/audit-engine/PromptBuilder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Policy-driven prompt assembler (Phase 4 / 4.1).
 *
 * Phase 4 changes:
 *  - buildEvidencePrompt() moved to EvidenceGenerator (Stage A)
 *  - buildEvaluatorPrompt() replaces build() for Stage B pillar calls
 *  - All evaluation logic removed from PromptBuilder — sourced from policies
 *  - PromptBuilder is now a pure assembler with zero evaluation logic
 *
 * Phase 4.1 additions:
 *  - buildCalibrationSummarySection(): injects one-line calibration summaries
 *    (coverage % + balance guidance) per question between sections 6 and 7
 *  - buildEvaluatorPrompt() gains optional coverages + balances parameters
 *  - Compact one-line format (Q2 decision: no verbose JSON injected)
 *
 * Sections assembled for Stage B (buildEvaluatorPrompt):
 *  1. Role (pillar-specific)
 *  2. Universal Audit Header (from PromptPolicies)
 *  3. Evidence Model (serialized AuditEvidenceModel)
 *  4. Workspace Context
 *  5. Zone Knowledge (pillar-filtered dimensions)
 *  6. Evaluation Instructions (Universal + Strategy-specific per question)
 *  6.5 Calibration Summaries (coverage + balance per question) ← Phase 4.1
 *  7. Question List
 *  8. Response Schema
 *  9. Reflection Checklist
 *
 * Design invariants:
 *  - Zero hardcoded zone names
 *  - Zero hardcoded question text
 *  - Zero hardcoded pillar names
 *  - Zero evaluation logic (all sourced from policies)
 *  - No AI calls
 *  - No parsing logic
 */

import type {
  PillarConfig,
  PillarPromptTemplate,
  WorkspaceContext,
  ZoneKnowledge,
  ZoneDimension,
  PillarDimensionMap,
  AuditEvidenceModel,
  QuestionDecisionConfig,
  EvidenceCoverage,
  BalanceResult,
  FilteredEvidenceModel,
} from './types.ts';
import {
  getPromptSection,
  type PromptSectionKey,
} from './policies/PromptPolicies.ts';
import { EvidenceCoverageService }  from './EvidenceCoverageService.ts';
import { PositiveBalanceService }    from './PositiveBalanceService.ts';
import { getQuestionEvalConfig }     from './QuestionEvaluationRegistry.ts';
import { getEvidenceCapability }     from './EvidenceCapabilityMatrix.ts';

// ── Dimension display labels ───────────────────────────────────────────────────

const DIMENSION_LABELS: Readonly<Record<ZoneDimension, string>> = {
  expectedEquipment:        'Expected Equipment',
  expectedDocuments:        'Expected Documents',
  expectedSafetyAssets:     'Expected Safety Assets',
  expectedLayout:           'Expected Layout',
  expectedVisualControls:   'Expected Visual Controls',
  expectedCleanliness:      'Expected Cleanliness Standards',
  expectedStoragePractices: 'Expected Storage Practices',
};

// ── Strategy → PromptSection mapping ──────────────────────────────────────────

const STRATEGY_TO_SECTION: Readonly<Record<string, PromptSectionKey>> = {
  VIOLATION_BASED:         'VIOLATION_BASED_INSTRUCTIONS',
  COMPLIANCE_BASED:        'COMPLIANCE_BASED_INSTRUCTIONS',
  CONDITION_ASSESSMENT:    'CONDITION_ASSESSMENT_INSTRUCTIONS',
  PRESENCE_DETECTION:      'PRESENCE_DETECTION_INSTRUCTIONS',
  VISUAL_CONTEXT:          'VISUAL_CONTEXT_INSTRUCTIONS',
  CONSERVATIVE_INFERENCE:  'CONSERVATIVE_INFERENCE_INSTRUCTIONS',
};

// ── Separator ─────────────────────────────────────────────────────────────────

const SEP = '\n\n' + '─'.repeat(80) + '\n\n';

// ── PromptBuilder ──────────────────────────────────────────────────────────────

export class PromptBuilder {

  // ── Section 1: Role ───────────────────────────────────────────────────────────

  static buildRoleSection(
    config:   PillarConfig,
    template: PillarPromptTemplate,
  ): string {
    return [
      `ROLE:`,
      template.role,
      ``,
      `PILLAR EVALUATION PRINCIPLES:`,
      template.evaluationPrinciples,
    ].join('\n');
  }

  // ── Section 2: Universal Header ──────────────────────────────────────────────

  static buildUniversalHeader(): string {
    return getPromptSection('UNIVERSAL_AUDIT_HEADER');
  }

  // ── Section 3: Evidence Model ─────────────────────────────────────────────────

  static buildEvidenceModelSection(evidence: AuditEvidenceModel): string {
    const lines: string[] = [
      `SHARED AUDIT EVIDENCE MODEL (generated from the workspace image):`,
      ``,
      `Zone Resolved: ${evidence.zone}`,
      `Overall Image Confidence: ${evidence.overallConfidence}`,
      evidence.imageNotes ? `Image Notes: ${evidence.imageNotes}` : '',
      ``,
    ];

    // Visible objects
    lines.push(`VISIBLE OBJECTS (${evidence.visibleObjects.length} identified):`);
    if (evidence.visibleObjects.length === 0) {
      lines.push(`  (No objects identified — use conservative evaluation)`);
    } else {
      for (const obj of evidence.visibleObjects) {
        const qty  = obj.quantity ? ` ×${obj.quantity}` : '';
        const loc  = obj.location ? ` [${obj.location}]` : '';
        lines.push(`  [${obj.category}/${obj.observationType}] ${obj.description}${qty}${loc}`);
      }
    }

    lines.push('');

    // Positive compliance
    lines.push(`POSITIVE COMPLIANCE FINDINGS (${evidence.positiveCompliance.length}):`);
    if (evidence.positiveCompliance.length === 0) {
      lines.push(`  (None recorded — apply conservative evaluation)`);
    } else {
      for (const pos of evidence.positiveCompliance) {
        lines.push(`  [${pos.dimension}/${pos.confidence}] ${pos.observation}`);
      }
    }

    lines.push('');

    // Violations
    lines.push(`VIOLATIONS (${evidence.violations.length} identified):`);
    if (evidence.violations.length === 0) {
      lines.push(`  (No violations detected in Stage A)`);
    } else {
      for (const v of evidence.violations) {
        lines.push(`  [${v.dimension}/${v.severity}/${v.confidence}] ${v.observation}`);
        lines.push(`    Evidence: "${v.evidence}" @ ${v.imageLocation}`);
      }
    }

    return lines.filter((l) => l !== '').join('\n');
  }

  // ── Section 4: Workspace Context ─────────────────────────────────────────────

  static buildWorkspaceContextSection(context: WorkspaceContext): string {
    return [
      `WORKSPACE CONTEXT:`,
      `  • Industry    : ${context.industry}`,
      `  • Department  : ${context.department}`,
      `  • Area Name   : ${context.area_name}`,
      `  • Zone Type   : ${context.workspace_type}`,
    ].join('\n');
  }

  // ── Section 5: Zone Knowledge ─────────────────────────────────────────────────

  static buildZoneKnowledgeSection(
    knowledge:    ZoneKnowledge,
    pillarKey:    string,
    dimensionMap: PillarDimensionMap,
  ): string {
    const activeDimensions =
      dimensionMap[pillarKey as keyof PillarDimensionMap] ??
      (Object.keys(DIMENSION_LABELS) as ZoneDimension[]);

    const lines: string[] = [
      `SELECTED ZONE: ${knowledge.zoneName}`,
      ``,
      `ZONE CHARACTERISTICS (relevant to this pillar):`,
    ];

    for (const dim of activeDimensions) {
      const label  = DIMENSION_LABELS[dim];
      const values = knowledge[dim] as string[];
      if (values.length === 0) continue;
      lines.push(`  • ${label}:`);
      for (const v of values) {
        lines.push(`      - ${v}`);
      }
    }

    lines.push('');
    lines.push(`Items listed above are EXPECTED for this zone.`);
    lines.push(`DO NOT penalize expected items. Do NOT apply expectations from other zone types.`);

    return lines.join('\n');
  }

  // ── Section 6: Strategy Instructions (R11 upgraded) ──────────────────────────

  /**
   * Builds per-question strategy instructions.
   * For each question, emits:
   *  - The strategy-specific instruction block (from PromptPolicies)
   *  - Structured inspection procedure (transformed from QER JSON steps)
   *  - ECM allowed object types and forbidden types for this question
   *  - Any context override
   *  - Forbidden evidence phrases
   *
   * PromptBuilder is the ONLY layer that transforms QER JSON into human text.
   * No business rules live here — only formatting.
   */
  static buildStrategySection(
    admConfigs:       QuestionDecisionConfig[],
    contextOverrides: Partial<Record<string, string>> = {},
    filteredMap:      Map<string, FilteredEvidenceModel> = new Map(),
  ): string {
    const lines: string[] = [
      `EVALUATION INSTRUCTIONS`,
      ``,
      getPromptSection('POSITIVE_COMPLIANCE_FIRST'),
      ``,
      getPromptSection('HUMAN_AUDITOR_DECISION_RULE'),
      ``,
      getPromptSection('EVIDENCE_CATEGORY_RULE'),
      ``,
      getPromptSection('FORBIDDEN_EVIDENCE_RULE'),
      ``,
      getPromptSection('CONFIDENCE_DEGRADATION_RULE'),
      ``,
      `────────────────────────────────────────────────────────────────────────────`,
      `PER-QUESTION STRATEGY ASSIGNMENTS:`,
    ];

    for (const cfg of admConfigs) {
      const sectionKey   = STRATEGY_TO_SECTION[cfg.decisionStrategy];
      const strategyText = sectionKey ? getPromptSection(sectionKey) : '';
      const override     = contextOverrides[cfg.questionId] ?? null;

      lines.push(``, `[${cfg.questionId}] — Type ${cfg.questionType} | Category ${cfg.evidenceCategory}`);
      lines.push(`  Strategy: ${cfg.decisionStrategy}`);

      if (strategyText) {
        lines.push(`  ${strategyText.split('\n').join('\n  ')}`);
      }

      // ── Structured Inspection Procedure (R11 Refinement 2) ──────────────
      try {
        const qerCfg = getQuestionEvalConfig(cfg.questionId);
        lines.push(`  Evidence Intent: ${qerCfg.evidenceIntent}`);
        if (qerCfg.inspectionProcedure.length > 0) {
          lines.push(`  INSPECTION PROCEDURE:`);
          for (const step of qerCfg.inspectionProcedure) {
            lines.push(`    Step ${step.step}: ${step.action}`);
            if (step.condition) {
              lines.push(`      → Condition: ${step.condition}`);
            }
            lines.push(`      → Expected outcome: ${step.expectedOutcome}`);
          }
        }
      } catch { /* QER lookup failed — skip inspection procedure */ }

      // ── ECM Evidence Capability (R11 Refinement 3 & 4) ──────────────────
      try {
        const ecm = getEvidenceCapability(cfg.questionId);
        if (ecm.requiredObjectTypes.length > 0) {
          lines.push(`  REQUIRED OBJECTS (must be visible to evaluate):`);
          lines.push(`    ${ecm.requiredObjectTypes.join(', ')}`);
          lines.push(`    If none of these are visible → return NOT_VISIBLE ("Cannot Verify")`);
        }
        if (ecm.primaryEvidence.length > 0) {
          lines.push(`  PRIMARY EVIDENCE (weight 1.0 — use these for rating decisions):`);
          lines.push(`    ${ecm.primaryEvidence.slice(0, 8).join(', ')}`);
        }
        if (ecm.supportingEvidence.length > 0) {
          lines.push(`  SUPPORTING EVIDENCE (weight 0.7 — context only):`);
          lines.push(`    ${ecm.supportingEvidence.slice(0, 6).join(', ')}`);
        }
        if (ecm.forbiddenObjectTypes.length > 0) {
          lines.push(`  FORBIDDEN OBJECTS (must NOT influence this question's rating):`);
          lines.push(`    ${ecm.forbiddenObjectTypes.slice(0, 8).join(', ')}`);
        }
      } catch { /* ECM lookup failed — skip capability injection */ }

      // ── Filtered evidence note (canVerify) ──────────────────────────────
      const filtered = filteredMap.get(cfg.questionId);
      if (filtered && !filtered.canVerify) {
        lines.push(`  ⚠ CANNOT VERIFY: No required objects found in filtered evidence.`);
        lines.push(`    Return rating: NOT_VISIBLE. Do not assume compliance or non-compliance.`);
      }

      if (override) {
        lines.push(`  ZONE OVERRIDE: ${override}`);
      }

      if (cfg.forbiddenEvidence.length > 0) {
        lines.push(`  Forbidden evidence phrases for this question:`);
        for (const fe of cfg.forbiddenEvidence) {
          lines.push(`    ✗ "${fe}"`);
        }
      }
    }

    return lines.join('\n');
  }

  // ── Section 7: Question List ───────────────────────────────────────────────────

  static buildQuestionListSection(config: PillarConfig): string {
    const lines: string[] = [
      `AUDIT QUESTIONS (${config.label.toUpperCase()} — ${config.jpLabel}):`,
      ``,
      `Evaluate ONLY these ${config.questions.length} questions. Do NOT evaluate questions from other pillars.`,
      ``,
    ];
    for (const q of config.questions) {
      lines.push(`  [${q.questionId}]  ${q.question}`);
    }
    return lines.join('\n');
  }

  // ── Section 8: Response Schema ────────────────────────────────────────────────

  static buildResponseSchemaSection(config: PillarConfig): string {
    const exampleEntry = {
      questionId:  config.questions[0]?.questionId ?? 'PILLAR-01',
      question:    config.questions[0]?.question   ?? 'Example question text.',
      rating:      'Good',
      evidence:    'Specific visible object reference from the Shared Evidence Model.',
      assessment:  'One sentence describing the compliance decision.',
      confidence:  '92%',
    };

    return [
      `RESPONSE FORMAT:`,
      ``,
      `Return ONLY a valid JSON array. No markdown code fences. No prose. No explanations.`,
      `The array must contain exactly ${config.questions.length} entries — one per question, in order.`,
      ``,
      `Required fields per entry:`,
      `  • questionId  — exact question ID (e.g. "${config.questions[0]?.questionId ?? 'PILLAR-01'}")`,
      `  • question    — full question text (copy exactly from the question list above)`,
      `  • rating      — one of: Very Bad | Bad | Average | Good | Very Good | NOT_VISIBLE`,
      `  • evidence    — one sentence citing a specific visible object from the Evidence Model`,
      `  • assessment  — one sentence describing the compliance decision`,
      `  • confidence  — percentage string (e.g. "87%") or "N/A" if NOT_VISIBLE`,
      ``,
      `IMPORTANT: evidence must reference the Shared Evidence Model — do NOT re-describe the image.`,
      ``,
      `Example (single entry):`,
      JSON.stringify([exampleEntry], null, 2),
    ].join('\n');
  }

  // ── Section 9: Reflection Checklist ──────────────────────────────────────────

  static buildReflectionSection(): string {
    return getPromptSection('REFLECTION_CHECKLIST');
  }

  // ── Stage B Assembly (R11 upgraded) ──────────────────────────────────────────

  /**
   * Assembles all 9 sections (+ optional calibration summary)
   * into the complete Stage B evaluator prompt.
   *
   * Section order is fixed and must not be changed.
   * The image is NOT re-sent — Stage B evaluators consume the evidence model only.
   *
   * R11: Now accepts filteredMap (FilteredEvidenceModel per question) to inject
   * ECM capability guidance and canVerify flags per question.
   *
   * @param coverages    - EvidenceCoverage per question (optional)
   * @param balances     - BalanceResult per question (optional)
   * @param filteredMap  - Filtered evidence per question from EvidenceFilterService (optional)
   */
  static buildEvaluatorPrompt(
    config:           PillarConfig,
    template:         PillarPromptTemplate,
    context:          WorkspaceContext,
    knowledge:        ZoneKnowledge,
    dimensionMap:     PillarDimensionMap,
    evidence:         AuditEvidenceModel,
    admConfigs:       QuestionDecisionConfig[],
    contextOverrides: Partial<Record<string, string>> = {},
    coverages:        EvidenceCoverage[]                         = [],
    balances:         BalanceResult[]                            = [],
    filteredMap:      Map<string, FilteredEvidenceModel>         = new Map(),
  ): string {
    const questionIds = config.questions.map((q) => q.questionId);

    const calibSection = PromptBuilder.buildCalibrationSummarySection(
      questionIds, coverages, balances,
    );

    const sections = [
      PromptBuilder.buildRoleSection(config, template),
      PromptBuilder.buildUniversalHeader(),
      PromptBuilder.buildEvidenceModelSection(evidence),
      PromptBuilder.buildWorkspaceContextSection(context),
      PromptBuilder.buildZoneKnowledgeSection(knowledge, config.pillar, dimensionMap),
      PromptBuilder.buildStrategySection(admConfigs, contextOverrides, filteredMap),
      ...(calibSection ? [calibSection] : []),
      PromptBuilder.buildQuestionListSection(config),
      PromptBuilder.buildResponseSchemaSection(config),
      PromptBuilder.buildReflectionSection(),
    ];

    return sections.join(SEP);
  }

  // ── Calibration summary section (Phase 4.1) ──────────────────────────────────
  static buildCalibrationSummarySection(
    questionIds: string[],
    coverages:   EvidenceCoverage[],
    balances:    BalanceResult[],
  ): string {
    if (!coverages || coverages.length === 0 || !balances || balances.length === 0) {
      return '';
    }

    const lines: string[] = [
      `CALIBRATION GUIDANCE FOR PILLAR QUESTIONS (PRE-STAGE B):`,
      `For each question, the following evidence coverage and positive balance guidance`,
      `have been computed from the Shared Evidence Model. Use this guidance to calibrate`,
      `your rating decisions and recommended confidence levels:`,
      ``,
    ];

    const covMap = new Map(coverages.map((c) => [c.questionId, c]));
    const balMap = new Map(balances.map((b) => [b.questionId, b]));

    for (const qId of questionIds) {
      const cov = covMap.get(qId);
      const bal = balMap.get(qId);
      if (cov && bal) {
        const covLine = EvidenceCoverageService.toOneLine(cov);
        const balLine = PositiveBalanceService.toOneLine(bal);
        lines.push(`  • [${qId}]  ${covLine} | ${balLine}`);
      }
    }

    return lines.join('\n');
  }

  // ── Legacy build() — DEPRECATED ──────────────────────────────────────────────
  // Retained for backwards compatibility during transition.
  // Phase 5: Remove this method.

  /** @deprecated Use buildEvaluatorPrompt() instead. */
  static build(
    config:       PillarConfig,
    context:      WorkspaceContext,
    knowledge:    ZoneKnowledge,
    template:     PillarPromptTemplate,
    dimensionMap: PillarDimensionMap,
  ): string {
    // Builds an empty evidence model for backwards-compatible fallback
    const emptyEvidence: AuditEvidenceModel = {
      generatedAt:        new Date().toISOString(),
      zone:               context.selected_zone,
      expectedObjects:    [],
      visibleObjects:     [],
      positiveCompliance: [],
      violations:         [],
      overallConfidence:  'LOW',
      imageNotes:         'Legacy mode — evidence model unavailable.',
    };
    return PromptBuilder.buildEvaluatorPrompt(
      config, template, context, knowledge,
      dimensionMap, emptyEvidence, [], {},
    );
  }

  /**
   * Helper to format the prompt strategy instructions for a single question.
   * Used by the Calibration Studio live preview.
   */
  static buildSingleQuestionPrompt(
    cfg: { questionId: string; questionType: number; evidenceCategory: string; decisionStrategy: string; forbiddenEvidence: string[] },
    qerCfg: { evidenceIntent: string; inspectionProcedure: Array<{ step: number; action: string; condition?: string; expectedOutcome: string }> },
    ecm: { requiredObjectTypes: string[]; primaryEvidence: string[]; supportingEvidence: string[]; forbiddenObjectTypes: string[] },
    filtered?: { canVerify: boolean },
    override?: string | null,
  ): string {
    const sectionKey   = STRATEGY_TO_SECTION[cfg.decisionStrategy];
    const strategyText = sectionKey ? getPromptSection(sectionKey) : '';

    const lines: string[] = [];
    lines.push(`[${cfg.questionId}] — Type ${cfg.questionType} | Category ${cfg.evidenceCategory}`);
    lines.push(`  Strategy: ${cfg.decisionStrategy}`);

    if (strategyText) {
      lines.push(`  ${strategyText.split('\n').join('\n  ')}`);
    }

    lines.push(`  Evidence Intent: ${qerCfg.evidenceIntent}`);
    if (qerCfg.inspectionProcedure.length > 0) {
      lines.push(`  INSPECTION PROCEDURE:`);
      for (const step of qerCfg.inspectionProcedure) {
        lines.push(`    Step ${step.step}: ${step.action}`);
        if (step.condition) {
          lines.push(`      → Condition: ${step.condition}`);
        }
        lines.push(`      → Expected outcome: ${step.expectedOutcome}`);
      }
    }

    if (ecm.requiredObjectTypes.length > 0) {
      lines.push(`  REQUIRED OBJECTS (must be visible to evaluate):`);
      lines.push(`    ${ecm.requiredObjectTypes.join(', ')}`);
      lines.push(`    If none of these are visible → return NOT_VISIBLE ("Cannot Verify")`);
    }
    if (ecm.primaryEvidence.length > 0) {
      lines.push(`  PRIMARY EVIDENCE (weight 1.0 — use these for rating decisions):`);
      lines.push(`    ${ecm.primaryEvidence.slice(0, 8).join(', ')}`);
    }
    if (ecm.supportingEvidence.length > 0) {
      lines.push(`  SUPPORTING EVIDENCE (weight 0.7 — context only):`);
      lines.push(`    ${ecm.supportingEvidence.slice(0, 6).join(', ')}`);
    }
    if (ecm.forbiddenObjectTypes.length > 0) {
      lines.push(`  FORBIDDEN OBJECTS (must NOT influence this question's rating):`);
      lines.push(`    ${ecm.forbiddenObjectTypes.slice(0, 8).join(', ')}`);
    }

    if (filtered && !filtered.canVerify) {
      lines.push(`  ⚠ CANNOT VERIFY: No required objects found in filtered evidence.`);
      lines.push(`    Return rating: NOT_VISIBLE. Do not assume compliance or non-compliance.`);
    }

    if (override) {
      lines.push(`  ZONE OVERRIDE: ${override}`);
    }

    if (cfg.forbiddenEvidence.length > 0) {
      lines.push(`  Forbidden evidence phrases for this question:`);
      for (const fe of cfg.forbiddenEvidence) {
        lines.push(`    - "${fe}"`);
      }
    }

    return lines.join('\n');
  }
}
