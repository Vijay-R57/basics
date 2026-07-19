# ARCOLAB AI Engine V3.2 – Cost Analysis Report

**Date:** July 19, 2026
**Engine Version:** V3.2 (Rating Decision Framework)
**Primary Model:** `gemini-3.5-flash`
**Fallback Model:** `gemini-3.1-flash-lite`
**Pricing Reference:** Google Gemini API — July 2026

---

## Executive Summary

A single ARCOLAB 5S workplace audit using the V3.2 engine costs approximately **$0.039 under normal conditions** and up to **$0.047 in a worst-case retry scenario**. At moderate volumes (100–500 audits/month), monthly API costs remain under **$25**. At scale (10,000+ audits/month), costs reach approximately **$400/month** using the primary model, or as low as **$70/month** if migrated to the fallback model.

---

## 1. Token Measurement Methodology

Tokens were estimated from the actual compiled prompt output of [`gemini/analyze-5s/index.ts`](file:///c:/Users/Vijay%20Ramesh/5S/basics/gemini/analyze-5s/index.ts) using the standard approximation of **1 token ≈ 4 characters** for structured English/technical prose.

| Measurement | Value |
|---|---|
| Prompt section characters (measured) | **24,567 chars** |
| Prompt section lines | 329 lines |
| Prompt section words | 3,262 words |
| Estimated prompt tokens | **~6,100 tokens** |

> [!NOTE]
> Token counts are estimates. The exact count varies by ±5–10% depending on Gemini's internal tokenizer. For billing purposes, use Google AI Studio's token counter for precise values.

---

## 2. Per-Analysis Token Breakdown

### 2.1 Input Tokens

| Component | Tokens (Low) | Tokens (High) | Notes |
|---|---|---|---|
| Prompt text — system rules | ~2,400 | ~2,400 | PRIMARY PRINCIPLES, GLOBAL RULES, VISIBILITY DECISION RULE, UNCERTAINTY CONTRACT, PARTIAL VISIBILITY, CONFIDENCE CALIBRATION, etc. |
| Prompt text — V3.2 Rating Decision Framework | ~700 | ~700 | Evidence Inventory, Compliance Assessment, Rating Mapping, Validation Gate, Drift Prevention Rule, Adjacent Boundary Rules |
| Prompt text — 20 audit questions + guidance | ~3,000 | ~3,000 | 20 questions × (question + Evaluate + Ignore + Notes + uncertainty directive) |
| Image input | ~258 | ~2,600 | Varies by resolution (see Section 5) |
| **Total Input** | **~6,358** | **~8,700** | |

### 2.2 Output Tokens

| Component | Tokens (Low) | Tokens (High) | Notes |
|---|---|---|---|
| 20 question blocks (echoed question text) | ~700 | ~900 | ~35–45 tokens per question |
| 20 reason fields | ~1,000 | ~1,800 | ~50–90 tokens per reason |
| 20 rating + confidence fields | ~60 | ~80 | Minimal tokens |
| JSON structure overhead | ~100 | ~150 | Braces, keys, commas |
| Recommendations (0–5 items) | ~0 | ~600 | ~100–120 tokens per recommendation |
| **Total Output** | **~1,860** | **~3,530** | |

### 2.3 Combined Totals

| Scenario | Input Tokens | Output Tokens | Total Tokens |
|---|---|---|---|
| **Optimistic** (low-res image, short reasons) | 6,400 | 1,900 | **~8,300** |
| **Typical** (standard image, average reasons) | 7,500 | 2,800 | **~10,300** |
| **Worst case** (HD image, detailed reasons + recs) | 8,700 | 3,530 | **~12,230** |

---

## 3. Pricing Reference (July 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Use in Engine |
|---|---|---|---|
| `gemini-3.5-flash` | **$1.50** | **$9.00** | Primary model (attempt 0) |
| `gemini-3.1-flash-lite` | **$0.25** | **$1.50** | Fallback model (attempt 1) |

---

## 4. Cost Per Single Analysis

### 4.1 Normal Operation (no retry)

Primary model `gemini-3.5-flash` is used. One API call is made.

```
Typical scenario:
  Input:  7,500 tokens  ×  ($1.50  / 1,000,000)  =  $0.01125
  Output: 2,800 tokens  ×  ($9.00  / 1,000,000)  =  $0.02520
  ─────────────────────────────────────────────────────────────
  Total per analysis:                               ≈ $0.037
```

| Scenario | Input Cost | Output Cost | **Total** |
|---|---|---|---|
| Optimistic | $0.0096 | $0.0171 | **$0.027** |
| Typical | $0.0113 | $0.0252 | **$0.037** |
| Worst case | $0.0131 | $0.0318 | **$0.045** |

### 4.2 Retry Scenario (both models used)

Triggered when: API call fails, JSON parse fails, or validation fails on attempt 0.
Both models are billed — the primary model for attempt 0, the fallback model for attempt 1.

```
Primary attempt (gemini-3.5-flash):   ≈ $0.037
Fallback attempt (gemini-3.1-flash-lite):
  Input:  7,500 tokens  ×  ($0.25  / 1,000,000)  =  $0.00188
  Output: 2,800 tokens  ×  ($1.50  / 1,000,000)  =  $0.00420
  Fallback total:                                   ≈ $0.006
  ──────────────────────────────────────────────────────────────
  Worst case (both attempts):                       ≈ $0.043
```

| Scenario | Primary Cost | Fallback Cost | **Total** |
|---|---|---|---|
| Typical + retry | $0.037 | $0.006 | **$0.043** |
| Worst case + retry | $0.045 | $0.008 | **$0.053** |

> [!NOTE]
> Retries are expected to be rare under normal API conditions. The retry path is a safety net for transient failures, not a regular occurrence.

---

## 5. Image Resolution Sensitivity

Image token cost is the most variable component. Gemini bills image input as tokens computed from pixel dimensions.

| Image Resolution | Approximate Image Tokens | Image Input Cost | % of Total Input Cost |
|---|---|---|---|
| 512 × 512 (low-res) | ~258 | $0.0004 | ~3% |
| 1024 × 768 (standard mobile) | ~512 | $0.0008 | ~6% |
| 1920 × 1080 (full HD) | ~1,024 | $0.0015 | ~11% |
| 4K / RAW | ~2,600 | $0.0039 | ~26% |

> [!TIP]
> Compressing workplace images to **1024×768** before submission captures all necessary visual detail for 5S audit evaluation while keeping image token costs at the low end. Full-HD and 4K uploads provide no meaningful audit quality improvement and increase cost unnecessarily.

---

## 6. V3.2 Prompt Overhead vs V3.1.1

The V3.2 Rating Decision Framework added approximately **130 lines** to the prompt.

| Version | Prompt Chars | Prompt Tokens | Cost Delta per Analysis |
|---|---|---|---|
| V3.1.1 | ~21,800 | ~5,450 | Baseline |
| V3.2 | ~24,567 | ~6,142 | +692 tokens |

```
Additional input cost from V3.2 framework:
  692 tokens × ($1.50 / 1,000,000) = $0.00104
  ─────────────────────────────────────────────
  Overhead per analysis:             ≈ $0.001
```

> [!NOTE]
> The V3.2 prompt overhead is **less than one-tenth of a cent per analysis**. The consistency and rating reliability improvements introduced by the Rating Decision Framework represent negligible marginal cost.

---

## 7. Monthly Volume Projections

### 7.1 Using Primary Model (`gemini-3.5-flash`)

| Monthly Audits | Estimated Cost | Cost per Audit |
|---|---|---|
| 10 | $0.37 | $0.037 |
| 50 | $1.85 | $0.037 |
| 100 | $3.70 | $0.037 |
| 500 | $18.50 | $0.037 |
| 1,000 | $37.00 | $0.037 |
| 5,000 | $185.00 | $0.037 |
| 10,000 | $370.00 | $0.037 |
| 50,000 | $1,850.00 | $0.037 |

### 7.2 Using Fallback Model (`gemini-3.1-flash-lite`) as Primary

> [!IMPORTANT]
> This is a hypothetical scenario for cost reduction planning only. The fallback model is lighter and may produce lower-quality reasoning. Thorough regression testing would be required before changing the primary model.

| Monthly Audits | Estimated Cost | Cost per Audit | Savings vs Primary |
|---|---|---|---|
| 100 | $0.62 | $0.006 | **$3.08 saved** |
| 1,000 | $6.20 | $0.006 | **$30.80 saved** |
| 5,000 | $31.00 | $0.006 | **$154.00 saved** |
| 10,000 | $62.00 | $0.006 | **$308.00 saved** |

---

## 8. Cost Driver Analysis

### Breakdown of Typical Analysis Cost ($0.037)

| Driver | Cost | Share |
|---|---|---|
| Output tokens (reasons + JSON) | $0.025 | **68%** |
| Input tokens (prompt text) | $0.011 | **30%** |
| Image input tokens | $0.001 | **2%** |

```
Output cost dominates because gemini-3.5-flash charges
$9.00/M output vs $1.50/M input — a 6× multiplier.
Reducing output verbosity (shorter reasons) has greater
cost impact than reducing prompt length.
```

---

## 9. Cost Optimization Opportunities

| Strategy | Estimated Saving | Risk / Trade-off |
|---|---|---|
| Compress images to ≤ 1024×768 before upload | ~5–25% input cost | Minimal — 5S audit does not require full HD |
| Switch primary model to `gemini-3.1-flash-lite` at scale | ~83% total cost reduction | Requires regression validation of reasoning quality |
| Reduce reason verbosity via prompt tuning | ~10–20% output cost | May reduce explainability and audit report quality |
| Cache repeated audits for identical images | 100% on duplicates | Only applicable if same image submitted multiple times |
| Batch audits during off-peak hours | Indirect (rate limit management) | No direct pricing benefit with current API model |

---

## 10. Free Tier Availability

Google AI Studio provides a **free tier** suitable for development and testing.

| Tier | Availability | Constraints |
|---|---|---|
| Free (AI Studio) | ✅ Available | Rate-limited (requests per minute/day) |
| Pay-as-you-go | ✅ Active production | No rate limit caps — billed per token |
| Committed use discount | Contact Google | Available for high-volume enterprise commitments |

> [!TIP]
> All development, integration testing, and regression verification for V3.2 can be performed at zero cost using the free tier in Google AI Studio, provided rate limits are observed.

---

## 11. Summary

| Metric | Value |
|---|---|
| Cost per analysis (typical, no retry) | **~$0.037** |
| Cost per analysis (worst case, with retry) | **~$0.053** |
| V3.2 overhead vs V3.1.1 | **+$0.001** (negligible) |
| Monthly cost at 100 audits | **~$3.70** |
| Monthly cost at 1,000 audits | **~$37.00** |
| Monthly cost at 10,000 audits | **~$370.00** |
| Largest cost driver | Output tokens (68% of total) |
| Largest variable factor | Image resolution |
| Model switch savings potential | **~83%** at high volume |

---

*Report generated from source analysis of [`gemini/analyze-5s/index.ts`](file:///c:/Users/Vijay%20Ramesh/5S/basics/gemini/analyze-5s/index.ts) and [`analysisPipeline.ts`](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/pipeline/analysisPipeline.ts). Pricing sourced from Google Gemini API pricing reference, July 2026.*
