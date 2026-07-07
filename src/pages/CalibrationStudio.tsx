import { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  Wrench,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Undo2,
  Redo2,
  RotateCcw,
  Copy,
  Sliders,
  Code,
  Activity,
  ShieldAlert,
  Eye,
  Check,
  X,
  FileDown,
  FileUp,
  Image,
  Layers,
  Sparkles,
  Info
} from "lucide-react";
import { toast } from "sonner";

// Import audit engine artifacts relatively
import { getAllQuestionEvalConfigs } from "../../supabase/functions/analyze-5s/audit-engine/QuestionEvaluationRegistry";
import { getAllCapabilities } from "../../supabase/functions/analyze-5s/audit-engine/EvidenceCapabilityMatrix";
import { EvidenceFilterService } from "../../supabase/functions/analyze-5s/audit-engine/EvidenceFilterService";
import { EvidenceCoverageService } from "../../supabase/functions/analyze-5s/audit-engine/EvidenceCoverageService";
import { PromptBuilder } from "../../supabase/functions/analyze-5s/audit-engine/PromptBuilder";
import { RATING_TO_SCORE } from "../../supabase/functions/analyze-5s/audit-engine/types";
import type {
  QuestionEvaluationConfig,
  EvidenceCapabilityEntry,
  AuditEvidenceModel,
  VisibleObject,
  PositiveObservation,
  ViolationObservation,
  AuditRating,
  EvidenceConfidence,
  EvidenceCoverage,
  FilteredEvidenceModel
} from "../../supabase/functions/analyze-5s/audit-engine/types";

// Common rating ordering for comparison helpers
const RATING_ORDER: AuditRating[] = ["Very Bad", "Bad", "Average", "Good", "Very Good"];

function getBetterRating(r1: AuditRating, r2: AuditRating): AuditRating {
  if (r1 === "NOT_VISIBLE" || r2 === "NOT_VISIBLE") return r1 === "NOT_VISIBLE" ? r2 : r1;
  const idx1 = RATING_ORDER.indexOf(r1);
  const idx2 = RATING_ORDER.indexOf(r2);
  return idx1 > idx2 ? r1 : r2;
}

function getWorseRating(r1: AuditRating, r2: AuditRating): AuditRating {
  if (r1 === "NOT_VISIBLE" || r2 === "NOT_VISIBLE") return "NOT_VISIBLE";
  const idx1 = RATING_ORDER.indexOf(r1);
  const idx2 = RATING_ORDER.indexOf(r2);
  return idx1 < idx2 ? r1 : r2;
}

// ── Default Mock Data ────────────────────────────────────────────────────────
const DEFAULT_ZONE_KNOWLEDGE = {
  zoneName: "Assembly Line 03",
  expectedEquipment: ["workbenches", "tool racks", "cleaning carts", "parts bins"],
  expectedDocuments: ["SOP sheets", "5S board", "maintenance checklists"],
  expectedSafetyAssets: ["fire extinguishers", "eyewash stations", "safety goggles", "first aid kits"],
  expectedLayout: ["aisle lines", "walkway boundaries", "pallet tape markings"],
  expectedVisualControls: ["location labels", "shadow boards", "status lights"],
  expectedCleanliness: ["clean floors", "dust-free shelves", "spill-free surfaces"],
  expectedStoragePractices: ["FIFO bins", "labeled inventory racks"]
};

const INITIAL_EVIDENCE: AuditEvidenceModel = {
  generatedAt: new Date().toISOString(),
  zone: "Assembly Line 03",
  expectedObjects: ["labels", "floor markings", "cleaning tools", "SOP", "safety goggles"],
  visibleObjects: [
    { description: "labeled bins", category: "A", observationType: "DIRECT" },
    { description: "yellow floor markings", category: "B", observationType: "DIRECT" },
    { description: "cleaning tools on floor", category: "C", observationType: "DIRECT" },
    { description: "dust on shelves", category: "C", observationType: "DIRECT" },
    { description: "discarded wrapper", category: "D", observationType: "DIRECT" }
  ],
  positiveCompliance: [
    { dimension: "layout", observation: "Yellow floor lines mark out aisles clearly", observationType: "DIRECT", confidence: "HIGH" },
    { dimension: "labelling", observation: "All primary equipment have clear label stickers", observationType: "DIRECT", confidence: "HIGH" }
  ],
  violations: [
    { dimension: "cleanliness", observation: "Accumulated dust and debris on lower shelf of Station 3", severity: "MINOR", evidence: "dust on shelves", imageLocation: "station 3 shelf", observationType: "DIRECT", confidence: "HIGH" },
    { dimension: "sorting", observation: "Cardboard trash and plastic wrap discarded in walkway", severity: "MODERATE", evidence: "discarded wrapper", imageLocation: "walkway", observationType: "DIRECT", confidence: "HIGH" },
    { dimension: "setInOrder", observation: "Broom and dustpan left lying in walkway instead of shadow board", severity: "MINOR", evidence: "cleaning tools on floor", imageLocation: "floor", observationType: "DIRECT", confidence: "HIGH" }
  ],
  overallConfidence: "HIGH",
  imageNotes: "Clear visibility, minor dust and loose items detected."
};

// Reusable stepper structures
interface ReplayStep {
  title: string;
  description: string;
  status: "success" | "warning" | "error" | "neutral";
  details: string[];
}

