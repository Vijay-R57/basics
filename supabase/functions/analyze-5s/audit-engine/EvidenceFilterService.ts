/**
 * supabase/functions/analyze-5s/audit-engine/EvidenceFilterService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Evidence Filter Service — Recommendation 11 / Engine v5.0
 *
 * Enforces the Evidence Capability Matrix (ECM) per question BEFORE any
 * reasoning begins. This service is the mandatory firewall that prevents
 * evidence leakage between unrelated audit questions.
 *
 * Pipeline position:
 *   AuditEvidenceModel (Stage A output)
 *       ↓
 *   EvidenceFilterService.filterForQuestion()   ← HERE
 *       ↓
 *   FilteredEvidenceModel (per question)
 *       ↓
 *   PromptBuilder / EvidenceCoverageService
 *       ↓
 *   LLM Stage B + Decision Engine
 *
 * Three-stage matching strategy (R11 Refinement 3):
 *
 *   Stage 1 — Exact canonical match
 *     Lowercased full description compared against each canonical object type.
 *     Fastest, zero ambiguity.
 *
 *   Stage 2 — Normalized token match
 *     Tokenize both description and canonical type. Match if all tokens of the
 *     canonical type appear in the description tokens (subset match).
 *     Catches plurals, compound phrases, hyphenated variants.
 *
 *   Stage 3 — Semantic alias match
 *     Compare against ECM objectAliases map for both allowed and forbidden sets.
 *     Uses token subset matching on alias strings.
 *     Only if Stages 1 and 2 both fail.
 *
 *   If all three stages fail → object is EXCLUDED (conservative: prefer safety).
 *
 * Required object logic (R11 Refinement 4):
 *   If no requiredObjectTypes are visible after filtering, canVerify = false.
 *   The evaluator must return "Cannot Verify" instead of assuming compliance.
 *
 * Evidence weight score (R11 Refinement 5):
 *   Computed from primaryEvidence (weight 1.0), supportingEvidence (weight 0.7),
 *   and allowedObjects not in either list (contextual, weight 0.4).
 *   Normalised to 0.0–1.0.
 *
 * Design invariants:
 *  - No LLM calls
 *  - No prompt content
 *  - Never throws — returns safe minimal model on error
 *  - Deterministic: same input always produces same output
 */

import type {
  AuditEvidenceModel,
  FilteredEvidenceModel,
  VisibleObject,
  PositiveObservation,
  ViolationObservation,
  EvidenceCapabilityEntry,
} from './types.ts';
import { EVIDENCE_WEIGHTS } from './types.ts';
import { getEvidenceCapability, ECM_VERSION } from './EvidenceCapabilityMatrix.ts';

// ── Normalisation helpers ──────────────────────────────────────────────────────

/**
 * Normalise a string for token matching:
 * lowercase, remove punctuation, collapse whitespace, split into tokens.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Stage 1: Exact canonical match.
 * Returns true if the description (lowercased) contains the canonical type (lowercased) as a substring.
 * Uses word-boundary padding to avoid partial word matches.
 */
function exactMatch(description: string, canonical: string): boolean {
  const desc = ` ${description.toLowerCase()} `;
  const term = ` ${canonical.toLowerCase()} `;
  return desc.includes(term);
}

/**
 * Stage 2: Normalized token match.
 * All tokens of `canonical` must appear in `descriptionTokens`.
 */
function tokenMatch(descriptionTokens: string[], canonical: string): boolean {
  const canonTokens = tokenize(canonical);
  return canonTokens.length > 0 && canonTokens.every((t) => descriptionTokens.includes(t));
}

/**
 * Stage 3: Semantic alias match.
 * Checks all aliases for the canonical type (from ECM objectAliases).
 * Uses token match on each alias.
 */
function aliasMatch(
  descriptionTokens: string[],
  canonical: string,
  aliases: Record<string, string[]>,
): boolean {
  const aliasSet = aliases[canonical] ?? [];
  for (const alias of aliasSet) {
    if (tokenMatch(descriptionTokens, alias)) return true;
  }
  return false;
}

