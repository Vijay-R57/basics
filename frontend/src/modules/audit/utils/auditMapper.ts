/**
 * src/modules/audit/utils/auditMapper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps AI pipeline output and database audit sessions to UI display types.
 *
 * CHANGES (Pipeline V2):
 *  - STANDARD_5S_QUESTIONS removed — questions now owned by pipeline/questions.ts
 *  - getMockRecommendation removed — fabricating recommendations is prohibited
 *  - mockScores injection removed
 *  - mapAnalysisResultToAuditResult rewritten to directly consume V2 output
 *  - mapSessionToAuditResult rewritten to not require embedded question definitions
 *  - sortRecommendations preserved unchanged
 */

import type {
  FutureAuditResult,
  FuturePillar,
  FutureAuditQuestion,
  FutureAuditRecommendation,
  FutureAuditSummary,
} from '../types';
import type { AuditSession, AuditSessionItem, AuditItemResponse } from '../types';
import type { AuditAnalysisResult } from '@/types/analysis';
import { AUDIT_PILLARS, PILLAR_META } from '../constants/pillars';
import type { AuditPillar } from '../constants/pillars';
import { getAllQuestions, PILLAR_TO_JSON_KEY, PILLAR_ORDER, type AuditPillarKey } from '../pipeline/questions';

// ── Internal helpers ──────────────────────────────────────────────────────────

const scoreToRating = (score: number): 'Very Bad' | 'Bad' | 'Average' | 'Good' | 'Very Good' => {
  if (score >= 4) return 'Very Good';
  if (score === 3) return 'Good';
  if (score === 2) return 'Average';
  if (score === 1) return 'Bad';
  return 'Very Bad';
};

const overallScoreToRating = (percentage: number): 'Excellent' | 'Good' | 'Average' | 'Needs Improvement' | 'Poor' => {
  if (percentage >= 90) return 'Excellent';
  if (percentage >= 70) return 'Good';
  if (percentage >= 50) return 'Average';
  if (percentage >= 25) return 'Needs Improvement';
  return 'Poor';
};

// ── AI Answer → numeric score (for history records using YES/PARTIAL/NO) ─────

function aiAnswerToScore(
  aiAnswer: string | null | undefined,
  finalScore: number | null | undefined,
  manualScore: number | null | undefined,
): number {
  // Prefer explicit numeric score
  if (finalScore != null) return Math.min(4, Math.max(0, finalScore));
  if (manualScore != null) return Math.min(4, Math.max(0, manualScore));
  // Fall back to ai_answer mapping
  switch (aiAnswer) {
    case 'YES':     return 4;
    case 'PARTIAL': return 2;
    case 'NO':      return 0;
    default:        return 0;
  }
}

// ── mapSessionToAuditResult ───────────────────────────────────────────────────

/**
 * Maps a database AuditSession + items + responses into FutureAuditResult.
 * Used by the History page to display past audit records.
 *
 * No mock scores. No default evidence. Uses only real data from the database.
 * If a response is missing for an item, the question is shown with score 0
 * and a "Not evaluated" reason.
 */
