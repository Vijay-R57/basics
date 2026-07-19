/**
 * gemini/analyze-5s/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Supabase Edge Function: 5S Workplace AI Audit (Pipeline V2)
 *
 * FLOW:
 *   1. Receive beforeImage from request body
 *   2. Build Gemini prompt with embedded questions
 *   3. Call Gemini Vision API
 *   4. Validate response — strict order:
 *        JSON valid → Question count → Question identity → Rating values → Required fields
 *   5. Score calculation begins only after full validation passes
 *   6. Return AuditAnalysisResult
 *
 * ERROR POLICY:
 *   - Missing/invalid confidence → store null (non-fatal)
 *   - Malformed recommendations  → skip, audit continues (non-fatal)
 *   - Any other validation error → retry once → return { error: "AI Analysis Failed" }
 *   - No mock fallback. Ever.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Model configuration ───────────────────────────────────────────────────────

/** Primary model. Change this constant to update all Gemini calls. */
const GEMINI_MODEL = "gemini-3.5-flash";

/** Fallback model used on the single retry attempt. */
const GEMINI_RETRY_MODEL = "gemini-3.1-flash-lite";

// ── Question definitions (must stay in sync with pipeline/questions.ts) ───────

type AuditPillarKey = "SORT" | "SET_IN_ORDER" | "SHINE" | "STANDARDIZE" | "SUSTAIN";
type AiRating = "VERY_GOOD" | "GOOD" | "AVERAGE" | "BAD" | "VERY_BAD";

const VALID_RATINGS: AiRating[] = ["VERY_GOOD", "GOOD", "AVERAGE", "BAD", "VERY_BAD"];

interface AuditQuestion {
  pillar:   AuditPillarKey;
  id:       string;
  question: string;
}

const AUDIT_QUESTIONS: AuditQuestion[] = [
  { pillar: "SORT",         id: "SORT_Q1",          question: "Are unnecessary raw materials, containers, or miscellaneous items cluttering the workplace or occupying valuable working space?" },
  { pillar: "SORT",         id: "SORT_Q2",          question: "Are unnecessary tools, trays, laboratory items, accessories, or portable equipment left in the work area instead of being stored in their designated locations?" },
  { pillar: "SORT",         id: "SORT_Q3",          question: "Are unused, abandoned, or non-operational machines, furniture, worktables, shelving, packing equipment, or other large equipment occupying valuable workspace?" },
  { pillar: "SORT",         id: "SORT_Q4",          question: "Are unnecessary, outdated, damaged, duplicate, or excessive documents, notices, procedures, drawings, or visual displays visible in the workplace?" },
  { pillar: "SET_IN_ORDER", id: "SET_IN_ORDER_Q1",  question: "Are machines, production units, workstations, piping, production lines, or work areas clearly identified using visible labels, signs, markings, or other visual identification methods?" },
  { pillar: "SET_IN_ORDER", id: "SET_IN_ORDER_Q2",  question: "Are tools, accessories, jigs, fixtures, and frequently used work items systematically organized so they can be easily located, accessed, and returned to their designated locations?" },
  { pillar: "SET_IN_ORDER", id: "SET_IN_ORDER_Q3",  question: "Are floor markings, storage boundaries, walkways, aisles, scrap areas, safety zones, or storage locations clearly identified using visible lines, colors, labels, or signs?" },
  { pillar: "SET_IN_ORDER", id: "SET_IN_ORDER_Q4",  question: "Are essential work documents, operating procedures, instructions, records, or visual management materials neatly organized, clearly identified, and easily accessible?" },
  { pillar: "SHINE",        id: "SHINE_Q1",         question: "Are cleaning tools, cleaning equipment, or cleaning materials visibly available, properly stored, and easily accessible for maintaining workplace cleanliness?" },
  { pillar: "SHINE",        id: "SHINE_Q2",         question: "Do machines, workstations, piping, cabinets, shelves, and surrounding equipment appear visibly clean and free from excessive dust, dirt, spills, stains, leaks, or contamination?" },
  { pillar: "SHINE",        id: "SHINE_Q3",         question: "Do floors, walls, aisles, walkways, mezzanine areas, and scrap areas appear visibly clean, well maintained, and free from excessive dirt, waste, spills, or debris?" },
  { pillar: "SHINE",        id: "SHINE_Q4",         question: "Does the workplace visually indicate that cleanliness is consistently maintained through visible housekeeping practices and the absence of accumulated waste or neglected areas?" },
  { pillar: "STANDARDIZE",  id: "STANDARDIZE_Q1",   question: "Are areas, tools, machines, piping, equipment, and storage locations consistently identified using visible labels, color coding, markings, or standardized visual identification systems?" },
  { pillar: "STANDARDIZE",  id: "STANDARDIZE_Q2",   question: "Are cleaning instructions, inspection checklists, visual standards, or workplace organization standards visibly displayed and easily identifiable within the workplace?" },
  { pillar: "STANDARDIZE",  id: "STANDARDIZE_Q3",   question: "Are operating procedures, production rules, safety instructions, PPE requirements, or emergency information visibly displayed, organized, and accessible within the workplace?" },
  { pillar: "STANDARDIZE",  id: "STANDARDIZE_Q4",   question: "Are consumables, raw materials, storage containers, or inventory locations visibly organized using standardized labels, quantity indicators, storage methods, or visual inventory controls?" },
  { pillar: "SUSTAIN",      id: "SUSTAIN_Q1",       question: "Are 5S audit boards, workplace performance boards, audit schedules, KPI boards, or other visual management displays visibly present and maintained?" },
  { pillar: "SUSTAIN",      id: "SUSTAIN_Q2",       question: "Are improvement boards, Kaizen boards, suggestion boards, corrective action displays, or continuous improvement information visibly displayed and organized?" },
  { pillar: "SUSTAIN",      id: "SUSTAIN_Q3",       question: "Does the workplace visually indicate that previous 5S improvements have been consistently maintained without obvious deterioration?" },
  { pillar: "SUSTAIN",      id: "SUSTAIN_Q4",       question: "Does the overall workplace appearance indicate continuous adherence to 5S through consistently organized, clean, standardized, and well-maintained conditions?" },
];