/**
 * Three-stage match: returns true if `description` matches `canonical` via
 * Stage 1 (exact), Stage 2 (token), or Stage 3 (alias).
 */
export function threeStageMatch(
  description: string,
  canonical: string,
  aliases: Record<string, string[]>,
): boolean {
  // Stage 1 — exact
  if (exactMatch(description, canonical)) return true;
  // Stage 2 — token
  const tokens = tokenize(description);
  if (tokenMatch(tokens, canonical)) return true;
  // Stage 3 — alias
  return aliasMatch(tokens, canonical, aliases);
}

/**
 * Returns true if `description` matches ANY string in the `list` using
 * three-stage matching with the provided alias map.
 */
function matchesAny(
  description: string,
  list: string[],
  aliases: Record<string, string[]>,
): boolean {
  return list.some((canonical) => threeStageMatch(description, canonical, aliases));
}

// ── Evidence Weight Score ─────────────────────────────────────────────────────

/**
 * Compute a 0.0–1.0 weighted evidence quality score.
 * Each allowed object contributes weight based on its category:
 *   - Matches primaryEvidence:   1.0
 *   - Matches supportingEvidence: 0.7
 *   - Other allowed objects:     0.4  (contextual)
 * Score = sum(weights) / (count * max_possible_weight = 1.0), clamped to 1.0
 */
function computeWeightScore(
  allowedObjects: VisibleObject[],
  entry: EvidenceCapabilityEntry,
): number {
  if (allowedObjects.length === 0) return 0;

  const totalWeight = allowedObjects.reduce((sum, obj) => {
    const desc = obj.description;
    if (matchesAny(desc, entry.primaryEvidence, entry.objectAliases)) {
      return sum + EVIDENCE_WEIGHTS.PRIMARY;
    }
    if (matchesAny(desc, entry.supportingEvidence, entry.objectAliases)) {
      return sum + EVIDENCE_WEIGHTS.SUPPORTING;
    }
    return sum + EVIDENCE_WEIGHTS.CONTEXTUAL;
  }, 0);

  return Math.min(1.0, totalWeight);
}

// ── EvidenceFilterService ─────────────────────────────────────────────────────

export class EvidenceFilterService {

