/**
 * src/components/AnalysisResults.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Redesigned 5S Workplace Audit Report Dashboard (Phase 3A Redesign).
 * Emulates a professional digital industrial 5S audit checklist sheet.
 * Single workplace image workflow; displays executive summary and audit timeline.
 */

import React, { useState } from 'react';
import { Download, ShieldCheck, Printer, Terminal, Eye, Sparkles } from 'lucide-react';
import { mapAnalysisResultToAuditResult } from '@/modules/audit/utils/auditMapper';
import AuditProgressStepper from '@/modules/audit/components/AuditProgressStepper';
import AuditScoreCard from '@/modules/audit/components/AuditScoreCard';
import PillarCard from '@/modules/audit/components/PillarCard';
import type { AuditPillar } from '@/modules/audit/constants/pillars';
import PillarAssessment from '@/modules/audit/components/PillarAssessment';
import RecommendationCard from '@/modules/audit/components/RecommendationCard';
import RadarScoreChart from '@/modules/audit/components/RadarScoreChart';
import AuditSummaryCard from '@/modules/audit/components/AuditSummaryCard';
import AuditTimelineComponent from '@/modules/audit/components/AuditTimeline';
import type { AuditAnalysisResult, AuditTimeline } from '@/types/analysis';
import { jsPDF } from 'jspdf';

interface Props {
  data: AuditAnalysisResult;
  workplaceImage: string;
  analysisTimestamp?: string;
  imageQualityScore?: number | null;
  imageQualityLevel?: string | null;
  timeline?: AuditTimeline | null;
}