const PILLAR_ORDER: AuditPillarKey[] = ["SORT", "SET_IN_ORDER", "SHINE", "STANDARDIZE", "SUSTAIN"];
const QUESTIONS_PER_PILLAR = 4;

const PILLAR_TO_JSON_KEY: Record<AuditPillarKey, string> = {
  SORT: "sort", SET_IN_ORDER: "set_in_order", SHINE: "shine",
  STANDARDIZE: "standardize", SUSTAIN: "sustain",
};

const PILLAR_LABEL: Record<AuditPillarKey, string> = {
  SORT: "Sort", SET_IN_ORDER: "Set in Order", SHINE: "Shine",
  STANDARDIZE: "Standardize", SUSTAIN: "Sustain",
};

// ── Scoring (application-owned, never Gemini) ─────────────────────────────────

function ratingToScore(rating: AiRating): number {
  const map: Record<AiRating, number> = {
    VERY_GOOD: 4, GOOD: 3, AVERAGE: 2, BAD: 1, VERY_BAD: 0,
  };
  return map[rating];
}

function calculateGradeLabel(pct: number): string {
  if (pct >= 90) return "Excellent";
  if (pct >= 80) return "Very Good";
  if (pct >= 70) return "Good";
  if (pct >= 60) return "Average";
  if (pct >= 40) return "Needs Improvement";
  return "Poor";
}

function gradeColor(label: string): string {
  if (label === "Excellent" || label === "Very Good") return "green";
  if (label === "Good") return "yellow";
  return "orange";
}

// ── Prompt builder ────────────────────────────────────────────────────────────