  /**
   * Filters the AuditEvidenceModel for a single question using the Evidence
   * Capability Matrix three-stage matching strategy.
   *
   * @param questionId  - The audit question to filter evidence for
   * @param evidence    - Full AuditEvidenceModel from Stage A
   * @returns           - FilteredEvidenceModel containing only permitted evidence
   */
  static filterForQuestion(
    questionId:  string,
    evidence:    AuditEvidenceModel,
    customECM?:  EvidenceCapabilityEntry,
  ): FilteredEvidenceModel {
    let entry: EvidenceCapabilityEntry;

    if (customECM) {
      entry = customECM;
    } else {
      try {
        entry = getEvidenceCapability(questionId);
      } catch {
        // ECM entry missing — fail safe: return empty model, cannot verify
        return {
          questionId,
          allowedObjects:      [],
          allowedPositive:     [],
          allowedViolations:   [],
          discardedObjects:    evidence.visibleObjects.length,
          discardedViolations: evidence.violations.length,
          canVerify:           false,
          evidenceWeightScore: 0,
          ecmVersion:          ECM_VERSION,
          filteredObjects:     [],
          discardedObjectsList: evidence.visibleObjects,
          discardReasons:      evidence.visibleObjects.map(o => `ECM entry missing for question ${questionId}`),
        };
      }
    }

    const { aliases } = EvidenceFilterService;

    // ── Filter VisibleObjects ─────────────────────────────────────────────────

    const allowedObjects:       VisibleObject[] = [];
    const discardedObjectsList: VisibleObject[] = [];
    const discardReasons:       string[]        = [];
    let   discardedObjects = 0;

    for (const obj of evidence.visibleObjects) {
      const desc = obj.description;

      // Reject: object is forbidden
      if (matchesAny(desc, entry.forbiddenObjectTypes, entry.objectAliases)) {
        discardedObjects++;
        discardedObjectsList.push(obj);
        discardReasons.push(`Object "${desc}" is explicitly forbidden for ${questionId}.`);
        continue;
      }

      // Accept: category is allowed OR object matches primary/supporting evidence
      const categoryAllowed = entry.allowedCategories.includes(obj.category);
      const evidenceMatch   =
        matchesAny(desc, entry.primaryEvidence,   entry.objectAliases) ||
        matchesAny(desc, entry.supportingEvidence, entry.objectAliases);

      if (categoryAllowed || evidenceMatch) {
        allowedObjects.push(obj);
      } else {
        discardedObjects++;
        discardedObjectsList.push(obj);
        discardReasons.push(
          `Object "${desc}" (category ${obj.category}) is neither in allowed categories ` +
          `[${entry.allowedCategories.join(', ')}] nor primary/supporting evidence for ${questionId}.`
        );
      }
    }

    // ── Filter PositiveObservations ───────────────────────────────────────────

    const allowedPositive: PositiveObservation[] = evidence.positiveCompliance.filter((pos) => {
      const text = `${pos.dimension} ${pos.observation}`;
      if (matchesAny(text, entry.forbiddenObjectTypes, entry.objectAliases)) return false;
      return (
        matchesAny(text, entry.primaryEvidence,   entry.objectAliases) ||
        matchesAny(text, entry.supportingEvidence, entry.objectAliases) ||
        aliases(entry, text)   // Allow if matches any required type
      );
    });

    // ── Filter ViolationObservations ──────────────────────────────────────────

    const allowedViolations: ViolationObservation[] = [];
    let   discardedViolations = 0;

    for (const violation of evidence.violations) {
      const evidence_text = `${violation.dimension} ${violation.observation} ${violation.evidence}`;

      // Reject: violation references a forbidden object type
      if (matchesAny(evidence_text, entry.forbiddenObjectTypes, entry.objectAliases)) {
        discardedViolations++;
        continue;
      }

      // Accept only violations referencing allowed evidence
      if (
        matchesAny(evidence_text, entry.primaryEvidence,   entry.objectAliases) ||
        matchesAny(evidence_text, entry.supportingEvidence, entry.objectAliases)
      ) {
        allowedViolations.push(violation);
      } else {
        discardedViolations++;
      }
    }

    // ── Required object check (R11 Refinement 4) ─────────────────────────────

    const canVerify = entry.requiredObjectTypes.length === 0
      ? true   // Type 3 questions have no required objects
      : entry.requiredObjectTypes.some((req) =>
          evidence.visibleObjects.some((obj) =>
            threeStageMatch(obj.description, req, entry.objectAliases),
          ),
        );

    // ── Evidence weight score (R11 Refinement 5) ─────────────────────────────

    const evidenceWeightScore = computeWeightScore(allowedObjects, entry);

    return {
      questionId,
      allowedObjects,
      allowedPositive,
      allowedViolations,
      discardedObjects,
      discardedViolations,
      canVerify,
      evidenceWeightScore,
      ecmVersion:           ECM_VERSION,
      filteredObjects:      allowedObjects,
      discardedObjectsList,
      discardReasons,
    };
  }

  /**
   * Filters evidence for all questions in the provided list.
   * Returns a Map<questionId, FilteredEvidenceModel> for O(1) lookup.
   */
  static filterForAll(
    questionIds: string[],
    evidence:    AuditEvidenceModel,
  ): Map<string, FilteredEvidenceModel> {
    const result = new Map<string, FilteredEvidenceModel>();
    for (const qId of questionIds) {
      result.set(qId, EvidenceFilterService.filterForQuestion(qId, evidence));
    }
    return result;
  }

  /**
   * Internal helper: returns true if text matches any requiredObjectTypes
   * for the given entry (used for positive observation inclusion).
   */
  private static aliases(entry: EvidenceCapabilityEntry, text: string): boolean {
    return entry.requiredObjectTypes.some((req) =>
      threeStageMatch(text, req, entry.objectAliases),
    );
  }
}
