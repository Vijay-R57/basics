/**
 * supabase/functions/analyze-5s/audit-engine/AuditEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Core orchestrator for the ARCOLAB 5S Audit Engine (Phase 4 / 4.1).
 *
 * Phase 4 changes:
 *  - Added generateEvidence() — Stage A: one vision call per audit
 *  - Modified runPillar() — Stage B: text-only call consuming evidence model
 *  - buildSessionResult() now requires and stores evidenceModel
 *  - AuditDecisionMatrix consulted per pillar to load question configs
 *  - ContextPolicies consulted for zone overrides
 *
 * Phase 4.1 additions:
 *  - EvidenceCoverageService + PositiveBalanceService compute pre-Stage B guidance
 *  - PromptBuilder injects one-line calibration summaries per question
 *  - CalibrationService applies post-Stage B escalation overrides
 *  - CrossQuestionConsistencyService validates logical consistency across all pillars
 *  - AuditReliabilityService computes overall audit reliability score
 *  - RecommendationPriorityService generates prioritized recommendations
 *
 * Phase 4.2 additions:
 *  - DecisionTraceService builds a full reasoning trace per question
 *  - Traces exposed on AuditSessionResult.decisionTraces (internal, not displayed)
 *  - AuditReliabilityService now returns positiveFactors + limitingFactors
 *
 * LLM call summary:
 *  Stage A: 1 vision call  (temperature 0.0, image + prompt)
 *  Stage B: 5 text calls   (temperature 0.1, evidence model + prompt, no image)
 *
 * Design invariants:
 *  - Zero pillar names (config drives everything)
 *  - Zero zone names (AuditKnowledgeBase + ContextPolicies drive everything)
 *  - Zero question text (config drives everything)
 *  - Zero prompt content (PromptBuilder drives everything)
 *  - Zero direct AI calls (LLMProvider drives everything)
 *  - AI never calculates scores (RATING_TO_SCORE is backend-only)
 */

import { resolveZoneKnowledge }                         from './AuditKnowledgeBase.ts';
import { PromptBuilder }                                from './PromptBuilder.ts';
import { AuditValidator, detectReflectionCorrections }  from './AuditValidator.ts';
import { AuditMetricsCollector }                        from './AuditMetrics.ts';
import { EvidenceGenerator }                            from './EvidenceGenerator.ts';
import { EvidenceValidator }                            from './EvidenceValidator.ts';
import { getPillarConfigs, DECISION_MATRIX_VERSION }   from './AuditDecisionMatrix.ts';
import { getAllCalibrationConfigs }                     from './AuditCalibrationMatrix.ts';
import { EvidenceCoverageService }                     from './EvidenceCoverageService.ts';
import { PositiveBalanceService }                      from './PositiveBalanceService.ts';
import { CalibrationService }                          from './CalibrationService.ts';
import { CrossQuestionConsistencyService }             from './CrossQuestionConsistencyService.ts';
import { AuditReliabilityService }                     from './AuditReliabilityService.ts';
import { RecommendationPriorityService }               from './RecommendationPriorityService.ts';
import { DecisionTraceService }                        from './DecisionTraceService.ts';
import { EvidenceFilterService }                       from './EvidenceFilterService.ts';  // R11
import { resolveContextPolicy, getQuestionOverride }    from './policies/ContextPolicies.ts';
import type { LLMProvider }                            from './LLMProvider.ts';
import type {
  PillarConfig,
  PillarPromptTemplate,
  WorkspaceContext,
  PillarResult,
  AuditSessionResult,
  AuditMetrics,
  AuditEvidenceModel,
  QuestionResult,
  EvidenceCoverage,
  BalanceResult,
} from './types.ts';
import {
  RATING_TO_SCORE,
  PILLAR_DIMENSION_MAP,
  AUDIT_ENGINE_VERSIONS,
} from './types.ts';

// ── Pillar rating derivation ───────────────────────────────────────────────────

function deriveRating(percentage: number): string {
  if (percentage >= 88) return 'Very Good';
  if (percentage >= 63) return 'Good';
  if (percentage >= 38) return 'Average';
  if (percentage >= 13) return 'Bad';
  return 'Very Bad';
}

// ── Overall session rating ─────────────────────────────────────────────────────

function deriveOverallRating(percentage: number): string {
  if (percentage >= 90) return 'Excellent';
  if (percentage >= 75) return 'Very Good';
  if (percentage >= 60) return 'Good';
  if (percentage >= 40) return 'Average';
  if (percentage >= 20) return 'Needs Improvement';
  return 'Poor';
}

// ── AuditEngine ────────────────────────────────────────────────────────────────

export class AuditEngine {
  private provider:          LLMProvider;
  private evidenceGenerator: EvidenceGenerator;

  constructor(provider: LLMProvider) {
    this.provider          = provider;
    this.evidenceGenerator = new EvidenceGenerator(provider);
  }

  // ── Stage A: Evidence Generation ─────────────────────────────────────────────

