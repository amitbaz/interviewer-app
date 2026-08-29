import { describe, expect, it } from "vitest";
import {
  appendFollowUp,
  buildInterviewPlan,
  chooseDifficulty,
} from "@/lib/interview-planner";
import type { Competency, PlannedQuestion } from "@/lib/types";

const weakSystemDesign: Competency = {
  id: "system-design",
  name: "System design",
  relevance: 0.95,
  expectedLevel: "senior",
  estimatedLevel: "foundational",
  confidence: "low",
  lastPracticedAt: "2025-01-01T00:00:00.000Z",
  questionCount: 4,
  averageScore: 4,
  recentScore: 3,
  strengths: [],
  weaknesses: ["Clarify requirements before proposing architecture."],
};

const strongReact: Competency = {
  id: "react",
  name: "React",
  relevance: 0.9,
  expectedLevel: "senior",
  estimatedLevel: "senior",
  confidence: "high",
  lastPracticedAt: "2026-08-20T00:00:00.000Z",
  questionCount: 8,
  averageScore: 9,
  recentScore: 9,
  strengths: ["Explains state ownership clearly."],
  weaknesses: [],
};

const unassessedReact: Competency = {
  ...strongReact,
  id: "unassessed-react",
  estimatedLevel: null,
  confidence: null,
  questionCount: 0,
  averageScore: null,
  recentScore: null,
};

describe("adaptive interview planning", () => {
  it("builds a five-question backbone that prioritizes weak system design", () => {
    const plan = buildInterviewPlan([strongReact, weakSystemDesign], "Senior");

    expect(plan).toHaveLength(5);
    expect(plan.map((question) => question.category)).toEqual([
      "introduction", "experience", "technical", "architecture", "behavioral",
    ]);
    for (let index = 1; index < plan.length; index += 1) {
      const previous = plan[index - 1].competencyId;
      const current = plan[index].competencyId;
      if (previous !== null && current !== null) expect(current).not.toBe(previous);
    }
    expect(plan.find((question) => question.category === "architecture")?.competencyName).toBe("System design");
  });

  it("adjusts difficulty from evidence while preserving unassessed role seniority", () => {
    expect(chooseDifficulty(strongReact, "Senior")).toBe("advanced");
    expect(chooseDifficulty(unassessedReact, "Senior")).toBe("senior");
  });

  it("allows only three follow-ups beyond the backbone", () => {
    const plan = buildInterviewPlan([strongReact, weakSystemDesign], "Senior");
    const followUp: PlannedQuestion = {
      id: "follow-up",
      sequence: 6,
      category: "technical",
      competencyId: strongReact.id,
      competencyName: strongReact.name,
      difficulty: "advanced",
      isFollowUp: true,
      prompt: "What trade-off would change your implementation?",
      answer: null,
      createdAt: "2026-08-29T00:00:00.000Z",
    };

    const withOne = appendFollowUp(plan, followUp);
    const withTwo = appendFollowUp(withOne, followUp);
    const withThree = appendFollowUp(withTwo, followUp);

    expect(withThree).toHaveLength(8);
    expect(appendFollowUp(withThree, followUp)).toBe(withThree);
  });
});