export function mapSessionToAuditResult(
  session: AuditSession & { items?: AuditSessionItem[]; responses?: AuditItemResponse[] }
): FutureAuditResult {
  const items = session.items ?? [];
  const responses = session.responses ?? [];

  const responseMap = new Map(responses.map(r => [r.session_item_id, r]));

  const recommendations: FutureAuditRecommendation[] = [];

  const mappedPillars: FuturePillar[] = AUDIT_PILLARS.map((pKey) => {
    const meta = PILLAR_META[pKey];
    const pillarItems = items.filter(i => i.pillar === pKey);

    const mappedQuestions: FutureAuditQuestion[] = pillarItems.map((item) => {
      const resp = responseMap.get(item.id);

      let score = 0;
      let evidence = '';
      let reason = '';

      if (resp) {
        score = aiAnswerToScore(resp.ai_answer, resp.final_score, resp.manual_score);
        evidence = resp.evidence || resp.observation || '';
        reason   = resp.reasoning || resp.notes || evidence;
      }

      const rating = scoreToRating(score);

      if (score < 4 && score >= 0 && evidence) {
        const priority: 'Immediate' | 'High' | 'Medium' | 'Low' =
          score === 0 ? 'Immediate' : score === 1 ? 'High' : score === 2 ? 'Medium' : 'Low';

        recommendations.push({
          id:              `rec_${item.question_id}_${score}`,
          priority,
          pillarKey:       pKey,
          pillarName:      meta.label,
          problem:         `Improvement needed: ${item.question_text}`,
          recommendation:  reason || 'Review and improve this area.',
          expectedBenefit: 'Increases 5S compliance score.',
          scoreGain:       4 - score,
          linkedQuestionId: item.question_id,
        });
      }

      return {
        id:                   item.question_id,
        question:             item.question_text,
        rating,
        score,
        benchmark:            item.description ?? '',
        evidence,
        reason,
        supportingObservation: evidence,
        evidenceSource:       (resp as any)?.evidenceSource ?? 'IMAGE',
      };
    });

    const totalScore  = mappedQuestions.reduce((s, q) => s + q.score, 0);
    const maxScore    = Math.max(pillarItems.length, 4) * 4;
    const percentage  = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    const rating      = scoreToRating(Math.round(totalScore / Math.max(pillarItems.length, 1)));

    return {
      name:     pKey,
      label:    meta.label,
      jpName:   meta.jp,
      score:    totalScore,
      maxScore,
      percentage,
      rating,
      questions: mappedQuestions,
    };
  });

  const overallScore      = mappedPillars.reduce((s, p) => s + p.score, 0);
  const overallMaxScore   = 80;
  const overallPercentage = Math.round((overallScore / overallMaxScore) * 100);
  const overallRating     = overallScoreToRating(overallPercentage);

  const sortedPillars  = [...mappedPillars].sort((a, b) => b.score - a.score);
  const highestPillar  = sortedPillars[0]?.label ?? 'Sort';
  const lowestPillar   = sortedPillars[sortedPillars.length - 1]?.label ?? 'Sustain';

  const strengths = mappedPillars
    .filter(p => p.percentage >= 80)
    .map(p => `High compliance in ${p.label} (${p.percentage}%).`);
  if (strengths.length === 0) {
    strengths.push(`Standard maintained in ${highestPillar}.`);
  }

  const weaknesses = mappedPillars
    .filter(p => p.percentage < 70)
    .map(p => `Identified issues in ${p.label} (${p.percentage}%).`);
  if (weaknesses.length === 0) {
    weaknesses.push(`Minor opportunities exist to optimize ${lowestPillar}.`);
  }

  const summary: FutureAuditSummary = {
    strengths,
    weaknesses,
    highestPillar,
    lowestPillar,
    totalRecommendations: recommendations.length,
    potentialImprovement: 80 - overallScore,
    overallScore,
    overallMaxScore,
    overallPercentage,
    overallRating,
    criticalFindings: 0,
    imageQualityScore: null,
    imageQualityLevel: null,
    auditConfidence:   null,
  };

  return {
    overallScore,
    overallMaxScore,
    overallPercentage,
    overallRating,
    pillars:         mappedPillars,
    recommendations: sortRecommendations(recommendations),
    summary,
    areaInfo: {
      companyName:   'ARCOLAB MANUFACTURING LTD',
      auditDate:     session.audit_date || new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
      areaName:      session.area_name || 'Production Floor',
      department:    session.department_name || 'Manufacturing',
      industry:      session.industry || 'General Industrial',
      workspaceType: session.workspace_type || 'Assembly Station',
      auditor:       session.auditor_name || 'Authorized Auditor',
    },
  };
}

