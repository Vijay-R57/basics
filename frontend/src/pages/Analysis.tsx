import { useState, useCallback, useEffect } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ImageUploader, { GeoMeta } from "@/components/ImageUploader";
import AnalysisResults from "@/components/AnalysisResults";
import WorkspaceContextCard, { WorkspaceContext } from "@/modules/audit/components/WorkspaceContextCard";
import ImageValidationPanel from "@/modules/audit/components/ImageValidationPanel";
import AuditExecutionPanel from "@/modules/audit/components/AuditExecutionPanel";
import AuditProgressStepper from "@/modules/audit/components/AuditProgressStepper";
import { AuditSessionState, SESSION_STATE_TO_STEP } from "@/modules/audit/types/sessionState";
import { Loader2, Sparkles, User, BadgeCheck, Building2, AlertTriangle, RotateCcw, Camera } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAnalysisPipeline } from "@/hooks/useAnalysisPipeline";
import arcolabLogoSrc from "@/assets/arcolab-logo.png";
import type { ImageValidationResult, AuditTimeline, AuditAnalysisResult } from "@/types/analysis";
import AdditionalAuditInfoPanel from "@/modules/audit/components/AdditionalAuditInfoPanel";
import { recalculateSessionScore, type AiRating } from "@/modules/audit/pipeline/scoreUtils";
import { getAllQuestions } from "@/modules/audit/pipeline/questions";

// Loads Arcolab logo as an Image element (cached after first load)
let cachedLogo: HTMLImageElement | null = null;
const loadArcolabLogo = (): Promise<HTMLImageElement> => {
  if (cachedLogo) return Promise.resolve(cachedLogo);
  return new Promise((resolve) => {
    const logo = new Image();
    logo.onload = () => { cachedLogo = logo; resolve(logo); };
    logo.onerror = () => resolve(logo);
    logo.src = arcolabLogoSrc;
  });
};

// Bakes employee name + office + zone + date + time (+ geo) + Arcolab logo as a watermark onto the image via canvas
const applyWatermark = (raw: string, employeeName: string, employeeId: string, officeName: string, zoneName?: string | null): Promise<string> => {
  // Parse geo prefix if present: "__geo:lat,lng:address__<base64>"
  let geoLine: string | null = null;
  let base64 = raw;
  const geoMatch = raw.match(/^__geo:([-\d.]+),([-\d.]+):([^_]*)__(.+)$/s);
  if (geoMatch) {
    const lat = parseFloat(geoMatch[1]).toFixed(5);
    const lng = parseFloat(geoMatch[2]).toFixed(5);
    const addr = geoMatch[3];
    geoLine = addr ? `📍 ${addr}` : `📍 ${lat}, ${lng}`;
    base64 = geoMatch[4];
  }

  return new Promise((resolve) => {
    Promise.all([loadArcolabLogo()]).then(([logo]) => {
      const img = new Image();
      img.onload = () => {
        const cw = img.naturalWidth;
        const ch = img.naturalHeight;

        const now = new Date();
        const day = String(now.getDate()).padStart(2, "0");
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = months[now.getMonth()];
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, "0");
        const mins = String(now.getMinutes()).padStart(2, "0");
        const secs = String(now.getSeconds()).padStart(2, "0");
        const dateStr = `${day} ${month} ${year}`;
        const timeStr = `${hours}:${mins}:${secs}`;

        const fontSize = Math.max(18, Math.min(32, Math.round(cw / 25)));
        const padding = Math.round(fontSize * 0.9);

        const lines: string[] = [
          `${employeeName}  |  ID: ${employeeId}`,
          `Office: ${officeName}${zoneName ? `  |  Zone: ${zoneName}` : ""}`,
          `${dateStr}  ${timeStr}`,
        ];
        if (geoLine) lines.push(geoLine);

        const logoH = Math.round(fontSize * 2.5);
        const logoW = logo.naturalWidth ? Math.round((logo.naturalWidth / logo.naturalHeight) * logoH) : logoH;
        const lineH = fontSize * 1.9;
        const stripH = padding + logoH + padding * 0.8 + lineH * lines.length + padding;

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch + stripH;
        const ctx = canvas.getContext("2d")!;

        ctx.drawImage(img, 0, 0, cw, ch);

        const stripY = ch;
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, stripY, cw, stripH);

        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        if (logo.naturalWidth) {
          const logoX = Math.round((cw - logoW) / 2);
          const logoY = stripY + padding;
          ctx.drawImage(logo, logoX, logoY, logoW, logoH);
        }

        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        const textStartY = stripY + padding + logoH + padding * 0.5;
        lines.forEach((line, i) => {
          ctx.fillText(line, cw / 2, textStartY + lineH * (i + 0.5));
        });
        ctx.textAlign = "left";

        resolve(canvas.toDataURL("image/jpeg", 0.88));
      };
      img.src = base64;
    });
  });
};

