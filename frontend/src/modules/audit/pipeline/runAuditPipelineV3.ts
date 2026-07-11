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

  // Initialize timer and stage recorder
  const timer = new ExecutionTimer();
  const stages: PipelineStageTrace[] = [];

  // Load configuration first
  const config = loadQuestionConfiguration();

  // ── Stage 1: Image Validation ──────────────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 1: Image Validation...');
  const valResult = await validateImage(imageBase64);
  const stage1Dur = timer.stop();
  stages.push(recordStageTrace('image-validation', stage1Dur, valResult.isValid ? 'success' : 'failed'));

  if (!valResult.isValid) {
    debugGroupEnd();
    throw new Error(`Image validation failed: ${valResult.errors.join('; ')}`);
  }

  // ── Stage 2: Gemini Vision perception ───────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 2: Gemini Vision Perception...');
  const visionOutput = await analyzeImageWithGemini(imageBase64, apiKey);
  const stage2Dur = timer.stop();
  stages.push(recordStageTrace('gemini-vision', stage2Dur, 'success'));

  // ── Stage 3: Structured Observations ────────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 3: Structured Observations...');
  const structuredObs = buildStructuredObservations(visionOutput, config.allQuestions);
  const stage3Dur = timer.stop();
  stages.push(recordStageTrace('structured-observation', stage3Dur, 'success'));

  // ── Stage 4: Observation Validation ─────────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 4: Observation Validation...');
  const obsValResult = validateObservations(structuredObs, visionOutput, config.allQuestions);
  const stage4Dur = timer.stop();
  stages.push(recordStageTrace('observation-validation', stage4Dur, obsValResult.validated ? 'success' : 'failed'));

  if (!obsValResult.validated) {
    debugGroupEnd();
    throw new Error('Structured observation validation failed. Contradiction detected.');
  }

  // ── Stage 5: Visibility Decision ────────────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 5: Visibility Decision...');
  const visibilityDecisions = determineVisibility(structuredObs, visionOutput, config.allQuestions);
  const stage5Dur = timer.stop();
  stages.push(recordStageTrace('visibility-engine', stage5Dur, 'success'));

  // ── Stage 6: Standardized Evidence ──────────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 6: Standardized Evidence...');
  const stdEvidenceResult = buildEvidenceIds(structuredObs, visionOutput);
  const stage6Dur = timer.stop();
  stages.push(recordStageTrace('standardized-evidence', stage6Dur, stdEvidenceResult ? 'success' : 'failed'));

  if (!stdEvidenceResult) {
    debugGroupEnd();
    throw new Error('Standardized evidence mapping failed configuration pre-flight checks.');
  }

  // ── Stage 7: Deterministic Rule Engine ──────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 7: Deterministic Rule Engine...');
  const ruleResults = evaluateAllQuestions(
    stdEvidenceResult.observations,
    visibilityDecisions,
    config,
  );
  const stage7Dur = timer.stop();
  stages.push(recordStageTrace('rule-engine', stage7Dur, 'success'));

  // ── Stage 8: Question Score Calculator ──────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 8: Question Scoring...');
  const questionScores = calculateAllQuestionScores(ruleResults, config);
  const stage8Dur = timer.stop();
  stages.push(recordStageTrace('scoring-engine', stage8Dur, 'success'));

  // ── Stages 9 & 10: Pillar & Overall Aggregation ─────────────────────────────
  timer.start();
  debugLog('Executing Stages 9 & 10: Score Aggregation...');
  const pillarScores = calculatePillarScores(questionScores, config);
  const overallScore = calculateOverallScore(pillarScores, config);
  const stage9Dur = timer.stop();
  stages.push(recordStageTrace('score-aggregator', stage9Dur, 'success'));

  // ── Stage 11: Grade Engine ──────────────────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 11: Grade Evaluation...');
  const gradeResult = calculateGrade(overallScore.percentage, config);
  const stage11Dur = timer.stop();
  stages.push(recordStageTrace('grade-engine', stage11Dur, 'success'));

  // ── Stage 12: Timing & Debug Trace ──────────────────────────────────────────
  timer.start();
  debugLog('Executing Stage 12: Debug Trace Compilation...');
  const questionTrace = ruleResults.flatMap(r =>
    r.evaluationTrace.map(msg => ({ questionId: r.questionId, stepName: 'Rule Match', logMessage: msg })),
  );
  const trace = buildAuditTrace(auditId, stages, questionTrace);
  const stage12Dur = timer.stop();
  stages.push(recordStageTrace('audit-trace', stage12Dur, 'success'));

  // ── Stage 13: Gemini Recommendation Generator ───────────────────────────────
  timer.start();
  debugLog('Executing Stage 13: Recommendation Generation...');
  const recommendations = await generateRecommendations(
    overallScore,
    gradeResult,
    pillarScores,
    questionScores,
    stdEvidenceResult.observations,
    config,
    apiKey,
  );
  const stage13Dur = timer.stop();
  stages.push(recordStageTrace('recommendation-engine', stage13Dur, 'success'));

  // ── Stage 14: Report Builder ────────────────────────────────────────────────
  const executionDuration = Date.now() - pipelineStartTime;
  timer.start();
  debugLog('Executing Stage 14: Report Builder...');
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
  const stage14Dur = timer.stop();
  stages.push(recordStageTrace('report-builder', stage14Dur, 'success'));

  debugLog(`V3 Pipeline Executed Successfully | Overall Duration: ${executionDuration}ms`);
  debugGroupEnd();

  return report;
}
