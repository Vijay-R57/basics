/**
 * src/modules/audit/recommendation/promptBuilder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 7 — Recommendation Generator: Prompt Builder
 *
 * ROLE:
 *   Constructs the system prompts and inputs to feed to Gemini.
 *   Enforces safety rules: no scoring, no rating alterations, no hallucinations.
 *   Injects ONLY structured audit statistics and evidence arrays.
 */

import type {
  OverallScore,
  GradeResult,
  PillarScore,
  QuestionScore,
  StandardizedObservation,
} from '@/types/analysis';

/**
 * Builds the strict context-based prompt for the Gemini Recommendation Generator.
 *
 * @param overall      - The overall score summary.
 * @param grade        - The calculated letter grade details.
 * @param pillars      - The pillar scores.
 * @param questions    - The question scores.
 * @param observations - Standardized observations (which contain evidenceIds).
 */
export function buildRecommendationPrompt(
  overall:      OverallScore,
  grade:        GradeResult,
  pillars:      PillarScore[],
  questions:    QuestionScore[],
  observations: StandardizedObservation[],
): string {
  // 1. Prepare minimal, clean structured questions data
  const questionMap = new Map<string, StandardizedObservation>();
  for (const obs of observations) {
    questionMap.set(obs.questionId, obs);
  }

  const structuredQuestionsInput = questions.map(q => {
    const obs = questionMap.get(q.questionId);
    return {
      questionId:  q.questionId,
      visibility:  q.visibility,
      rating:      q.rating,
      score:       q.score,
      maxScore:    q.maxScore,
      evidenceIds: obs?.evidenceIds ?? [],
      observations:obs?.evidence ?? [],
    };
  });

  // Filter low-rated questions for prompt efficiency (only BAD, VERY_BAD, AVERAGE need recommendations)
  const lowRatedQuestionsInput = structuredQuestionsInput.filter(
    q => q.rating === 'VERY_BAD' || q.rating === 'BAD' || q.rating === 'AVERAGE',
  );

  const contextData = {
    auditTemplate:   'Industrial_5S',
    overallScore: {
      actualScore:        overall.actualScore,
      maximumScore:       overall.maximumScore,
      percentage:         overall.percentage,
      evaluatedQuestions: overall.evaluatedQuestions,
      skippedQuestions:   overall.skippedQuestions,
    },
    grade: {
      grade:            grade.grade,
      matchedThreshold: grade.matchedThreshold,
    },
    pillarScores: pillars.map(p => ({
      pillar:            p.pillar,
      eligibleQuestions: p.eligibleQuestions,
      skippedQuestions:  p.skippedQuestions,
      actualScore:       p.actualScore,
      maximumScore:      p.maximumScore,
      percentage:        p.percentage,
    })),
    // Send all questions so Gemini understands the overall context (strengths, next steps),
    // but clearly demarcate which ones require recommendations.
    allQuestions: structuredQuestionsInput,
  };

  return `You are a professional industrial inspection system specialized in 5S audits.
Your sole task is to generate constructive, evidence-based recommendations based on the deterministic audit results provided below.

======================================================================
CRITICAL SAFETY CONSTRAINTS & INSTRUCTIONS
======================================================================
1. You are NOT allowed to:
   - Assign Ratings
   - Assign Scores
   - Change Scores or Ratings
   - Evaluate Compliance
   - Modify any values in the provided audit results
2. NO HALLUCINATION RULE:
   - You must NEVER invent observations.
   - You must NEVER mention objects or issues that do not exist in the provided "evidenceIds" or "observations" sections.
   - If no evidence or objects are present in a question, remain silent or state only the facts provided.
3. Every recommendation must be:
   - Evidence-based: refer only to detected objects.
   - Specific: detail what specific issue occurred.
   - Actionable: provide exact next steps.
   - Concise and Professional.
4. Recommendations must never contradict the question scores, visibility decisions, or evidence IDs.

======================================================================
DETERMINISTIC AUDIT RESULTS
======================================================================
${JSON.stringify(contextData, null, 2)}

======================================================================
EXPECTED JSON OUTPUT SCHEMA
======================================================================
Respond ONLY with a valid JSON object matching the following structure.
Do NOT include markdown formatting or backticks like \\\`\\\`\\\`json. Return raw JSON text.

{
  "questionRecommendations": [
    {
      "questionId": "SORT_Q1",
      "rating": "BAD",
      "issue": "Brief explanation of why this rating occurred using ONLY the provided observations and evidenceIds.",
      "action": "Clear, actionable recommendation to improve/resolve this specific issue."
    }
  ],
  "pillarRecommendations": [
    {
      "pillar": "SORT",
      "summary": "Factual summary of major weaknesses/issues detected in this pillar.",
      "strategy": "Concise, actionable improvement strategy for the work area."
    }
  ],
  "overallRecommendation": {
    "summary": "Executive summary workplace assessment based on the overall percentage and grade.",
    "strengths": [
      "Factual strength identified from questions rated GOOD or VERY_GOOD."
    ],
    "improvements": [
      "Factual high-priority improvement based on questions rated BAD or VERY_BAD."
    ],
    "nextSteps": [
      "Factual concrete next step based on the overall assessment."
    ]
  }
}

NOTE:
- Only include questionRecommendations for questions where rating is "AVERAGE", "BAD", or "VERY_BAD".
- You must generate a pillarRecommendation for all 5 pillars based on their respective scores.
- Return ONLY the raw JSON text.
`;
}
