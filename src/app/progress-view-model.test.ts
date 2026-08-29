import { describe, expect, it } from "vitest";
import type { Competency, ProgressSnapshot } from "@/lib/types";
import { progressViewModel } from "@/app/progress-view-model";

function competency(overrides: Partial<Competency> = {}): Competency {
  return {
    id: "competency-1",
    name: "System design",
    relevance: 5,
    expectedLevel: "senior",
    estimatedLevel: "senior",
    confidence: "high",
    lastPracticedAt: "2026-08-29T10:00:00.000Z",
    questionCount: 4,
    averageScore: 4.2,
    recentScore: 4.5,
    strengths: ["Frames trade-offs."],
    weaknesses: ["Needs crisper sequencing."],
    ...overrides,
  };
}

describe("progressViewModel", () => {
  it("uses the server snapshot as the single source of readiness and weakest focus", () => {
    const snapshot: ProgressSnapshot = {
      readiness: 81,
      latestScore: 7,
      trend: "baseline",
      recentScores: [7],
      strongest: competency({ id: "strongest", name: "React architecture", averageScore: 9.1 }),
      weakest: competency({ id: "weakest", name: "Communication", averageScore: 3.3 }),
      recurringWeaknesses: ["Lead with the decision."],
    };

    expect(progressViewModel(snapshot)).toEqual({
      hasEvidence: true,
      readiness: 81,
      weakest: expect.objectContaining({ id: "weakest", name: "Communication" }),
    });
  });

  it("returns the empty-state model when no progress snapshot is available", () => {
    expect(progressViewModel(null)).toEqual({
      hasEvidence: false,
      readiness: null,
      weakest: null,
    });
  });
});