// ── mapAnalysisResultToAuditResult ────────────────────────────────────────────

/**
 * Maps AuditAnalysisResult (from the AI pipeline) directly into FutureAuditResult.
 *
 * This function is the primary consumer of the V2 pipeline output. It builds
 * FutureAuditResult directly from pillar_scores and per-question responses
 * without going through the pseudo-session path.
 *
 * Question text is sourced from AUDIT_QUESTIONS (the single source of truth).
 * Per-question scores come from the `score` field stored in each response
 * (stored as an extended field by analysisPipeline.ts) or derived from ai_answer.
 */
export function mapAnalysisResultToAuditResult(
  data: AuditAnalysisResult,
  analysisDate?: string,
): FutureAuditResult {
  const beforeScore = data.before.score;

  // Build a lookup: question_id → response
  const responseById = new Map(
    data.before.responses.map(r => [r.question_id, r]),
  );

  // Build a lookup: question_id → AuditQuestion definition
  const questionById = new Map(getAllQuestions().map(q => [q.id, q]));

  // Build a lookup: pillar label → AuditPillar key
  const pillarLabelToKey: Record<string, AuditPillar> = {
    'Sort':          'SORT',
    'Set in Order':  'SET_IN_ORDER',
    'Shine':         'SHINE',
    'Standardize':   'STANDARDIZE',
    'Sustain':       'SUSTAIN',
  };

  const mappedPillars: FuturePillar[] = beforeScore.pillar_scores.map((ps) => {
    const pillarKey = pillarLabelToKey[ps.pillar as string] ?? 'SORT';
    const meta      = PILLAR_META[pillarKey];
    const jsonKey   = PILLAR_TO_JSON_KEY[pillarKey as AuditPillarKey];

    // Get the questions belonging to this pillar from AUDIT_QUESTIONS
    const pillarQDefs = getAllQuestions().filter(q => q.pillar === pillarKey);

    const mappedQuestions: FutureAuditQuestion[] = pillarQDefs.map((def) => {
      const resp = responseById.get(def.id);

      // Prefer explicit numeric score (stored as extended field by pipeline),
      // then fall back to ai_answer conversion.
      const score = resp
        ? aiAnswerToScore(resp.ai_answer, (resp as any).score ?? null, null)
        : 0;

      const evidence = resp?.evidence ?? '';
      const reason   = resp?.evidence ?? '';
      const confidence = resp ? Math.round((resp.confidence ?? 0) * 100) : 0;

      return {
        id:                    def.id,
        question:              def.question,
        rating:                scoreToRating(score),
        score,
        benchmark:             `Confidence: ${confidence}%`,
        evidence,
        reason,
        supportingObservation: evidence,
        evidenceSource:        (resp as any)?.evidenceSource ?? 'IMAGE',
      };
    });

    const percentage = ps.percentage;
    const rating     = scoreToRating(Math.round(ps.score / Math.max(pillarQDefs.length, 1)));

    return {
      name:      pillarKey,
      label:     meta.label,
      jpName:    meta.jp,
      score:     ps.score,
      maxScore:  ps.maximum,
      percentage,
      rating,
      questions: mappedQuestions,
    };
  });

  const overallScore      = beforeScore.overall_score;
  const overallMaxScore   = beforeScore.overall_maximum;
  const overallPercentage = beforeScore.overall_percentage;
  const overallRating     = overallScoreToRating(overallPercentage);

  // Build recommendations from data.recommendations
  const pipelineRecs: FutureAuditRecommendation[] = (data.recommendations ?? []).map((rec, idx) => {
    const pillarKey = pillarLabelToKey[rec.pillar] ?? 'SORT';
    const priority: 'Immediate' | 'High' | 'Medium' | 'Low' =
      rec.severity === 'CRITICAL' ? 'Immediate' :
      rec.severity === 'MAJOR'    ? 'High' :
      rec.severity === 'MINOR'    ? 'Medium' : 'Low';

    return {
      id:              `rec_${pillarKey}_${idx}`,
      priority,
      pillarKey,
      pillarName:      PILLAR_META[pillarKey]?.label ?? rec.pillar,
      problem:         rec.description || rec.title || 'Workplace area requires attention.',
      recommendation:  rec.corrective_action || rec.title || '',
      expectedBenefit: rec.expected_benefit || rec.root_cause || 'Restores 5S compliance standard.',
      scoreGain:       2,
      linkedQuestionId: rec.linked_question_id || `${pillarKey}_Q1`,
    };
  });

  const sortedPillars = [...mappedPillars].sort((a, b) => b.score - a.score);
  const highestPillar = sortedPillars[0]?.label ?? 'Sort';
  const lowestPillar  = sortedPillars[sortedPillars.length - 1]?.label ?? 'Sustain';

  const strengths = mappedPillars
    .filter(p => p.percentage >= 80)
    .map(p => `High compliance in ${p.label} (${p.percentage}%).`);
  if (strengths.length === 0) {
    strengths.push(`Standard maintained in ${highestPillar}.`);
  }

  const weaknesses = mappedPillars
    .filter(p => p.percentage < 70)
    .map(p => `Identified issues in ${p.label} (${p.percentage}%).`);
  if (weaknesses.length === 0) {
    weaknesses.push(`Minor opportunities exist to optimize ${lowestPillar}.`);
  }

  const summary: FutureAuditSummary = {
    strengths,
    weaknesses,
    highestPillar,
    lowestPillar,
    totalRecommendations: pipelineRecs.length,
    potentialImprovement: 80 - overallScore,
    overallScore,
    overallMaxScore,
    overallPercentage,
    overallRating,
    criticalFindings: beforeScore.critical_failures ?? 0,
    imageQualityScore: null,
    imageQualityLevel: null,
    auditConfidence:   null,
  };

  // Inject audit_confidence if available
  if (typeof data.audit_confidence === 'number') {
    summary.auditConfidence = Math.round(data.audit_confidence * 100);
  }

  return {
    overallScore,
    overallMaxScore,
    overallPercentage,
    overallRating,
    pillars:         mappedPillars,
    recommendations: sortRecommendations(pipelineRecs),
    summary,
    areaInfo: {
      companyName:   'ARCOLAB MANUFACTURING LTD',
      auditDate:     analysisDate || new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
      areaName:      'Workplace Scan',
      department:    'Production Operations',
      industry:      'General Industrial',
      workspaceType: 'Assembly Station',
      auditor:       'ARCOLAB Vision System',
    },
  };
}

// ── Recommendation sort utility ───────────────────────────────────────────────

const PRIORITY_SORT_ORDER: Record<string, number> = {
  Immediate: 0,
  High:      1,
  Medium:    2,
  Low:       3,
};

/**
 * Sorts recommendations by:
 *   1. Priority   — Immediate → High → Medium → Low
 *   2. Score gain — highest potential improvement first
 *   3. Pillar     — SORT → SET_IN_ORDER → SHINE → STANDARDIZE → SUSTAIN
 */
export function sortRecommendations(
  recs: FutureAuditRecommendation[]
): FutureAuditRecommendation[] {
  return [...recs].sort((a, b) => {
    const pDiff = (PRIORITY_SORT_ORDER[a.priority] ?? 4) - (PRIORITY_SORT_ORDER[b.priority] ?? 4);
    if (pDiff !== 0) return pDiff;
    const sDiff = b.scoreGain - a.scoreGain;
    if (sDiff !== 0) return sDiff;
    const aIdx = AUDIT_PILLARS.indexOf((a.pillarKey || 'SORT') as AuditPillar);
    const bIdx = AUDIT_PILLARS.indexOf((b.pillarKey || 'SORT') as AuditPillar);
    return aIdx - bIdx;
  });
}
