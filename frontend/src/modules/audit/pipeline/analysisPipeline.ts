/**
 * src/modules/audit/pipeline/analysisPipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the complete 5S AI audit pipeline.
 *
 * FLOW:
 *   1. Load questions from questions.ts (app owns the question set)
 *   2. Build Gemini prompt with questions embedded
 *   3. Call Gemini Vision API
 *   4. Validate response — in strict order:
 *        JSON valid → Question count → Question identity → Rating values → Required fields
 *   5. Score calculation begins only after all validation passes
 *   6. Return AuditAnalysisResult (existing type — no UI changes needed)
 *
 * ERROR POLICY:
 *   - Invalid JSON     → retry once → throw Error('AI Analysis Failed')
 *   - Wrong question count  → retry once → throw Error('AI Analysis Failed')
 *   - Question identity mismatch → retry once → throw Error('AI Analysis Failed')
 *   - Invalid rating   → retry once → throw Error('AI Analysis Failed')
 *   - Missing reason   → retry once → throw Error('AI Analysis Failed')
 *   - Missing/invalid confidence → store null, audit continues (non-fatal)
 *   - Malformed recommendations → skip recommendations, audit continues (non-fatal)
 *   - No mock fallback. Ever.
 */

import type { AuditAnalysisResult, AuditRecommendation } from '@/types/analysis';
import {
  AUDIT_QUESTIONS,
  getAllQuestions,
  PILLAR_ORDER,
  PILLAR_TO_JSON_KEY,
  QUESTIONS_PER_PILLAR,
  type AuditPillarKey,
  type AuditQuestion,
} from './questions';
import {
  isValidRating,
  ratingToScore,
  calculateGradeLabel,
  gradeColor,
  averageConfidence,
  type AiRating,
} from './scoreUtils';
import {
  debugLog,
  debugGroup,
  debugGroupEnd,
  debugError,
  debugImageInfo,
} from './debug';

// ── Model configuration ───────────────────────────────────────────────────────

/** Primary Gemini model for all audit requests. Change here to update everywhere. */
const GEMINI_MODEL = 'gemini-2.5-flash';

/** Fallback model used on the single retry attempt. */
const GEMINI_RETRY_MODEL = 'gemini-1.5-flash-latest';

// ── Internal types for parsed Gemini response ─────────────────────────────────

interface GeminiQuestionEval {
  question:   string;
  rating:     string;
  reason:     string;
  confidence: unknown; // treated as unknown — non-fatal if invalid
}

interface GeminiPillarResponse {
  questions: GeminiQuestionEval[];
}

type GeminiRawResponse = Record<string, unknown> & {
  recommendations?: unknown;
};

interface GeminiRawRecommendation {
  pillar:            string;
  problem:           string;
  corrective_action: string;
  expected_benefit?: string;
}

// ── Prompt builder ────────────────────────────────────────────────────────────
//
// Dynamically constructs the Gemini prompt from questions.ts.
// For questions with guidance, the prompt includes:
//   Question → Evaluate → Ignore → Notes (if present) → Uncertainty Response
// For questions without guidance, the prompt uses a simple numbered format.

/** Formats a single question block for the Gemini prompt */
function formatQuestionBlock(q: AuditQuestion, index: number): string {
  const lines: string[] = [];
  lines.push(`  ${index + 1}. ${q.question}`);

  if (q.guidance) {
    const g = q.guidance;
    lines.push(`     Evaluate: ${g.evaluate.join('; ')}`);
    lines.push(`     Ignore: ${g.ignore.join('; ')}`);
    if (g.notes && g.notes.length > 0) {
      lines.push(`     Notes: ${g.notes.join(' ')}`);
    }
    lines.push(
      `     If uncertain: rating="${g.uncertaintyResponse.rating}", ` +
      `confidence=${g.uncertaintyResponse.confidence}, ` +
      `reason="${g.uncertaintyResponse.reason}"`,
    );
  }

  return lines.join('\n');
}