// Guidance definitions (inline for Edge Function — matches frontend questions.ts)
const AUDIT_GUIDANCE: Record<string, { evaluate: string[]; ignore: string[]; notes?: string[] }> = {
  // SORT
  SORT_Q1: {
    evaluate: ["Loose raw materials", "Excess inventory", "Unnecessary containers", "Miscellaneous items creating clutter", "Materials occupying valuable working space unnecessarily"],
    ignore: ["Materials clearly required for production", "Properly stored production inventory"],
  },
  SORT_Q2: {
    evaluate: ["Loose tools", "Empty trays", "Laboratory accessories", "Portable equipment", "Gloves", "Wrenches", "Scrapers", "Other accessories left unnecessarily"],
    ignore: ["Tools currently being used", "Properly stored equipment"],
  },
  SORT_Q3: {
    evaluate: ["Old machines", "Idle equipment", "Empty shelving", "Unused worktables", "Packing equipment", "Furniture occupying unnecessary space"],
    ignore: ["Machines actively being used"],
    notes: ["Operational status cannot always be determined from a single image.", "Evaluate only visible evidence of abandonment or unnecessary occupation of workspace."],
  },
  SORT_Q4: {
    evaluate: ["Duplicate notices", "Damaged documents", "Excess paperwork", "Outdated visual displays", "Unnecessary posted instructions"],
    ignore: ["Current, authorized documents", "Required safety postings"],
    notes: ["Do NOT assume a document is obsolete simply because it exists.", "If there is no visible evidence of damage, duplication, or obsolescence, use the uncertainty response."],
  },
  // SET IN ORDER
  SET_IN_ORDER_Q1: {
    evaluate: [
      "Machine identification labels",
      "Equipment nameplates",
      "Area identification boards",
      "Production line identification",
      "Pipe identification",
      "Department signs",
      "Workstation identification",
    ],
    ignore: [
      "Small text that cannot be read",
      "Areas outside the captured image",
      "Hidden equipment",
    ],
    notes: [
      "Labels do not need to be readable if they are clearly visible.",
      "Evaluate only whether visual identification exists.",
    ],
  },
  SET_IN_ORDER_Q2: {
    evaluate: [
      "Tool organization",
      "Shadow boards",
      "Tool holders",
      "Designated storage locations",
      "Organized workstations",
      "Easily accessible equipment",
    ],
    ignore: [
      "Tools currently being used",
      "Equipment actively being operated",
    ],
    notes: [
      "Do not assume poor organization simply because tools are visible.",
      "Evaluate whether a logical storage system exists.",
    ],
  },
  SET_IN_ORDER_Q3: {
    evaluate: [
      "Floor markings",
      "Yellow safety lines",
      "Walkways",
      "Storage boundaries",
      "Scrap areas",
      "Safety zones",
      "Shelf labels",
      "Quantity labels",
    ],
    ignore: [
      "Areas outside the captured image",
      "Floor areas hidden by equipment",
    ],
    notes: [
      "Evaluate only the visible portion of the floor.",
      "Missing floor visibility should not automatically reduce the rating.",
    ],
  },
  SET_IN_ORDER_Q4: {
    evaluate: [
      "SOP displays",
      "Work instructions",
      "Operating procedures",
      "Visual management boards",
      "Organized documents",
      "Clearly labelled files",
      "Information boards",
    ],
    ignore: [
      "Document contents that cannot be read",
      "Closed cabinets",
      "Areas outside the captured image",
    ],
    notes: [
      "The presence of documents alone is not sufficient.",
      "Evaluate whether they appear organized and clearly identified.",
    ],
  },
  // SHINE
  SHINE_Q1: {
    evaluate: [
      "Cleaning tools",
      "Brooms",
      "Mops",
      "Cleaning kits",
      "Cleaning equipment",
      "Cleaning material storage",
      "Easily accessible cleaning supplies",
    ],
    ignore: [
      "Hidden storage",
      "Cleaning schedules",
      "Cleaning equipment outside the image",
    ],
    notes: [
      "Evaluate only the visible availability and accessibility of cleaning tools.",
      "Do not assume cleaning tools are missing simply because they are not visible.",
    ],
  },
  SHINE_Q2: {
    evaluate: [
      "Dust",
      "Dirt",
      "Oil stains",
      "Chemical spills",
      "Rust",
      "Surface cleanliness",
      "Equipment cleanliness",
      "Visible leaks",
    ],
    ignore: [
      "Maintenance history",
      "Cleaning schedules",
      "Internal contamination",
      "Equipment outside the image",
    ],
    notes: [
      "Evaluate only visible cleanliness.",
      "Do not assume equipment is dirty because it is old.",
    ],
  },
  SHINE_Q3: {
    evaluate: [
      "Floor cleanliness",
      "Walls",
      "Walkways",
      "Scrap areas",
      "Debris",
      "Waste",
      "Dust",
      "Visible spills",
    ],
    ignore: [
      "Hidden areas",
      "Areas outside the captured image",
      "Cleaning schedules",
    ],
    notes: [
      "Evaluate only the visible portion of the workplace.",
      "Missing visibility should not automatically reduce the rating.",
    ],
  },
  SHINE_Q4: {
    evaluate: [
      "General housekeeping",
      "Maintained appearance",
      "No accumulated waste",
      "No neglected areas",
      "Overall visible cleanliness",
    ],
    ignore: [
      "Employee behaviour",
      "Team discipline",
      "Cleaning frequency",
      "Cleaning culture",
    ],
    notes: [
      "Never infer employee behaviour.",
      "Evaluate only the visible condition of the workplace.",
    ],
  },
  // STANDARDIZE
  STANDARDIZE_Q1: {
    evaluate: [
      "Area labels",
      "Equipment labels",
      "Machine identification",
      "Pipe identification",
      "Color coding",
      "Storage labels",
      "Shelf labels",
      "Standardized markings",
    ],
    ignore: [
      "Labels too small to read",
      "Hidden equipment",
      "Areas outside the captured image",
    ],
    notes: [
      "Evaluate the consistency and visibility of the identification system.",
      "Labels do not need to be readable if they are clearly visible.",
    ],
  },
  STANDARDIZE_Q2: {
    evaluate: [
      "Cleaning instruction boards",
      "Inspection checklists",
      "Visual work standards",
      "Organization standards",
      "Visual management boards",
      "Standard operating boards",
    ],
    ignore: [
      "Whether employees follow them",
      "Cleaning frequency",
      "Hidden documents",
    ],
    notes: [
      "Evaluate only whether visible standards are present.",
      "Do not evaluate compliance with those standards.",
    ],
  },
  STANDARDIZE_Q3: {
    evaluate: [
      "SOP boards",
      "Production rules",
      "Safety signs",
      "PPE instructions",
      "Emergency procedures",
      "Operating procedures",
      "Safety posters",
    ],
    ignore: [
      "Whether workers follow them",
      "Small unreadable text",
      "Document contents",
    ],
    notes: [
      "Evaluate visibility and accessibility only.",
      "Do not judge procedural compliance.",
    ],
  },
  STANDARDIZE_Q4: {
    evaluate: [
      "Inventory labels",
      "Quantity labels",
      "Storage labels",
      "Bin labels",
      "Material identification",
      "Standardized storage",
      "Inventory markings",
    ],
    ignore: [
      "Stock levels",
      "Replenishment process",
      "Supply chain",
      "Internal inventory management",
    ],
    notes: [
      "Evaluate only visible inventory standardization.",
      "Never assume inventory management practices.",
    ],
  },
  // SUSTAIN
  SUSTAIN_Q1: {
    evaluate: [
      "5S audit boards",
      "KPI boards",
      "Daily management boards",
      "Audit schedules",
      "Performance boards",
      "Workplace information boards",
      "Visual management displays",
    ],
    ignore: [
      "Audit frequency",
      "Audit effectiveness",
      "Whether audits are actually conducted",
      "Information outside the image",
    ],
    notes: [
      "Evaluate only the visible presence and organization of these boards.",
      "Do not judge whether the information displayed is current.",
    ],
  },
  SUSTAIN_Q2: {
    evaluate: [
      "Kaizen boards",
      "Suggestion boards",
      "Improvement boards",
      "Corrective action displays",
      "Continuous improvement boards",
      "Visual improvement tracking",
    ],
    ignore: [
      "Whether improvements are completed",
      "Employee participation",
      "Improvement effectiveness",
    ],
    notes: [
      "Evaluate only whether continuous improvement is visibly supported through visual management.",
    ],
  },
  SUSTAIN_Q3: {
    evaluate: [
      "Maintained organization",
      "Maintained cleanliness",
      "Preserved labels",
      "Preserved floor markings",
      "Maintained storage organization",
      "No obvious deterioration",
    ],
    ignore: [
      "Historical workplace condition",
      "Previous audit results",
      "Long-term maintenance history",
    ],
    notes: [
      "Evaluate only visible evidence that improvements appear to have been maintained.",
      "Never compare with an earlier state that is not available.",
    ],
  },
  SUSTAIN_Q4: {
    evaluate: [
      "Overall organization",
      "Overall cleanliness",
      "Overall standardization",
      "Overall maintenance",
      "Visual consistency",
    ],
    ignore: [
      "Employee discipline",
      "Team behaviour",
      "Company culture",
      "Management commitment",
      "Training",
      "Historical performance",
    ],
    notes: [
      "This question evaluates only the visible condition of the workplace.",
      "Never infer organizational culture or employee discipline.",
    ],
  },
};

