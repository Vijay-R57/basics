/**
 * src/modules/audit/pipeline/imageValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline V3 — Phase 1: Image Validation Module
 *
 * RESPONSIBILITIES:
 *   1. Verify an image was provided.
 *   2. Verify the file is a supported image format (JPG, JPEG, PNG, WEBP).
 *   3. Verify the image is readable (decode via browser Image API).
 *   4. Capture image dimensions (width × height).
 *   5. Generate image metadata (width, height, aspectRatio, fileType, fileSize).
 *   6. Generate a technical Image Quality Score (0–100).
 *      Score is based ONLY on: resolution, decode success, file size, format.
 *      It NEVER evaluates workplace conditions.
 *   7. Generate validation status (VALID | INVALID).
 *   8. Generate validation errors (non-empty only when INVALID).
 *
 * DESIGN PRINCIPLES:
 *   - Single Responsibility: validates images only. No AI, no scoring, no UI.
 *   - Single exported entry point: validateImage(base64) → ImageValidationV3Result
 *   - All debug output via debug.ts. Never calls console directly.
 *   - No mock fallback. If an image cannot be decoded, it is INVALID.
 *
 * PIPELINE POSITION:
 *   User Uploads Image → [Image Validation Module] → Gemini Vision Analyzer
 *
 * PIPELINE BEHAVIOR:
 *   isValid === false → caller must stop the pipeline. Gemini is never reached.
 *   isValid === true  → caller may proceed to the next stage.
 */

import type { ImageValidationV3Result } from '@/types/analysis';
import { debugLog, debugGroup, debugGroupEnd, debugError } from './debug';

// ── Supported formats ─────────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Detects MIME type from the base64 data URI prefix.
 * Returns null if no recognised prefix is present (format check will fail).
 */
function detectMimeType(base64: string): string | null {
  if (base64.startsWith('data:image/jpeg;')) return 'image/jpeg';
  if (base64.startsWith('data:image/jpg;'))  return 'image/jpeg';
  if (base64.startsWith('data:image/png;'))  return 'image/png';
  if (base64.startsWith('data:image/webp;')) return 'image/webp';
  if (base64.startsWith('data:image/gif;'))  return 'image/gif';
  if (base64.startsWith('data:image/bmp;'))  return 'image/bmp';
  if (base64.startsWith('data:image/'))      return 'image/unknown';
  // Raw base64 without data URI — heuristic sniff from magic bytes prefix
  if (base64.startsWith('/9j/'))  return 'image/jpeg';  // JPEG magic
  if (base64.startsWith('iVBOR')) return 'image/png';   // PNG magic
  if (base64.startsWith('UklGR')) return 'image/webp';  // WEBP magic
  return null; // cannot determine format
}

/**
 * Estimates the decoded file size from the base64 string length.
 * Base64 encodes 3 bytes as 4 characters → decoded ≈ (len × 3/4).
 */
function estimateFileSizeBytes(base64: string): number {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  return Math.round((raw.length * 3) / 4);
}

/**
 * Computes the simplified aspect ratio string (e.g. "16:9", "4:3").
 * Falls back to the raw ratio if no clean divisor is found.
 */
function computeAspectRatio(width: number, height: number): string {
  if (width === 0 || height === 0) return 'Unknown';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

/**
 * Decodes a base64 image string in the browser using the Image API.
 * Resolves with the HTMLImageElement on success.
 * Rejects if the image cannot be decoded (corrupted, empty, invalid binary).
 */
function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be decoded.'));
    img.src = src;
  });
}

// ── Quality score calculator ──────────────────────────────────────────────────
//
// This is a TECHNICAL quality score. It evaluates:
//   - Resolution tier   (0 / 40 / 60 / 70)
//   - Decode success    (implicit — only called after successful decode)
//   - File size         (0 / 10 / 20)
//   - Format            (0 / 10)
//
// It NEVER evaluates workplace conditions, cleanliness, or audit quality.
//
// Score tiers (approximate):
//   100 — HD resolution + good size + supported format
//    80 — Medium resolution
//    40 — Very small but readable image
//     0 — Unreadable (not returned by this fn — caller sets 0 on decode failure)

function computeQualityScore(
  width:         number,
  height:        number,
  fileSizeBytes: number,
  mimeType:      string | null,
): number {
  // Resolution score (0–70 pts)
  let resolutionPts: number;
  if (width >= 1920 && height >= 1080) {
    resolutionPts = 70; // Full HD or better
  } else if (width >= 1280 && height >= 720) {
    resolutionPts = 60; // HD
  } else if (width >= 640 && height >= 480) {
    resolutionPts = 40; // Minimum acceptable
  } else {
    resolutionPts = 10; // Very small — readable but poor
  }

  // File size score (0–20 pts)
  const sizeMb = fileSizeBytes / (1024 * 1024);
  let sizePts: number;
  if (sizeMb <= 5) {
    sizePts = 20; // Optimal size
  } else if (sizeMb <= 10) {
    sizePts = 10; // Acceptable size
  } else {
    sizePts = 0;  // Too large (this image should already be INVALID)
  }

  // Format score (0–10 pts)
  const formatPts = mimeType && SUPPORTED_MIME_TYPES.has(mimeType) ? 10 : 0;

  return Math.min(100, resolutionPts + sizePts + formatPts);
}

// ── Main validation function ──────────────────────────────────────────────────

