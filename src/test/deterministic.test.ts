import { describe, it, expect } from "vitest";
import AnalysisResults from "../components/AnalysisResults";
import type { AnalysisData } from "../types/analysis";

const mockData: AnalysisData = {
  overview: "Test overview",
  beforeScores: { sort: 80, setInOrder: 80, shine: 80, standardize: 80, sustain: 80 },
  afterScores: { sort: 90, setInOrder: 90, shine: 90, standardize: 90, sustain: 90 },
  beforeExplanations: { sort: "Ok", setInOrder: "Ok", shine: "Ok", standardize: "Ok", sustain: "Ok" },
  afterExplanations: { sort: "Better", setInOrder: "Better", shine: "Better", standardize: "Better", sustain: "Better" },
  recommendations: ["Rec 1"],
  improvements: ["Imp 1"],
  leanMaintenanceScore: 85,
  leanMaintenanceExplanation: "Good"
};

describe("AnalysisResults deterministic validation", () => {
  it("should throw error if scoringMethod contains 'gemini'", () => {
    const dataWithGemini = {
      ...mockData,
      scoringMethod: "Gemini Vision Fallback"
    };

    expect(() => {
      // Call the component function directly to check validation throwing in rendering path
      AnalysisResults({
        data: dataWithGemini,
        beforeImage: "data:image/jpeg;base64,123",
        afterImage: "data:image/jpeg;base64,456"
      });
    }).toThrow("Deterministic scoring violation detected.");
  });

  it("should throw error if scoringMethod contains 'fallback'", () => {
    const dataWithFallback = {
      ...mockData,
      scoringMethod: "mathematical-fallback"
    };

    expect(() => {
      AnalysisResults({
        data: dataWithFallback,
        beforeImage: "data:image/jpeg;base64,123",
        afterImage: "data:image/jpeg;base64,456"
      });
    }).toThrow("Deterministic scoring violation detected.");
  });

  it("should NOT throw error if scoringMethod is 'CV Engine'", () => {
    const dataOk = {
      ...mockData,
      scoringMethod: "CV Engine"
    };

    expect(() => {
      AnalysisResults({
        data: dataOk,
        beforeImage: "data:image/jpeg;base64,123",
        afterImage: "data:image/jpeg;base64,456"
      });
    }).not.toThrow();
  });
});
