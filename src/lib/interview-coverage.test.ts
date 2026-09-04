import { describe, expect, it } from "vitest";
import { canContinueOnAnsweredRow, deriveCoverageState, rescuesSpentInSession, targetIdOf } from "@/lib/interview-coverage";
import type { CoverageTarget, Evaluation, PlannedQuestion } from "@/lib/types";

function target(id: string, overrides: Partial<CoverageTarget> = {}): CoverageTarget {
  return {
    id,
    competencyId: `comp-${id}`,
    competencyName: `Competency ${id}`,
    category: "experience",
    evidenceIds: [],
    difficulty: "senior",
    objective: `Probe ${id}.`,
    expectedSignals: ["ownership", "impact"],
    rubricCriteria: ["Name a concrete example."],
    required: true,
    ...overrides,
  };
}

function question(id: string, overrides: Partial<PlannedQuestion> = {}): PlannedQuestion {
  return {
    id,
    sequence: 1,
    category: "experience",
    competencyId: null,
    competencyName: null,
    difficulty: "senior",
    isFollowUp: false,
    prompt: "asked",
    answer: "answered",
    createdAt: "2026-09-01T00:00:00.000Z",
    askedIntent: null,
    assistance: [],
    nonAnswer: false,
    setAsideAt: null,
    setAsideReason: null,
    nonAnswers: [],
    ...overrides,
  };
}

function evaluation(questionId: string, signals: string[]): Evaluation {
  return {
    questionId,
    competencyId: null,
    competency: "Competency a",
    score: 7,
    relevance: 8,
    dimensions: {} as Evaluation["dimensions"],
    strengths: [],
    needsWork: [],
    missingPoints: ["x"],
    betterStructure: ["y"],
    improvedAnswer: "z",
    supportedClaims: ["something"],
    expectedSignalsPresent: signals,
    unsupportedClaims: [],
    dimensionReasons: {} as Evaluation["dimensionReasons"],
  } as Evaluation;
}

describe("deriveCoverageState", () => {
  it("reports an untouched target as unasked", () => {
    const state = deriveCoverageState([target("a")], [], []);
    expect(state[0].status).toBe("unasked");
    expect(state[0].turnsSpent).toBe(0);
    expect(state[0].askedIntents).toEqual([]);
  });

  it("marks a target satisfied only when every expected signal is present", () => {
    const asked = question("q1", {
      askedIntent: { kind: "open", targetId: "a" },
    });
    const partial = deriveCoverageState([target("a")], [asked], [evaluation("q1", ["ownership"])]);
    expect(partial[0].status).toBe("open");

    const complete = deriveCoverageState([target("a")], [asked], [evaluation("q1", ["ownership", "impact"])]);
    expect(complete[0].status).toBe("satisfied");
  });

  it("marks a target parked when its last intent was a park rescue", () => {
    const asked = question("q1", {
      askedIntent: { kind: "rescue", targetId: "a", style: "park", hook: null },
    });
    const state = deriveCoverageState([target("a")], [asked], []);
    expect(state[0].status).toBe("parked");
  });

  it("collects every intent already issued for a target", () => {
    const first = question("q1", { askedIntent: { kind: "open", targetId: "a" } });
    const second = question("q2", {
      sequence: 2,
      askedIntent: { kind: "probe", targetId: "a", aspect: "ownership", basis: "the migration" },
    });
    const state = deriveCoverageState([target("a")], [first, second], []);
    expect(state[0].askedIntents).toHaveLength(2);
    expect(state[0].turnsSpent).toBe(2);
  });

  it("counts rescues per target and per session", () => {
    const first = question("q1", {
      askedIntent: { kind: "rescue", targetId: "a", style: "narrow", hook: null },
      assistance: [{ style: "narrow", at: "2026-09-01T00:00:00.000Z" }],
    });
    const second = question("q2", {
      sequence: 2,
      askedIntent: { kind: "rescue", targetId: "b", style: "hook", hook: "the migration" },
      assistance: [{ style: "hook", at: "2026-09-01T00:01:00.000Z" }],
    });
    const state = deriveCoverageState([target("a"), target("b")], [first, second], []);
    expect(state[0].rescuesSpent).toBe(1);
    expect(state[1].rescuesSpent).toBe(1);
    expect(rescuesSpentInSession([first, second])).toBe(2);
  });

  it("does not count a non-answer turn as progress toward satisfaction", () => {
    const blank = question("q1", {
      askedIntent: { kind: "open", targetId: "a" },
      nonAnswer: true,
    });
    const state = deriveCoverageState([target("a")], [blank], []);
    expect(state[0].status).toBe("open");
  });
});

describe("canContinueOnAnsweredRow", () => {
  const limits = { maxFollowUps: 3, maxQuestions: 8 };

  it("allows one continuation off a coverage-target row", () => {
    const row = question("q1");
    expect(canContinueOnAnsweredRow([row], row, limits)).toBe(true);
  });

  it("refuses a continuation off a follow-up row", () => {
    // `record_conversation_turn` unconditionally refuses a follow-up whose
    // parent is itself a follow-up, so there is nowhere to write one.
    const row = question("follow-1", { isFollowUp: true });
    expect(canContinueOnAnsweredRow([question("q1"), row], row, limits)).toBe(false);
  });

  it("refuses a continuation once the session's follow-up budget is spent", () => {
    const row = question("q1");
    const followUps = ["f1", "f2", "f3"].map((id) => question(id, { isFollowUp: true }));
    expect(canContinueOnAnsweredRow([row, ...followUps], row, limits)).toBe(false);
  });

  it("refuses a continuation once the session's question budget is spent", () => {
    const row = question("q1");
    const rows = Array.from({ length: 8 }, (_, index) => question(`q${index + 1}`));
    expect(canContinueOnAnsweredRow(rows, row, limits)).toBe(false);
  });
});

describe("targetIdOf", () => {
  it("returns null for session-level intents", () => {
    expect(targetIdOf({ kind: "close" })).toBeNull();
    expect(targetIdOf({ kind: "candidate-questions" })).toBeNull();
  });

  it("returns the target for question-level intents", () => {
    expect(targetIdOf({ kind: "open", targetId: "a" })).toBe("a");
  });
});