function buildPrompt(workspaceContext?: Record<string, unknown>): string {
  const pillarSections = PILLAR_ORDER.map(pillarKey => {
    const pillarLabel = pillarKey === 'SET_IN_ORDER' ? 'SET IN ORDER' : pillarKey;
    const questions = AUDIT_QUESTIONS[pillarKey];
    const questionBlocks = questions.map((q, i) => formatQuestionBlock(q, i)).join('\n');
    return `${pillarLabel}:\n${questionBlocks}`;
  }).join('\n\n');

  // Extract variables with fallbacks
  const injectedAuditZone = (workspaceContext?.selectedZone as string) || 'General';
  const injectedWorkspaceType = (workspaceContext?.workspaceType as string) || 'General';
  const injectedIndustry = (workspaceContext?.industry as string) || 'General Industrial';
  const injectedOfficeName = (workspaceContext?.officeName as string) || 'Unknown Office';
  const injectedZoneName = (workspaceContext?.selectedZone as string) || 'Unspecified Zone';

  return `You are an experienced industrial 5S auditor with decades of field experience.

Carefully examine the provided workplace image and evaluate each question below based ONLY on what is visually observable in the image.

CRITICAL RULES:
- Return VALID JSON ONLY. No markdown. No code blocks. No explanations outside JSON.
- Answer EVERY question in the EXACT ORDER and EXACT WORDING given below. Do NOT rephrase, skip, merge, or reorder questions.
- For every question return exactly: question (copy the exact text), rating, reason, confidence.
- rating MUST be one of: VERY_GOOD, GOOD, AVERAGE, BAD, VERY_BAD — no other values.
- reason MUST describe specific visual evidence observed in the image.
- confidence MUST be an integer from 0 to 100 representing your certainty.
- Do NOT calculate any scores, percentages, or grades — the application handles all calculations.
- Do NOT invent objects not visible in the image.
- Audit Zone Interpretation Rule
  Audit Zone Context Rules
  Use the provided Audit Zone only to understand the operational purpose of the workplace being evaluated.
  The Audit Zone provides contextual understanding of the workspace and should help interpret the environment appropriately.
  However:
  • Never use the Audit Zone itself as evidence.
  • Never assume equipment, tools, safety devices, labels, documents, machinery, storage systems, or workplace features exist simply because they are commonly expected within that Audit Zone.
  • Never assume something is missing solely because it is normally expected within that Audit Zone.
  • Every rating, reason, confidence level, observation, and recommendation must be supported only by visually observable evidence contained in the uploaded image.
  If sufficient visual evidence is unavailable, follow the existing uncertainty rules exactly.
- If a question includes an "If uncertain" directive, follow it exactly when evidence is insufficient.
- Otherwise, if a question cannot be assessed: rating="AVERAGE", confidence=30, reason="Cannot be determined from the provided image."

SORT EVALUATION RULES:
- Evaluate ONLY what is directly visible in the image.
- Never infer information outside the image.
- Never assume an item is unnecessary simply because it exists.
- Industrial workplaces naturally contain raw materials, spare parts, chemicals, equipment, and containers — these are NOT unnecessary unless there is clear visual evidence.
- Only classify something as unnecessary when there is visible evidence that it creates clutter, appears abandoned, is unrelated to the workplace, occupies valuable workspace unnecessarily, or is obviously stored improperly.
- Every reason must reference specific visible evidence.

## WORKSPACE CONTEXT
Audit Zone:
${injectedAuditZone}

Workspace Type:
${injectedWorkspaceType}

Industry:
${injectedIndustry}

Facility / Office:
${injectedOfficeName}

Area / Station:
${injectedZoneName}

Context Guidance
This workplace belongs to the Audit Zone shown above.
Use this information only to understand the operational purpose of the workplace.
Do not treat this context as visual evidence.
Visible observations always take precedence over contextual expectations.
If the uploaded image does not visibly contain sufficient evidence for a particular assessment, follow the existing uncertainty rules without making assumptions.

## QUESTIONS TO EVALUATE:

${pillarSections}

Recommendation Rules
Generate recommendations only for issues that are visually observed within the uploaded image.
When generating recommendations, consider the operational purpose of the Audit Zone so that recommendations are appropriate for that type of workplace.
However:
• Never recommend correcting equipment, safety devices, documents, labels, storage systems, or workplace features that cannot be visually confirmed.
• Never recommend adding something solely because it is commonly expected in that Audit Zone.
• Every recommendation must directly correspond to a visually observed issue identified during the audit.
Recommendations should remain:
• Specific
• Practical
• Actionable
• Relevant to the observed workplace
Avoid generic recommendations whenever possible.

Return this exact JSON structure:
{
  "sort": {
    "questions": [
      { "question": "exact question text", "rating": "GOOD", "reason": "specific visual evidence", "confidence": 90 }
    ]
  },
  "set_in_order": { "questions": [...] },
  "shine": { "questions": [...] },
  "standardize": { "questions": [...] },
  "sustain": { "questions": [...] },
  "recommendations": [
    { "pillar": "SORT", "problem": "description of issue", "corrective_action": "what to do", "expected_benefit": "expected outcome" }
  ]
}`;
}

