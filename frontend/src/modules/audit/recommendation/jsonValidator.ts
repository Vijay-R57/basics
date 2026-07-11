/**
 * src/modules/audit/recommendation/jsonValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 7 — Recommendation Generator: JSON Parser & Validator
 *
 * ROLE:
 *   Cleans and parses the raw JSON string returned by the Gemini API.
 *   Gracefully strips markdown backticks and code fence tags.
 */

/**
 * Strips markdown code blocks and parses JSON string.
 * Throws a clean error if parsing fails.
 *
 * @param rawText - Raw text response from Gemini.
 * @returns Parsed JSON object.
 */
export function safeParseJson(rawText: string): any {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('JSON_PARSE_ERROR: Input is not a valid string.');
  }

  let cleaned = rawText.trim();

  // Strip ```json ... ``` or ``` ... ``` code block markers
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '');
    cleaned = cleaned.replace(/\n?```$/, '');
    cleaned = cleaned.trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `JSON_PARSE_ERROR: Failed to parse Gemini response as JSON. ` +
      `Error: ${err instanceof Error ? err.message : String(err)}. ` +
      `Raw response snippet: "${rawText.slice(0, 150)}..."`,
    );
  }
}