const Analysis = () => {
  const [sessionState, setSessionState] = useState<AuditSessionState>('SESSION_SETUP');
  
  // Workspace Context
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [workspaceType, setWorkspaceType] = useState<string>('General');
  const [industry, setIndustry] = useState<string>('');

  // Image State
  const [workplaceImage, setWorkplaceImage] = useState<string | null>(null);
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [imageGeo, setImageGeo] = useState<GeoMeta | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Validation Panel Result
  const [validationResult, setValidationResult] = useState<ImageValidationResult | null>(null);

  // Timestamps / Audit Timeline
  const [timeline, setTimeline] = useState<AuditTimeline>({
    imageUploaded: null,
    validationComplete: null,
    auditStarted: null,
    auditCompleted: null,
    reportGenerated: null,
  });

  const { toast } = useToast();
  const { employee, office } = useAuth();

  const officeName = office?.name ?? "Unknown Office";
  const { pipeline, results, analysisTimestamp, runAnalysis, saveAuditLog, reset } = useAnalysisPipeline(officeName);
  const loading = pipeline.stage !== "idle" && pipeline.stage !== "complete" && pipeline.stage !== "error";

  // Local results and pending questions states
  const [localResults, setLocalResults] = useState<AuditAnalysisResult | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<any[]>([]);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);

  const handleGeoDenied = useCallback(() => {
    setGeoError("Location access is required for 5S audit compliance. Please enable location permissions and try again.");
  }, []);

  // Pre-fill industry from employee profile department when component mounts or employee loads
  useEffect(() => {
    if (employee?.department && !industry) {
      setIndustry(employee.department);
    }
  }, [employee, industry]);

  // Dynamically apply watermark to raw image when context details change
  useEffect(() => {
    if (rawImage) {
      applyWatermark(rawImage, employee?.name ?? "Employee", employee?.employeeId ?? "", officeName, selectedZone)
        .then(setWorkplaceImage);
    } else {
      setWorkplaceImage(null);
    }
  }, [rawImage, selectedZone, employee, officeName]);

  const handleContextChange = useCallback((ctx: WorkspaceContext) => {
    setSelectedZone(ctx.selectedZone);
    setWorkspaceType(ctx.workspaceType);
    setIndustry(ctx.industry);
    setSessionState(prev => (prev === 'SESSION_SETUP' ? 'CONTEXT_READY' : prev));
  }, []);

  const handleWorkplaceImage = useCallback((img: string | null, geo?: GeoMeta | null) => {
    if (!img) {
      setRawImage(null);
      setWorkplaceImage(null);
      setImageGeo(null);
      setValidationResult(null);
      setTimeline({
        imageUploaded: null,
        validationComplete: null,
        auditStarted: null,
        auditCompleted: null,
        reportGenerated: null,
      });
      setSessionState('CONTEXT_READY');
      return;
    }

    if (img.startsWith("__geo_denied__")) {
      setGeoError("Location access required for audit. Please enable location and try again.");
      return;
    }

    setGeoError(null);
    setImageGeo(geo ?? null);
    setRawImage(img);
    setTimeline(prev => ({
      ...prev,
      imageUploaded: geo?.capturedAt ?? new Date().toISOString(),
    }));
    setSessionState('IMAGE_READY');
  }, []);

  const handleValidation = useCallback((res: ImageValidationResult) => {
    setValidationResult(res);
    if (res.passed) {
      setTimeline(prev => ({
        ...prev,
        validationComplete: new Date().toISOString(),
      }));
      setSessionState('IMAGE_VALIDATED');
    } else {
      setSessionState('IMAGE_READY');
    }
  }, []);

  const handleStartAudit = async () => {
    if (!workplaceImage || !selectedZone) {
      toast({
        title: "Missing Audit Context",
        description: "Please specify workplace details and upload a valid image.",
        variant: "destructive"
      });
      return;
    }

    const now = new Date().toISOString();
    setTimeline(prev => ({
      ...prev,
      auditStarted: now,
    }));
    setSessionState('AUDIT_RUNNING');

    try {
      await runAnalysis(workplaceImage, undefined, undefined, {
        selectedZone,
        workspaceType,
        industry,
        department: employee?.department,
        area_name: selectedZone,
      });
    } catch (err) {
      console.error("Audit start failed", err);
    }
  };

  // Sync completion stage and results mapping with state machine
  useEffect(() => {
    if (pipeline.stage === 'complete' && results && sessionState === 'AUDIT_RUNNING') {
      // Check for pending questions
      const pending = results.before.responses.filter(
        r => r.evidence === 'Cannot be determined from the provided image.'
      ).map(r => {
        const qDef = getAllQuestions().find(q => q.id === r.question_id);
        return {
          question_id: r.question_id,
          pillar: qDef?.pillar ?? 'SORT',
          question: qDef?.question ?? '',
          rating: 'AVERAGE',
          score: (r as any).score ?? 2,
          reason: r.evidence,
          evidence: r.evidence,
        };
      });

      if (pending.length === 0) {
        // No-Question Flow: immediately complete
        setLocalResults(results);
        const now = new Date().toISOString();
        setTimeline(prev => ({
          ...prev,
          auditCompleted: now,
          reportGenerated: now,
        }));
        setSessionState('AUDIT_COMPLETE');
      } else {
        // Pause before report generation, show questionnaire
        setPendingQuestions(pending);
        setShowQuestionnaire(true);
      }
    }
  }, [pipeline.stage, results, sessionState]);

  const handleFinishQuestionnaire = async (answers: Array<{ questionId: string; rating: AiRating; remarks: string }>) => {
    if (!results) return;

    const ratingToScoreMap: Record<AiRating, number> = {
      VERY_GOOD: 4,
      GOOD: 3,
      AVERAGE: 2,
      BAD: 1,
      VERY_BAD: 0,
    };

    // Update ONLY the affected questions, preserve all other questions
    const updatedResponses = results.before.responses.map(r => {
      const answer = answers.find(a => a.questionId === r.question_id);
      if (answer) {
        const score = ratingToScoreMap[answer.rating];
        const ai_answer = score >= 3 ? 'YES' : score === 2 ? 'PARTIAL' : 'NO';
        const reasonText = answer.remarks && answer.remarks.trim() !== ''
          ? answer.remarks.trim()
          : 'User confirmed this assessment during the additional audit questionnaire.';
        
        return {
          ...r,
          ai_answer,
          score,
          reason: reasonText,
          evidence: reasonText,
          evidenceSource: 'USER',
        };
      }
      return {
        ...r,
        evidenceSource: 'IMAGE', // preserve and explicitly set as IMAGE
      };
    });

    // Recalculate scores deterministically
    const recalculatedScore = recalculateSessionScore(updatedResponses);

    // Create the final results object
    const updatedResults: AuditAnalysisResult = {
      ...results,
      before: {
        score: recalculatedScore,
        responses: updatedResponses,
      },
    };

    // Save log using the updated result
    await saveAuditLog(updatedResults, workplaceImage!);

    // Update state to render results
    setLocalResults(updatedResults);
    setShowQuestionnaire(false);
    
    const now = new Date().toISOString();
    setTimeline(prev => ({
      ...prev,
      auditCompleted: now,
      reportGenerated: now,
    }));
    setSessionState('AUDIT_COMPLETE');
  };

  const handleNewAudit = () => {
    reset();
    setLocalResults(null);
    setPendingQuestions([]);
    setShowQuestionnaire(false);
    setRawImage(null);
    setWorkplaceImage(null);
    setImageGeo(null);
    setValidationResult(null);
    setTimeline({
      imageUploaded: null,
      validationComplete: null,
      auditStarted: null,
      auditCompleted: null,
      reportGenerated: null,
    });
    setSessionState('CONTEXT_READY');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 section-padding bg-background py-8">
        <div className="container-max">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header Title */}
            <div className="text-center">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-bold text-foreground mb-2">
                5S Workplace Audit
              </h1>
              <p className="text-muted-foreground max-w-xl mx-auto text-sm">
                Perform a structured visual 5S compliance audit of the current workspace condition.
              </p>
            </div>

            {/* Step Stepper */}
            <AuditProgressStepper currentStep={SESSION_STATE_TO_STEP[sessionState]} />

            {/* Geo error banner */}
            {geoError && (
              <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 rounded-xl p-4">
                <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Location Access Required</p>
                  <p className="text-xs text-destructive/80 mt-0.5">{geoError}</p>
                </div>
              </div>
            )}

            {/* Step 1: Session Information */}
            {employee && (
              <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide font-semibold">Session Info</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-heading font-bold text-foreground">{employee.name}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <BadgeCheck className="h-4 w-4 text-primary flex-shrink-0" />
                        <span>ID: <span className="font-medium text-foreground">{employee.employeeId}</span></span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-4 w-4 text-primary flex-shrink-0" />
                        <span>Dept: <span className="font-medium text-foreground">{employee.department}</span></span>
                      </div>
                    </div>
                  </div>
                  {office && (
                    <div className="flex items-start gap-3 sm:border-l sm:border-border sm:pl-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide font-bold">Selected Office</p>
                        <p className="text-sm font-semibold text-foreground leading-snug">{office.name}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Workspace Context Selection */}
            {employee && !showQuestionnaire && (
              <WorkspaceContextCard
                defaultIndustry={employee.department || ''}
                onContextChange={handleContextChange}
              />
            )}

            {/* Step 3: Upload Current Workplace Image */}
            {sessionState !== 'SESSION_SETUP' && !showQuestionnaire && (
              <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="text-sm font-black text-foreground flex items-center gap-2">
                    <Camera className="h-4 w-4 text-primary" />
                    Upload Current Workplace Image
                  </h3>
                </div>
                <ImageUploader
                  label="Workplace Image"
                  sublabel="Geotagged image of the active workstation"
                  variant="workplace"
                  image={workplaceImage}
                  onImageChange={handleWorkplaceImage}
                  employeeName={employee?.name ?? "Employee"}
                  officeName={officeName}
                  zoneName={selectedZone || "Unspecified Zone"}
                  onGeoDenied={handleGeoDenied}
                />
              </div>
            )}

            {/* Step 4: Image Quality Validation */}
            {workplaceImage && (sessionState === 'IMAGE_READY' || sessionState === 'IMAGE_VALIDATED') && !showQuestionnaire && (
              <ImageValidationPanel
                imageBase64={workplaceImage}
                onValidation={handleValidation}
              />
            )}

            {/* Step 5: Action Button (Start / Reset) */}
            {sessionState !== 'SESSION_SETUP' && !showQuestionnaire && (
              <div className="flex gap-3">
                {sessionState !== 'AUDIT_COMPLETE' ? (
                  <button
                    onClick={handleStartAudit}
                    disabled={sessionState !== 'IMAGE_VALIDATED' || loading}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {pipeline.message || "Auditing workspace…"}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-5 w-5" />
                        Start 5S Audit
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleNewAudit}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-border px-6 py-4 text-base font-bold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <RotateCcw className="h-5 w-5" />
                    New Audit
                  </button>
                )}
              </div>
            )}

            {/* Progress Panel */}
            {sessionState === 'AUDIT_RUNNING' && !showQuestionnaire && (
              <AuditExecutionPanel pipeline={pipeline} results={results} />
            )}

            {/* Questionnaire Panel */}
            {showQuestionnaire && pendingQuestions.length > 0 && (
              <div className="pt-4 animate-fade-in">
                <AdditionalAuditInfoPanel
                  pendingQuestions={pendingQuestions}
                  onFinish={handleFinishQuestionnaire}
                />
              </div>
            )}

            {/* Step 6 & 7: Audit Report & Results */}
            {localResults && workplaceImage && (sessionState === 'AUDIT_COMPLETE' || sessionState === 'REPORT_READY') && (
              <div className="animate-fade-in pt-4">
                <AnalysisResults
                  data={localResults}
                  workplaceImage={workplaceImage}
                  analysisTimestamp={analysisTimestamp || undefined}
                  imageQualityScore={validationResult?.qualityScore}
                  imageQualityLevel={validationResult?.qualityLevel}
                  timeline={timeline}
                />
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Analysis;