// ── Gemini API caller ─────────────────────────────────────────────────────────

async function callGeminiApi(
  imageBase64: string,
  prompt: string,
  apiKey: string,
  modelName: string,
): Promise<string> {
  const rawBase64 = imageBase64.includes(',')
    ? imageBase64.split(',')[1]
    : imageBase64;

  // ── Debug: Image metadata (never logs the base64 data itself) ────────────
  debugImageInfo(imageBase64);

  // ── Debug: Full prompt sent to Gemini ─────────────────────────────────────
  debugGroup('Prompt Sent to Gemini');
  debugLog(prompt);
  debugGroupEnd();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: rawBase64 } },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');

  const trimmed = text.trim();

  // ── Debug: Raw Gemini response (before parsing) ───────────────────────────
  debugGroup('Raw Gemini Response');
  debugLog(trimmed);
  debugGroupEnd();

  return trimmed;
}

// ── Strict response validator ─────────────────────────────────────────────────
//
// Validation order (matches specification):
//   Step 1 — JSON valid          (guaranteed by caller: JSON.parse succeeded)
//   Step 2 — Question count      (all 5 pillars present, each has exactly 4 questions)
//   Step 3 — Question identity   (Gemini's question field matches application's exact text)
//   Step 4 — Rating values       (must be one of the 5 valid AiRating values)
//   Step 5 — Required fields     (reason must be a non-empty string)
//
//   Confidence is NOT a failure condition — see parseConfidence() below.
//   Recommendations are NOT validated here — parsed separately with graceful fallback.