function buildPrompt(questions: AuditQuestion[]): string {
  const formatQuestion = (q: AuditQuestion, i: number): string => {
    const lines: string[] = [];
    lines.push(`  ${i + 1}. ${q.question}`);
    const g = AUDIT_GUIDANCE[q.id];
    if (g) {
      lines.push(`     Evaluate: ${g.evaluate.join("; ")}`);
      lines.push(`     Ignore: ${g.ignore.join("; ")}`);
      if (g.notes && g.notes.length > 0) {
        lines.push(`     Notes: ${g.notes.join(" ")}`);
      }
      lines.push(`     If uncertain: rating="AVERAGE", confidence=30, reason="Cannot be determined from the provided image."`);
    }
    return lines.join("\n");
  };

  const byPillar = (pillar: AuditPillarKey) =>
    questions
      .filter(q => q.pillar === pillar)
      .map((q, i) => formatQuestion(q, i))
      .join("\n");

  return `You are an experienced industrial 5S workplace auditor. Your responsibility is ONLY to evaluate the uploaded workplace image. Do not calculate scores, percentages, grades, or compliance values. You only perform visual observation, question evaluation, reason generation, and confidence estimation.

PRIMARY PRINCIPLES & CRITICAL RULES:
- Visible evidence always has higher priority than inference.
- When there is any conflict between the question and the visible evidence, always trust the visible evidence.
- Never invent observations to satisfy a question.
- SYSTEMATIC IMAGE SCANNING STRATEGY: Before evaluating each question, systematically inspect the entire visible workplace. You must look at the foreground, background, floor, walls, ceilings (if visible), workstations, machinery, storage locations, shelves, containers, signage, labels, safety markings, walkways, and visual management boards. Do not restrict attention to a single localized area to avoid missed observations.
- EVIDENCE-FIRST REASONING STRATEGY: Before evaluating every question, follow this internal reasoning process:
  1. Scan the entire visible image.
  2. Identify all visible evidence relevant to the current question.
  3. Ignore irrelevant objects.
  4. Determine whether sufficient evidence exists.
  5. If evidence is insufficient, apply the existing uncertainty response.
  6. If sufficient evidence exists, explain the visible evidence first.
  7. Only after analyzing the evidence, determine the rating.
  8. Assign confidence based on evidence quality.
- INTERNAL CONSISTENCY CONTROL: The rating, reason, confidence, and recommendation (if any) must all describe the same observed condition. Contradictory outputs must never occur. Strictly prevent:
  * GOOD/VERY_GOOD rating with negative evidence.
  * BAD/VERY_BAD rating with positive evidence.
  * High confidence with insufficient evidence.
  * Recommendations unrelated to observed issues.

GLOBAL VISUAL INTERPRETATION RULES:
1. Evaluate ONLY what is directly visible in the uploaded workplace image.
2. Never evaluate areas outside the camera frame.
3. Never infer conditions that are hidden.
4. Never assume compliance.
5. Never assume non-compliance.
6. Never guess.
7. Every conclusion must be supported by visible evidence.
8. SUFFICIENT VS INSUFFICIENT EVIDENCE DEFINITION:
   - Sufficient Evidence: Evidence is sufficient when relevant objects are clearly visible, relevant areas are visible, and the observed condition directly relates to the question.
   - Insufficient Evidence: Evidence is insufficient when objects are hidden, areas are outside the image, evidence is heavily occluded, or image quality prevents reliable interpretation. Insufficient evidence must always trigger the uncertainty response: rating="AVERAGE", confidence=30, reason="Cannot be determined from the provided image."
9. POSITIVE VS NEGATIVE EVIDENCE BALANCING:
   - When both compliant (positive) and non-compliant (negative) observations are visible, consider both. Do not ignore either.
   - Base the rating on the overall balance of evidence.
   - Consider the severity, frequency, and impact of the observed conditions.
   - Avoid allowing a single minor issue to dominate and downgrade an otherwise compliant workplace.
   - Likewise, avoid allowing a single positive observation to hide multiple significant deficiencies.

GLOBAL VISIBILITY DECISION RULE:
Before evaluating each question, the model must determine whether the required evidence for that specific question can be reliably evaluated. Classify the question into exactly one of the following evidence states:
- State 1 – Positive Evidence (Visible Presence): Required object, condition, or evidence is clearly visible within the image. (Action: Evaluate normally).
- State 2 – Negative Evidence (Visible Absence): The relevant area is fully visible and can be confidently inspected, but the required object or condition is demonstrably absent (e.g. storage shelf visible with no labels, walkway visible with no floor markings, workstation visible with no visual controls). (Action: Evaluate normally using visible absence as evidence. Do NOT trigger the uncertainty response).
- State 3 – Insufficient Evidence (Cannot Verify): Required evidence cannot be reliably inspected (e.g. objects outside image frame, partial image, cropped/occluded, closed cabinets, poor lighting, blur, or relevant work area only partially visible such that evidence may exist elsewhere but cannot be confirmed). (Action: Immediately return the standardized Uncertainty Contract and terminate evaluation for this question).

UNCERTAINTY CONTRACT:
Whenever the Visibility Decision Rule classifies a question as State 3 – Insufficient Evidence, the following output values are mandatory, represent the standardized uncertainty response, and must always appear together without any variation:
  * rating: "AVERAGE"
  * confidence: 30
  * reason: "Cannot be determined from the provided image."

IMMUTABLE UNCERTAINTY CONTRACT RULE:
Once the Visibility Decision Rule classifies a question as State 3 – Insufficient Evidence, the Uncertainty Contract is completely immutable and becomes the final output for that question. After the Uncertainty Contract has been selected, no subsequent instruction in this prompt (including Evaluate/Ignore guidance, Notes, Observation-to-Interpretation reasoning, Evidence-first reasoning, Confidence calibration, or recommendations) may modify, extend, or alter this contract in the final JSON output.
The evaluation for that question terminates immediately. Appending explanatory text, justifications, observations, visibility descriptions, or evidence comments (such as "Cannot be determined from the provided image, as no labels are visible.") is strictly prohibited. The final reason field in the JSON must contain EXACTLY the string: "Cannot be determined from the provided image."

VISIBILITY DECISION RULE PRECEDENCE:
The Visibility Decision Rule is a global evaluation gate and must be executed BEFORE any question-specific guidance (such as Evaluate lists, Ignore lists, Notes, or question-specific examples). For every question, the model must first:
1. Identify the evidence required for the current question.
2. Determine whether that required evidence can be reliably inspected.
3. Classify the question into exactly one evidence state: Positive Evidence, Visible Absence, or Insufficient Evidence.
If classified as State 3 – Insufficient Evidence, the model must immediately terminate the evaluation for that question and return the standardized Uncertainty Contract, without attempting to infer an answer from the question guidance. This pre-evaluation gate prevents Evaluate or Notes instructions from overriding uncertainty handling.

INDEPENDENT QUESTION EVALUATION & EVIDENCE INDEPENDENCE PRINCIPLE:
- Each audit question must be evaluated independently. Before answering any question, the model must execute the complete Visibility Decision Rule specifically for that question.
- The model must not assume that a previous question's visibility assessment, uncertainty classification, or observations remain valid for the current question. This reassessment must occur even when multiple questions relate to the same workplace area or object.
- Evidence Independence Principle: The evidence required for one question may differ from another, even when referring to the same image. A determination made for one question must not automatically influence another question. Every question must independently verify that its own required evidence is available before proceeding. If it cannot be verified, it must be classified as State 3 - Insufficient Evidence, regardless of previous question outcomes.

STANDARDIZED UNCERTAINTY OUTPUT RULE:
When the Visibility Decision Rule classifies a question as State 3 – Insufficient Evidence (Cannot Verify), the final output must always use the standardized uncertainty response.
Alternative phrases (such as "not visible", "cannot be seen", "appears hidden", "seems absent", "not observed", "unable to inspect", "difficult to observe", "insufficiently visible") must not replace the standardized uncertainty response in the final JSON output. These phrases may be used internally during intermediate reasoning, but the final response for State 3 in the JSON must always remain exactly:
  * rating: "AVERAGE"
  * confidence: 30
  * reason: "Cannot be determined from the provided image."

EXECUTION ORDER FOR EVALUATING EACH QUESTION:
Follow this strict sequence for every single question:
1. Identify evidence required for this question.
2. Reassess only the evidence relevant to this question.
3. Execute Visibility Decision Rule to classify the evidence state.
4. If State 3 (Insufficient Evidence): Terminate evaluation for this question immediately and return the exact, immutable Uncertainty Contract. No further reasoning, recommendations, or comments are permitted.
5. If State 1 (Positive Evidence) or State 2 (Visible Absence):
   - Read the question-specific "Evaluate" guidance.
   - Read the question-specific "Ignore" guidance.
   - Read the question-specific "Notes" guidance.
   - Determine Rating (using visible absence if State 2).
   - Generate Reason (Observation -> Interpretation structure).
   - Assign Confidence (calibrated based on evidence).
   - Generate Recommendations (if applicable).

PARTIAL VISIBILITY:
- If only part of an object is visible (for example a machine, workstation, cabinet, shelf, production line, floor, wall, pipe, or storage rack), evaluate ONLY the visible portion. Do not infer the condition of hidden or partially obscured areas.
- Example:
  * Correct: "The visible portion of the machine appears clean."
  * Incorrect: "The entire machine appears clean."
- Never reduce a rating simply because an object is only partially visible. Partial visibility is not evidence of non-compliance.
- Never increase a rating by assuming hidden areas are compliant. Hidden areas should always be treated as unknown.

INSUFFICIENT EVIDENCE:
- If sufficient evidence is unavailable, never guess.
- Instead, use the exact, immutable Uncertainty Contract:
  * rating: "AVERAGE"
  * reason: "Cannot be determined from the provided image."
  * confidence: 30
- Do NOT create custom uncertainty responses or append any additional text, explanations, observations, or descriptions. The final output must be exactly the Uncertainty Contract.

OBSERVATION PRINCIPLE & REASONING STYLE:
- Distinguish between Visible Observation and Inference. Every conclusion must originate from visible observations. Ratings must be derived from observations. Unsupported conclusions are prohibited.
- Always describe visible evidence first (what you saw), and only then explain how it relates to the question (what it means).
- Every reason structure must follow: Visible Observation -> Interpretation.
  * Example:
    Visible Observation: "Yellow floor markings define pedestrian walkways."
    Interpretation: "This indicates organized traffic management within the visible work area."
- Avoid subjective wording, emotional language, and speculation. Use deterministic, concise, and objective reasoning based entirely on observable facts.
- Prefer objective wording: visible, observed, identifiable, labeled, marked, stored, organized, obstructed, accessible.
- Avoid subjective/speculative wording: probably, likely, appears to, seems, may indicate, presumably (unless uncertainty genuinely exists).
- Examples:
  * Good: "Two loose hand tools are visible on the workbench without any designated storage location."
  * Poor: "The workplace is poorly organized."

INDUSTRIAL CONTEXT & AUDIT ZONE Rules:
- Retain the existing Audit Zone guidance. The Audit Zone is contextual only. Visible evidence always overrides contextual expectations.
- Industrial workplaces naturally contain machines, chemicals, oil, grease, raw materials, containers, spare parts, equipment, workstations, and production materials. The presence of these items alone must NEVER reduce the rating.
- Only reduce the rating when there is visible evidence that they: create clutter, are improperly stored, obstruct work, reduce accessibility, reduce cleanliness, lack identification, or violate the specific question being evaluated.

QUESTION EVALUATION:
- Each question is independent. Never allow the answer of one question to influence another.
- Evaluate every question separately using only: question text, question guidance, and visible evidence. Do not reuse conclusions from previous questions.

CONFIDENCE CALIBRATION:
- Confidence represents how certain you are based on evidence quality and visibility:
  * High Confidence (80-100): Multiple relevant observations, unobstructed visibility, clear image quality, direct evidence.
  * Medium Confidence (40-79): Partial visibility, moderate ambiguity, indirect supporting evidence.
  * Low Confidence (0-39): Poor visibility, hidden objects, occlusion, or insufficient evidence (forces the uncertainty response with confidence=30).
- Confidence must never be random and must never be influenced by whether the rating is positive or negative.

CONSISTENCY:
- The same workplace image should produce nearly identical results when evaluated multiple times. Use repeatable and deterministic reasoning.

STANDARDIZE EVALUATION RULES:
- Before answering each STANDARDIZE question, read the guidance attached to that specific question.
- Strictly follow the evaluate and ignore lists. Do not introduce your own evaluation criteria.
- STANDARDIZE evaluates visual standardization, not operational compliance.
- Only evaluate visible evidence such as labels, color coding, signage, SOP boards, inspection checklists, safety information, visual management boards, inventory labels, and standardized storage markings.
- Never evaluate employee behaviour, procedural compliance, inspection frequency, management practices, training, or internal inventory processes.
- Never reduce the rating simply because document contents cannot be read. Small or unreadable text is not evidence of poor standardization.
- Only reduce the rating when there is visible evidence that: standardized identification is missing, labels are inconsistent, visual controls are absent, safety information is missing, storage identification is inconsistent, or visual management systems are lacking.
- If there is insufficient visual evidence, use the uncertaintyResponse defined in the question configuration (rating="AVERAGE", confidence=30, reason="Cannot be determined from the provided image.").
- Every reason must reference visible evidence (e.g. Good: "Storage shelves are visible but no standardized labels or identification markings can be observed." Bad: "The workplace lacks standardization.").

SUSTAIN EVALUATION RULES:
- Before answering each SUSTAIN question, read the guidance attached to that specific question.
- Strictly follow the evaluate and ignore lists. Do not introduce your own evaluation criteria.
- SUSTAIN evaluates visible indicators suggesting sustained 5S implementation. It does NOT evaluate organizational culture, employee discipline, employee behaviour, team culture, management commitment, training, audit frequency, historical compliance, long-term performance, or continuous improvement programs.
- Only evaluate visible indicators such as audit boards, KPI boards, visual management boards, Kaizen boards, suggestion boards, corrective action displays, maintained labels, maintained floor markings, preserved organization, consistent housekeeping, and maintained standardization.
- Only reduce the rating when there is visible evidence that: visual management systems are absent, maintained improvements are visibly deteriorated, standardization appears inconsistent, or workplace condition suggests poor long-term maintenance.
- If there is insufficient visual evidence, use the uncertaintyResponse defined in the question configuration (rating="AVERAGE", confidence=30, reason="Cannot be determined from the provided image.").
- Every reason must reference visible evidence (e.g. Good: "No visible audit board, improvement board, or other visual management system can be observed in the captured workplace area." Bad: "The organization does not maintain 5S.").

RECOMMENDATION GENERATION RULES:
- Recommendations must originate only from observed evidence.
- Address the highest-impact problems first.
- Avoid duplicate corrective actions.
- Avoid generic recommendations; they must remain practical, measurable, and workplace-specific.
- Never recommend correcting something that cannot be visually confirmed.

CRITICAL RULES FOR OUTPUT:
- Return VALID JSON ONLY. No markdown. No code blocks. No natural language outside the JSON object. No comments. No explanations.
- Answer EVERY question in the EXACT ORDER and EXACT WORDING given below. Do NOT rephrase, skip, merge, or reorder questions.
- For every question return exactly: question (copy exact text), rating, reason, confidence.
- rating MUST be one of: VERY_GOOD, GOOD, AVERAGE, BAD, VERY_BAD
- reason MUST describe specific visual evidence observed in the image and follow the reasoning style.
- confidence MUST be an integer 0-100.
- Do NOT calculate scores, percentages, or grades. The application is the single source of truth.
- If a question includes an "If uncertain" directive, follow it exactly when evidence is insufficient.

SORT:
${byPillar("SORT")}

SET IN ORDER:
${byPillar("SET_IN_ORDER")}

SHINE:
${byPillar("SHINE")}

STANDARDIZE:
${byPillar("STANDARDIZE")}

SUSTAIN:
${byPillar("SUSTAIN")}

Return this exact JSON:
{
  "sort": { "questions": [{ "question": "...", "rating": "GOOD", "reason": "...", "confidence": 90 }] },
  "set_in_order": { "questions": [...] },
  "shine": { "questions": [...] },
  "standardize": { "questions": [...] },
  "sustain": { "questions": [...] },
  "recommendations": [{ "pillar": "SORT", "problem": "...", "corrective_action": "...", "expected_benefit": "..." }]
}`;
}

