/**
 * src/modules/audit/pipeline/geminiVisionAnalyzer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline V3 — Phase 2: Gemini Vision Analyzer
 *
 * ROLE:
 *   This module is the "eyes" of the AI pipeline.
 *   It sends a validated image to Gemini Vision and receives structured
 *   visual observations in return.
 *
 * RESPONSIBILITIES:
 *   ✓ Detect visible objects (name, count, location, confidence)
 *   ✓ Identify the scene / environment type
 *   ✓ Extract all readable text (OCR)
 *   ✓ Return a structured GeminiVisionResult
 *
 * STRICT PROHIBITIONS:
 *   ✗ No audit scoring
 *   ✗ No 5S question evaluation
 *   ✗ No compliance judgements
 *   ✗ No recommendations
 *   ✗ No workplace quality assessment
 *   ✗ No hardcoded object names or industry assumptions
 *
 * DESIGN:
 *   - Single exported entry point: analyzeImageWithGemini()
 *   - Reusable beyond 5S auditing — the module is domain-agnostic
 *   - Primary model: gemini-2.5-flash
 *   - Retry model:   gemini-1.5-flash (single retry on JSON failure)
 *   - Never crashes the pipeline — returns _error field on both attempts failing
 *
 * PIPELINE POSITION:
 *   Image Validation → [Gemini Vision Analyzer] → Structured Observation Engine
 */

import type { GeminiVisionResult, GeminiVisionScene, GeminiVisionObject } from '@/types/analysis';
import {
  debugLog,
  debugGroup,
  debugGroupEnd,
  debugError,
} from './debug';

// ── Model configuration ───────────────────────────────────────────────────────

/** Primary model for visual perception. */
const PRIMARY_MODEL = 'gemini-3.6-flash';

/** Fallback model used on the single retry attempt. */
const RETRY_MODEL = 'gemini-flash-latest';

/** Gemini API base URL. */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Safe error result ─────────────────────────────────────────────────────────

/**
 * Returns a structured error result when both Gemini attempts fail.
 * The pipeline is never allowed to crash — downstream stages check _error.
 */
function buildErrorResult(reason: string): GeminiVisionResult {
  return {
    scene:       { environment: 'Unknown', confidence: 0 },
    objects:     [],
    visibleText: [],
    _error:      reason,
  };
}

// ── Prompt builder ────────────────────────────────────────────────────────────
//
// The prompt is intentionally free of all audit, 5S, and compliance language.
// Gemini is instructed to act as a visual inspection system, not an auditor.
// It must only observe and describe — never evaluate or judge.

function buildVisionPrompt(): string {
  return `You are a professional industrial visual inspection system.

Your ONLY task is to examine the provided image and describe what is physically visible.

YOU MUST NOT:
- Evaluate compliance
- Assess quality
- Judge whether anything is correct or incorrect
- Score anything
- Make recommendations
- Use any audit language (5S, Sort, Shine, Standardize, Sustain, etc.)

YOUR ONLY JOB:
1. Identify the scene/environment type from visible context (e.g. "Manufacturing Workshop", "Chemical Storage Area", "Office Workspace").
2. List every major visible physical object with its approximate count and location.
3. Extract every piece of text that is readable in the image.

OBJECT DETECTION RULES:
- Only include objects that are visibly present in the image.
- Never invent objects that are not clearly visible.
- For each object provide: name, estimated count, approximate location in frame, confidence (0-100).
- Location must use spatial descriptors: Left, Right, Center, Foreground, Background, Upper Left, Upper Right, Lower Left, Lower Right, Center Left, Center Right.
- Count is your best visual estimate. Use 1 if only one is visible.

OCR RULES:
- Extract every readable text string visible in the image.
- Include signs, labels, machine IDs, safety notices, department names, container labels, notices, boards.
- Do NOT interpret the meaning of the text — just extract the raw string.
- If no text is readable, return an empty array.

RESPONSE FORMAT:
Return ONLY a valid JSON object. No markdown. No code blocks. No explanation outside the JSON.

Return this exact structure:
{
  "scene": {
    "environment": "Description of the visible environment",
    "confidence": 95
  },
  "objects": [
    {
      "id": 1,
      "name": "Object name as observed",
      "count": 1,
      "location": "Location in frame",
      "confidence": 95
    }
  ],
  "visibleText": [
    "EXACT TEXT AS VISIBLE"
  ]
}

If visibleText is empty, return: "visibleText": []
If no objects are detected, return: "objects": []`;
}