  /**
   * Stage A — generates the shared AuditEvidenceModel from the workspace image.
   *
   * Called ONCE per audit. All Stage B pillar evaluators consume this model.
   * The image is NOT sent to Stage B calls — evidence is pre-extracted here.
   *
   * @param imageBase64  - Workspace image as base64 data URI
   * @param context      - Workspace context from request payload
   * @returns            - Validated AuditEvidenceModel + Stage A telemetry
   */
  async generateEvidence(
    imageBase64: string,
    context:     WorkspaceContext,
  ): Promise<{
    evidence:     AuditEvidenceModel;
    tokensUsed:   number | null;
    parseFailure: boolean;
    dropped:      number;
  }> {
    // Resolve zone knowledge (all 7 dimensions) for evidence prompt context
    const knowledge = resolveZoneKnowledge(context.selected_zone, {
      equipment: context.expected_equipment,
      safety:    context.expected_safety_assets,
    });

    // Stage A: vision call
    const { rawText, tokensUsed } = await this.evidenceGenerator.generate(
      imageBase64,
      context,
      knowledge,
    );

    // Validate + normalize
    const { model, parseFailure, droppedViolations } =
      EvidenceValidator.validate(rawText, context);

    return {
      evidence:     model,
      tokensUsed,
      parseFailure,
      dropped:      droppedViolations,
    };
  }

  // ── Stage B: Pillar Evaluation ────────────────────────────────────────────────

  /**
   * Stage B — evaluate a single pillar using the shared evidence model.
   *
   * No image is sent. The LLM receives the serialized evidence model as text
   * and applies strategy-driven question evaluation.
   *
   * @param config        - Declarative pillar config (questions, label, etc.)
   * @param template      - Pillar-specific prompt preamble (role + principles)
   * @param evidence      - Shared AuditEvidenceModel from Stage A
   * @param context       - Workspace context from request payload
   * @returns             - Validated PillarResult, internal AuditMetrics,
   *                        calibration coverage/balance arrays, and decision traces
   */
  async runPillar(
    config:   PillarConfig,
    template: PillarPromptTemplate,
    evidence: AuditEvidenceModel,
    context:  WorkspaceContext,
  ): Promise<{ result: PillarResult; metrics: AuditMetrics; coverages: EvidenceCoverage[]; balances: BalanceResult[]; traces: Map<string, unknown> }> {
    const collector = new AuditMetricsCollector();
    collector.start(config.pillar);

    // ── 1. Resolve zone knowledge (pillar-filtered dimensions) ────────────────
    const knowledge = resolveZoneKnowledge(context.selected_zone, {
      equipment: context.expected_equipment,
      safety:    context.expected_safety_assets,
    });

    // ── 2. Load ADM configs for this pillar ────────────────────────────────────
    const admConfigs = getPillarConfigs(config.pillar);
    const questionIds = config.questions.map((q) => q.questionId);

    // ── 3. Load context policy overrides ──────────────────────────────────────
    const contextPolicy  = resolveContextPolicy(context.selected_zone);
    const contextOverrides: Partial<Record<string, string>> = {};
    for (const cfg of admConfigs) {
      const override = getQuestionOverride(cfg.questionId, contextPolicy);
      if (override) contextOverrides[cfg.questionId] = override;
    }

    // ── 4. R11: Filter evidence per question via ECM (three-stage matching) ───
    const filteredMap = EvidenceFilterService.filterForAll(questionIds, evidence);

    // ── 5. Phase 4.1: Compute calibration guidance (pre-Stage B) ─────────────
    const allCalibConfigs = getAllCalibrationConfigs();
    const pillarCalibConfigs = allCalibConfigs.filter((c) => questionIds.includes(c.questionId));

    const coverages = EvidenceCoverageService.computeAll(questionIds, filteredMap, knowledge, evidence);
    const balances  = PositiveBalanceService.computeAll(questionIds, evidence, pillarCalibConfigs);

    // ── 6. Build Stage B prompt (with calibration summaries + ECM context) ─────
    const prompt = PromptBuilder.buildEvaluatorPrompt(
      config, template, context, knowledge, PILLAR_DIMENSION_MAP,
      evidence, admConfigs, contextOverrides, coverages, balances, filteredMap,
    );
    collector.recordPromptStats(9, prompt.length);

    // ── 6. Stage B LLM call (text-only — no image) ────────────────────────────
    const t0 = Date.now();
    const llmResponse = await this.provider.complete({
      systemPrompt: prompt,
      imageBase64:  '',    // Empty — Stage B evaluators do not receive the image
      temperature:  0.1,
    });
    collector.recordResponseTime(Date.now() - t0);
    collector.recordModel(llmResponse.model);
    collector.recordTokens(llmResponse.tokensUsed);

    // ── 7. Validate + normalize Stage B response ──────────────────────────────
    const { questions: rawQuestions, corrections } = AuditValidator.validate(llmResponse.rawText, config);
    for (let i = 0; i < corrections; i++) {
      collector.recordValidationCorrection();
    }

    // ── 8. Detect reflection corrections ──────────────────────────────────────
    const reflectionCount = detectReflectionCorrections(llmResponse.rawText, rawQuestions);
    for (let i = 0; i < reflectionCount; i++) {
      collector.recordReflectionCorrection();
    }

    // ── 9. Phase 4.1: Apply CalibrationService escalation overrides ───────────
    const { questions, overrides: calibOverrides } = CalibrationService.applyEscalationRules(
      rawQuestions, evidence, allCalibConfigs, coverages,
    );
    if (calibOverrides.length > 0) {
      console.log(
        `[AuditEngine] CalibrationService: ${calibOverrides.length} override(s) on ${config.pillar}:`,
        calibOverrides.map((o) => `${o.questionId}: ${o.fromRating}→${o.toRating} (${o.rule})`).join(', '),
      );
    }

    // ── 10. Record NOT_VISIBLE count ──────────────────────────────────────────
    const notVisibleCount = questions.filter((q) => q.rating === 'NOT_VISIBLE').length;
    collector.recordNotVisible(notVisibleCount);

    // ── 11. Calculate pillar score (backend — RATING_TO_SCORE, not AI) ────────
    const pillarScore = questions.reduce(
      (sum, q) => sum + RATING_TO_SCORE[q.rating], 0,
    );
    const maxScore   = config.questions.length * config.benchmarkScore;
    const percentage = maxScore > 0 ? Math.round((pillarScore / maxScore) * 100) : 0;

    const result: PillarResult = {
      pillar:      config.pillar,
      label:       config.label,
      jpLabel:     config.jpLabel,
      questions,
      pillarScore,
      maxScore,
      percentage,
      rating:      deriveRating(percentage),
    };

    // ── 12. Phase 4.2: Build decision traces for this pillar ──────────────
    const pillarAllConfigs = getAllCalibrationConfigs();
    const traces = DecisionTraceService.buildAllTraces(
      rawQuestions,
      questions,
      evidence,
      admConfigs,
      pillarAllConfigs,
      coverages,
      balances,
      calibOverrides,
      filteredMap,
    );

    return { result, metrics: collector.finalize(), coverages, balances, traces };
  }

