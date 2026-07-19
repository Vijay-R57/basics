# 5S Audit Rating Definitions & Qualifying Conditions

This document details the exact definitions, scores, compliance mapping, and evaluation conditions for the five ratings currently used in the ARCOLAB 5S Insight pipeline and analysis.

---

## 1. Rating Overview & Score Mappings

The system utilizes five distinct ratings to score each audit question. The mappings between the AI ratings, numeric scores, UI labels, and compliance statuses are defined in [scoreUtils.ts](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/pipeline/scoreUtils.ts), [AdditionalAuditInfoPanel.tsx](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/components/AdditionalAuditInfoPanel.tsx), and [Analysis.tsx](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/pages/Analysis.tsx):

| AI Rating (`AiRating`) | Numeric Score | UI Display Label | Official Meaning (Completion Questionnaire) | Compliance Answer (`ai_answer`) |
| :--- | :---: | :--- | :--- | :---: |
| **`VERY_GOOD`** | `4` | `"Very Good"` | *“Fully compliant, exemplary standard”* | `'YES'` |
| **`GOOD`** | `3` | `"Good"` | *“Minor areas to clean or organize”* | `'YES'` |
| **`AVERAGE`** | `2` | `"Average"` | *“Moderate compliance, needs work”* | `'PARTIAL'` |
| **`BAD`** | `1` | `"Bad"` | *“Unacceptable levels of disorder/dirt”* | `'NO'` |
| **`VERY_BAD`** | `0` | `"Very Bad"` | *“Severe non-compliance or hazard”* | `'NO'` |

---

## 2. Qualifying Conditions & Rules

During the computer vision execution (detailed in [index.ts](file:///c:/Users/Vijay%20Ramesh/5S/basics/gemini/analyze-5s/index.ts) and [analysisPipeline.ts](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/pipeline/analysisPipeline.ts)), specific rules determine when each rating is applied.

### A. Compliance Mappings (`ai_answer`)
- **`YES` (Score 3 or 4 - `VERY_GOOD`, `GOOD`):**
  - Indicates that the workspace is compliant or mostly compliant with the question's criteria. Only minor or negligible issues can be present.
- **`PARTIAL` (Score 2 - `AVERAGE`):**
  - Indicates moderate compliance. A structured storage system or cleaning standard is partially implemented, but significant areas still need work.
- **`NO` (Score 0 or 1 - `VERY_BAD`, `BAD`):**
  - Indicates non-compliance. There is direct, visible evidence of severe clutter, lack of organization, dust, dirt, hazards, or complete absence of standard/visual markers.

### B. Internal Consistency Control Rules
The pipeline enforces strict visual-rating alignment. The following logic ensures ratings match visual findings:
- **Positive Evidence Alignment:** A `GOOD` or `VERY_GOOD` rating is **strictly prohibited** if there is negative evidence (non-compliance observations) for that question.
- **Negative Evidence Alignment:** A `BAD` or `VERY_BAD` rating is **strictly prohibited** if there is positive evidence (compliance observations) for that question.
- **Evidence Balancing Rule:** When both positive and negative elements are present, the rating must reflect the overall balance.
  - A single minor issue should **not** automatically downgrade an otherwise compliant space (allowing a `GOOD` or `VERY_GOOD` rating).
  - A single positive observation must **not** mask multiple significant deficiencies.

### C. The Uncertainty Contract (Fallback to `AVERAGE`)
If the required visual evidence for a question cannot be verified (e.g. objects are outside the camera frame, closed behind cabinet doors, or heavily occluded), the AI cannot guess. It must trigger the standardized **Uncertainty Contract**:
- **Assigned Rating:** `AVERAGE`
- **Numeric Score:** `2`
- **Confidence:** `30`
- **Reason:** `"Cannot be determined from the provided image."`

This contract is **immutable**; no other guidelines can override it once triggered.

---

## 3. Pillar-Specific Evaluation Targets

When evaluating compliance to assign these ratings, the pipeline instructs the AI to look at specific targets (and ignore others) defined in [questions.ts](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/modules/audit/pipeline/questions.ts):

* **SORT (`SORT_Q1` - `SORT_Q4`):**
  - *Evaluate:* Loose raw materials, excess inventory, loose tools, idle equipment, damaged/duplicate documents.
  - *Ignore:* Materials required for active production, tools in active use.
* **SET IN ORDER (`SET_IN_ORDER_Q1` - `SET_IN_ORDER_Q4`):**
  - *Evaluate:* Storage lines/boundaries, tool shadow boards, floor safety lines, walkway markers, SOP accessibility.
  - *Ignore:* Text too small to read, areas hidden behind machinery.
* **SHINE (`SHINE_Q1` - `SHINE_Q4`):**
  - *Evaluate:* Presence and access of cleaning tools, grease/dirt build-up on machines/floors, overflowing waste bins.
  - *Ignore:* Operational grime that is normal for the industrial context (so long as surfaces are maintained).
* **STANDARDIZE (`STANDARDIZE_Q1` - `STANDARDIZE_Q4`):**
  - *Evaluate:* Consistently color-coded labels, visible checklist postings, PPE safety warnings, standardized shelf markings.
  - *Ignore:* Employee behavior or training procedures (which cannot be seen in a static photo).
* **SUSTAIN (`SUSTAIN_Q1` - `SUSTAIN_Q4`):**
  - *Evaluate:* Visibly maintained audit/Kaizen boards, up-to-date tracking metrics, lack of visible deterioration in floor lines or labels.
  - *Ignore:* General company culture or team history (strictly focus on visible workspace condition).
