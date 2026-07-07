/**
 * supabase/functions/analyze-5s/audit-engine/EvidenceCoverageService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Evidence Coverage computation — Engine v5.0 (Recommendation 11).
 *
 * Computes EvidenceCoverage per question using FilteredEvidenceModel (ECM output)
 * instead of the raw AuditEvidenceModel. This ensures coverage is calculated
 * only over evidence approved by the Evidence Capability Matrix.
 *
 * Dimension keywords are now derived from ECM primaryEvidence + supportingEvidence
 * lists instead of the hardcoded QUESTION_DIMENSIONS map.
 *
 * Algorithm:
 *   1. Use FilteredEvidenceModel.allowedObjects (ECM-filtered)
 *   2. Quality score = ratio of DIRECT vs total allowed objects
 *   3. Context score = ECM evidenceWeightScore (already weighted by ECM tiers)
 *   4. Positive score = allowed positive observations density
 *   5. coveragePercentage = weighted average (quality 40%, context 40%, positive 20%)
 *   6. canVerify flag from FilteredEvidenceModel drives context completeness
 *   7. recommendedConfidence = HIGH (≥75%), MEDIUM (45–74%), LOW (<45%)
 *
 * Design invariants:
 *  - No LLM calls
 *  - No prompt content
 *  - No hardcoded dimension keywords (ECM is the single source of truth)
 *  - Never throws — returns safe minimal coverage on error
 */

import type {
  EvidenceCoverage,
  EvidenceConfidence,
  FilteredEvidenceModel,
  ZoneKnowledge,
  AuditEvidenceModel,
  EvidenceCapabilityEntry,
} from './types.ts';
import { EvidenceFilterService, threeStageMatch } from './EvidenceFilterService.ts';
import { getEvidenceCapability }                   from './EvidenceCapabilityMatrix.ts';

// ── Scoring weights ────────────────────────────────────────────────────────────

const W_QUALITY  = 0.40;  // DIRECT vs INFERENCE ratio of allowed objects
const W_CONTEXT  = 0.40;  // ECM evidence weight score (tier-based)
const W_POSITIVE = 0.20;  // Positive observation density

// ── EvidenceCoverageService ────────────────────────────────────────────────────

export class EvidenceCoverageService {

  /**
   * Computes EvidenceCoverage for every question using FilteredEvidenceModels or raw AuditEvidenceModel.
   *
   * @param questionIds               - All question IDs to compute coverage for
   * @param filteredMapOrEvidence     - Map<questionId, FilteredEvidenceModel> or raw AuditEvidenceModel (backward compatibility)
   * @param knowledge                 - Zone knowledge (provides expectedObjectTypes count)
   * @returns                         - One EvidenceCoverage per question ID
   */
  /**
   * Computes EvidenceCoverage for every question using FilteredEvidenceModels or raw AuditEvidenceModel.
   *
   * @param questionIds               - All question IDs to compute coverage for
   * @param filteredMapOrEvidence     - Map<questionId, FilteredEvidenceModel> or raw AuditEvidenceModel (backward compatibility)
   * @param knowledge                 - Zone knowledge (provides expectedObjectTypes count)
   * @param rawEvidence               - Raw AuditEvidenceModel (optional, provides unfiltered visible objects)
   * @returns                         - One EvidenceCoverage per question ID
   */
  static computeAll(
    questionIds:  string[],
    filteredMapOrEvidence:  Map<string, FilteredEvidenceModel> | AuditEvidenceModel,
    knowledge:    ZoneKnowledge,
    rawEvidence?: AuditEvidenceModel,
  ): EvidenceCoverage[] {
    let map: Map<string, FilteredEvidenceModel>;
    let evidence: AuditEvidenceModel | undefined = rawEvidence;
    if (typeof (filteredMapOrEvidence as unknown as { get: unknown }).get === 'function') {
      map = filteredMapOrEvidence as Map<string, FilteredEvidenceModel>;
    } else {
      // Backward compatibility for unit tests: construct filtered map on the fly
      map = EvidenceFilterService.filterForAll(questionIds, filteredMapOrEvidence as AuditEvidenceModel);
      evidence = filteredMapOrEvidence as AuditEvidenceModel;
    }

    return questionIds.map((qId) => {
      const filtered = map.get(qId);
      if (!filtered) {
        return EvidenceCoverageService._fallback(qId);
      }
      return EvidenceCoverageService.computeForQuestion(qId, filtered, knowledge, evidence);
    });
  }