// ── Gemini API caller ─────────────────────────────────────────────────────────

async function callGemini(
  imageBase64: string,
  prompt: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const raw = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: raw } }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API error (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response.");
  return text.trim();
}

// ── Normalisation helper ──────────────────────────────────────────────────────

function normaliseQuestion(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── Confidence parser (non-fatal) ─────────────────────────────────────────────

function parseConfidence(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  return null;
}

// ── Validated question shape ──────────────────────────────────────────────────

interface ValidatedQuestion {
  id:         string;
  question:   string;
  rating:     AiRating;
  reason:     string;
  confidence: number | null;
}

interface ValidatedPillar {
  pillarKey: AuditPillarKey;
  questions: ValidatedQuestion[];
}

// ── Strict validator ──────────────────────────────────────────────────────────
//
// Order: JSON valid → Question count → Question identity → Rating values → Required fields
// Confidence is non-fatal. Recommendations validated separately.

function validateResponse(
  parsed: unknown,
  questions: AuditQuestion[],
): ValidatedPillar[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Response is not a JSON object.");
  }

  const resp = parsed as Record<string, unknown>;
  const validatedPillars: ValidatedPillar[] = [];

  for (const pillarKey of PILLAR_ORDER) {
    const jsonKey    = PILLAR_TO_JSON_KEY[pillarKey];
    const pillarData = resp[jsonKey];

    // Step 2 — Question count
    if (!pillarData || typeof pillarData !== "object" || Array.isArray(pillarData)) {
      throw new Error(`Missing pillar section "${jsonKey}".`);
    }

    const pillarObj  = pillarData as Record<string, unknown>;
    if (!Array.isArray(pillarObj.questions)) {
      throw new Error(`"${jsonKey}.questions" must be an array.`);
    }

    const geminiQs   = pillarObj.questions as unknown[];
    const expectedQs = questions.filter(q => q.pillar === pillarKey);

    if (geminiQs.length !== expectedQs.length) {
      throw new Error(
        `"${jsonKey}" has ${geminiQs.length} question(s), expected ${expectedQs.length}.`,
      );
    }

    const validatedQuestions: ValidatedQuestion[] = [];

    for (let i = 0; i < expectedQs.length; i++) {
      const expected = expectedQs[i];
      const gq       = geminiQs[i] as Record<string, unknown>;

      // Step 3 — Question identity
      if (typeof gq.question !== "string") {
        throw new Error(`"${jsonKey}" question ${i + 1}: missing "question" field.`);
      }
      if (normaliseQuestion(gq.question) !== normaliseQuestion(expected.question)) {
        throw new Error(
          `"${jsonKey}" question ${i + 1} identity mismatch.\n` +
          `  Expected: "${expected.question}"\n` +
          `  Received: "${gq.question}"`,
        );
      }

      // Step 4 — Rating values
      if (!VALID_RATINGS.includes(gq.rating as AiRating)) {
        throw new Error(
          `"${jsonKey}" question ${i + 1}: invalid rating "${gq.rating}". ` +
          `Must be one of: ${VALID_RATINGS.join(", ")}.`,
        );
      }

      // Step 5 — Required fields
      if (typeof gq.reason !== "string" || gq.reason.trim() === "") {
        throw new Error(`"${jsonKey}" question ${i + 1}: "reason" is missing or empty.`);
      }

      // Confidence: non-fatal
      validatedQuestions.push({
        id:         expected.id,
        question:   expected.question, // always use app's authoritative text
        rating:     gq.rating as AiRating,
        reason:     (gq.reason as string).trim(),
        confidence: parseConfidence(gq.confidence),
      });
    }

    validatedPillars.push({ pillarKey, questions: validatedQuestions });
  }

  return validatedPillars;
}