// ── Gemini API caller ─────────────────────────────────────────────────────────

/**
 * Makes a single call to the Gemini Vision API.
 * Strips the data URI prefix from the base64 string before sending.
 * Returns the raw text response — parsing is done by the caller.
 */
async function callGeminiVision(
  imageBase64: string,
  apiKey:      string,
  model:       string,
): Promise<string> {
  const rawBase64 = imageBase64.includes(',')
    ? imageBase64.split(',')[1]
    : imageBase64;

  // Detect MIME type from prefix for the inlineData field
  let mimeType = 'image/jpeg'; // safe default — most uploads are JPEG
  if (imageBase64.startsWith('data:image/png'))  mimeType = 'image/png';
  if (imageBase64.startsWith('data:image/webp')) mimeType = 'image/webp';

  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: buildVisionPrompt() },
            { inlineData: { mimeType, data: rawBase64 } },
          ],
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
  if (!text) throw new Error('Gemini returned an empty response.');

  return text.trim();
}

// ── Response validator ────────────────────────────────────────────────────────
//
// Validates that the parsed JSON matches the GeminiVisionResult shape.
// Returns a typed result on success, throws a descriptive error on failure.

function validateVisionResponse(parsed: unknown): GeminiVisionResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini vision response is not a JSON object.');
  }

  const resp = parsed as Record<string, unknown>;

  // ── Validate scene ────────────────────────────────────────────────────────
  if (!resp.scene || typeof resp.scene !== 'object' || Array.isArray(resp.scene)) {
    throw new Error('Missing or invalid "scene" field.');
  }

  const sceneRaw = resp.scene as Record<string, unknown>;

  if (typeof sceneRaw.environment !== 'string' || sceneRaw.environment.trim() === '') {
    throw new Error('"scene.environment" must be a non-empty string.');
  }

  const sceneConfidence = typeof sceneRaw.confidence === 'number'
    ? Math.min(100, Math.max(0, Math.round(sceneRaw.confidence)))
    : 0;

  const scene: GeminiVisionScene = {
    environment: sceneRaw.environment.trim(),
    confidence:  sceneConfidence,
  };

  // ── Validate objects ──────────────────────────────────────────────────────
  if (!Array.isArray(resp.objects)) {
    throw new Error('"objects" must be an array.');
  }

  const objects: GeminiVisionObject[] = [];

  for (let i = 0; i < resp.objects.length; i++) {
    const raw = resp.objects[i];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;

    // id — coerce or assign sequential
    const id = typeof obj.id === 'number' ? Math.round(obj.id) : i + 1;

    // name — must be a non-empty string
    if (typeof obj.name !== 'string' || obj.name.trim() === '') continue;

    // count — must be a positive integer; default 1
    const count = typeof obj.count === 'number' && obj.count >= 1
      ? Math.round(obj.count)
      : 1;

    // location — must be a non-empty string; default "Unknown"
    const location = typeof obj.location === 'string' && obj.location.trim() !== ''
      ? obj.location.trim()
      : 'Unknown';

    // confidence — 0-100 number; default 0
    const confidence = typeof obj.confidence === 'number'
      ? Math.min(100, Math.max(0, Math.round(obj.confidence)))
      : 0;

    objects.push({ id, name: obj.name.trim(), count, location, confidence });
  }

  // ── Validate visibleText ──────────────────────────────────────────────────
  let visibleText: string[] = [];

  if (Array.isArray(resp.visibleText)) {
    visibleText = resp.visibleText
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      .map(t => t.trim());
  }

  return { scene, objects, visibleText };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Sends a validated image to Gemini Vision and returns structured visual observations.
 *
 * This is the single entry point for the Gemini Vision Analyzer.
 * Call this function AFTER image validation passes.
 *
 * The result contains ONLY visual observations — no audit, scoring, or compliance data.
 * The downstream Structured Observation Engine (Sprint 3) consumes this result.
 *
 * @param imageBase64 - Base64-encoded image (with or without data URI prefix).
 *                      Must have already passed imageValidator.ts.
 * @param apiKey      - Gemini API key (VITE_GEMINI_API_KEY).
 * @returns GeminiVisionResult — structured visual perception output.
 *          On total failure: returns result with _error field set.
 */