/** Normalises question text for comparison: trim + collapse whitespace + lower case */
function normaliseQuestion(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Parses confidence from a Gemini question eval.
 * Returns the numeric value if valid (0–100 integer), otherwise null.
 * A missing or non-numeric confidence does NOT fail the audit.
 */
function parseConfidence(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  return null;
}

interface ValidatedQuestion {
  id:         string;
  question:   string;
  rating:     AiRating;
  reason:     string;
  confidence: number | null;
}

interface ValidatedPillar {
  pillarKey: AuditPillarKey;
  questions: ValidatedQuestion[];
}

function validateGeminiResponse(
  parsed: unknown,
  questions: AuditQuestion[],
): ValidatedPillar[] {
  // Step 1 — JSON valid (caller already parsed, so we just check object shape)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini response is not a JSON object.');
  }

  const resp = parsed as Record<string, unknown>;
  const validatedPillars: ValidatedPillar[] = [];

  for (const pillarKey of PILLAR_ORDER) {
    const jsonKey    = PILLAR_TO_JSON_KEY[pillarKey];
    const pillarData = resp[jsonKey];

    // Step 2 — Question count: pillar must exist and have exactly 4 questions
    if (!pillarData || typeof pillarData !== 'object' || Array.isArray(pillarData)) {
      throw new Error(`Missing pillar section "${jsonKey}" in Gemini response.`);
    }

    const pillarObj = pillarData as Record<string, unknown>;
    if (!Array.isArray(pillarObj.questions)) {
      throw new Error(`"${jsonKey}.questions" must be an array.`);
    }

    const geminiQs   = pillarObj.questions as unknown[];
    const expectedQs = questions.filter(q => q.pillar === pillarKey);

    if (geminiQs.length !== expectedQs.length) {
      throw new Error(
        `"${jsonKey}" has ${geminiQs.length} question(s), expected ${expectedQs.length}.`,
      );
    }

    const validatedQuestions: ValidatedQuestion[] = [];

    for (let i = 0; i < expectedQs.length; i++) {
      const expected = expectedQs[i];
      const geminiQ  = geminiQs[i] as Record<string, unknown>;

      // Step 3 — Question identity: Gemini must echo back the exact question text
      if (typeof geminiQ.question !== 'string') {
        throw new Error(
          `"${jsonKey}" question ${i + 1}: missing "question" field.`,
        );
      }

      if (normaliseQuestion(geminiQ.question) !== normaliseQuestion(expected.question)) {
        throw new Error(
          `"${jsonKey}" question ${i + 1} identity mismatch.\n` +
          `  Expected: "${expected.question}"\n` +
          `  Received: "${geminiQ.question}"`,
        );
      }

      // Step 4 — Rating values
      if (!isValidRating(geminiQ.rating)) {
        throw new Error(
          `"${jsonKey}" question ${i + 1}: invalid rating "${geminiQ.rating}". ` +
          `Must be one of: VERY_GOOD, GOOD, AVERAGE, BAD, VERY_BAD.`,
        );
      }

      // Step 5 — Required fields: reason must be a non-empty string
      if (typeof geminiQ.reason !== 'string' || geminiQ.reason.trim() === '') {
        throw new Error(
          `"${jsonKey}" question ${i + 1}: "reason" is missing or empty.`,
        );
      }

      // Confidence: non-fatal — null if missing or invalid
      const confidence = parseConfidence(geminiQ.confidence);

      validatedQuestions.push({
        id:         expected.id,
        question:   expected.question, // always use app's authoritative question text
        rating:     geminiQ.rating as AiRating,
        reason:     geminiQ.reason.trim(),
        confidence,
      });
    }

    validatedPillars.push({ pillarKey, questions: validatedQuestions });
  }

  return validatedPillars;
}

// ── Recommendations parser (non-fatal) ───────────────────────────────────────

/**
 * Parses Gemini's recommendations array.
 * If the recommendations field is absent, null, or malformed, returns an empty array.
 * A malformed recommendations section does NOT fail the audit.
 */
