/**
 * src/modules/audit/pipeline/observationEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline V3 — Phase 3: Structured Observation Engine
 *
 * ROLE:
 *   Converts Gemini Vision output (detected objects, scene, visible text)
 *   into structured, evidence-based observations for every audit question.
 *
 * RESPONSIBILITIES:
 *   ✓ Iterate over every audit question from questions.ts
 *   ✓ Match detected objects against each question's evaluate guidance
 *   ✓ Build factual evidence sentences from matched objects
 *   ✓ Extract relevant visible text per question
 *   ✓ Calculate observation confidence from matched object confidence values
 *   ✓ Return one StructuredObservationResult per question
 *
 * STRICT PROHIBITIONS:
 *   ✗ No Gemini API calls — fully deterministic
 *   ✗ No audit ratings (VERY_GOOD, GOOD, AVERAGE, BAD, VERY_BAD)
 *   ✗ No numeric scores (0–4)
 *   ✗ No compliance judgements
 *   ✗ No recommendations
 *   ✗ No subjective language (probably, maybe, seems, unnecessary, etc.)
 *   ✗ No invented objects — only references to GeminiVisionResult.objects
 *
 * DESIGN:
 *   - Single exported entry point: buildStructuredObservations()
 *   - Synchronous and pure — no side effects
 *   - Every question processed independently — no shared state between questions
 *   - Reusable beyond 5S auditing
 *
 * PIPELINE POSITION:
 *   Gemini Vision Analyzer → [Structured Observation Engine] → Observation Validator
 */

import type {
  GeminiVisionResult,
  GeminiVisionObject,
  QuestionObservation,
  StructuredObservationResult,
} from '@/types/analysis';
import type { AuditQuestion } from './questions';
import {
  debugLog,
  debugGroup,
  debugGroupEnd,
} from './debug';

// ── Banned subjective words ───────────────────────────────────────────────────
//
// Evidence sentences must never contain these words.
// The filter is applied as a final safety gate on each generated sentence.

const BANNED_WORDS = [
  'probably', 'maybe', 'seems', 'likely', 'could be', 'appears to be',
  'appears unnecessary', 'unnecessary', 'non-compliant', 'compliant',
  'excellent', 'poor', 'good', 'bad', 'clean', 'dirty', 'organized',
  'disorganized', 'properly', 'improperly', 'correctly', 'incorrectly',
];

function containsBannedWord(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return BANNED_WORDS.some(w => lower.includes(w));
}

// ── Keyword extraction ────────────────────────────────────────────────────────
//
// Converts each evaluate/ignore term into individual lowercase search tokens.
// "Floor markings" → ["floor", "markings"]
// Short words (≤2 chars) are skipped to avoid false matches on "or", "in", etc.

function extractKeywords(terms: string[]): string[] {
  const keywords: string[] = [];
  for (const term of terms) {
    const tokens = term
      .toLowerCase()
      .split(/[\s,/\-_]+/)
      .filter(t => t.length > 2);
    keywords.push(...tokens);
  }
  // Deduplicate
  return [...new Set(keywords)];
}

// ── Object matcher ────────────────────────────────────────────────────────────
//
// Returns true if a GeminiVisionObject's name matches any keyword.
// Matching is case-insensitive substring — "Chemical Containers" matches "container".

function objectMatchesKeywords(obj: GeminiVisionObject, keywords: string[]): boolean {
  const lowerName = obj.name.toLowerCase();
  return keywords.some(kw => lowerName.includes(kw));
}

// ── Text relevance check ──────────────────────────────────────────────────────
//
// Returns true if a visible text string is relevant to any evaluate keyword.

function textIsRelevant(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some(kw => lowerText.includes(kw));
}

// ── Evidence sentence builder ─────────────────────────────────────────────────
//
// Produces one factual sentence describing a matched visible object.
// Format: "<Count> <Name> <is/are> visible <location clause>."
//
// Rules enforced:
//   - Always uses exact name and count from the GeminiVisionObject
//   - Location clause included only when location is not "Unknown"
//   - Singular/plural verb agrees with count
//   - Never evaluates compliance
//   - Banned word check as final gate

function buildEvidenceSentence(obj: GeminiVisionObject): string | null {
  const noun   = obj.name.trim();
  const count  = obj.count;
  const verb   = count === 1 ? 'is' : 'are';
  const qty    = count === 1 ? 'One' : String(count);

  let sentence: string;

  if (obj.location && obj.location.toLowerCase() !== 'unknown') {
    const loc = obj.location.trim().toLowerCase();
    sentence = `${qty} ${noun} ${verb} visible in the ${loc}.`;
  } else {
    sentence = `${qty} ${noun} ${verb} visible in the captured area.`;
  }

  // Safety gate: discard the sentence if it accidentally contains banned words
  if (containsBannedWord(sentence)) return null;

  return sentence;
}

// ── No-match observation ──────────────────────────────────────────────────────
//
// Returned when no relevant objects or text are found for a question.
// Confidence = 30 aligns with the uncertaintyResponse defined in questions.ts.

const NO_MATCH_OBSERVATION: QuestionObservation = {
  visible:     false,
  evidence:    [],
  objects:     [],
  visibleText: [],
  confidence:  30,
};

// ── Per-question observation builder ─────────────────────────────────────────

