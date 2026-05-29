/**
 * src/types/analysis.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all analysis-related TypeScript types.
 * Mirrors the FastAPI CV Engine's Pydantic response schema exactly.
 */

// ── Per-pillar scores (0-100 after conversion from /20) ─────────────────────
export interface FiveSScore {
  sort: number;
  setInOrder: number;
  shine: number;
  standardize: number;
  sustain: number;
}

// ── Natural-language explanations for each pillar ────────────────────────────
export interface ScoreExplanations {
  sort: string;
  setInOrder: string;
  shine: string;
  standardize: string;
  sustain: string;
}

// ── Raw CV metrics from the Python engine ────────────────────────────────────
export interface CVMetrics {
  clutter_count: number;
  object_count: number;
  clutter_density: number;
  obstruction_ratio: number;
  unused_material_presence: number;
  alignment_score: number;
  spacing_consistency: number;
  edge_alignment: number;
  organization_symmetry: number;
  brightness_mean: number;
  brightness_std: number;
  brightness_consistency: number;
  dirt_proxy_count: number;
  texture_irregularity: number;
  edge_cleanliness: number;
  edge_density: number;
  color_uniformity: number;
  visual_consistency: number;
  workplace_std_dev: number;
}

// ── Top-level analysis result (matches edge function response) ───────────────
export interface AnalysisData {
  overview: string;
  beforeScores: FiveSScore;
  afterScores: FiveSScore;
  beforeExplanations: ScoreExplanations;
  afterExplanations: ScoreExplanations;
  recommendations: string[];
  improvements: string[];
  rootCauseObservations?: string[];
  safetyRecommendations?: string[];
  leanMaintenanceScore: number;
  leanMaintenanceScoreAfter?: number;
  leanMaintenanceExplanation: string;
  scoringMethod?: string;
  rawScoringMethod?: string;
  beforeMetrics?: CVMetrics;
  afterMetrics?: CVMetrics;
}

// ── Analysis pipeline stages (for progress UX) ───────────────────────────────
export type AnalysisStage =
  | "idle"
  | "compressing"
  | "checking-cache"
  | "analyzing"
  | "saving"
  | "complete"
  | "error";

export interface AnalysisPipelineState {
  stage: AnalysisStage;
  progress: number;          // 0–100
  message: string;
  retryCount: number;
}

// ── Pillar metadata ───────────────────────────────────────────────────────────
export interface PillarMeta {
  key: keyof FiveSScore;
  label: string;
  jp: string;
  desc: string;
  icon: string;             // emoji shorthand
  factors: string[];        // sub-factors measured
}

export const PILLAR_META: PillarMeta[] = [
  {
    key: "sort",
    label: "Sort",
    jp: "Seiri",
    desc: "Removing unnecessary items from the workspace",
    icon: "🗂️",
    factors: ["Clutter count", "Clutter density", "Obstruction ratio", "Unused material presence"],
  },
  {
    key: "setInOrder",
    label: "Set in Order",
    jp: "Seiton",
    desc: "Organising all remaining items systematically",
    icon: "📐",
    factors: ["Object alignment", "Spacing consistency", "Edge alignment", "Organisation symmetry"],
  },
  {
    key: "shine",
    label: "Shine",
    jp: "Seiso",
    desc: "Cleaning and maintaining the workspace",
    icon: "✨",
    factors: ["Brightness consistency", "Dirt proxy detection", "Texture irregularity", "Edge cleanliness"],
  },
  {
    key: "standardize",
    label: "Standardize",
    jp: "Seiketsu",
    desc: "Creating and enforcing workplace standards",
    icon: "📋",
    factors: ["Visual consistency", "Color uniformity", "Workplace std deviation", "Visual compliance"],
  },
  {
    key: "sustain",
    label: "Sustain",
    jp: "Shitsuke",
    desc: "Maintaining discipline and continuous improvement",
    icon: "🔄",
    factors: ["Historical consistency", "Compliance trends", "Previous audit comparison", "Discipline index"],
  },
];