  /**
   * Computes EvidenceCoverage for a single question from a FilteredEvidenceModel or raw AuditEvidenceModel.
   * Never throws — returns minimal coverage on error.
   */
  static computeForQuestion(
    questionId: string,
    filteredOrEvidence: FilteredEvidenceModel | AuditEvidenceModel,
    knowledge:  ZoneKnowledge,
    rawEvidence?: AuditEvidenceModel,
    customECM?: EvidenceCapabilityEntry,
  ): EvidenceCoverage {
    try {
      let filtered: FilteredEvidenceModel;
      let evidence: AuditEvidenceModel | undefined = rawEvidence;
      if (filteredOrEvidence && 'allowedObjects' in filteredOrEvidence) {
        filtered = filteredOrEvidence;
      } else {
        // Fallback for direct unit test invocations
        filtered = EvidenceFilterService.filterForQuestion(questionId, filteredOrEvidence as AuditEvidenceModel, customECM);
        evidence = filteredOrEvidence as AuditEvidenceModel;
      }

      const { allowedObjects, allowedPositive, allowedViolations, evidenceWeightScore, canVerify } = filtered;

      // Use raw visible objects for checking coverage; fallback to allowedObjects if unavailable
      const coverageObjects = evidence?.visibleObjects ?? allowedObjects;

      if (coverageObjects.length === 0) {
        return EvidenceCoverageService._fallback(questionId);
      }

      // ── 1. Quality score — DIRECT ratio of allowed objects ────────────────
      const directCount   = allowedObjects.filter((o) => o.observationType === 'DIRECT').length;
      const totalAllowed  = allowedObjects.length;
      const qualityScore  = totalAllowed === 0
        ? 50   // No objects → neutral; absence ≠ failure
        : Math.round((directCount / totalAllowed) * 100);

      // ── 2. Context score — ECM tier-weighted score ─────────────────────────
      // evidenceWeightScore is 0.0–1.0; scale to 0–100
      // Default to 100 if no allowedObjects are present (area is clean)
      const contextScore = allowedObjects.length === 0
        ? 100
        : Math.round(evidenceWeightScore * 100);

      // ── 3. Expected object types ───────────────────────────────────────────
      const totalExpected = Math.max(1,
        knowledge.expectedEquipment.length +
        knowledge.expectedSafetyAssets.length +
        knowledge.expectedLayout.length,
      );

      // ── 4. Required, Primary, Supporting Coverage (R11.1) ──────────────────
      const entry = customECM ?? getEvidenceCapability(questionId);

      // Required Coverage: 1.0 if canVerify is true, otherwise 0.0
      const requiredCoverageRatio = canVerify ? 1.0 : 0.0;

      // Primary Coverage: 1.0 if any primary evidence item is visible in coverageObjects
      const hasPrimary = entry.primaryEvidence.some((pri) =>
        coverageObjects.some((obj) =>
          threeStageMatch(obj.description, pri, entry.objectAliases),
        ),
      );
      const primaryEvidenceCoverageRatio = entry.primaryEvidence.length === 0 ? 1.0 : (hasPrimary ? 1.0 : 0.0);

      // Supporting Coverage: 1.0 if any supporting evidence item is visible in coverageObjects
      const hasSupporting = entry.supportingEvidence.some((sup) =>
        coverageObjects.some((obj) =>
          threeStageMatch(obj.description, sup, entry.objectAliases),
        ),
      );
      const supportingEvidenceCoverageRatio = entry.supportingEvidence.length === 0 ? 1.0 : (hasSupporting ? 1.0 : 0.0);

      // ── 5. Capability Score (0–100%) ──────────────────────────────────────
      const capabilityScore = canVerify
        ? Math.round(
            (requiredCoverageRatio * 0.40 +
             primaryEvidenceCoverageRatio * 0.40 +
             supportingEvidenceCoverageRatio * 0.20) * 100
          )
        : 70; // Baseline for non-verifiable/non-applicable questions to prevent penalizing audit reliability

      // ── 6. Context completeness — driven by canVerify + context score ──────
      const contextCompleteness: 'FULL' | 'PARTIAL' | 'MINIMAL' =
        !canVerify           ? (allowedObjects.length === 0 ? 'FULL' : 'MINIMAL') :
        contextScore >= 80   ? 'FULL'    :
        contextScore >= 40   ? 'PARTIAL' :
        'MINIMAL';

      // ── 7. Evidence quality ────────────────────────────────────────────────
      const evidenceQuality: 'HIGH' | 'MEDIUM' | 'LOW' =
        qualityScore >= 75 ? 'HIGH' :
        qualityScore >= 45 ? 'MEDIUM' :
        'LOW';

      // ── 8. Recommended confidence derived from Capability Score (R11.1) ───
      const recommendedConfidence: EvidenceConfidence =
        capabilityScore >= 75 ? 'HIGH' :
        capabilityScore >= 45 ? 'MEDIUM' :
        'LOW';

      return {
        questionId,
        relevantObjectsFound:  totalAllowed,
        expectedObjectTypes:   totalExpected,
        positiveCount:         allowedPositive.length,
        violationCount:        allowedViolations.length,
        evidenceQuality,
        contextCompleteness,
        coveragePercentage:     capabilityScore, // Derive from Capability Score
        recommendedConfidence,
        requiredCoverage:          Math.round(requiredCoverageRatio * 100),
        primaryEvidenceCoverage:   Math.round(primaryEvidenceCoverageRatio * 100),
        supportingEvidenceCoverage: Math.round(supportingEvidenceCoverageRatio * 100),
        capabilityScore,
      };

    } catch {
      return EvidenceCoverageService._fallback(questionId);
    }
  }

  /**
   * Returns a compact one-line summary for PromptBuilder injection.
   * Format: "Coverage: 72%, Confidence: MEDIUM, Context: PARTIAL"
   */
  static toOneLine(coverage: EvidenceCoverage): string {
    return `Coverage: ${coverage.coveragePercentage}%, Confidence: ${coverage.recommendedConfidence}, Context: ${coverage.contextCompleteness}`;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private static _fallback(questionId: string): EvidenceCoverage {
    return {
      questionId,
      relevantObjectsFound:  0,
      expectedObjectTypes:   1,
      positiveCount:         0,
      violationCount:        0,
      evidenceQuality:       'LOW',
      contextCompleteness:   'MINIMAL',
      coveragePercentage:    30,
      recommendedConfidence: 'MEDIUM',
      requiredCoverage:          100,
      primaryEvidenceCoverage:   0,
      supportingEvidenceCoverage: 0,
      capabilityScore:           30,
    };
  }
}