function buildObservationForQuestion(
  question:     AuditQuestion,
  visionResult: GeminiVisionResult,
): QuestionObservation {
  // ── 1. Extract evaluate keywords from guidance ────────────────────────────
  const evaluateTerms = question.guidance?.evaluate ?? [];

  // Without guidance we cannot determine relevant objects — return no-match
  if (evaluateTerms.length === 0) {
    return { ...NO_MATCH_OBSERVATION };
  }

  const evaluateKeywords = extractKeywords(evaluateTerms);

  // ── 2. Match detected objects against evaluate keywords ───────────────────
  const matchedObjects: GeminiVisionObject[] = visionResult.objects.filter(
    obj => objectMatchesKeywords(obj, evaluateKeywords),
  );

  // ── 3. Match visible text against evaluate keywords ───────────────────────
  const matchedText: string[] = visionResult.visibleText.filter(
    txt => textIsRelevant(txt, evaluateKeywords),
  );

  // ── 4. If nothing matches — return no-match observation ──────────────────
  if (matchedObjects.length === 0 && matchedText.length === 0) {
    return { ...NO_MATCH_OBSERVATION };
  }

  // ── 5. Build evidence sentences from matched objects ──────────────────────
  const evidence: string[] = [];
  const objectNames: string[] = [];

  for (const obj of matchedObjects) {
    const sentence = buildEvidenceSentence(obj);
    if (sentence !== null) {
      evidence.push(sentence);
      objectNames.push(obj.name);
    }
  }

  // ── 6. Calculate confidence (average of matched object confidences) ───────
  let confidence: number;

  if (matchedObjects.length > 0) {
    const total = matchedObjects.reduce((sum, obj) => sum + obj.confidence, 0);
    confidence = Math.round(total / matchedObjects.length);
  } else {
    // Text matched but no objects — low-medium certainty
    confidence = 40;
  }

  // Guard: if all evidence sentences were banned, treat as no-match
  if (evidence.length === 0 && matchedText.length === 0) {
    return { ...NO_MATCH_OBSERVATION };
  }

  return {
    visible:     true,
    evidence,
    objects:     objectNames,
    visibleText: matchedText,
    confidence:  Math.min(100, Math.max(0, confidence)),
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Builds a structured observation for every audit question.
 *
 * This is the single entry point for the Structured Observation Engine.
 * Call this function AFTER analyzeImageWithGemini() succeeds.
 *
 * Each question is processed independently — no question influences another.
 * The function is synchronous, pure, and deterministic.
 *
 * @param visionResult - Output of geminiVisionAnalyzer.ts (Sprint 2).
 * @param questions    - Flat array of audit questions from getAllQuestions().
 * @returns One StructuredObservationResult per question (20 total for standard audit).
 *          Ready for consumption by the Observation Validator (Sprint 4).
 */
export function buildStructuredObservations(
  visionResult: GeminiVisionResult,
  questions:    AuditQuestion[],
): StructuredObservationResult[] {
  const startTime = Date.now();

  debugGroup('Structured Observation Engine Started');
  debugLog('Total questions to process:', questions.length);
  debugLog('Detected objects from Vision:', visionResult.objects.length);
  debugLog('Visible text strings from Vision:', visionResult.visibleText.length);

  const results: StructuredObservationResult[] = [];

  for (const question of questions) {
    // ── Debug: question header ──────────────────────────────────────────────
    debugGroup(`Processing: ${question.id}`);
    debugLog('Current Question:', question.question);

    if (question.guidance) {
      debugLog('Question Guidance — Evaluate:', question.guidance.evaluate);
      debugLog('Question Guidance — Ignore:  ', question.guidance.ignore);
      if (question.guidance.notes?.length) {
        debugLog('Question Guidance — Notes:   ', question.guidance.notes);
      }
    } else {
      debugLog('Question Guidance: (none defined)');
    }

    // ── Build observation ───────────────────────────────────────────────────
    let observation: QuestionObservation;

    try {
      observation = buildObservationForQuestion(question, visionResult);
    } catch {
      // Never stop the pipeline — return a safe no-match on any unexpected error
      observation = { ...NO_MATCH_OBSERVATION, confidence: 0 };
    }

    // ── Debug: observation output ───────────────────────────────────────────
    debugLog('Relevant Vision Objects:', observation.objects);
    debugGroup('Generated Observation');
    debugLog('visible:    ', observation.visible);
    debugLog('evidence:   ', observation.evidence);
    debugLog('objects:    ', observation.objects);
    debugLog('visibleText:', observation.visibleText);
    debugGroupEnd();
    debugLog('Observation Confidence:', observation.confidence + '%');
    debugGroupEnd(); // close question group

    results.push({ questionId: question.id, observation });
  }

  const elapsed = Date.now() - startTime;

  // ── Debug: summary ──────────────────────────────────────────────────────
  const visibleCount    = results.filter(r => r.observation.visible).length;
  const notVisibleCount = results.length - visibleCount;

  debugLog(`Observations complete — ${visibleCount} with evidence, ${notVisibleCount} with no visible match`);
  debugLog(`Execution Time (ms): ${elapsed}`);
  debugLog('Pipeline Decision: PASS_TO_OBSERVATION_VALIDATOR');
  debugGroupEnd(); // close 'Structured Observation Engine Started'

  return results;
}