function parseRecommendations(resp: unknown): GeminiRawRecommendation[] {
  try {
    const r = (resp as Record<string, unknown>)?.recommendations;
    if (!Array.isArray(r)) return [];

    const valid: GeminiRawRecommendation[] = [];
    for (const item of r) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as any).pillar           === 'string' &&
        typeof (item as any).problem          === 'string' &&
        typeof (item as any).corrective_action === 'string'
      ) {
        valid.push(item as GeminiRawRecommendation);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

// ── Score calculator (runs only after validation passes) ──────────────────────

interface ScoredPillar {
  pillarKey:  AuditPillarKey;
  score:      number;   // 0–16
  maxScore:   number;   // 16
  percentage: number;   // 0–100
  questions:  ScoredQuestion[];
}

interface ScoredQuestion {
  id:         string;
  question:   string;
  aiRating:   AiRating;
  score:      number;        // 0–4
  reason:     string;
  confidence: number | null;
}

function calculateScores(
  validatedPillars: ValidatedPillar[],
): { pillars: ScoredPillar[]; overallScore: number; overallPct: number; allConfidences: Array<number | null> } {
  const pillars: ScoredPillar[] = [];
  const allConfidences: Array<number | null> = [];

  // ── Debug: Score calculation header ──────────────────────────────────────
  debugGroup('Score Calculation');

  for (const vp of validatedPillars) {
    debugGroup(`Pillar: ${vp.pillarKey}`);

    const scoredQuestions: ScoredQuestion[] = vp.questions.map(q => {
      const score = ratingToScore(q.rating);
      allConfidences.push(q.confidence);

      // ── Debug: Per-question rating → score ──────────────────────────────
      debugLog(
        `${q.id}  |  ${q.rating}  →  ${score}  |  conf: ${
          q.confidence !== null ? q.confidence + '%' : 'N/A'
        }  |  ${q.question}`,
      );

      return {
        id:         q.id,
        question:   q.question,
        aiRating:   q.rating,
        score,
        reason:     q.reason,
        confidence: q.confidence,
      };
    });

    const pillarScore    = scoredQuestions.reduce((sum, q) => sum + q.score, 0);
    const pillarMaxScore = QUESTIONS_PER_PILLAR * 4; // 16
    const pillarPct      = Math.round((pillarScore / pillarMaxScore) * 100);

    // ── Debug: Pillar total ───────────────────────────────────────────────
    debugLog(`Total: ${pillarScore} / ${pillarMaxScore}  (${pillarPct}%)`);
    debugGroupEnd(); // close pillar group

    pillars.push({
      pillarKey:  vp.pillarKey,
      score:      pillarScore,
      maxScore:   pillarMaxScore,
      percentage: pillarPct,
      questions:  scoredQuestions,
    });
  }

  const overallScore = pillars.reduce((sum, p) => sum + p.score, 0);
  const overallMax   = PILLAR_ORDER.length * QUESTIONS_PER_PILLAR * 4; // 80
  const overallPct   = Math.round((overallScore / overallMax) * 100);

  debugGroupEnd(); // close 'Score Calculation' group

  return { pillars, overallScore, overallPct, allConfidences };
}

// ── Build AuditAnalysisResult ─────────────────────────────────────────────────

const PILLAR_LABEL: Record<AuditPillarKey, string> = {
  SORT:         'Sort',
  SET_IN_ORDER: 'Set in Order',
  SHINE:        'Shine',
  STANDARDIZE:  'Standardize',
  SUSTAIN:      'Sustain',
};

function buildAuditAnalysisResult(
  scoredPillars:  ScoredPillar[],
  overallScore:   number,
  overallPct:     number,
  allConfidences: Array<number | null>,
  rawRecommendations: GeminiRawRecommendation[],
  modelName:      string,
): AuditAnalysisResult {
  // ── Debug: Question evaluations (details per question) ───────────────────
  debugGroup('Question Evaluations');
  for (const p of scoredPillars) {
    for (const q of p.questions) {
      debugGroup(`${q.id}`);
      debugLog('Question:  ', q.question);
      debugLog('Rating:    ', q.aiRating);
      debugLog('Score:     ', q.score, '/ 4');
      debugLog('Confidence:', q.confidence !== null ? q.confidence + '%' : 'N/A (not provided)');
      debugLog('Reason:    ', q.reason);
      debugGroupEnd();
    }
  }
  debugGroupEnd();
  const grade = calculateGradeLabel(overallPct);

  // Average confidence: only over questions that returned a numeric value
  const numericConfidences = allConfidences.filter((c): c is number => c !== null);
  const avgConf = averageConfidence(numericConfidences); // null if none provided

  // Pillar score summaries
  const pillarScores = scoredPillars.map(p => ({
    pillar:         PILLAR_LABEL[p.pillarKey] as any,
    score:          p.score,
    maximum:        p.maxScore,
    percentage:     p.percentage,
    raw_percentage: p.percentage,
    passed:         p.questions.filter(q => q.score >= 3).length,
    partial:        p.questions.filter(q => q.score === 2).length,
    failed:         p.questions.filter(q => q.score <= 1).length,
    not_visible:    0,
    not_applicable: 0,
    critical:       p.questions.filter(q => q.score === 0).length,
    cap_applied:    false,
    top_deductions: [],
  }));

  // Per-question responses.
  // `score` is an extended field (not in AuditQuestionResponse type) stored here so
  // auditMapper.ts can reconstruct exact 0–4 scores without the lossy YES/PARTIAL/NO mapping.
  const responses = scoredPillars.flatMap(p =>
    p.questions.map(q => ({
      question_id: q.id,
      ai_answer:   (q.score >= 3 ? 'YES' : q.score === 2 ? 'PARTIAL' : 'NO') as any,
      confidence:  q.confidence !== null ? q.confidence / 100 : null,
      evidence:    q.reason,
      score:       q.score, // extended field for mapper
    } as any)),
  );

  // Map recommendations (already validated/filtered by parseRecommendations)
  const recommendations: AuditRecommendation[] = rawRecommendations.map((rec, idx) => {
    const pillarKey = PILLAR_ORDER.find(
      k => PILLAR_LABEL[k].toLowerCase() === rec.pillar.toLowerCase(),
    ) ?? 'SORT';

    const pillarData = scoredPillars.find(p => p.pillarKey === pillarKey);
    const worstQ     = pillarData?.questions
      .slice()
      .sort((a, b) => a.score - b.score)[0];

    return {
      pillar:             PILLAR_LABEL[pillarKey],
      severity:           'MAJOR' as const,
      priority:           idx + 1,
      priority_label:     'High Priority',
      title:              rec.problem,
      description:        rec.corrective_action,
      problem:            rec.problem,
      root_cause:         rec.problem,
      corrective_action:  rec.corrective_action,
      expected_benefit:   rec.expected_benefit ?? 'Restores 5S compliance standard.',
      linked_question_id: worstQ?.id ?? `${pillarKey}_Q1`,
    };
  });

  // ── Debug: Pillar score summary ───────────────────────────────────────────
  debugGroup('Pillar Score Summary');
  for (const p of scoredPillars) {
    debugLog(`${p.pillarKey.padEnd(14)}  ${p.score} / ${p.maxScore}  (${p.percentage}%)`);
  }
  debugGroupEnd();

  // ── Debug: Overall result ─────────────────────────────────────────────────
  debugGroup('Overall Result');
  debugLog('Overall Score:     ', overallScore, '/ 80');
  debugLog('Overall Percentage:', overallPct + '%');
  debugLog('Grade:             ', grade);
  debugLog('Avg Confidence:    ', avgConf !== null ? avgConf + '%' : 'N/A');
  debugGroupEnd();

  // ── Debug: Recommendations ────────────────────────────────────────────────
  debugGroup(`Recommendations (${rawRecommendations.length})`);
  rawRecommendations.forEach((rec, i) => {
    debugLog(`${i + 1}. [${rec.pillar}] ${rec.problem} → ${rec.corrective_action}`);
  });
  debugGroupEnd();

  return {
    template: {
      id:      'std-5s-v2',
      name:    'Standard 5S Audit',
      version: '2.0.0',
    },
    prompt_version:    'v2.0',
    vision_model:      modelName,
    schema_version:    '2.0',
    audit_confidence:  avgConf !== null ? avgConf / 100 : null as any,
    before: {
      score: {
        pillar_scores:      pillarScores,
        overall_score:      overallScore,
        overall_maximum:    80,
        overall_percentage: overallPct,
        grade,
        grade_color:        gradeColor(grade),
        total_answered:     scoredPillars.reduce((s, p) => s + p.questions.length, 0),
        total_questions:    scoredPillars.reduce((s, p) => s + p.questions.length, 0),
        critical_failures:  pillarScores.reduce((s, p) => s + p.critical, 0),
        computed_at:        new Date().toISOString(),
      },
      responses,
    },
    recommendations,
    improvement_prompt:    null,
    explainability_report: null,
    scoringMethod:         'AI Audit V2 (Rating-Based)',
  };
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

/**
 * Runs the complete 5S audit pipeline for a single workplace image.
 *
 * @param imageBase64      - Base64-encoded workplace image (with or without data URI prefix).
 * @param apiKey           - Gemini API key (VITE_GEMINI_API_KEY).
 * @param workspaceContext - Optional metadata passed through for logging.
 * @param attempt          - Internal retry counter. Do not pass externally.
 * @returns AuditAnalysisResult — consumed by useAnalysisPipeline.ts unchanged.
 * @throws Error('AI Analysis Failed') after one retry if any fatal validation fails.
 */
export async function runAuditPipeline(
  imageBase64: string,
  apiKey: string,
  workspaceContext?: Record<string, unknown>,
  attempt = 0,
): Promise<AuditAnalysisResult> {
  const modelName  = attempt === 0 ? GEMINI_MODEL : GEMINI_RETRY_MODEL;
  const startTime  = Date.now();
  const prompt     = buildPrompt(workspaceContext);

  // ── Debug: Pipeline Started ───────────────────────────────────────────────
  if (attempt === 0) {
    debugGroup('AI Audit Pipeline Started');
    debugLog('Timestamp:      ', new Date().toISOString());
    debugLog('Model:          ', modelName);
    debugLog('Question Count: ', getAllQuestions().length);
    debugGroupEnd();

    // ── Debug: Questions loaded from questions.ts ─────────────────────────
    debugGroup('Questions Sent to Gemini');
    getAllQuestions().forEach((q, i) => debugLog(`${String(i + 1).padStart(2, '0')}. [${q.pillar}] ${q.id}: ${q.question}`));
    debugGroupEnd();
  } else {
    debugLog(`Retry attempt — Model: ${modelName}`);
  }

  // ── Step 1: Call Gemini ───────────────────────────────────────────────────
  let rawText: string;
  try {
    rawText = await callGeminiApi(imageBase64, prompt, apiKey, modelName);
  } catch (err) {
    debugError(`API call failed (attempt ${attempt})`, err);
    if (attempt === 0) {
      console.warn('[analysisPipeline] API call failed (attempt 0). Retrying…', err);
      return runAuditPipeline(imageBase64, apiKey, workspaceContext, 1);
    }
    debugLog('Pipeline Finished — FAILED after retry | Elapsed:', Date.now() - startTime + 'ms');
    throw new Error('AI Analysis Failed');
  }

  // ── Step 2: Parse JSON ───────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
    // ── Debug: Parsed JSON ───────────────────────────────────────────────
    debugGroup('Parsed JSON');
    debugLog(JSON.stringify(parsed, null, 2));
    debugGroupEnd();
  } catch {
    debugError('JSON parse failed', rawText);
    if (attempt === 0) {
      console.warn('[analysisPipeline] Invalid JSON (attempt 0). Retrying…');
      return runAuditPipeline(imageBase64, apiKey, workspaceContext, 1);
    }
    debugLog('Pipeline Finished — FAILED after retry | Elapsed:', Date.now() - startTime + 'ms');
    throw new Error('AI Analysis Failed');
  }

  // ── Steps 3–7: Validate (count → identity → ratings → required fields) ──
  let validatedPillars: ValidatedPillar[];
  try {
    validatedPillars = validateGeminiResponse(parsed, getAllQuestions());
  } catch (validationErr) {
    debugError(`Validation failed (attempt ${attempt})`, validationErr);
    if (attempt === 0) {
      console.warn('[analysisPipeline] Validation failed (attempt 0). Retrying…', validationErr);
      return runAuditPipeline(imageBase64, apiKey, workspaceContext, 1);
    }
    console.error('[analysisPipeline] Validation failed on retry:', validationErr);
    debugLog('Pipeline Finished — FAILED after retry | Elapsed:', Date.now() - startTime + 'ms');
    throw new Error('AI Analysis Failed');
  }

  // ── Recommendations: parsed separately — malformed = skip, not fail ──────
  const rawRecommendations = parseRecommendations(parsed);

  // ── Score calculation: begins only after full validation passes ───────────
  const { pillars, overallScore, overallPct, allConfidences } = calculateScores(validatedPillars);

  const result = buildAuditAnalysisResult(
    pillars,
    overallScore,
    overallPct,
    allConfidences,
    rawRecommendations,
    modelName,
  );

  // ── Debug: Pipeline Finished ──────────────────────────────────────────────
  debugLog(
    `Pipeline Finished — SUCCESS | Elapsed: ${Date.now() - startTime}ms | ` +
    `Score: ${overallScore}/80 (${overallPct}%) | Grade: ${result.before.score.grade}`,
  );

  return result;
}