  // ── Session Assembly ──────────────────────────────────────────────────────────


  /**
   * Assemble an AuditSessionResult from completed Stage A + Stage B results.
   * Phase 4.1: computes cross-question consistency, reliability, recommendations.
   * Phase 4.2: aggregates decision traces into AuditSessionResult.decisionTraces.
   */
  static buildSessionResult(
    context:         WorkspaceContext,
    pillars:         PillarResult[],
    metrics:         AuditMetrics[],
    modelUsed:       string,
    evidenceModel:   AuditEvidenceModel,
    allCoverages:    EvidenceCoverage[]          = [],
    allBalances:     BalanceResult[]             = [],
    tracesByPillar:  Map<string, unknown>[]      = [],
  ): AuditSessionResult {
    const overallScore    = pillars.reduce((s, p) => s + p.pillarScore, 0);
    const overallMaxScore = pillars.reduce((s, p) => s + p.maxScore,   0);
    const overallPct      = overallMaxScore > 0
      ? Math.round((overallScore / overallMaxScore) * 100)
      : 0;

    // ── Phase 4.1: Cross-question consistency ────────────────────────────
    const allQuestions: QuestionResult[] = pillars.flatMap((p) => p.questions);
    const { flags, confidenceDropMap } = CrossQuestionConsistencyService.validate(allQuestions);
    // Apply confidence drops to pillar questions (non-destructive to scores)
    const adjustedPillars: PillarResult[] = pillars.map((p) => ({
      ...p,
      questions: CrossQuestionConsistencyService.applyConfidenceDrops(
        p.questions, confidenceDropMap,
      ),
    }));

    // ── Phase 4.1: Reliability score ──────────────────────────────────
    const reliabilityScore = AuditReliabilityService.compute(
      evidenceModel, allCoverages, flags,
    );

    // ── Phase 4.1: Prioritized recommendations ────────────────────────
    const recommendations = RecommendationPriorityService.generate(
      adjustedPillars, evidenceModel,
    );

    // ── Phase 4.2: Aggregate decision traces across all pillars ───────────
    const aggregatedTraces: Record<string, unknown> = {};
    for (const pillarTraceMap of tracesByPillar) {
      for (const [qId, trace] of pillarTraceMap.entries()) {
        aggregatedTraces[qId] = trace;
      }
    }

    return {
      context,
      pillars:           adjustedPillars,
      overallScore,
      overallMaxScore,
      overallPercentage: overallPct,
      overallRating:     deriveOverallRating(overallPct),
      recommendations:   recommendations.length > 0 ? recommendations : null,
      summary:           null,
      versions:          { ...AUDIT_ENGINE_VERSIONS },
      metrics,
      modelUsed,
      analyzedAt:            new Date().toISOString(),
      evidenceModel,
      decisionMatrixVersion: DECISION_MATRIX_VERSION,
      calibration: {
        coverageResults:  allCoverages,
        balanceResults:   allBalances,
        consistencyFlags: flags,
        reliabilityScore,
      },
      decisionTraces: Object.keys(aggregatedTraces).length > 0
        ? aggregatedTraces
        : undefined,
    };
  }
}