// ── Recommendations parser (non-fatal) ───────────────────────────────────────

interface RawRec {
  pillar: string; problem: string; corrective_action: string; expected_benefit?: string;
}

function parseRecommendations(parsed: unknown): RawRec[] {
  try {
    const r = (parsed as Record<string, unknown>)?.recommendations;
    if (!Array.isArray(r)) return [];
    return r.filter(
      (item: any) =>
        typeof item?.pillar            === "string" &&
        typeof item?.problem           === "string" &&
        typeof item?.corrective_action === "string",
    ) as RawRec[];
  } catch {
    return [];
  }
}

// ── Score calculation (after validation) ─────────────────────────────────────

function buildResult(
  validatedPillars: ValidatedPillar[],
  rawRecs:          RawRec[],
  modelName:        string,
): Record<string, unknown> {
  const allConfidences: Array<number | null> = [];
  const scoredPillars: Array<{ pillarKey: AuditPillarKey; score: number; maxScore: number; pct: number; questions: ValidatedQuestion[] }> = [];
  const allResponses: Record<string, unknown>[] = [];

  for (const vp of validatedPillars) {
    let pillarScore = 0;
    const questions: ValidatedQuestion[] = [];

    for (const q of vp.questions) {
      const score = ratingToScore(q.rating);
      pillarScore += score;
      allConfidences.push(q.confidence);
      questions.push(q);
      allResponses.push({
        question_id: q.id,
        ai_answer:   score >= 3 ? "YES" : score === 2 ? "PARTIAL" : "NO",
        confidence:  q.confidence !== null ? q.confidence / 100 : null,
        evidence:    q.reason,
        score,       // extended field for mapper
      });
    }

    const maxScore = QUESTIONS_PER_PILLAR * 4;
    scoredPillars.push({
      pillarKey: vp.pillarKey,
      score:     pillarScore,
      maxScore,
      pct:       Math.round((pillarScore / maxScore) * 100),
      questions,
    });
  }

  const overallScore = scoredPillars.reduce((s, p) => s + p.score, 0);
  const overallMax   = PILLAR_ORDER.length * QUESTIONS_PER_PILLAR * 4; // 80
  const overallPct   = Math.round((overallScore / overallMax) * 100);
  const grade        = calculateGradeLabel(overallPct);

  const numericConfs = allConfidences.filter((c): c is number => c !== null);
  const avgConf = numericConfs.length > 0
    ? Math.round(numericConfs.reduce((a, b) => a + b, 0) / numericConfs.length)
    : null;

  const pillarScores = scoredPillars.map(p => ({
    pillar:         PILLAR_LABEL[p.pillarKey],
    score:          p.score,
    maximum:        p.maxScore,
    percentage:     p.pct,
    raw_percentage: p.pct,
    passed:         p.questions.filter(q => ratingToScore(q.rating) >= 3).length,
    partial:        p.questions.filter(q => ratingToScore(q.rating) === 2).length,
    failed:         p.questions.filter(q => ratingToScore(q.rating) <= 1).length,
    not_visible:    0,
    not_applicable: 0,
    critical:       p.questions.filter(q => ratingToScore(q.rating) === 0).length,
    cap_applied:    false,
    top_deductions: [],
  }));

  const recommendations = rawRecs.map((rec, idx) => {
    const pk = PILLAR_ORDER.find(
      k => PILLAR_LABEL[k].toLowerCase() === rec.pillar.toLowerCase(),
    ) ?? "SORT";

    return {
      pillar:             PILLAR_LABEL[pk],
      severity:           "MAJOR",
      priority:           idx + 1,
      priority_label:     "High Priority",
      title:              rec.problem,
      description:        rec.corrective_action,
      problem:            rec.problem,
      root_cause:         rec.problem,
      corrective_action:  rec.corrective_action,
      expected_benefit:   rec.expected_benefit ?? "Restores 5S compliance standard.",
      linked_question_id: `${pk}_Q1`,
    };
  });

  return {
    template:          { id: "std-5s-v2", name: "Standard 5S Audit", version: "2.0.0" },
    prompt_version:    "v2.0",
    vision_model:      modelName,
    schema_version:    "2.0",
    audit_confidence:  avgConf !== null ? avgConf / 100 : null,
    before: {
      score: {
        pillar_scores:      pillarScores,
        overall_score:      overallScore,
        overall_maximum:    overallMax,
        overall_percentage: overallPct,
        grade,
        grade_color:        gradeColor(grade),
        total_answered:     AUDIT_QUESTIONS.length,
        total_questions:    AUDIT_QUESTIONS.length,
        critical_failures:  pillarScores.reduce((s, p) => s + (p.critical as number), 0),
        computed_at:        new Date().toISOString(),
      },
      responses: allResponses,
    },
    recommendations,
    improvement_prompt:    null,
    explainability_report: null,
    scoringMethod:         "AI Audit V2 (Rating-Based)",
  };
}

