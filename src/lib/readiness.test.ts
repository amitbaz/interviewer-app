import { describe, expect, it } from "vitest";
import { calculateReadiness } from "@/lib/readiness";
import type { ReadinessEvidence } from "@/lib/types";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

let seq = 0;
const evidence = (overrides: Partial<ReadinessEvidence> = {}): ReadinessEvidence => ({
  questionEvaluationId: `eval-${(seq += 1)}`,
  sessionId: "session-1",
  recordedAt: daysAgo(1),
  score: 7,
  competencyId: "competency-1",
  competencyName: "React architecture",
  category: "technical",
  relevance: 1,
  mode: "real",
  degraded: false,
  assistanceCount: 0,
  ...overrides,
});

const dimension = (model: ReturnType<typeof calculateReadiness>, name: string) =>
  model.dimensions.find((entry) => entry.dimension === name)!;

describe("calculateReadiness", () => {
  it("returns every dimension even when there is no evidence", () => {
    const model = calculateReadiness([], NOW);
    expect(model.dimensions).toHaveLength(7);
    expect(model.overall).toBeNull();
    for (const entry of model.dimensions) {
      expect(entry.score).toBeNull();
      expect(entry.confidence).toBeNull();
      expect(entry.trend).toBe("unresolved");
    }
  });

  it("scores a dimension on 0-100 from its 0-10 rubric evidence", () => {
    const model = calculateReadiness([evidence({ score: 8 })], NOW);
    expect(dimension(model, "frontend").score).toBe(80);
  });

  it("does not let one outlier overwrite a consistent history", () => {
    const consistent = Array.from({ length: 8 }, () => evidence({ score: 8, recordedAt: daysAgo(10) }));
    const outlier = evidence({ score: 1, recordedAt: daysAgo(1) });
    const model = calculateReadiness([...consistent, outlier], NOW);
    expect(dimension(model, "frontend").score).toBeGreaterThan(70);
  });

  it("lets recent repeated evidence materially outweigh an old baseline", () => {
    const oldBaseline = Array.from({ length: 6 }, () => evidence({ score: 3, recordedAt: daysAgo(300) }));
    const recentStrong = Array.from({ length: 6 }, () => evidence({ score: 9, recordedAt: daysAgo(3) }));
    const model = calculateReadiness([...oldBaseline, ...recentStrong], NOW);
    expect(dimension(model, "frontend").score).toBeGreaterThan(80);
  });

  it("counts coach-mode teaching for materially less than a real-mode demonstration", () => {
    const taught = calculateReadiness(
      Array.from({ length: 4 }, () => evidence({ score: 9, mode: "coach" })),
      NOW,
    );
    const demonstrated = calculateReadiness(
      Array.from({ length: 4 }, () => evidence({ score: 9, mode: "real" })),
      NOW,
    );
    expect(dimension(taught, "frontend").totalWeight).toBeLessThan(
      dimension(demonstrated, "frontend").totalWeight / 2,
    );
    expect(dimension(taught, "frontend").confidence).not.toBe("high");
    expect(dimension(demonstrated, "frontend").confidence).toBe("high");
  });

  it("reports low confidence on sparse evidence and high confidence on plentiful strong evidence", () => {
    const sparse = calculateReadiness([evidence({ score: 7 })], NOW);
    expect(dimension(sparse, "frontend").confidence).toBe("low");

    const plentiful = calculateReadiness(
      Array.from({ length: 6 }, () => evidence({ score: 7 })),
      NOW,
    );
    expect(dimension(plentiful, "frontend").confidence).toBe("high");
  });

  it("weights evidence by the relevance of its underlying competency", () => {
    const model = calculateReadiness(
      [
        evidence({ score: 10, relevance: 1 }),
        evidence({ score: 0, relevance: 0.1 }),
      ],
      NOW,
    );
    expect(dimension(model, "frontend").score).toBeGreaterThan(85);
  });

  it("records the evidence that produced each dimension score, heaviest first", () => {
    const model = calculateReadiness(
      [evidence({ score: 5, recordedAt: daysAgo(200) }), evidence({ score: 9, recordedAt: daysAgo(1) })],
      NOW,
    );
    const contributions = dimension(model, "frontend").contributions;
    expect(contributions).toHaveLength(2);
    expect(contributions[0].weight).toBeGreaterThan(contributions[1].weight);
    expect(contributions[0].score).toBe(9);
  });

  it("drops evidence that matches no dimension and reports the count", () => {
    const model = calculateReadiness(
      [evidence({ competencyName: "Widget wrangling", category: null })],
      NOW,
    );
    expect(model.unmappedEvidenceCount).toBe(1);
    expect(model.dimensions.every((entry) => entry.score === null)).toBe(true);
  });
});

describe("calculateReadiness trend", () => {
  const older = (score: number) => evidence({ score, recordedAt: daysAgo(90) });
  const newer = (score: number) => evidence({ score, recordedAt: daysAgo(5) });

  it("reports unresolved when one side of the comparison has too little weight", () => {
    const model = calculateReadiness([newer(9), newer(9)], NOW);
    expect(dimension(model, "frontend").trend).toBe("unresolved");
  });

  it("reports improving when recent evidence is clearly stronger", () => {
    const model = calculateReadiness(
      [...Array.from({ length: 4 }, () => older(4)), ...Array.from({ length: 4 }, () => newer(9))],
      NOW,
    );
    expect(dimension(model, "frontend").trend).toBe("improving");
  });

  it("reports worsening when recent evidence is clearly weaker", () => {
    const model = calculateReadiness(
      [...Array.from({ length: 4 }, () => older(9)), ...Array.from({ length: 4 }, () => newer(4))],
      NOW,
    );
    expect(dimension(model, "frontend").trend).toBe("worsening");
  });

  it("reports stable when the two halves are close", () => {
    const model = calculateReadiness(
      [...Array.from({ length: 4 }, () => older(7)), ...Array.from({ length: 4 }, () => newer(7.2))],
      NOW,
    );
    expect(dimension(model, "frontend").trend).toBe("stable");
  });

  it("does not flip the trend on a single bad answer", () => {
    const model = calculateReadiness(
      [
        ...Array.from({ length: 5 }, () => older(8)),
        ...Array.from({ length: 5 }, () => newer(8)),
        newer(1),
      ],
      NOW,
    );
    expect(dimension(model, "frontend").trend).not.toBe("worsening");
  });

  it("derives an overall trend across every dimension", () => {
    const model = calculateReadiness(
      [
        ...Array.from({ length: 4 }, () => older(4)),
        ...Array.from({ length: 4 }, () => newer(9)),
      ],
      NOW,
    );
    expect(model.overallTrend).toBe("improving");
  });
});