export default function AnalysisResults({
  data,
  workplaceImage,
  analysisTimestamp,
  imageQualityScore = null,
  imageQualityLevel = null,
  timeline = null,
}: Props) {
  // Deterministic scoring safety check
  const scoringMethod = data.scoringMethod || "AI Audit (Structured Questionnaire)";
  if (
    scoringMethod.toLowerCase().includes("fallback") ||
    scoringMethod.toLowerCase().includes("gemini")
  ) {
    throw new Error("Deterministic scoring violation detected.");
  }

  const [devMode, setDevMode] = useState(false);

  // Map incoming database AI response model to future-compatible AuditResult contract
  const auditResult = mapAnalysisResultToAuditResult(data, analysisTimestamp);
  const { overallScore, overallMaxScore, overallPercentage, overallRating, pillars, recommendations, summary, areaInfo } = auditResult;

  // Enhance summary with image quality fields passed from validation panel
  const enhancedSummary = {
    ...summary,
    imageQualityScore,
    imageQualityLevel,
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    let y = 15;
    const margin = 15;
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    const checkPageBreak = (needed: number) => {
      if (y + needed > pageHeight - 15) {
        doc.addPage();
        y = 15;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('ARCOLAB 5S Workplace Audit Report', margin, 10);
        doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin - 10, 10);
        doc.setLineWidth(0.2);
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, 12, pageWidth - margin, 12);
      }
    };

    // Header Panel
    doc.setFillColor(26, 80, 54);
    doc.rect(margin, y, pageWidth - (margin * 2), 20, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('ARCOLAB 5S WORKPLACE AUDIT REPORT', margin + 5, y + 8);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('DIGITAL AUDITOR COMPLIANCE RECORD', margin + 5, y + 15);
    y += 26;

    // Metadata details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    doc.text('AUDIT INFORMATION', margin, y);
    y += 4;
    doc.setLineWidth(0.3);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);

    const leftColX = margin;
    const rightColX = pageWidth / 2 + 5;

    // Left Column
    doc.text(`Company: ${areaInfo.companyName}`, leftColX, y); y += 5;
    doc.text(`Auditor: ${areaInfo.auditor}`, leftColX, y); y += 5;
    doc.text(`Department: ${areaInfo.department}`, leftColX, y); y += 5;
    doc.text(`Workspace Type: ${areaInfo.workspaceType}`, leftColX, y); y += 5;

    // Reset y for right column
    let yRight = y - 20;
    doc.text(`Date Conducted: ${areaInfo.auditDate}`, rightColX, yRight); yRight += 5;
    doc.text(`Area / Station: ${areaInfo.areaName}`, rightColX, yRight); yRight += 5;
    doc.text(`Industry: ${areaInfo.industry}`, rightColX, yRight); yRight += 5;
    doc.text(`Scoring Standard: Physical Audit 5S (0-4 Rating)`, rightColX, yRight);

    y += 6;

    // Summary Card (Border box)
    checkPageBreak(40);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, pageWidth - (margin * 2), 32, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('EXECUTIVE COMPLIANCE SUMMARY', margin + 5, y + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(26, 80, 54);
    doc.text(`Overall Score: ${overallScore} / ${overallMaxScore} (${overallPercentage}%)`, margin + 5, y + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Rating: ${overallRating.toUpperCase()}`, margin + 5, y + 21);
    doc.text(`Critical Findings: ${enhancedSummary.criticalFindings}`, margin + 5, y + 27);

    const sumRightX = pageWidth / 2 + 10;
    doc.text(`Highest Pillar: ${enhancedSummary.highestPillar}`, sumRightX, y + 14);
    doc.text(`Lowest Pillar: ${enhancedSummary.lowestPillar}`, sumRightX, y + 20);
    doc.text(`Image Quality: ${enhancedSummary.imageQualityScore !== null ? `${enhancedSummary.imageQualityScore}/100 (${enhancedSummary.imageQualityLevel})` : 'N/A'}`, sumRightX, y + 26);

    y += 38;

    // Pillar Scores
    checkPageBreak(45);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    doc.text('5S PILLAR SCORE BREAKDOWN', margin, y);
    y += 4;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Pillar', margin + 5, y);
    doc.text('Score', margin + 60, y);
    doc.text('Compliance', margin + 90, y);
    doc.text('Rating', margin + 130, y);
    y += 5;

    doc.setLineWidth(0.1);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    pillars.forEach((p) => {
      doc.text(p.label, margin + 5, y);
      doc.text(`${p.score} / ${p.maxScore}`, margin + 60, y);
      doc.text(`${p.percentage}%`, margin + 90, y);
      doc.text(p.rating, margin + 130, y);
      y += 6;
    });

    y += 6;

    // Strengths and Weaknesses
    checkPageBreak(50);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    doc.text('STRENGTHS & AREAS OF CONCERN', margin, y);
    y += 4;
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(22, 101, 52);
    doc.text('Overall Strengths:', margin, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    enhancedSummary.strengths.forEach((str) => {
      doc.text(`• ${str}`, margin + 3, y);
      y += 4.5;
    });

    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9);
    doc.text('Areas of Concern / Weaknesses:', margin, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    enhancedSummary.weaknesses.forEach((weak) => {
      doc.text(`• ${weak}`, margin + 3, y);
      y += 4.5;
    });

    y += 6;

    // Recommendations
    if (recommendations && recommendations.length > 0) {
      checkPageBreak(40);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      doc.text('CORRECTIVE ACTION RECOMMENDATIONS', margin, y);
      y += 4;
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;

      recommendations.forEach((rec, idx) => {
        checkPageBreak(25);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(50, 50, 50);
        doc.text(`${idx + 1}. [${rec.priority.toUpperCase()} ACTION] ${rec.problem}`, margin, y);
        y += 4.5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(80, 80, 80);
        
        const recText = doc.splitTextToSize(`Recommendation: ${rec.recommendation}`, pageWidth - (margin * 2) - 5);
        doc.text(recText, margin + 3, y);
        y += (recText.length * 4);

        const benefitText = `Expected Benefit: ${rec.expectedBenefit} | Est. Score Gain: +${rec.scoreGain} point(s)`;
        doc.text(benefitText, margin + 3, y);
        y += 7;
      });
    }

    // Detailed Question-by-Question Assessment Section
    checkPageBreak(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    doc.text('DETAILED QUESTION ASSESSMENT', margin, y);
    y += 4;
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    pillars.forEach((p) => {
      checkPageBreak(20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(26, 80, 54);
      doc.text(`${p.label.toUpperCase()} PILLAR (${p.score} / ${p.maxScore})`, margin, y);
      y += 5;

      p.questions.forEach((q, idx) => {
        const ratingEnum = q.score === 4 ? 'VERY_GOOD' :
                           q.score === 3 ? 'GOOD' :
                           q.score === 2 ? 'AVERAGE' :
                           q.score === 1 ? 'BAD' : 'VERY_BAD';

        // Question header
        const qNum = `${idx + 1}. `;
        const qHeader = `${qNum}${q.question}`;
        const qHeaderLines = doc.splitTextToSize(qHeader, pageWidth - (margin * 2) - 6);
        
        // Score & rating enum line
        const scoreRatingText = `Score: ${q.score}/4  |  Rating: ${ratingEnum}`;
        
        // Evidence & Reason lines
        const evidenceText = q.evidence ? `Evidence: ${q.evidence}` : 'Evidence: None recorded.';
        const reasonText = q.reason ? `Reasoning: ${q.reason}` : 'Reasoning: None recorded.';
        const evidenceLines = doc.splitTextToSize(evidenceText, pageWidth - (margin * 2) - 8);
        const reasonLines = doc.splitTextToSize(reasonText, pageWidth - (margin * 2) - 8);
        
        const blockHeight = (qHeaderLines.length * 4.5) + 5 + (evidenceLines.length * 4) + (reasonLines.length * 4) + 6;
        checkPageBreak(blockHeight);

        // Render question text
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(60, 60, 60);
        doc.text(qHeaderLines, margin + 2, y);
        y += (qHeaderLines.length * 4.5);

        // Render score & rating
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(26, 80, 54);
        doc.text(scoreRatingText, margin + 4, y);
        y += 4.5;

        // Render evidence
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 80);
        doc.text(evidenceLines, margin + 4, y);
        y += (evidenceLines.length * 4);

        // Render reason
        doc.text(reasonLines, margin + 4, y);
        y += (reasonLines.length * 4) + 4;
      });
      y += 2;
    });

    // Timeline Footer
    if (timeline) {
      checkPageBreak(35);
      y += 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      doc.text('AUDIT LOG TIMELINE', margin, y);
      y += 4;
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);

      const formatTS = (iso: string | null) => {
        if (!iso) return 'N/A';
        return new Date(iso).toLocaleString();
      };

      doc.text(`Image Uploaded: ${formatTS(timeline.imageUploaded)}`, margin + 2, y); y += 4;
      doc.text(`Validation Completed: ${formatTS(timeline.validationComplete)}`, margin + 2, y); y += 4;
      doc.text(`Audit Started: ${formatTS(timeline.auditStarted)}`, margin + 2, y); y += 4;
      doc.text(`Audit Completed: ${formatTS(timeline.auditCompleted)}`, margin + 2, y);
    }

    doc.save(`5S-Audit-Report-${areaInfo.areaName.replace(/\s+/g, '-')}-${areaInfo.auditDate.replace(/\s+/g, '-')}.pdf`);
  };


  return (
    <div className="space-y-8 font-sans">
      {/* 11. Audit Progress Stepper */}
      <AuditProgressStepper currentStep={6} />

      {/* Industrial Audit Header */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm print:border-none print:shadow-none">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary text-xl">
              AL
            </div>
            <div className="text-center sm:text-left">
              <h1 className="text-xl font-black tracking-tight text-foreground uppercase">
                ARCOLAB 5S Workplace Audit
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mt-0.5">
                Digital Auditor Compliance Report
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button
              onClick={handleDownloadPDF}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-all cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Download Report
            </button>
            <button
              onClick={() => setDevMode(!devMode)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                devMode
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              Dev Mode
            </button>
          </div>
        </div>

        {/* Area Information Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Company</p>
            <p className="font-bold text-foreground mt-0.5 truncate">{areaInfo.companyName}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Date Conducted</p>
            <p className="font-bold text-foreground mt-0.5">{areaInfo.auditDate}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Area / Workstation</p>
            <p className="font-bold text-foreground mt-0.5 truncate">{areaInfo.areaName}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Auditor</p>
            <p className="font-bold text-foreground mt-0.5 truncate">{areaInfo.auditor}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border/40 mt-4 text-xs">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Department</p>
            <p className="font-semibold text-foreground mt-0.5">{areaInfo.department}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Industry</p>
            <p className="font-semibold text-foreground mt-0.5">{areaInfo.industry}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Workspace Type</p>
            <p className="font-semibold text-foreground mt-0.5">{areaInfo.workspaceType}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Scoring Standard</p>
            <p className="font-semibold text-foreground mt-0.5">Physical Audit 5S (0-4 Rating)</p>
          </div>
        </div>
      </div>

      {/* 2. Executive Summary - Promoted to the top section of the report */}
      <div className="print:break-inside-avoid">
        <AuditSummaryCard summary={enhancedSummary} />
      </div>

      {/* 3. Interactive Pillar Navigation */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 no-print">
        {pillars.map((pillar) => (
          <PillarCard
            key={pillar.name}
            pillarKey={pillar.name as AuditPillar}
            label={pillar.label}
            jpName={pillar.jpName}
            score={pillar.score}
            maxScore={pillar.maxScore}
            percentage={pillar.percentage}
            rating={pillar.rating}
          />
        ))}
      </div>

      {/* Split layout: Sticky Image Preview + Detailed Assessments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* 4. Display the Uploaded Image During Assessment */}
        <div className="lg:col-span-1 lg:sticky lg:top-24 space-y-4 print:hidden">
          <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
                Workplace Audit Evidence
              </h4>
              <span className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                Audited State
              </span>
            </div>
            <div className="relative group overflow-hidden rounded-lg border border-border bg-muted">
              <img
                src={workplaceImage.replace(/^__geo:[^_]*__/, "")}
                alt="Audited Workspace"
                className="w-full h-auto max-h-96 object-contain rounded-lg transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed italic text-center">
              Verify questions below against this active visual record.
            </p>
          </div>
        </div>

        {/* Detailed Assessments */}
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between no-print">
              <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground">
                Detailed Pillar Checklist
              </h3>
              <span className="text-[10px] text-muted-foreground font-semibold">
                Click any row below to review observations
              </span>
            </div>
            {pillars.map((pillar) => (
              <PillarAssessment
                key={pillar.name}
                pillarKey={pillar.name as AuditPillar}
                label={pillar.label}
                jpName={pillar.jpName}
                score={pillar.score}
                maxScore={pillar.maxScore}
                percentage={pillar.percentage}
                rating={pillar.rating}
                questions={pillar.questions}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Print-only layout for Workplace Image */}
      <div className="hidden print:block space-y-3 my-8">
        <h4 className="text-xs font-black uppercase tracking-wider text-foreground border-b border-border pb-1">
          Workplace Image Audit Evidence
        </h4>
        <img
          src={workplaceImage.replace(/^__geo:[^_]*__/, "")}
          alt="Audited Workspace Evidence"
          className="w-full h-auto max-h-[400px] object-contain rounded-lg border border-border"
        />
      </div>

      {/* Overall score section */}
      <div className="print:break-inside-avoid">
        <AuditScoreCard
          score={overallScore}
          maxScore={overallMaxScore}
          percentage={overallPercentage}
          rating={overallRating}
        />
      </div>

      {/* Radar Chart */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch print:break-inside-avoid">
        <div className="md:col-span-1 flex flex-col justify-between space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex-1 flex flex-col justify-center">
            <h4 className="text-xs font-black uppercase tracking-wider text-foreground border-b border-border pb-2 mb-3">
              Score Breakdown
            </h4>
            <div className="space-y-3 text-xs">
              {pillars.map((p) => (
                <div key={p.name} className="flex justify-between items-center">
                  <span className="text-muted-foreground font-semibold">{p.label}</span>
                  <span className="font-mono font-bold text-foreground">{p.score} / 16</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="md:col-span-2">
          <RadarScoreChart pillars={pillars} />
        </div>
      </div>

      {/* Centralized Improvement Recommendations */}
      <div className="space-y-3 print:break-inside-avoid">
        <h3 className="text-sm font-black uppercase tracking-wider text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Improvement Recommendations
        </h3>
        <RecommendationCard recommendations={recommendations} />
      </div>

      {/* Audit Timeline */}
      {timeline && (
        <div className="print:break-inside-avoid">
          <AuditTimelineComponent timeline={timeline} />
        </div>
      )}

      {/* PDF Download Button */}
      <div className="flex gap-3 no-print">
        <button
          onClick={handleDownloadPDF}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-primary-foreground hover:bg-primary/90 transition-all shadow-md shadow-primary/10 cursor-pointer"
        >
          <Download className="h-5 w-5" />
          Download PDF Report
        </button>
      </div>

      {/* Developer Mode widgets */}
      {devMode && (
        <div className="bg-card border border-destructive/20 rounded-xl p-5 space-y-4 font-mono text-xs no-print">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h4 className="font-bold text-destructive flex items-center gap-1.5">
              <Terminal className="h-4 w-4" />
              AI Developer Telemetry
            </h4>
            <span className="bg-destructive/10 text-destructive text-[10px] px-2 py-0.5 rounded font-bold">
              DEV ONLY
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase">Vision Model</p>
              <p className="text-foreground mt-0.5 font-mono">{data.vision_model}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase">Prompt Version</p>
              <p className="text-foreground mt-0.5 font-mono">v{data.prompt_version}</p>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground font-bold uppercase">Raw JSON Payload</p>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto max-h-60 text-[10px] border border-border">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}