// ── Main audit runner ─────────────────────────────────────────────────────────

async function runAudit(
  imageBase64: string,
  apiKey: string,
  attempt = 0,
): Promise<Record<string, unknown>> {
  const modelName = attempt === 0 ? GEMINI_MODEL : GEMINI_RETRY_MODEL;
  const prompt    = buildPrompt(AUDIT_QUESTIONS);

  // Call Gemini
  let rawText: string;
  try {
    rawText = await callGemini(imageBase64, prompt, apiKey, modelName);
  } catch (err) {
    if (attempt === 0) {
      console.warn("[analyze-5s] API call failed (attempt 0). Retrying…", err);
      return runAudit(imageBase64, apiKey, 1);
    }
    throw new Error("AI Analysis Failed");
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    if (attempt === 0) {
      console.warn("[analyze-5s] Invalid JSON (attempt 0). Retrying…");
      return runAudit(imageBase64, apiKey, 1);
    }
    throw new Error("AI Analysis Failed");
  }

  // Validate — count → identity → ratings → required fields
  let validatedPillars: ValidatedPillar[];
  try {
    validatedPillars = validateResponse(parsed, AUDIT_QUESTIONS);
  } catch (validationErr) {
    if (attempt === 0) {
      console.warn("[analyze-5s] Validation failed (attempt 0). Retrying…", validationErr);
      return runAudit(imageBase64, apiKey, 1);
    }
    console.error("[analyze-5s] Validation failed on retry:", validationErr);
    throw new Error("AI Analysis Failed");
  }

  // Recommendations: non-fatal
  const rawRecs = parseRecommendations(parsed);

  // Score calculation (after all validation passes)
  return buildResult(validatedPillars, rawRecs, modelName);
}

// ── Edge Function handler ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const payload = await req.json();

    if (payload.action === "visualize") {
      return new Response(
        JSON.stringify({ success: true, visualizedImageUrl: null }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const { beforeImage } = payload;
    if (!beforeImage) {
      return new Response(
        JSON.stringify({ error: "beforeImage is required." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not configured on the server." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const result = await runAudit(beforeImage, apiKey);
    return new Response(JSON.stringify(result), {
      status:  200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const message = err?.message ?? "Internal Server Error";
    console.error("[analyze-5s] Error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
}, { port: Number(Deno.env.get("PORT") ?? 8000) });
