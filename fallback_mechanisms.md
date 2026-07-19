# ARCOLAB AI Engine – Fallback Mechanisms Reference

This document provides a complete reference for every fallback mechanism implemented across the ARCOLAB AI Engine.
Fallbacks exist at two distinct layers: the **Edge Function layer** ([`gemini/analyze-5s/index.ts`](file:///c:/Users/Vijay%20Ramesh/5S/basics/gemini/analyze-5s/index.ts)) and the **Frontend Pipeline layer** ([`analysisPipeline.ts`](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/pipeline/analysisPipeline.ts)).

---

## Architecture Overview

```
Client Request
      │
      ▼
┌─────────────────────────────────────┐
│   Frontend Pipeline Layer           │  analysisPipeline.ts
│   (runAuditPipeline)                │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│   Edge Function Layer               │  gemini/analyze-5s/index.ts
│   (runAudit via Supabase Edge Fn)   │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│   Gemini Vision API                 │
│   (Primary or Fallback Model)       │
└─────────────────────────────────────┘
```

Both layers implement **independent but structurally identical** fallback strategies. Each layer contains its own model failover, retry logic, and graceful degradation rules.

---

## Layer 1 – Edge Function Fallbacks

**File:** [`gemini/analyze-5s/index.ts`](file:///c:/Users/Vijay%20Ramesh/5S/basics/gemini/analyze-5s/index.ts)
**Entry point:** `runAudit(imageBase64, apiKey, attempt)`

---

### FB-E1 — Model Failover on Retry

| Property | Detail |
|---|---|
| **Trigger** | Any fatal error on `attempt = 0` |
| **Primary model** | `gemini-3.5-flash` |
| **Fallback model** | `gemini-3.1-flash-lite` |
| **Mechanism** | `attempt` counter passed recursively; `modelName` selected by `attempt === 0 ? GEMINI_MODEL : GEMINI_RETRY_MODEL` |
| **Max attempts** | 2 (attempt 0 + attempt 1) |
| **Terminal on** | Any failure on attempt 1 → throws `Error("AI Analysis Failed")` |

```typescript
const modelName = attempt === 0 ? GEMINI_MODEL : GEMINI_RETRY_MODEL;
```

The fallback model is intentionally lighter (`gemini-3.1-flash-lite`) to maximize the chance of a valid structured response on retry, even under API instability or quota pressure.

---

### FB-E2 — API Call Failure Retry

| Property | Detail |
|---|---|
| **Trigger** | `callGemini()` throws (HTTP error, network failure, empty response) |
| **Behavior on attempt 0** | Logs warning, recursively calls `runAudit(..., 1)` with fallback model |
| **Behavior on attempt 1** | Throws `Error("AI Analysis Failed")` — no further retries |
| **Mock fallback** | **Never.** Explicitly prohibited by design policy |

```typescript
try {
  rawText = await callGemini(imageBase64, prompt, apiKey, modelName);
} catch (err) {
  if (attempt === 0) {
    return runAudit(imageBase64, apiKey, 1); // retry with fallback model
  }
  throw new Error("AI Analysis Failed");
}
```

---

### FB-E3 — JSON Parse Failure Retry

| Property | Detail |
|---|---|
| **Trigger** | `JSON.parse(rawText)` throws (Gemini returns markdown, prose, or malformed JSON) |
| **Behavior on attempt 0** | Logs warning, recursively calls `runAudit(..., 1)` |
| **Behavior on attempt 1** | Throws `Error("AI Analysis Failed")` |

```typescript
try {
  parsed = JSON.parse(rawText);
} catch {
  if (attempt === 0) {
    return runAudit(imageBase64, apiKey, 1);
  }
  throw new Error("AI Analysis Failed");
}
```

---

### FB-E4 — Validation Failure Retry

| Property | Detail |
|---|---|
| **Trigger** | `validateResponse()` throws on any of the five validation steps |
| **Validation steps** | JSON object shape → Question count → Question identity → Rating values → Required fields |
| **Behavior on attempt 0** | Logs warning + error detail, recursively calls `runAudit(..., 1)` |
| **Behavior on attempt 1** | Logs error, throws `Error("AI Analysis Failed")` |

The five sequential validation gates that can trigger this fallback:

| Step | Validation | Example failure |
|---|---|---|
| 1 | Response is a JSON object (not array, not primitive) | Gemini returns `[]` instead of `{}` |
| 2 | All 5 pillar sections present, each with exactly 4 questions | `"sort"` section missing or has 3 questions |
| 3 | Each `question` field matches the application's authoritative text (normalised) | Gemini rephrased the question |
| 4 | Each `rating` is one of `VERY_GOOD`, `GOOD`, `AVERAGE`, `BAD`, `VERY_BAD` | Gemini returns `"EXCELLENT"` |
| 5 | Each `reason` field is a non-empty string | Gemini returns `reason: ""` |

---

### FB-E5 — Confidence Non-Fatal Fallback

| Property | Detail |
|---|---|
| **Trigger** | `confidence` field is missing, non-numeric, non-finite, or out of range |
| **Behavior** | `parseConfidence()` returns `null`; audit continues normally |
| **Effect on output** | `confidence` stored as `null`; `audit_confidence` computed as `null` if no valid confidences exist |
| **Severity** | **Non-fatal** — audit never fails due to a confidence issue |

```typescript
function parseConfidence(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  return null; // graceful fallback — never fails the audit
}
```

Valid confidence values are clamped to `[0, 100]` and rounded to the nearest integer.

---

### FB-E6 — Recommendations Non-Fatal Fallback

| Property | Detail |
|---|---|
| **Trigger** | `recommendations` field is absent, not an array, or individual items are malformed |
| **Behavior** | `parseRecommendations()` returns `[]`; audit continues with zero recommendations |
| **Individual item rule** | Items missing `pillar`, `problem`, or `corrective_action` strings are silently skipped |
| **Severity** | **Non-fatal** — audit never fails due to recommendation issues |

```typescript
function parseRecommendations(parsed: unknown): RawRec[] {
  try {
    const r = (parsed as Record<string, unknown>)?.recommendations;
    if (!Array.isArray(r)) return [];
    return r.filter(
      (item: any) =>
        typeof item?.pillar            === 'string' &&
        typeof item?.problem           === 'string' &&
        typeof item?.corrective_action === 'string',
    ) as RawRec[];
  } catch {
    return []; // unexpected error → empty array, never throws
  }
}
```

---

### FB-E7 — `expected_benefit` Default Value

| Property | Detail |
|---|---|
| **Trigger** | A valid recommendation item has no `expected_benefit` field |
| **Behavior** | Replaced with the string `"Restores 5S compliance standard."` |
| **Severity** | **Non-fatal** — recommendation is still included in output |

```typescript
expected_benefit: rec.expected_benefit ?? "Restores 5S compliance standard.",
```

---

## Layer 2 – Frontend Pipeline Fallbacks

**File:** [`analysisPipeline.ts`](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/pipeline/analysisPipeline.ts)
**Entry point:** `runAuditPipeline(imageBase64, apiKey, workspaceContext?, attempt)`

The frontend pipeline mirrors the Edge Function strategy with structurally identical fallback logic. This layer is active when the client calls the Gemini API directly (development or direct-call path).

---

### FB-F1 — Model Failover on Retry

Identical to FB-E1.

| Property | Detail |
|---|---|
| **Primary model** | `gemini-3.5-flash` |
| **Fallback model** | `gemini-3.1-flash-lite` |
| **Mechanism** | `attempt === 0 ? GEMINI_MODEL : GEMINI_RETRY_MODEL` |

---

### FB-F2 — API Call Failure Retry

Identical to FB-E2.

| Property | Detail |
|---|---|
| **Trigger** | `callGeminiApi()` throws |
| **Behavior on attempt 0** | `console.warn` + recursive retry with fallback model |
| **Behavior on attempt 1** | `throw new Error('AI Analysis Failed')` |

---

### FB-F3 — JSON Parse Failure Retry

Identical to FB-E3.

| Property | Detail |
|---|---|
| **Trigger** | `JSON.parse(rawText)` throws |
| **Behavior on attempt 0** | `console.warn` + recursive retry |
| **Behavior on attempt 1** | `throw new Error('AI Analysis Failed')` |

---

### FB-F4 — Validation Failure Retry

Identical to FB-E4. The same five sequential validation gates apply via `validateGeminiResponse()`.

| Property | Detail |
|---|---|
| **Trigger** | `validateGeminiResponse()` throws |
| **Behavior on attempt 0** | `console.warn` + recursive retry |
| **Behavior on attempt 1** | `console.error` + `throw new Error('AI Analysis Failed')` |

---

### FB-F5 — Confidence Non-Fatal Fallback

Identical to FB-E5.

---

### FB-F6 — Recommendations Non-Fatal Fallback

Identical to FB-E6.

---

### FB-F7 — `expected_benefit` Default Value

Identical to FB-E7.

```typescript
expected_benefit: rec.expected_benefit ?? 'Restores 5S compliance standard.',
```

Additionally, the frontend pipeline uses the worst-scoring question within the pillar to populate `linked_question_id`, with a safe fallback:

```typescript
linked_question_id: worstQ?.id ?? `${pillarKey}_Q1`,
```

---

### FB-F8 — Workspace Context Variable Defaults

| Property | Detail |
|---|---|
| **Trigger** | `workspaceContext` is `undefined` or any individual field is missing or falsy |
| **Behavior** | Each variable falls back to a safe default string before prompt injection |
| **Severity** | **Non-fatal** — the prompt is always valid even without metadata |

```typescript
const injectedAuditZone     = (workspaceContext?.selectedZone   as string) || 'General';
const injectedWorkspaceType = (workspaceContext?.workspaceType  as string) || 'General';
const injectedIndustry      = (workspaceContext?.industry       as string) || 'General Industrial';
const injectedOfficeName    = (workspaceContext?.officeName     as string) || 'Unknown Office';
const injectedZoneName      = (workspaceContext?.selectedZone   as string) || 'Unspecified Zone';
```

This ensures the prompt always contains valid context variables, preventing template injection failures when the caller omits metadata.

---

## Prompt-Level Fallback – The Uncertainty Contract

This fallback operates entirely inside the Gemini reasoning process, not in application code.

| Property | Detail |
|---|---|
| **Trigger** | Visibility Decision Rule classifies a question as **State 3 – Insufficient Evidence** |
| **Output** | `rating: "AVERAGE"`, `confidence: 30`, `reason: "Cannot be determined from the provided image."` |
| **Immutability** | No subsequent prompt instruction may alter or extend this output once triggered |
| **Application code impact** | None — `AVERAGE` is a valid rating, `30` is a valid confidence integer. Passes all five validators. |

The Uncertainty Contract is the only fallback that does not originate in TypeScript. It is enforced by the prompt and validated passively by the existing rating validator (`AVERAGE` is an accepted `AiRating` value).

---

## Complete Fallback Decision Flow

```
runAudit / runAuditPipeline  (attempt = 0,  model = gemini-3.5-flash)
         │
         ├─ callGemini FAILS?
         │       ├── attempt 0 → retry  (attempt = 1, model = gemini-3.1-flash-lite)  [FB-E2 / FB-F2]
         │       └── attempt 1 → throw Error("AI Analysis Failed")  ◄── TERMINAL
         │
         ├─ JSON.parse FAILS?
         │       ├── attempt 0 → retry                                                 [FB-E3 / FB-F3]
         │       └── attempt 1 → throw Error("AI Analysis Failed")  ◄── TERMINAL
         │
         ├─ validateResponse FAILS?
         │       ├── attempt 0 → retry                                                 [FB-E4 / FB-F4]
         │       └── attempt 1 → throw Error("AI Analysis Failed")  ◄── TERMINAL
         │
         ├─ parseRecommendations — always returns [] on any error                      [FB-E6 / FB-F6]  NON-FATAL
         │
         ├─ confidence invalid or missing → null                                        [FB-E5 / FB-F5]  NON-FATAL
         │
         ├─ expected_benefit missing → default string                                  [FB-E7 / FB-F7]  NON-FATAL
         │
         └─ workspaceContext fields missing → default strings                          [FB-F8]           NON-FATAL
                  │
                  ▼
         buildResult / buildAuditAnalysisResult
                  │
                  ▼
         Return AuditAnalysisResult ✅
```

---

## Quick-Reference Table

| ID | Layer | Trigger | Severity | Recovery |
|---|---|---|---|---|
| FB-E1 / FB-F1 | Both | Any fatal error on attempt 0 | Fatal (retried once) | Switch to `gemini-3.1-flash-lite` |
| FB-E2 / FB-F2 | Both | `callGemini` throws | Fatal (retried once) | Retry with fallback model |
| FB-E3 / FB-F3 | Both | `JSON.parse` throws | Fatal (retried once) | Retry with fallback model |
| FB-E4 / FB-F4 | Both | `validateResponse` throws | Fatal (retried once) | Retry with fallback model |
| FB-E5 / FB-F5 | Both | `confidence` missing or invalid | **Non-fatal** | Store `null`, continue |
| FB-E6 / FB-F6 | Both | `recommendations` malformed | **Non-fatal** | Return `[]`, continue |
| FB-E7 / FB-F7 | Both | `expected_benefit` missing | **Non-fatal** | Default string, continue |
| FB-F8 | Frontend only | `workspaceContext` fields missing | **Non-fatal** | Default strings injected |
| Uncertainty Contract | Prompt | State 3 – Insufficient Evidence | **Non-fatal** | `AVERAGE` / `30` / fixed reason |

---

## Design Principles

**1. No mock fallback — ever.**
The error policy explicitly prohibits returning fabricated or placeholder audit data. Every fallback either retries with a real model or throws a hard error. This ensures all stored audit records reflect genuine AI analysis.

**2. Fatal errors retry exactly once.**
A single retry with the lighter model prevents compounding latency while still recovering from transient API failures. A second failure always terminates cleanly.

**3. Non-fatal failures are isolated.**
Confidence, recommendations, and context metadata failures never propagate to block the audit result. The core rating and reason output is fully independent of these fields.

**4. Validators are the trust boundary.**
Score calculation only begins after all five validation gates pass. This ensures that every numeric score in the output is derived from a verified, structurally sound AI response.

**5. The Uncertainty Contract is immutable.**
Once the prompt-level fallback fires for a question, no code or prompt instruction can alter it. This prevents partial or modified uncertainty outputs from entering the scoring pipeline.