export async function analyzeImageWithGemini(
  imageBase64: string,
  apiKey:      string,
): Promise<GeminiVisionResult> {
  const startTime = Date.now();

  debugGroup('Gemini Vision Analyzer Started');
  debugLog('Primary model:', PRIMARY_MODEL);

  // Log prompt content in debug mode (prompt text only — never the image data)
  debugGroup('Prompt Sent');
  debugLog(buildVisionPrompt());
  debugGroupEnd();

  // ── Attempt loop (primary + one retry) ───────────────────────────────────
  for (let attempt = 0; attempt <= 1; attempt++) {
    const model = attempt === 0 ? PRIMARY_MODEL : RETRY_MODEL;

    if (attempt === 1) {
      debugLog('Retrying with fallback model:', RETRY_MODEL);
    }

    // ── Step 1: Call Gemini API ─────────────────────────────────────────
    let rawText: string;
    try {
      rawText = await callGeminiVision(imageBase64, apiKey, model);
    } catch (apiErr) {
      debugError(`Gemini API call failed (attempt ${attempt})`, apiErr);
      if (attempt === 0) continue; // retry
      // Both attempts failed at the API level
      const reason = (apiErr as Error).message ?? 'Gemini API unreachable.';
      debugLog('Pipeline Decision: STOP — Gemini Vision Failed');
      debugLog(`Execution Time (ms): ${Date.now() - startTime}`);
      debugGroupEnd();
      return buildErrorResult(reason);
    }

    // ── Debug: Raw response ─────────────────────────────────────────────
    debugGroup('Raw Gemini Response');
    debugLog(rawText);
    debugGroupEnd();

    // ── Step 2: Parse JSON ──────────────────────────────────────────────
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      debugError(`JSON parse failed (attempt ${attempt})`, rawText.slice(0, 200));
      if (attempt === 0) continue; // retry
      debugLog('Pipeline Decision: STOP — Invalid JSON after retry');
      debugLog(`Execution Time (ms): ${Date.now() - startTime}`);
      debugGroupEnd();
      return buildErrorResult('Gemini returned invalid JSON after retry.');
    }

    // ── Step 3: Validate shape ──────────────────────────────────────────
    let result: GeminiVisionResult;
    try {
      result = validateVisionResponse(parsed);
    } catch (validationErr) {
      debugError(`Schema validation failed (attempt ${attempt})`, validationErr);
      if (attempt === 0) continue; // retry
      debugLog('Pipeline Decision: STOP — Schema invalid after retry');
      debugLog(`Execution Time (ms): ${Date.now() - startTime}`);
      debugGroupEnd();
      return buildErrorResult(
        `Gemini response did not match expected schema: ${(validationErr as Error).message}`,
      );
    }

    // ── Success ─────────────────────────────────────────────────────────
    const elapsed = Date.now() - startTime;

    debugGroup('Detected Scene');
    debugLog('Environment:', result.scene.environment);
    debugLog('Confidence: ', result.scene.confidence + '%');
    debugGroupEnd();

    debugLog('Detected Object Count:', result.objects.length);

    debugGroup('Parsed Objects');
    result.objects.forEach(obj => {
      debugLog(
        `[${String(obj.id).padStart(2, '0')}] ${obj.name.padEnd(30)} ` +
        `count=${obj.count}  loc="${obj.location}"  conf=${obj.confidence}%`,
      );
    });
    debugGroupEnd();

    debugGroup('Visible Text');
    if (result.visibleText.length > 0) {
      result.visibleText.forEach((t, i) => debugLog(`${i + 1}. "${t}"`));
    } else {
      debugLog('(none detected)');
    }
    debugGroupEnd();

    debugLog('Pipeline Decision: PASS_TO_OBSERVATION_ENGINE');
    debugLog(`Execution Time (ms): ${elapsed}`);
    debugGroupEnd(); // close 'Gemini Vision Analyzer Started'

    return result;
  }

  // Unreachable — loop always returns, but TypeScript requires a return here
  return buildErrorResult('Gemini Vision Analyzer: unexpected exit from attempt loop.');
}
