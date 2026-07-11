/**
 * src/modules/audit/recommendation/recommendationGenerator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 7 — Recommendation Generator: Main Engine
 *
 * ROLE:
 *   Assembles prompts, calls Gemini (with fallback retry), parses response,
 *   validates constraints, and returns prioritized recommendation outputs.
 */

import type {
  OverallScore,
  GradeResult,
  PillarScore,
  QuestionScore,
  StandardizedObservation,
} from '@/types/analysis';
import type { AuditRecommendationResult } from './recommendationTypes';
import { buildRecommendationPrompt } from './promptBuilder';
import { safeParseJson } from './jsonValidator';
import { validateRecommendations } from './recommendationValidator';
import { sortQuestionRecommendations } from './recommendationPriority';
import { debugLog, debugGroup, debugGroupEnd, debugError } from '../pipeline/debug';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const PRIMARY_MODEL   = 'gemini-2.5-flash';
const RETRY_MODEL     = 'gemini-1.5-flash';

/** Calls Gemini text API. */
async function callGeminiText(
  prompt: string,
  apiKey: string,
  model:  string,
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty text response.');
  }

  return text.trim();
}

/** Fallback error result when all attempts fail. */
function buildErrorResult(reason: string): AuditRecommendationResult {
  return {
    questionRecommendations: [],
    pillarRecommendations:   [],
    overallRecommendation: {
      summary:      `Failed to generate recommendations: ${reason}`,
      strengths:    ['Deterministic scoring was successful.'],
      improvements: ['Check connection or configuration.'],
      nextSteps:    ['Retry the audit analysis.'],
    },
  };
}

/**
 * Generates intelligent human-readable recommendations from audit results.
 *
 * @param overall      - The overall score.
 * @param grade        - The calculated letter grade.
 * @param pillars      - The pillar scores.
 * @param questions    - The question scores.
 * @param observations - Standardized observations (with evidenceIds).
 * @param config       - The global audit configuration registry.
 * @param customApiKey - Optional custom API key.
 * @returns Parsed and validated AuditRecommendationResult.
 */
export async function generateRecommendations(
  overall:      OverallScore,
  grade:        GradeResult,
  pillars:      PillarScore[],
  questions:    QuestionScore[],
  observations: StandardizedObservation[],
  config:       any,
  customApiKey?: string,
): Promise<AuditRecommendationResult> {
  const startTime = Date.now();

  // Load API key
  const apiKey = customApiKey ?? (import.meta.env?.VITE_GEMINI_API_KEY as string);

  if (!apiKey || apiKey.trim() === '') {
    debugError('VITE_GEMINI_API_KEY is missing. Skipping recommendations.', null);
    return buildErrorResult('Gemini API key is not configured.');
  }

  debugGroup('Recommendation Generator Started');

  // Build the strict prompt
  const prompt = buildRecommendationPrompt(overall, grade, pillars, questions, observations);
  debugLog('Prompt Size:        ', `${prompt.length} characters`);
  debugLog('Question Count:     ', questions.length);

  debugGroup('Gemini Request');
  debugLog(prompt);
  debugGroupEnd();

  // Loop with retry fallback
  for (let attempt = 0; attempt <= 1; attempt++) {
    const model = attempt === 0 ? PRIMARY_MODEL : RETRY_MODEL;

    if (attempt === 1) {
      debugLog('Retrying recommendations with fallback model:', RETRY_MODEL);
    }

    let rawText = '';
    try {
      rawText = await callGeminiText(prompt, apiKey, model);
    } catch (apiErr) {
      debugError(`Gemini API call failed (attempt ${attempt})`, apiErr);
      if (attempt === 0) continue; // retry
      debugLog('Pipeline Decision:  PASS_TO_REPORT_BUILDER (with empty fallback recs)');
      debugLog(`Execution Time (ms): ${Date.now() - startTime}`);
      debugGroupEnd();
      return buildErrorResult((apiErr as Error).message ?? 'Gemini API unreachable.');
    }

    debugGroup('Gemini Response');
    debugLog(rawText);
    debugGroupEnd();

    // Parse JSON safely
    let parsed: any;
    try {
      parsed = safeParseJson(rawText);
      debugLog('JSON Validation:     PASS');
    } catch (parseErr) {
      debugError(`JSON parsing failed (attempt ${attempt})`, parseErr);
      if (attempt === 0) continue; // retry
      debugLog('Pipeline Decision:  PASS_TO_REPORT_BUILDER (with empty fallback recs)');
      debugLog(`Execution Time (ms): ${Date.now() - startTime}`);
      debugGroupEnd();
      return buildErrorResult('Failed to parse Gemini recommendations output.');
    }

    // Validate structural boundaries and constraints
    try {
      validateRecommendations(parsed, questions, observations);
    } catch (valErr) {
      debugError(`Output validation failed (attempt ${attempt})`, valErr);
      if (attempt === 0) continue; // retry
      debugLog('Pipeline Decision:  PASS_TO_REPORT_BUILDER (with empty fallback recs)');
      debugLog(`Execution Time (ms): ${Date.now() - startTime}`);
      debugGroupEnd();
      return buildErrorResult(`Gemini recommendation validation failed: ${(valErr as Error).message}`);
    }

    // Prioritize & sort recommendations deterministically
    parsed.questionRecommendations = sortQuestionRecommendations(parsed.questionRecommendations);

    const elapsed = Date.now() - startTime;
    debugLog('Pipeline Decision:  PASS_TO_REPORT_BUILDER');
    debugLog(`Execution Time (ms): ${elapsed}`);
    debugGroupEnd(); // close 'Recommendation Generator Started'

    return parsed as AuditRecommendationResult;
  }

  return buildErrorResult('Recommendation Generator: unexpected attempt loop exit.');
}
