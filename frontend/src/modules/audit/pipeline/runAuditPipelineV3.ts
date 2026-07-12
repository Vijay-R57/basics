/**
 * src/modules/audit/pipeline/runAuditPipelineV3.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 8 — AI 5S Analysis Pipeline V3: Unified Orchestrator Runner
 *
 * ROLE:
 *   Orchestrates the 14 execution stages of the V3 pipeline in strict sequence.
 *   Tracks stage timings, gathers outputs, and compiles the final immutable report.
 */

import { validateImage } from './imageValidator';
import { analyzeImageWithGemini } from './geminiVisionAnalyzer';
import { buildStructuredObservations } from './observationEngine';
import { validateObservations } from './observationValidator';
import { determineVisibility } from './visibilityEngine';
import { buildEvidenceIds } from '../standardizedEvidence';
import { evaluateAllQuestions } from '../ruleEngine';
import { calculateAllQuestionScores } from '../questionScore';
import { calculatePillarScores, calculateOverallScore } from '../scoreAggregation';
import { calculateGrade } from '../grade';
import { buildAuditTrace, ExecutionTimer, recordStageTrace } from '../trace';
import { generateRecommendations } from '../recommendation';
import { buildAuditReport } from '../report';
import { loadQuestionConfiguration } from '../ruleConfiguration';
import type { Final5SAuditReport, PipelineStageTrace } from '@/types/analysis';
import { debugLog, debugGroup, debugGroupEnd, debugError } from './debug';

/**
 * Executes the complete V3 5S Analysis Pipeline.
 *
 * @param imageBase64      - The raw base64 workplace image.
 * @param apiKey           - The VITE_GEMINI_API_KEY.
 * @param workspaceContext - Optional parameters.
 * @returns Readonly Final5SAuditReport.
 */