export default function CalibrationStudio() {
  // Static Production Configurations
  const prodRegistry = useMemo(() => getAllQuestionEvalConfigs(), []);
  const prodECM = useMemo(() => getAllCapabilities(), []);

  // Workspace configuration state
  const [zoneKnowledge, setZoneKnowledge] = useState(DEFAULT_ZONE_KNOWLEDGE);

  // Active state: selected question ID
  const [selectedQuestionId, setSelectedQuestionId] = useState("SORT-01");

  // Experimental state - clones of the config
  const [expRegistry, setExpRegistry] = useState<QuestionEvaluationConfig[]>([]);
  const [expECM, setExpECM] = useState<EvidenceCapabilityEntry[]>([]);

  // Raw observation cache (Synthetic observations / Test mode)
  const [evidence, setEvidence] = useState<AuditEvidenceModel>(INITIAL_EVIDENCE);

  // Undo/Redo Version History Stacks
  const [history, setHistory] = useState<Array<{ registry: QuestionEvaluationConfig[]; ecm: EvidenceCapabilityEntry[]; label: string }>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Layout selection / active sub-tabs
  const [rightPanelTab, setRightPanelTab] = useState<"replay" | "ecm" | "qer" | "prompt">("replay");
  const [isExperimentalMode, setIsExperimentalMode] = useState(true);

  // Synthetic object creator modal/form state
  const [newObjectType, setNewObjectType] = useState<"object" | "positive" | "violation">("object");
  // Form fields
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState<"A" | "B" | "C" | "D" | "UNKNOWN">("C");
  const [formObsType, setFormObsType] = useState<"DIRECT" | "INFERENCE">("DIRECT");
  const [formDimension, setFormDimension] = useState("layout");
  const [formSeverity, setFormSeverity] = useState<"MINOR" | "MODERATE" | "MAJOR" | "CRITICAL">("MINOR");
  const [formEvidenceRef, setFormEvidenceRef] = useState("");

  // Initialize clones on load
  useEffect(() => {
    const regClone = JSON.parse(JSON.stringify(prodRegistry));
    const ecmClone = JSON.parse(JSON.stringify(prodECM));
    setExpRegistry(regClone);
    setExpECM(ecmClone);

    // Initial history state
    setHistory([{ registry: regClone, ecm: ecmClone, label: "Initial cloned state" }]);
    setHistoryIndex(0);
  }, [prodRegistry, prodECM]);

  // Helper to commit state edits to the history stack
  const commitChange = (updatedReg: QuestionEvaluationConfig[], updatedECM: EvidenceCapabilityEntry[], label: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    const registryCopy = JSON.parse(JSON.stringify(updatedReg));
    const ecmCopy = JSON.parse(JSON.stringify(updatedECM));
    setHistory([...newHistory, { registry: registryCopy, ecm: ecmCopy, label }]);
    setHistoryIndex(newHistory.length);
    setExpRegistry(registryCopy);
    setExpECM(ecmCopy);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setExpRegistry(JSON.parse(JSON.stringify(prev.registry)));
      setExpECM(JSON.parse(JSON.stringify(prev.ecm)));
      setHistoryIndex(historyIndex - 1);
      toast.success(`Undone: ${history[historyIndex].label}`);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setExpRegistry(JSON.parse(JSON.stringify(next.registry)));
      setExpECM(JSON.parse(JSON.stringify(next.ecm)));
      setHistoryIndex(historyIndex + 1);
      toast.success(`Redone: ${next.label}`);
    }
  };

  const handleReset = () => {
    const regClone = JSON.parse(JSON.stringify(prodRegistry));
    const ecmClone = JSON.parse(JSON.stringify(prodECM));
    setExpRegistry(regClone);
    setExpECM(ecmClone);
    commitChange(regClone, ecmClone, "Reset to production configurations");
    toast.success("Experimental configurations reset to baseline production.");
  };

  // ── Find Question Configs Helper ──────────────────────────────────────────
  const activeQerProd = useMemo(() => prodRegistry.find(q => q.questionId === selectedQuestionId)!, [prodRegistry, selectedQuestionId]);
  const activeEcmProd = useMemo(() => prodECM.find(e => e.questionId === selectedQuestionId)!, [prodECM, selectedQuestionId]);

  const activeQerExp = useMemo(() => expRegistry.find(q => q.questionId === selectedQuestionId), [expRegistry, selectedQuestionId]);
  const activeEcmExp = useMemo(() => expECM.find(e => e.questionId === selectedQuestionId), [expECM, selectedQuestionId]);

  // Evaluated results for current question
  const prodEvaluation = useMemo(() => {
    return evaluateInMemory(selectedQuestionId, activeQerProd, activeEcmProd, evidence);
  }, [selectedQuestionId, activeQerProd, activeEcmProd, evidence]);

  const expEvaluation = useMemo(() => {
    if (!activeQerExp || !activeEcmExp) return prodEvaluation;
    return evaluateInMemory(selectedQuestionId, activeQerExp, activeEcmExp, evidence);
  }, [selectedQuestionId, activeQerExp, activeEcmExp, evidence, prodEvaluation]);

  // Question lists for selector dashboard
  const allQuestionStatuses = useMemo(() => {
    return prodRegistry.map(prodQ => {
      const expQ = expRegistry.find(q => q.questionId === prodQ.questionId);
      const prodE = prodECM.find(e => e.questionId === prodQ.questionId)!;
      const expE = expECM.find(e => e.questionId === prodQ.questionId);

      const pResult = evaluateInMemory(prodQ.questionId, prodQ, prodE, evidence);
      const eResult = expQ && expE ? evaluateInMemory(prodQ.questionId, expQ, expE, evidence) : pResult;

      return {
        questionId: prodQ.questionId,
        questionText: prodQ.questionText,
        pillar: prodQ.pillar,
        prodRating: pResult.rating,
        expRating: eResult.rating,
        prodCoverage: pResult.coverage.coveragePercentage,
        expCoverage: eResult.coverage.coveragePercentage,
        prodConfidence: pResult.confidence,
        expConfidence: eResult.confidence,
        hasChanged: JSON.stringify(prodQ) !== JSON.stringify(expQ) || JSON.stringify(prodE) !== JSON.stringify(expE)
      };
    });
  }, [prodRegistry, expRegistry, prodECM, expECM, evidence]);

  // ── Patch Generator Logic ──────────────────────────────────────────────────
  const generatedPatch = useMemo(() => {
    if (expRegistry.length === 0 || expECM.length === 0) return "";

    const qerPatches: Record<string, Partial<QuestionEvaluationConfig>> = {};
    const ecmPatches: Record<string, Partial<EvidenceCapabilityEntry>> = {};

    expRegistry.forEach((expQ, idx) => {
      const prodQ = prodRegistry[idx];
      const diff: Partial<QuestionEvaluationConfig> = {};
      let changed = false;

      // Deep compare fields
      for (const key in expQ) {
        const k = key as keyof QuestionEvaluationConfig;
        if (JSON.stringify(expQ[k]) !== JSON.stringify(prodQ[k])) {
          (diff as any)[k] = expQ[k];
          changed = true;
        }
      }
      if (changed) {
        qerPatches[expQ.questionId] = diff;
      }
    });

    expECM.forEach((expE, idx) => {
      const prodE = prodECM[idx];
      const diff: Partial<EvidenceCapabilityEntry> = {};
      let changed = false;

      // Deep compare fields
      for (const key in expE) {
        const k = key as keyof EvidenceCapabilityEntry;
        if (JSON.stringify(expE[k]) !== JSON.stringify(prodE[k])) {
          (diff as any)[k] = expE[k];
          changed = true;
        }
      }
      if (changed) {
        ecmPatches[expE.questionId] = diff;
      }
    });

    return JSON.stringify({
      patchVersion: "1.0",
      generatedAt: new Date().toISOString(),
      questionEvaluationRegistry: qerPatches,
      evidenceCapabilityMatrix: ecmPatches
    }, null, 2);
  }, [expRegistry, expECM, prodRegistry, prodECM]);

  // ── Synthetic Cache Handlers ──────────────────────────────────────────────
  const handleAddSynthetic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDesc.trim()) {
      toast.error("Please provide a description");
      return;
    }

    const updated = { ...evidence };
    if (newObjectType === "object") {
      updated.visibleObjects = [
        ...updated.visibleObjects,
        {
          description: formDesc,
          category: formCategory,
          observationType: formObsType
        }
      ];
      toast.success(`Added visible object: ${formDesc}`);
    } else if (newObjectType === "positive") {
      updated.positiveCompliance = [
        ...updated.positiveCompliance,
        {
          dimension: formDimension,
          observation: formDesc,
          observationType: "DIRECT",
          confidence: "HIGH"
        }
      ];
      toast.success(`Added compliance finding: ${formDesc}`);
    } else {
      updated.violations = [
        ...updated.violations,
        {
          dimension: formDimension,
          observation: formDesc,
          severity: formSeverity,
          evidence: formEvidenceRef || formDesc,
          imageLocation: "synthetic",
          observationType: "DIRECT",
          confidence: "HIGH"
        }
      ];
      toast.success(`Added violation: ${formDesc}`);
    }

    setEvidence(updated);
    setFormDesc("");
    setFormEvidenceRef("");
  };

  const handleRemoveObject = (idx: number) => {
    const updated = { ...evidence };
    updated.visibleObjects = updated.visibleObjects.filter((_, i) => i !== idx);
    setEvidence(updated);
    toast.success("Removed object from workspace cache");
  };

  const handleRemovePositive = (idx: number) => {
    const updated = { ...evidence };
    updated.positiveCompliance = updated.positiveCompliance.filter((_, i) => i !== idx);
    setEvidence(updated);
    toast.success("Removed positive compliance finding");
  };

  const handleRemoveViolation = (idx: number) => {
    const updated = { ...evidence };
    updated.violations = updated.violations.filter((_, i) => i !== idx);
    setEvidence(updated);
    toast.success("Removed violation");
  };

  // ── QER Editor handlers ─────────────────────────────────────────────────────
  const handleUpdateQERField = (field: keyof QuestionEvaluationConfig, val: any) => {
    if (!activeQerExp) return;
    const updated = expRegistry.map(q => {
      if (q.questionId === selectedQuestionId) {
        return { ...q, [field]: val };
      }
      return q;
    });
    commitChange(updated, expECM, `Update QER field ${field} for ${selectedQuestionId}`);
  };

  const handleUpdateThreshold = (severity: "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL", key: "triggersAt" | "ratingCap", val: any) => {
    if (!activeQerExp) return;
    const updated = expRegistry.map(q => {
      if (q.questionId === selectedQuestionId) {
        const nextThresholds = { ...q.thresholds };
        nextThresholds[severity] = { ...nextThresholds[severity], [key]: val };
        return { ...q, thresholds: nextThresholds };
      }
      return q;
    });
    commitChange(updated, expECM, `Update threshold ${severity}.${key} for ${selectedQuestionId}`);
  };

  const handleUpdatePositiveInfluence = (key: string, val: any) => {
    if (!activeQerExp) return;
    const updated = expRegistry.map(q => {
      if (q.questionId === selectedQuestionId) {
        return {
          ...q,
          positiveInfluence: {
            ...q.positiveInfluence,
            [key]: val
          }
        };
      }
      return q;
    });
    commitChange(updated, expECM, `Update positive influence ${key} for ${selectedQuestionId}`);
  };

  // Step procedures handlers
  const handleUpdateStep = (stepIdx: number, field: string, val: any) => {
    if (!activeQerExp) return;
    const updated = expRegistry.map(q => {
      if (q.questionId === selectedQuestionId) {
        const nextProcedures = [...q.inspectionProcedure];
        nextProcedures[stepIdx] = { ...nextProcedures[stepIdx], [field]: val };
        return { ...q, inspectionProcedure: nextProcedures };
      }
      return q;
    });
    commitChange(updated, expECM, `Edit inspection step ${stepIdx + 1} for ${selectedQuestionId}`);
  };

  const handleAddStep = () => {
    if (!activeQerExp) return;
    const updated = expRegistry.map(q => {
      if (q.questionId === selectedQuestionId) {
        const stepNum = q.inspectionProcedure.length + 1;
        return {
          ...q,
          inspectionProcedure: [
            ...q.inspectionProcedure,
            { step: stepNum, action: "New step procedure description...", expectedOutcome: "Outcome details..." }
          ]
        };
      }
      return q;
    });
    commitChange(updated, expECM, `Add step to inspection procedures for ${selectedQuestionId}`);
  };

  const handleRemoveStep = (stepIdx: number) => {
    if (!activeQerExp) return;
    const updated = expRegistry.map(q => {
      if (q.questionId === selectedQuestionId) {
        const nextProcedures = q.inspectionProcedure
          .filter((_, i) => i !== stepIdx)
          .map((step, idx) => ({ ...step, step: idx + 1 }));
        return { ...q, inspectionProcedure: nextProcedures };
      }
      return q;
    });
    commitChange(updated, expECM, `Remove inspection step ${stepIdx + 1} for ${selectedQuestionId}`);
  };

  // ── ECM Editor handlers ─────────────────────────────────────────────────────
  const handleUpdateECMField = (field: keyof EvidenceCapabilityEntry, rawVal: string) => {
    if (!activeEcmExp) return;
    const list = rawVal.split(",").map(s => s.trim()).filter(Boolean);
    const updated = expECM.map(e => {
      if (e.questionId === selectedQuestionId) {
        return { ...e, [field]: list };
      }
      return e;
    });
    commitChange(expRegistry, updated, `Update ECM array ${field} for ${selectedQuestionId}`);
  };

  // Import / Export patches
  const handleExportPatchFile = () => {
    const element = document.createElement("a");
    const file = new Blob([generatedPatch], { type: "application/json" });
    element.href = URL.createObjectURL(file);
    element.download = `5s-calibration-patch-${selectedQuestionId.toLowerCase()}-${Date.now()}.json`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Patch exported successfully!");
  };

  const handleImportPatch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed.patchVersion !== "1.0") {
            throw new Error("Invalid patch version (must be 1.0)");
          }

          let regUpdated = [...expRegistry];
          let ecmUpdated = [...expECM];

          if (parsed.questionEvaluationRegistry) {
            regUpdated = expRegistry.map(q => {
              const qPatch = parsed.questionEvaluationRegistry[q.questionId];
              if (qPatch) {
                return { ...q, ...qPatch };
              }
              return q;
            });
          }

          if (parsed.evidenceCapabilityMatrix) {
            ecmUpdated = expECM.map(e => {
              const ePatch = parsed.evidenceCapabilityMatrix[e.questionId];
              if (ePatch) {
                return { ...e, ...ePatch };
              }
              return e;
            });
          }

          commitChange(regUpdated, ecmUpdated, "Import configuration patch");
          toast.success("Configuration patch imported and loaded!");
        } catch (err: any) {
          toast.error(`Import failed: ${err.message}`);
        }
      };
    }
  };

  // Copy patch helper
  const handleCopyPatch = () => {
    navigator.clipboard.writeText(generatedPatch);
    toast.success("Patch copied to clipboard!");
  };

  // Active configs & evaluation
  const activeQer = isExperimentalMode ? activeQerExp || activeQerProd : activeQerProd;
  const activeEcm = isExperimentalMode ? activeEcmExp || activeEcmProd : activeEcmProd;
  const activeEval = isExperimentalMode ? expEvaluation : prodEvaluation;

  // ── Evidence Inspector Details ─────────────────────────────────────────────
  // Computes allowed/forbidden status for every observed object in workspace
  const inspectedObjects = useMemo(() => {
    if (!activeEcm) return [];

    return evidence.visibleObjects.map(obj => {
      // Find questions using this object
      const usingQuestions = expRegistry.filter(q => {
        const entry = expECM.find(e => e.questionId === q.questionId);
        if (!entry) return false;
        return (
          entry.requiredObjectTypes.includes(obj.description) ||
          entry.primaryEvidence.includes(obj.description) ||
          entry.supportingEvidence.includes(obj.description)
        );
      }).map(q => q.questionId);

      const filtered = EvidenceFilterService.filterForQuestion(selectedQuestionId, {
        ...evidence,
        visibleObjects: [obj]
      }, activeEcm);

      const isAllowed = filtered.allowedObjects.length > 0;
      let reason = "Forbidden object category or not registered in ECM for this question";
      let weight = 0.0;

      if (isAllowed) {
        const isPrimary = activeEcm.primaryEvidence.some(pri =>
          EvidenceFilterService.threeStageMatch(obj.description, pri, activeEcm.objectAliases)
        );
        const isSupporting = activeEcm.supportingEvidence.some(sup =>
          EvidenceFilterService.threeStageMatch(obj.description, sup, activeEcm.objectAliases)
        );

        if (isPrimary) {
          weight = 1.0;
          reason = "Allowed Primary Evidence (Weight 1.0)";
        } else if (isSupporting) {
          weight = 0.7;
          reason = "Allowed Supporting Evidence (Weight 0.7)";
        } else {
          weight = 0.4; // context only / default allowed
          reason = "Allowed Contextual Evidence (Weight 0.4)";
        }
      } else {
        const isForbidden = activeEcm.forbiddenObjectTypes.some(forb =>
          EvidenceFilterService.threeStageMatch(obj.description, forb, activeEcm.objectAliases)
        );
        if (isForbidden) {
          reason = "Explicitly Forbidden Element (Must NOT influence rating)";
        }
      }

      return {
        name: obj.description,
        category: obj.category,
        isAllowed,
        reason,
        weight,
        usingQuestions
      };
    });
  }, [evidence, activeEcm, selectedQuestionId, expRegistry, expECM]);

  // ── Prompt Preview Generator ──────────────────────────────────────────────
  const renderedPromptPreview = useMemo(() => {
    if (!activeQer || !activeEcm) return "";
    const filtered = EvidenceFilterService.filterForQuestion(selectedQuestionId, evidence, activeEcm);
    return PromptBuilder.buildSingleQuestionPrompt(
      {
        questionId: activeQer.questionId,
        questionType: activeQer.questionType as any,
        evidenceCategory: activeQer.evidenceCategory as any,
        decisionStrategy: activeQer.decisionStrategy,
        forbiddenEvidence: activeQer.forbiddenEvidence
      },
      activeQer,
      activeEcm,
      filtered,
      null
    );
  }, [selectedQuestionId, activeQer, activeEcm, evidence]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar />

      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider">
              Internal Dev Tool
            </span>
            <span className="text-slate-500 text-xs">Engine v5.0</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
            5S Audit Calibration Studio
          </h1>
          <p className="text-sm text-slate-400">
            Interactive workspace to calibrate, edit and test QER/ECM reasoning paths in-memory.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* History undo/redo controls */}
          <div className="flex bg-slate-800 rounded-md border border-slate-700 p-0.5 mr-2">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-1.5 hover:bg-slate-700 rounded text-slate-300 disabled:opacity-40"
              title="Undo modification"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 hover:bg-slate-700 rounded text-slate-300 disabled:opacity-40"
              title="Redo modification"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs px-3 py-2 rounded-md font-medium transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Config
          </button>

          <label className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs px-3 py-2 rounded-md font-medium cursor-pointer transition">
            <FileUp className="h-3.5 w-3.5" />
            Import Patch
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportPatch}
            />
          </label>

          <button
            onClick={handleExportPatchFile}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-2 rounded-md font-medium transition"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export Patch
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="flex-1 p-6 grid grid-cols-1 xl:grid-cols-12 gap-6 overflow-hidden">

        {/* Left column (xl:span-4) - Panel 1: Image, Observations, Test Mode */}
        <section className="xl:col-span-4 flex flex-col gap-6">
          {/* Active Configuration View Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-slate-300">Evaluating Configuration:</span>
            <div className="flex bg-slate-950 p-1 rounded-md border border-slate-800">
              <button
                onClick={() => setIsExperimentalMode(false)}
                className={`text-xs px-3 py-1.5 rounded transition ${
                  !isExperimentalMode
                    ? "bg-slate-800 text-slate-100 font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Production (Immutable)
              </button>
              <button
                onClick={() => setIsExperimentalMode(true)}
                className={`text-xs px-3 py-1.5 rounded transition ${
                  isExperimentalMode
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Experimental (Editable)
              </button>
            </div>
          </div>

          {/* Workspace Image / Synthetic Setup */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
            <div className="bg-slate-850 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Image className="h-4 w-4 text-indigo-400" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">Workspace Viewer</span>
              </div>
              <span className="text-xs text-slate-400 bg-slate-950 border border-slate-850 px-2 py-0.5 rounded">
                Zone: {zoneKnowledge.zoneName}
              </span>
            </div>

            {/* Interactive Area Image Placeholder */}
            <div className="h-48 bg-slate-950 flex flex-col justify-center items-center p-4 text-center relative border-b border-slate-850">
              <img
                src="/lovable-uploads/ed1f29a2-5ca0-4ccd-a9e2-1577c80d61b6.png"
                alt="Workspace Standard"
                className="w-full h-full object-cover rounded opacity-40 absolute inset-0 pointer-events-none"
              />
              <div className="relative z-10 space-y-1">
                <p className="text-xs text-slate-300 font-semibold">Loaded Workspace Image: Standard Assembly Area</p>
                <p className="text-[10px] text-slate-400">Default synthetic observations injected in-memory</p>
              </div>
            </div>

            {/* Observation Editor / Test Mode (Synthetic observations) */}
            <div className="p-4 flex-1 flex flex-col gap-4">
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Synthetic Observations Editor (Question Test Mode)
                </h3>
                <div className="border border-slate-800 rounded-md p-3 bg-slate-950">
                  <form onSubmit={handleAddSynthetic} className="space-y-3">
                    <div className="flex gap-2">
                      <select
                        value={newObjectType}
                        onChange={(e) => setNewObjectType(e.target.value as any)}
                        className="bg-slate-900 border border-slate-850 text-xs text-slate-200 rounded p-1.5 flex-1"
                      >
                        <option value="object">Visible Object</option>
                        <option value="positive">Compliance Indicator</option>
                        <option value="violation">Violation Item</option>
                      </select>

                      {newObjectType === "object" && (
                        <select
                          value={formCategory}
                          onChange={(e) => setFormCategory(e.target.value as any)}
                          className="bg-slate-900 border border-slate-850 text-xs text-slate-200 rounded p-1.5"
                          title="Object Category"
                        >
                          <option value="A">Category A (Expected)</option>
                          <option value="B">Category B (Support)</option>
                          <option value="C">Category C (Temporary)</option>
                          <option value="D">Category D (Unnecessary)</option>
                          <option value="UNKNOWN">UNKNOWN</option>
                        </select>
                      )}

                      {newObjectType === "violation" && (
                        <select
                          value={formSeverity}
                          onChange={(e) => setFormSeverity(e.target.value as any)}
                          className="bg-slate-900 border border-slate-850 text-xs text-slate-200 rounded p-1.5"
                          title="Violation Severity"
                        >
                          <option value="MINOR">Minor</option>
                          <option value="MODERATE">Moderate</option>
                          <option value="MAJOR">Major</option>
                          <option value="CRITICAL">Critical</option>
                        </select>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={
                          newObjectType === "object"
                            ? "e.g. green chemical drum"
                            : newObjectType === "positive"
                            ? "e.g. Shadow board completely populated"
                            : "e.g. Blocked emergency egress hallway"
                        }
                        value={formDesc}
                        onChange={(e) => setFormDesc(e.target.value)}
                        className="bg-slate-900 border border-slate-850 text-xs text-slate-200 rounded p-1.5 flex-1"
                      />
                      <button
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 rounded flex items-center gap-1 transition"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add
                      </button>
                    </div>

                    {newObjectType === "violation" && (
                      <input
                        type="text"
                        placeholder="Associated Object Name (Reference)"
                        value={formEvidenceRef}
                        onChange={(e) => setFormEvidenceRef(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-850 text-xs text-slate-200 rounded p-1.5"
                      />
                    )}
                  </form>
                </div>
              </div>

              {/* Observed cache listing */}
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {/* Visible Objects */}
                <div>
                  <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">
                    Visible Objects ({evidence.visibleObjects.length})
                  </h4>
                  <div className="space-y-1">
                    {evidence.visibleObjects.map((obj, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs bg-slate-950/60 hover:bg-slate-950 px-2.5 py-1 rounded border border-slate-850">
                        <span className="text-slate-300 font-mono">
                          [{obj.category}] {obj.description}
                        </span>
                        <button onClick={() => handleRemoveObject(idx)} className="text-slate-500 hover:text-red-400 transition">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Compliance Indicators */}
                <div>
                  <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                    Compliance Indicators ({evidence.positiveCompliance.length})
                  </h4>
                  <div className="space-y-1">
                    {evidence.positiveCompliance.map((pos, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs bg-slate-950/60 hover:bg-slate-950 px-2.5 py-1 rounded border border-slate-850">
                        <span className="text-slate-300 truncate max-w-[280px]">
                          {pos.observation}
                        </span>
                        <button onClick={() => handleRemovePositive(idx)} className="text-slate-500 hover:text-red-400 transition">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Violations */}
                <div>
                  <h4 className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1">
                    Violations ({evidence.violations.length})
                  </h4>
                  <div className="space-y-1">
                    {evidence.violations.map((vio, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs bg-slate-950/60 hover:bg-slate-950 px-2.5 py-1 rounded border border-slate-850">
                        <span className="text-slate-300 flex items-center gap-1.5 truncate max-w-[280px]">
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            vio.severity === "CRITICAL" ? "bg-red-500 animate-pulse" :
                            vio.severity === "MAJOR" ? "bg-orange-500" :
                            vio.severity === "MODERATE" ? "bg-yellow-500" : "bg-blue-400"
                          }`} />
                          <span className="font-semibold text-slate-400 font-mono">[{vio.severity}]</span>
                          {vio.observation}
                        </span>
                        <button onClick={() => handleRemoveViolation(idx)} className="text-slate-500 hover:text-red-400 transition">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Middle column (xl:span-4) - Panel 2: QER Registry Selector & Question Health Dashboard */}
        <section className="xl:col-span-4 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-lg">
          <div className="bg-slate-850 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-white uppercase tracking-wider">Question Health Dashboard</span>
            </div>
            <span className="text-xs text-slate-400 font-mono">QER: 20 Questions</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Legend / Metrics summary */}
            <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-850 flex justify-between items-center gap-2">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Workspace Avg Score</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-sm font-bold text-indigo-400">
                    {Math.round(allQuestionStatuses.reduce((acc, q) => acc + (q.expRating !== "NOT_VISIBLE" ? RATING_TO_SCORE[q.expRating] : 0), 0) / 20 * 25)}%
                  </span>
                  <span className="text-slate-600 text-xs">/</span>
                  <span className="text-xs text-slate-400">
                    Prod: {Math.round(allQuestionStatuses.reduce((acc, q) => acc + (q.prodRating !== "NOT_VISIBLE" ? RATING_TO_SCORE[q.prodRating] : 0), 0) / 20 * 25)}%
                  </span>
                </div>
              </div>

              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider text-right">Low Coverage Warning</p>
                <p className="text-xs font-semibold text-amber-500 text-right mt-0.5">
                  {allQuestionStatuses.filter(q => q.expCoverage < 45).length} Question(s)
                </p>
              </div>
            </div>

            {/* List of Questions grouped by Pillar */}
            {["SORT", "SET_IN_ORDER", "SHINE", "STANDARDIZE", "SUSTAIN"].map(pillarKey => {
              const questions = allQuestionStatuses.filter(q => q.pillar === pillarKey);
              return (
                <div key={pillarKey} className="space-y-1.5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-1">
                    {pillarKey.replace(/_/g, " ")}
                  </h3>
                  <div className="space-y-1">
                    {questions.map(q => {
                      const isSelected = q.questionId === selectedQuestionId;
                      const hasLowCoverage = q.expCoverage < 45;

                      return (
                        <div
                          key={q.questionId}
                          onClick={() => setSelectedQuestionId(q.questionId)}
                          className={`p-2.5 rounded-lg border text-left cursor-pointer transition flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-slate-800 border-indigo-500 text-white"
                              : "bg-slate-950/40 hover:bg-slate-950 border-slate-850 hover:border-slate-800 text-slate-300"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-indigo-400">
                                {q.questionId}
                              </span>
                              {q.hasChanged && (
                                <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] px-1 rounded font-mono">
                                  Mod
                                </span>
                              )}
                              {hasLowCoverage && (
                                <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] px-1 rounded flex items-center gap-0.5 font-mono">
                                  <AlertTriangle className="h-2 w-2" /> Low Cov
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 truncate mt-1">
                              {q.questionText}
                            </p>
                          </div>

                          {/* Ratings Display */}
                          <div className="text-right flex flex-col items-end gap-1">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                              q.expRating === "Very Good" || q.expRating === "Good" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                              q.expRating === "Average" ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" :
                              q.expRating === "NOT_VISIBLE" ? "bg-slate-800 text-slate-400 border border-slate-700" :
                              "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            }`}>
                              {q.expRating}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              Cov: {q.expCoverage}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right column (xl:span-4) - Panel 3/4/5/6 Tabs */}
        <section className="xl:col-span-4 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-lg">
          {/* Tabs bar */}
          <div className="bg-slate-850 border-b border-slate-800 flex">
            {[
              { id: "replay", label: "Replay & Compare", icon: Activity },
              { id: "ecm", label: "ECM / Inspector", icon: Sliders },
              { id: "qer", label: "QER / Calibration", icon: Layers },
              { id: "prompt", label: "Prompt Preview", icon: Code }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setRightPanelTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold uppercase tracking-wider transition border-b-2 ${
                  rightPanelTab === tab.id
                    ? "border-indigo-500 text-indigo-400 bg-slate-800/20"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label.split(" ")[0]}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Active Question Title Summary */}
            <div className="bg-slate-950 p-4 border border-slate-850 rounded-lg">
              <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
                {selectedQuestionId}
              </span>
              <h2 className="text-sm font-bold text-white mt-2 leading-relaxed">
                {activeQer?.questionText}
              </h2>
            </div>

            {/* TAB CONTENT: DECISION REPLAY & SIDE-BY-SIDE COMPARE */}
            {rightPanelTab === "replay" && (
              <div className="space-y-6">
                {/* Comparison Results */}
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Side-by-Side Comparison
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Production Result */}
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-850 text-left">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Production Output</span>
                      <div className="mt-1.5 space-y-1.5">
                        <div>
                          <p className="text-xs text-slate-500">Rating:</p>
                          <span className="text-xs font-bold text-slate-300">{prodEvaluation.rating}</span>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Confidence:</p>
                          <span className="text-xs font-bold text-slate-300">{prodEvaluation.confidence}</span>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Capability Score:</p>
                          <span className="text-xs font-bold text-slate-300">{prodEvaluation.coverage.coveragePercentage}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Experimental Result */}
                    <div className="bg-slate-950 rounded-lg p-3 border border-indigo-900/40 text-left">
                      <span className="text-[10px] text-indigo-400 uppercase tracking-wider">Experimental Output</span>
                      <div className="mt-1.5 space-y-1.5">
                        <div>
                          <p className="text-xs text-slate-500">Rating:</p>
                          <span className="text-xs font-bold text-indigo-300">{expEvaluation.rating}</span>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Confidence:</p>
                          <span className="text-xs font-bold text-indigo-300">{expEvaluation.confidence}</span>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Capability Score:</p>
                          <span className="text-xs font-bold text-indigo-300">{expEvaluation.coverage.coveragePercentage}%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recommendation Template Delta */}
                  <div className="mt-3 bg-slate-950 p-3 rounded-lg border border-slate-850">
                    <p className="text-xs font-semibold text-indigo-400">Experimental Action Recommendation:</p>
                    <p className="text-xs text-slate-300 mt-1 italic leading-relaxed">
                      "{activeQer?.recommendationTemplate.corrective}"
                    </p>
                    <div className="flex gap-4 mt-2 text-[10px] text-slate-400">
                      <span>Priority: <strong className="text-slate-200">{activeQer?.recommendationTemplate.priority}</strong></span>
                      <span>Difficulty: <strong className="text-slate-200">{activeQer?.recommendationTemplate.implementationDifficulty}</strong></span>
                      <span>Time: <strong className="text-slate-200">{activeQer?.recommendationTemplate.timeEstimate}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Pipeline Replay Stepper */}
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Decision Replay Stepper
                  </h3>
                  <div className="space-y-4 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                    {activeEval.traceSteps.map((step, idx) => (
                      <div key={idx} className="relative pl-7 text-left">
                        <div className={`absolute left-1.5 top-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center border ${
                          step.status === "success" ? "bg-emerald-500/20 border-emerald-500" :
                          step.status === "warning" ? "bg-amber-500/20 border-amber-500" :
                          step.status === "error" ? "bg-rose-500/20 border-rose-500" :
                          "bg-slate-800 border-slate-700"
                        }`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        </div>
                        <h4 className="text-xs font-bold text-white">{step.title}</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{step.description}</p>
                        {step.details.length > 0 && (
                          <div className="bg-slate-950 border border-slate-850 rounded p-2 mt-1.5 space-y-0.5 font-mono text-[10px] text-slate-400">
                            {step.details.map((d, dIdx) => (
                              <p key={dIdx}>&gt; {d}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Patch Generator Display */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Configuration Patch Generator
                    </h3>
                    <button
                      onClick={handleCopyPatch}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition"
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  </div>
                  <pre className="bg-slate-950 border border-slate-850 rounded-lg p-3 text-[10px] font-mono text-indigo-300 max-h-40 overflow-y-auto text-left">
                    {generatedPatch || "/* No modifications detected. Edit configuration to generate a patch. */"}
                  </pre>
                </div>
              </div>
            )}

            {/* TAB CONTENT: ECM INSPECTOR */}
            {rightPanelTab === "ecm" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Evidence Capability Matrix Rules
                  </h3>

                  <div className="space-y-4">
                    {/* Required Object Types */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Required Object Types (Comma separated)
                      </label>
                      <input
                        type="text"
                        value={activeEcm?.requiredObjectTypes.join(", ") || ""}
                        disabled={!isExperimentalMode}
                        onChange={(e) => handleUpdateECMField("requiredObjectTypes", e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        If none of these are visible in workspace, the rating is automatically NOT_VISIBLE.
                      </p>
                    </div>

                    {/* Primary Evidence */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Primary Evidence (Weight 1.0)
                      </label>
                      <input
                        type="text"
                        value={activeEcm?.primaryEvidence.join(", ") || ""}
                        disabled={!isExperimentalMode}
                        onChange={(e) => handleUpdateECMField("primaryEvidence", e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>

                    {/* Supporting Evidence */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Supporting Evidence (Weight 0.7)
                      </label>
                      <input
                        type="text"
                        value={activeEcm?.supportingEvidence.join(", ") || ""}
                        disabled={!isExperimentalMode}
                        onChange={(e) => handleUpdateECMField("supportingEvidence", e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>

                    {/* Forbidden Object Types */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Forbidden Object Types (Weight 0.0)
                      </label>
                      <input
                        type="text"
                        value={activeEcm?.forbiddenObjectTypes.join(", ") || ""}
                        disabled={!isExperimentalMode}
                        onChange={(e) => handleUpdateECMField("forbiddenObjectTypes", e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Evidence Inspector */}
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Evidence Inspector (Active Workspace Objects)
                  </h3>
                  <div className="space-y-2">
                    {inspectedObjects.map((ins, idx) => (
                      <div key={idx} className="bg-slate-950 border border-slate-850 rounded p-3 text-left">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-white font-mono">{ins.name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            ins.isAllowed
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}>
                            {ins.isAllowed ? `Allowed (w: ${ins.weight})` : "Forbidden"}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Reason: {ins.reason}</p>
                        {ins.usingQuestions.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                            <span className="text-[9px] text-slate-500">Other questions using it:</span>
                            {ins.usingQuestions.map(qId => (
                              <span key={qId} className="text-[8px] bg-slate-900 border border-slate-800 text-slate-400 px-1 rounded font-mono">
                                {qId}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: QER / CALIBRATION CONFIG */}
            {rightPanelTab === "qer" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Decision Config (QER)
                  </h3>

                  <div className="space-y-4">
                    {/* Strategy & intent */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Decision Strategy
                        </label>
                        <select
                          value={activeQer?.decisionStrategy}
                          disabled={!isExperimentalMode}
                          onChange={(e) => handleUpdateQERField("decisionStrategy", e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="VIOLATION_BASED">VIOLATION_BASED</option>
                          <option value="COMPLIANCE_BASED">COMPLIANCE_BASED</option>
                          <option value="CONDITION_ASSESSMENT">CONDITION_ASSESSMENT</option>
                          <option value="PRESENCE_DETECTION">PRESENCE_DETECTION</option>
                          <option value="VISUAL_CONTEXT">VISUAL_CONTEXT</option>
                          <option value="CONSERVATIVE_INFERENCE">CONSERVATIVE_INFERENCE</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Evidence Intent
                        </label>
                        <select
                          value={activeQer?.evidenceIntent}
                          disabled={!isExperimentalMode}
                          onChange={(e) => handleUpdateQERField("evidenceIntent", e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="PRESENCE_DETECTION">PRESENCE_DETECTION</option>
                          <option value="ABSENCE_DETECTION">ABSENCE_DETECTION</option>
                          <option value="CONDITION_ASSESSMENT">CONDITION_ASSESSMENT</option>
                          <option value="ORGANIZATION_ASSESSMENT">ORGANIZATION_ASSESSMENT</option>
                          <option value="CLEANLINESS_ASSESSMENT">CLEANLINESS_ASSESSMENT</option>
                          <option value="DOCUMENTATION_PRESENCE">DOCUMENTATION_PRESENCE</option>
                          <option value="VISUAL_STANDARD_ASSESSMENT">VISUAL_STANDARD_ASSESSMENT</option>
                        </select>
                      </div>
                    </div>

                    {/* Policy keys */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[9px] font-semibold text-slate-400 block mb-1">
                          Rating Policy
                        </label>
                        <select
                          value={activeQer?.ratingPolicy}
                          disabled={!isExperimentalMode}
                          onChange={(e) => handleUpdateQERField("ratingPolicy", e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="STANDARD">STANDARD</option>
                          <option value="CONSERVATIVE">CONSERVATIVE</option>
                          <option value="NEUTRAL_ONLY">NEUTRAL_ONLY</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] font-semibold text-slate-400 block mb-1">
                          Evidence Policy
                        </label>
                        <select
                          value={activeQer?.evidencePolicy}
                          disabled={!isExperimentalMode}
                          onChange={(e) => handleUpdateQERField("evidencePolicy", e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="DIRECT_ONLY">DIRECT_ONLY</option>
                          <option value="POSITIVE_FIRST">POSITIVE_FIRST</option>
                          <option value="ZONE_AWARE">ZONE_AWARE</option>
                          <option value="NO_ABSENCE_REASONING">NO_ABSENCE_REASONING</option>
                          <option value="CONSERVATIVE">CONSERVATIVE</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] font-semibold text-slate-400 block mb-1">
                          Confidence Policy
                        </label>
                        <select
                          value={activeQer?.confidencePolicy}
                          disabled={!isExperimentalMode}
                          onChange={(e) => handleUpdateQERField("confidencePolicy", e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="STANDARD">STANDARD</option>
                          <option value="CONSERVATIVE">CONSERVATIVE</option>
                          <option value="FORCED_LOW">FORCED_LOW</option>
                        </select>
                      </div>
                    </div>

                    {/* Calibration Thresholds */}
                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Severity Threshold Caps
                      </h4>
                      <div className="grid grid-cols-2 gap-4 border border-slate-850 rounded-lg p-3 bg-slate-950/40">
                        {["MINOR", "MODERATE", "MAJOR", "CRITICAL"].map((sev) => {
                          const thr = activeQer?.thresholds[sev as "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL"];
                          if (!thr) return null;

                          return (
                            <div key={sev} className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-300 block">{sev}</label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  placeholder="triggersAt"
                                  value={thr.triggersAt}
                                  disabled={!isExperimentalMode}
                                  onChange={(e) => handleUpdateThreshold(sev as any, "triggersAt", parseInt(e.target.value) || 1)}
                                  className="w-12 bg-slate-950 border border-slate-800 rounded p-1 text-center text-xs text-slate-200"
                                />
                                <select
                                  value={thr.ratingCap}
                                  disabled={!isExperimentalMode}
                                  onChange={(e) => handleUpdateThreshold(sev as any, "ratingCap", e.target.value)}
                                  className="flex-1 bg-slate-950 border border-slate-800 rounded p-1 text-xs text-slate-200"
                                >
                                  <option value="Very Good">Very Good</option>
                                  <option value="Good">Good</option>
                                  <option value="Average">Average</option>
                                  <option value="Bad">Bad</option>
                                  <option value="Very Bad">Very Bad</option>
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Positive Influence controls */}
                    {activeQer?.positiveInfluence && (
                      <div>
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                          Positive Influence Rules
                        </h4>
                        <div className="grid grid-cols-3 gap-2 border border-slate-850 rounded-lg p-3 bg-slate-950/40">
                          <div>
                            <label className="text-[9px] font-semibold text-slate-400 block mb-1">Min Positive Count</label>
                            <input
                              type="number"
                              value={activeQer.positiveInfluence.minimumPositiveCount}
                              disabled={!isExperimentalMode}
                              onChange={(e) => handleUpdatePositiveInfluence("minimumPositiveCount", parseInt(e.target.value) || 0)}
                              className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-xs text-slate-200 text-center font-mono"
                            />
                          </div>

                          <div>
                            <label className="text-[9px] font-semibold text-slate-400 block mb-1">Rating Floor</label>
                            <select
                              value={activeQer.positiveInfluence.ratingFloor}
                              disabled={!isExperimentalMode}
                              onChange={(e) => handleUpdatePositiveInfluence("ratingFloor", e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-xs text-slate-200"
                            >
                              <option value="Very Good">Very Good</option>
                              <option value="Good">Good</option>
                              <option value="Average">Average</option>
                              <option value="Bad">Bad</option>
                            </select>
                          </div>

                          <div className="flex flex-col justify-center items-center">
                            <label className="text-[9px] font-semibold text-slate-400 block mb-1 text-center">Suppress Minor</label>
                            <input
                              type="checkbox"
                              checked={activeQer.positiveInfluence.suppressMinor}
                              disabled={!isExperimentalMode}
                              onChange={(e) => handleUpdatePositiveInfluence("suppressMinor", e.target.checked)}
                              className="h-4 w-4 bg-slate-950 border border-slate-800 rounded mt-1"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Structured Inspection Procedure step editor */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Inspection Procedures
                    </h3>
                    <button
                      onClick={handleAddStep}
                      disabled={!isExperimentalMode}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Step
                    </button>
                  </div>

                  <div className="space-y-3">
                    {activeQer?.inspectionProcedure.map((step, idx) => (
                      <div key={idx} className="bg-slate-950 border border-slate-850 rounded-lg p-3 space-y-2 text-left relative">
                        <button
                          onClick={() => handleRemoveStep(idx)}
                          disabled={!isExperimentalMode}
                          className="absolute right-2 top-2 text-slate-500 hover:text-red-400 transition disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded font-mono">
                            Step {step.step}
                          </span>
                        </div>

                        <div>
                          <label className="text-[9px] font-semibold text-slate-500 uppercase">Action</label>
                          <textarea
                            value={step.action}
                            disabled={!isExperimentalMode}
                            onChange={(e) => handleUpdateStep(idx, "action", e.target.value)}
                            rows={1}
                            className="w-full bg-slate-900 border border-slate-850 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="text-[9px] font-semibold text-slate-500 uppercase">Condition (Optional)</label>
                          <input
                            type="text"
                            value={step.condition || ""}
                            disabled={!isExperimentalMode}
                            onChange={(e) => handleUpdateStep(idx, "condition", e.target.value)}
                            className="w-full bg-slate-900 border border-slate-850 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="text-[9px] font-semibold text-slate-500 uppercase">Expected Outcome</label>
                          <textarea
                            value={step.expectedOutcome}
                            disabled={!isExperimentalMode}
                            onChange={(e) => handleUpdateStep(idx, "expectedOutcome", e.target.value)}
                            rows={1}
                            className="w-full bg-slate-900 border border-slate-850 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: PROMPT PREVIEW */}
            {rightPanelTab === "prompt" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Live Generated Prompt (QER Section 6 instructions)
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(renderedPromptPreview);
                      toast.success("Prompt snippet copied!");
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition"
                  >
                    <Copy className="h-3 w-3" /> Copy Snippet
                  </button>
                </div>
                <pre className="bg-slate-950 border border-slate-850 rounded-xl p-4 text-[10px] font-mono text-emerald-400 leading-relaxed overflow-x-auto text-left max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                  {renderedPromptPreview}
                </pre>
              </div>
            )}
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}

// ── In-Memory Decision Evaluator ─────────────────────────────────────────────
interface EvaluatorResult {
  rating: AuditRating;
  confidence: EvidenceConfidence;
  coverage: EvidenceCoverage;
  traceSteps: ReplayStep[];
}

function evaluateInMemory(
  questionId: string,
  qer: QuestionEvaluationConfig,
  ecm: EvidenceCapabilityEntry,
  evidence: AuditEvidenceModel
): EvaluatorResult {
  const steps: ReplayStep[] = [];

  // Stage 1: Observation Input
  steps.push({
    title: "1. Raw Workspace Observations",
    description: `Retrieved all observations from workspace cache.`,
    status: "neutral",
    details: [
      `Total visible objects in cache: ${evidence.visibleObjects.length}`,
      `Total compliance findings in cache: ${evidence.positiveCompliance.length}`,
      `Total violations in cache: ${evidence.violations.length}`
    ]
  });

  // Stage 2: Filter Evidence (ECM enforcement)
  const filtered = EvidenceFilterService.filterForQuestion(questionId, evidence, ecm);
  const { allowedObjects, allowedPositive, allowedViolations, canVerify } = filtered;

  steps.push({
    title: "2. Evidence Filtering (ECM Rules)",
    description: `Allowed/forbidden filter matrices applied.`,
    status: canVerify ? "success" : "warning",
    details: [
      `Required object categories allowed: ${ecm.requiredObjectTypes.join(", ")}`,
      `Visible required objects found: ${allowedObjects.length}`,
      `Filtered positive compliance findings: ${allowedPositive.length}`,
      `Filtered violations: ${allowedViolations.length}`,
      `Can verify question? ${canVerify ? "YES" : "NO"}`
    ]
  });

  // Stage 3: Coverage Calculations
  const mockKnowledge = {
    zoneName: "Calibration Zone",
    expectedEquipment: ecm.requiredObjectTypes,
    expectedDocuments: [],
    expectedSafetyAssets: [],
    expectedLayout: [],
    expectedVisualControls: [],
    expectedCleanliness: [],
    expectedStoragePractices: []
  };
  const coverage = EvidenceCoverageService.computeForQuestion(questionId, filtered, mockKnowledge, evidence, ecm);

  steps.push({
    title: "3. Coverage & Capability Score",
    description: `Derived coverage metrics and recommended confidence based on capability score.`,
    status: coverage.coveragePercentage >= 75 ? "success" : coverage.coveragePercentage >= 45 ? "warning" : "error",
    details: [
      `Capability score: ${coverage.coveragePercentage}%`,
      `Recommended confidence: ${coverage.recommendedConfidence}`,
      `Evidence quality: ${coverage.evidenceQuality}`,
      `Context completeness: ${coverage.contextCompleteness}`
    ]
  });

  // If cannot verify, return fallback NOT_VISIBLE immediately
  if (!canVerify) {
    steps.push({
      title: "4. Question Decision Tree",
      description: "Cannot verify question — required elements are absent from the workspace context.",
      status: "warning",
      details: ["Base rating: NOT_VISIBLE", "Confidence forced: LOW"]
    });
    return {
      rating: "NOT_VISIBLE",
      confidence: "LOW",
      coverage,
      traceSteps: steps
    };
  }

  // Stage 4: Decision Tree Rating & Violations cap
  let rating: AuditRating = "Very Good";
  const minorCount = allowedViolations.filter(v => v.severity === "MINOR").length;
  const moderateCount = allowedViolations.filter(v => v.severity === "MODERATE").length;
  const majorCount = allowedViolations.filter(v => v.severity === "MAJOR").length;
  const criticalCount = allowedViolations.filter(v => v.severity === "CRITICAL").length;

  // Positive balance influence
  let effectiveMinor = minorCount;
  let hasPositiveInfluence = false;
  const meetPositive = allowedPositive.length >= qer.positiveInfluence.minimumPositiveCount;
  if (meetPositive) {
    if (qer.positiveInfluence.suppressMinor && minorCount > 0) {
      effectiveMinor = 0;
      hasPositiveInfluence = true;
    }
  }

  // Deduct/Cap based on thresholds
  let capReason = "No violations detected";
  if (effectiveMinor >= qer.thresholds.MINOR.triggersAt) {
    rating = getWorseRating(rating, qer.thresholds.MINOR.ratingCap);
    capReason = `MINOR violations count (${effectiveMinor}) >= trigger (${qer.thresholds.MINOR.triggersAt}) -> caps at ${qer.thresholds.MINOR.ratingCap}`;
  }
  if (moderateCount >= qer.thresholds.MODERATE.triggersAt) {
    rating = getWorseRating(rating, qer.thresholds.MODERATE.ratingCap);
    capReason = `MODERATE violations count (${moderateCount}) >= trigger (${qer.thresholds.MODERATE.triggersAt}) -> caps at ${qer.thresholds.MODERATE.ratingCap}`;
  }
  if (majorCount >= qer.thresholds.MAJOR.triggersAt) {
    rating = getWorseRating(rating, qer.thresholds.MAJOR.ratingCap);
    capReason = `MAJOR violations count (${majorCount}) >= trigger (${qer.thresholds.MAJOR.triggersAt}) -> caps at ${qer.thresholds.MAJOR.ratingCap}`;
  }
  if (criticalCount >= qer.thresholds.CRITICAL.triggersAt) {
    rating = getWorseRating(rating, qer.thresholds.CRITICAL.ratingCap);
    capReason = `CRITICAL violations count (${criticalCount}) >= trigger (${qer.thresholds.CRITICAL.triggersAt}) -> caps at ${qer.thresholds.CRITICAL.ratingCap}`;
  }

  if (meetPositive) {
    const oldRating = rating;
    rating = getBetterRating(rating, qer.positiveInfluence.ratingFloor);
    if (oldRating !== rating) {
      hasPositiveInfluence = true;
      capReason += ` | Raised by positive floor to ${qer.positiveInfluence.ratingFloor}`;
    }
  }

  steps.push({
    title: "4. Question Decision Tree",
    description: `Evaluated violation thresholds and positive compliance adjustments.`,
    status: rating === "Very Good" || rating === "Good" ? "success" : rating === "Average" ? "warning" : "error",
    details: [
      `Raw violations: MINOR:${minorCount}, MODERATE:${moderateCount}, MAJOR:${majorCount}, CRITICAL:${criticalCount}`,
      `Positive findings: ${allowedPositive.length} (Meet trigger? ${meetPositive ? "YES" : "NO"})`,
      `Isolated minor suppressed? ${hasPositiveInfluence ? "YES" : "NO"}`,
      `Scoring decision: ${capReason}`,
      `Derived pre-calibration rating: ${rating}`
    ]
  });

  // Stage 5: Calibration Rules (Escalations)
  let confidence: EvidenceConfidence = coverage.recommendedConfidence;
  const oldRating = rating;

  // Calibration Rule 1: SHN-04 override
  if (questionId === "SHN-04" && rating !== "Average") {
    rating = "Average";
    confidence = "LOW";
    steps.push({
      title: "5. Post-B Calibration Override",
      description: "Triggered SHN04_FORCED_AVERAGE escalation rule.",
      status: "warning",
      details: ["SHN-04 is forced to Average + LOW confidence (needs long-term behavioral check)"]
    });
  }

  // Calibration Rule 2: CRITICAL violation escalation
  const criticalViolations = evidence.violations.filter(
    (v) => v.severity === "CRITICAL" && qer.escalationRules.some(
      (rule) => v.observation.toLowerCase().includes(rule.pattern.toLowerCase())
    )
  );
  if (criticalViolations.length > 0 && rating !== "Very Bad") {
    const rule = qer.escalationRules.find(r =>
      criticalViolations.some(v => v.observation.toLowerCase().includes(r.pattern.toLowerCase()))
    );
    rating = "Very Bad";
    confidence = "HIGH";
    steps.push({
      title: "5. Post-B Calibration Override",
      description: `Triggered CRITICAL_ESCALATION override: ${rule?.reason}`,
      status: "error",
      details: [`Forced rating: Very Bad`, `Forced confidence: HIGH`]
    });
  }

  // Calibration Rule 3: Conservative Floor
  const CONSERVATIVE_QUESTIONS = new Set(["SORT-02", "SORT-03", "SORT-04", "SIO-02", "SIO-04", "SUS-01", "SUS-04"]);
  if (
    rating === "Very Bad" &&
    CONSERVATIVE_QUESTIONS.has(questionId) &&
    !evidence.violations.some((v) => v.severity === "MAJOR" || v.severity === "CRITICAL")
  ) {
    rating = "Bad";
    steps.push({
      title: "5. Post-B Calibration Override",
      description: "Triggered CONSERVATIVE_FLOOR calibration override.",
      status: "warning",
      details: [`Very Bad rating raised to Bad because no MAJOR or CRITICAL violation was observed.`]
    });
  }

  // Calibration Rule 4: Low Coverage Override
  if (rating === "Very Bad" && coverage.coveragePercentage < 30 && questionId !== "SHN-04") {
    rating = "NOT_VISIBLE";
    confidence = "LOW";
    steps.push({
      title: "5. Post-B Calibration Override",
      description: "Triggered LOW_COVERAGE_NOT_VISIBLE override.",
      status: "warning",
      details: [`Rating raised to NOT_VISIBLE because coverage percentage (${coverage.coveragePercentage}%) < 30%`]
    });
  }

  if (rating === oldRating) {
    steps.push({
      title: "5. Post-B Calibration Override",
      description: "No post-evaluation escalation overrides triggered.",
      status: "success",
      details: ["Final rating and confidence match pre-calibration results."]
    });
  }

  return {
    rating,
    confidence,
    coverage,
    traceSteps: steps
  };
}
