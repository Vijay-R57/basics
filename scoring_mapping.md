# 5S Audit Scoring Mapping & Calculation Logic

This document details the scoring mappings and deterministic calculations used in the ARCOLAB 5S Insight pipeline.

---

## 1. Rating-to-Score Mapping

Each of the 20 checklist questions is evaluated and assigned one of the five `AiRating` categories. This rating is converted to a numeric score from `0` to `4` inside [scoreUtils.ts](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/pipeline/scoreUtils.ts):

| AI Rating (`AiRating`) | Numeric Score | UI Display Label | Compliance Status |
| :--- | :---: | :--- | :--- |
| **`VERY_GOOD`** | `4` | `"Very Good"` | **Passed** (Fully Compliant) |
| **`GOOD`** | `3` | `"Good"` | **Passed** (Mostly Compliant) |
| **`AVERAGE`** | `2` | `"Average"` | **Partial** (Partially Compliant / Fallback) |
| **`BAD`** | `1` | `"Bad"` | **Failed** (Non-Compliant) |
| **`VERY_BAD`** | `0` | `"Very Bad"` | **Failed** (Critical Deficiency / Hazard) |

---

## 2. Deterministic Score Calculation Formula

The application uses these individual question scores to calculate the pillar and overall audit scores. The calculation logic runs entirely within the application layer (Gemini does not perform math or generate grades):

### A. Pillar Scoring
An audit has 5 pillars (Sort, Set in Order, Shine, Standardize, Sustain), each containing **4 questions**.
- **Maximum Pillar Score:** `16` (4 questions × 4 points max)
- **Pillar Percentage Formula:** 
  $$\text{Pillar \%} = \text{Math.round}\left(\frac{\text{Sum of 4 Question Scores}}{16} \times 100\right)$$

### B. Overall Audit Scoring
- **Maximum Overall Score:** `80` (20 questions × 4 points max)
- **Overall Percentage Formula:** 
  $$\text{Overall \%} = \text{Math.round}\left(\frac{\text{Sum of 20 Question Scores}}{80} \times 100\right)$$

---

## 3. Grade & Color Thresholds

The overall audit percentage determines the final audit grade and color display in the UI:

| Overall Percentage Range | Grade Label | UI Color (`gradeColor`) |
| :--- | :--- | :---: |
| **90% – 100%** | `"Excellent"` | `green` |
| **80% – 89%** | `"Very Good"` | `green` |
| **70% – 79%** | `"Good"` | `yellow` |
| **60% – 69%** | `"Average"` | `orange` |
| **40% – 59%** | `"Needs Improvement"` | `orange` |
| **0% – 39%** | `"Poor"` | `red` |

---

## 4. Integrity and Stability Safeguards
- **Zero Mock Fallback:** All scoring calculations are computed dynamically and deterministically in code based strictly on the AI's returned ratings array.
- **Uncertainty Fallback:** When visual evidence is missing, the uncertainty response defaults the rating to `AVERAGE` (Score: `2`, Confidence: `30`), preventing arbitrary scoring variance and anchoring the question score to a neutral midpoint.