export async function runAuditPipelineV3(
  imageBase64: string,
  apiKey: string,
  workspaceContext?: Record<string, unknown>,
): Promise<Readonly<Final5SAuditReport>> {
  const pipelineStartTime = Date.now();
  const auditId = 'audit-' + Math.random().toString(36).substring(2, 11).toUpperCase();

  debugGroup(`V3 Pipeline Execution Started (Audit ID: ${auditId})`);

  const stages: PipelineStageTrace[] = [];

  // Helper to compile correct timing objects
  const makeTiming = (start: number, end: number) => ({
    startTime: new Date(start).toISOString(),
    endTime:   new Date(end).toISOString(),
    duration:  Math.max(0, end - start),
  });

  // Stage 1: Audit Started
  stages.push(recordStageTrace('Audit Started', makeTiming(pipelineStartTime, pipelineStartTime), 'PASS', 'PASS'));

  // Stage 7: Rule Configuration (timed at start)
  const tConfigStart = Date.now();
  const config = loadQuestionConfiguration();
  const tConfigEnd = Date.now();

  // ── Stage 2: Image Validation ──────────────────────────────────────────────
  const tValStart = Date.now();
  debugLog('Executing Stage 2: Image Validation...');
  const valResult = await validateImage(imageBase64);
  const tValEnd = Date.now();
  stages.push(recordStageTrace('Image Validation', makeTiming(tValStart, tValEnd), valResult.isValid ? 'PASS' : 'FAIL', valResult.isValid ? 'PASS' : 'STOP_PIPELINE'));

  if (!valResult.isValid) {
    debugGroupEnd();
    throw new Error(`Image validation failed: ${valResult.errors.join('; ')}`);
  }

  // ── Stage 3: Gemini Vision perception ───────────────────────────────────────
  const tVisionStart = Date.now();
  debugLog('Executing Stage 3: Gemini Vision Perception...');
  const visionOutput = await analyzeImageWithGemini(imageBase64, apiKey);
  const tVisionEnd = Date.now();
  stages.push(recordStageTrace('Gemini Vision', makeTiming(tVisionStart, tVisionEnd), 'PASS', 'PASS'));

  // ── Stage 4: Structured Observations ────────────────────────────────────────
  const tObsStart = Date.now();
  debugLog('Executing Stage 4: Structured Observations...');
  const structuredObs = buildStructuredObservations(visionOutput, config.allQuestions);
  const tObsEnd = Date.now();
  stages.push(recordStageTrace('Structured Observation', makeTiming(tObsStart, tObsEnd), 'PASS', 'PASS'));

  // ── Stage 5: Observation Validation ─────────────────────────────────────────
  const tObsValStart = Date.now();
  debugLog('Executing Stage 5: Observation Validation...');
  const obsValResult = validateObservations(structuredObs, visionOutput, config.allQuestions);
  const tObsValEnd = Date.now();
  stages.push(recordStageTrace('Observation Validation', makeTiming(tObsValStart, tObsValEnd), obsValResult.validated ? 'PASS' : 'FAIL', obsValResult.validated ? 'PASS' : 'STOP_PIPELINE'));

  if (!obsValResult.validated) {
    debugGroupEnd();
    throw new Error('Structured observation validation failed. Contradiction detected.');
  }

  // ── Stage 6: Visibility Decision ────────────────────────────────────────────
  const tVisStart = Date.now();
  debugLog('Executing Stage 6: Visibility Decision...');
  const visibilityDecisions = determineVisibility(structuredObs, visionOutput, config.allQuestions);
  const tVisEnd = Date.now();
  stages.push(recordStageTrace('Visibility Decision', makeTiming(tVisStart, tVisEnd), 'PASS', 'PASS'));

  // ── Stage 7: Rule Configuration (Recorded here in the 14-stage sequence) ───
  stages.push(recordStageTrace('Rule Configuration', makeTiming(tConfigStart, tConfigEnd), 'PASS', 'PASS'));

  // ── Stage 8: Evidence Mapping ──────────────────────────────────────────────
  const tMapStart = Date.now();
  debugLog('Executing Stage 8: Standardized Evidence Mapping...');
  const stdEvidenceResult = buildEvidenceIds(structuredObs, visionOutput);
  const tMapEnd = Date.now();
  stages.push(recordStageTrace('Evidence Mapping', makeTiming(tMapStart, tMapEnd), stdEvidenceResult ? 'PASS' : 'FAIL', stdEvidenceResult ? 'PASS' : 'STOP_PIPELINE'));

  if (!stdEvidenceResult) {
    debugGroupEnd();
    throw new Error('Standardized evidence mapping failed configuration pre-flight checks.');
  }

  // ── Stage 9: Rule Evaluation ───────────────────────────────────────────────
  const tEvalStart = Date.now();
  debugLog('Executing Stage 9: Deterministic Rule Evaluation...');
  const ruleResults = evaluateAllQuestions(
    stdEvidenceResult.observations,
    visibilityDecisions,
    config,
  );
  const tEvalEnd = Date.now();
  stages.push(recordStageTrace('Rule Evaluation', makeTiming(tEvalStart, tEvalEnd), 'PASS', 'PASS'));

  // ── Stage 10: Question Scores ──────────────────────────────────────────────
  const tQSStart = Date.now();
  debugLog('Executing Stage 10: Question Scoring...');
  const questionScores = calculateAllQuestionScores(ruleResults, config);
  const tQSEnd = Date.now();
  stages.push(recordStageTrace('Question Scores', makeTiming(tQSStart, tQSEnd), 'PASS', 'PASS'));

  // ── Stages 11 & 12: Pillar & Overall Aggregation ───────────────────────────
  const tAggStart = Date.now();
  debugLog('Executing Stages 11 & 12: Score Aggregation...');
  const aggregationConfig = {
    pillars: Object.keys(config.questions),
    rounding: { decimals: 2 },
  };
  const pillarScores = calculatePillarScores(questionScores, aggregationConfig);
  const overallScore = calculateOverallScore(pillarScores, aggregationConfig);
  const tAggEnd = Date.now();

  // Record Pillar Scores & Overall Score separately to match sequence
  stages.push(recordStageTrace('Pillar Scores', makeTiming(tAggStart, tAggEnd), 'PASS', 'PASS'));
  stages.push(recordStageTrace('Overall Score', makeTiming(tAggStart, tAggEnd), 'PASS', 'PASS'));

  // ── Stage 13: Grade Engine ──────────────────────────────────────────────────
  const tGradeStart = Date.now();
  debugLog('Executing Stage 13: Grade Evaluation...');
  const gradeResult = calculateGrade(overallScore.percentage, config);
  const tGradeEnd = Date.now();
  stages.push(recordStageTrace('Grade', makeTiming(tGradeStart, tGradeEnd), 'PASS', 'PASS'));

  // Stage 14: Audit Completed (Timing marker)
  const tCompleted = Date.now();
  stages.push(recordStageTrace('Audit Completed', makeTiming(tCompleted, tCompleted), 'PASS', 'PASS'));

  // Assemble Debug Trace
  const questionTrace = ruleResults.flatMap(r =>
    r.evaluationTrace.map(msg => ({ questionId: r.questionId, stepName: 'Rule Match', logMessage: msg })),
  );
  const trace = buildAuditTrace(auditId, config, stages, questionTrace);

  // ── Stage 13 (UI): Gemini Recommendation Generator ──────────────────────────
  debugLog('Executing Recommendations phase...');
  const recommendations = await generateRecommendations(
    overallScore,
    gradeResult,
    pillarScores,
    questionScores,
    stdEvidenceResult.observations,
    config,
    apiKey,
  );

  // ── Stage 14 (UI): Report Builder ───────────────────────────────────────────
  const executionDuration = Date.now() - pipelineStartTime;
  debugLog('Executing Report Builder...');
  const report = buildAuditReport({
    auditId,
    overallScore,
    gradeResult,
    pillarScores,
    questionScores,
    recommendations,
    observations: stdEvidenceResult.observations,
    trace,
    config,
    executionDuration,
  });

  debugLog(`V3 Pipeline Executed Successfully | Overall Duration: ${executionDuration}ms`);
  debugGroupEnd();

  return report;
}