/**
 * Validates an uploaded image before it enters the AI pipeline.
 *
 * This is the single entry point for the Image Validation Module.
 * Call this function BEFORE passing any image to Gemini.
 *
 * @param base64 - Base64-encoded image string (with or without data URI prefix).
 * @returns ImageValidationV3Result — consumed by the pipeline orchestrator.
 *
 * Pipeline contract:
 *   result.isValid === false → STOP. Do NOT call Gemini.
 *   result.isValid === true  → PASS. Proceed to next pipeline stage.
 */
export async function validateImage(base64: string): Promise<ImageValidationV3Result> {
  const startTime = Date.now();

  debugGroup('Image Validation Started');

  // ── Check 1: Image was provided ───────────────────────────────────────────
  if (!base64 || base64.trim() === '') {
    const result: ImageValidationV3Result = {
      isValid:      false,
      status:       'INVALID',
      qualityScore: 0,
      metadata: {
        width:       0,
        height:      0,
        aspectRatio: 'Unknown',
        fileType:    'unknown',
        fileSize:    0,
      },
      errors: ['No image was provided.'],
    };

    debugLog('Validation Status: INVALID');
    debugLog('Validation Errors:', result.errors);
    debugLog('Pipeline Decision: STOP_PIPELINE');
    debugLog(`Validation Time (ms): ${Date.now() - startTime}`);
    debugGroupEnd();
    return result;
  }

  // ── Check 2: Format check ─────────────────────────────────────────────────
  const mimeType     = detectMimeType(base64);
  const formatValid  = mimeType !== null && SUPPORTED_MIME_TYPES.has(mimeType);
  const fileSizeBytes = estimateFileSizeBytes(base64);
  const errors: string[] = [];

  if (!formatValid) {
    errors.push(
      mimeType
        ? `Unsupported image format: ${mimeType}. Supported formats: JPG, JPEG, PNG, WEBP.`
        : 'Unrecognised file format. Supported formats: JPG, JPEG, PNG, WEBP.',
    );
  }

  // ── Check 3: File size pre-screen (before decode, saves time) ─────────────
  const sizeMb = fileSizeBytes / (1024 * 1024);
  if (sizeMb > 10) {
    errors.push(
      `File is too large (${sizeMb.toFixed(1)} MB). Maximum allowed size is 10 MB.`,
    );
  }

  // ── Check 4: Readability — decode the image ───────────────────────────────
  let img: HTMLImageElement | null = null;
  let decodeError = false;

  try {
    img = await decodeImage(base64);
  } catch {
    decodeError = true;
    errors.push('Image could not be read. The file may be corrupted, empty, or an invalid binary.');
  }

  // If decode failed or format is unsupported, stop here — we cannot get dimensions
  if (decodeError || !img) {
    const result: ImageValidationV3Result = {
      isValid:      false,
      status:       'INVALID',
      qualityScore: 0,
      metadata: {
        width:       0,
        height:      0,
        aspectRatio: 'Unknown',
        fileType:    mimeType ?? 'unknown',
        fileSize:    fileSizeBytes,
      },
      errors,
    };

    debugGroup('Image Metadata');
    debugLog('Width:       0 (decode failed)');
    debugLog('Height:      0 (decode failed)');
    debugLog('Aspect Ratio: Unknown');
    debugLog(`File Type:   ${mimeType ?? 'unknown'}`);
    debugLog(`File Size:   ${fileSizeBytes} bytes`);
    debugGroupEnd();

    debugLog('Image Quality Score: 0');
    debugLog('Validation Status:   INVALID');
    debugLog('Validation Errors:  ', errors);
    debugLog('Pipeline Decision:   STOP_PIPELINE');
    debugLog(`Validation Time (ms): ${Date.now() - startTime}`);
    debugGroupEnd();
    return result;
  }

  // ── Check 5: Dimension capture ────────────────────────────────────────────
  const width  = img.naturalWidth;
  const height = img.naturalHeight;

  if (width === 0 || height === 0) {
    errors.push('Image has zero dimensions and cannot be processed.');
  }

  // ── Metadata assembly ─────────────────────────────────────────────────────
  const aspectRatio = computeAspectRatio(width, height);
  const resolvedMime = mimeType ?? 'image/jpeg'; // safe fallback after decode

  // ── Quality Score ─────────────────────────────────────────────────────────
  const qualityScore = errors.length > 0
    ? 0
    : computeQualityScore(width, height, fileSizeBytes, resolvedMime);

  // ── Final validity decision ───────────────────────────────────────────────
  const isValid = errors.length === 0;

  const result: ImageValidationV3Result = {
    isValid,
    status:       isValid ? 'VALID' : 'INVALID',
    qualityScore,
    metadata: {
      width,
      height,
      aspectRatio,
      fileType: resolvedMime,
      fileSize: fileSizeBytes,
    },
    errors,
  };

  // ── Debug output ──────────────────────────────────────────────────────────
  debugGroup('Image Metadata');
  debugLog(`Width:        ${width}px`);
  debugLog(`Height:       ${height}px`);
  debugLog(`Aspect Ratio: ${aspectRatio}`);
  debugLog(`File Type:    ${resolvedMime}`);
  debugLog(`File Size:    ${fileSizeBytes} bytes (${sizeMb.toFixed(2)} MB)`);
  debugGroupEnd();

  debugLog(`Image Quality Score: ${qualityScore}/100`);
  debugLog(`Validation Status:   ${result.status}`);

  if (errors.length > 0) {
    debugLog('Validation Errors:  ', errors);
  } else {
    debugLog('Validation Errors:   (none)');
  }

  const decision = isValid ? 'PASS_TO_GEMINI' : 'STOP_PIPELINE';
  debugLog(`Pipeline Decision:   ${decision}`);
  debugLog(`Validation Time (ms): ${Date.now() - startTime}`);
  debugGroupEnd();

  return result;
}
