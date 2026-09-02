import { describe, expect, it } from "vitest";
import { calculateProgress } from "@/lib/progress";
import type { Competency, Evaluation, InterviewSession } from "@/lib/types";

const competency = (overrides: Partial<Competency>): Competency => ({
  id: "competency-1",
  name: "React architecture",
  relevance: 1,
  expectedLevel: "senior",
  estimatedLevel: "senior",
  confidence: "medium",
  lastPracticedAt: "2026-08-29T09:00:00.000Z",
  questionCount: 3,
  averageScore: 7,
  recentScore: 7,
  strengths: [],
  weaknesses: [],
  ...overrides,
});

const evaluation = (overrides: Partial<Evaluation>): Evaluation => ({
  score: 7,
  competencyId: "competency-1",
  competency: "React architecture",
  dimensions: {},
  strengths: [],
  needsWork: [],
  missingPoints: [],
  betterStructure: [],
  improvedAnswer: "",
  ...overrides,
});

const session = (overrides: Partial<InterviewSession>): InterviewSession => ({
  id: "session-1",
  userId: "user-1",
  kind: "conversation",
  roundId: "tech-lead",
  mode: "real",
  degraded: false,
  status: "complete",
  startedAt: "2026-08-29T09:00:00.000Z",
  completedAt: "2026-08-29T10:00:00.000Z",
  exercise: {},
  resultSummary: {},
  overallScore: 7,
  questions: [],
  checkpoints: [],
  evaluations: [],
  messages: [],
  createdAt: "2026-08-29T09:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  practicePlanId: null,
  opportunityId: null,
  ...overrides,
});

describe("calculateProgress", () => {
  it("returns an empty snapshot when there is no competency evidence", () => {
    expect(calculateProgress([], [])).toEqual({
      readiness: null,
      latestScore: null,
      trend: null,
      recentScores: [],
      strongest: null,
      weakest: null,
      recurringWeaknesses: [],
    });
  });

  it("establishes a baseline from one completed session and computes readiness from weighted evidence", () => {
    const competencies = [
      competency({
        id: "react",
        name: "React",
        relevance: 1,
        confidence: "high",
        averageScore: 8,
        recentScore: 8,
        weaknesses: ["Quantify trade-offs"],
      }),
      competency({
        id: "system-design",
        name: "System design",
        relevance: 0.8,
        confidence: "low",
        averageScore: 6,
        recentScore: 6,
        weaknesses: ["Open with requirements"],
      }),
    ];
    const completed = [
      session({
        id: "baseline",
        completedAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:05:00.000Z",
        overallScore: 8.2,
        evaluations: [
          evaluation({ competencyId: "react", competency: "React", needsWork: ["Quantify trade-offs"] }),
        ],
      }),
    ];

    expect(calculateProgress(competencies, completed)).toMatchObject({
      readiness: 75,
      latestScore: 8.2,
      trend: "baseline",
      recentScores: [8.2],
      strongest: expect.objectContaining({ id: "react" }),
      weakest: expect.objectContaining({ id: "system-design" }),
      recurringWeaknesses: ["Quantify trade-offs"],
    });
  });

  it("withholds readiness until there is at least one scored completed session", () => {
    const competencies = [
      competency({
        id: "react",
        averageScore: 8,
        recentScore: 8,
        confidence: "high",
      }),
    ];

    expect(calculateProgress(competencies, [
      session({
        id: "active-session",
        status: "active",
        completedAt: null,
        updatedAt: "2026-08-29T12:05:00.000Z",
        overallScore: 8.2,
      }),
      session({
        id: "complete-without-score",
        completedAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:05:00.000Z",
        overallScore: null,
      }),
    ])).toMatchObject({
      readiness: null,
      latestScore: null,
      trend: null,
      recentScores: [],
      strongest: expect.objectContaining({ id: "react" }),
      weakest: expect.objectContaining({ id: "react" }),
    });
  });

  it("sorts completed sessions newest-first and marks an improving trend above the boundary", () => {
    const competencies = [
      competency({ id: "react", averageScore: 8, confidence: "high" }),
    ];
    const older = session({
      id: "older",
      completedAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      overallScore: 6.1,
      evaluations: [evaluation({ needsWork: ["Be more specific"] })],
    });
    const newer = session({
      id: "newer",
      completedAt: "2026-08-28T10:00:00.000Z",
      updatedAt: "2026-08-28T10:05:00.000Z",
      overallScore: 7,
      evaluations: [evaluation({ needsWork: ["State the metric first"] })],
    });
    const latest = session({
      id: "latest",
      completedAt: null,
      updatedAt: "2026-08-29T10:00:00.000Z",
      overallScore: 8.4,
      evaluations: [evaluation({ needsWork: ["Name the trade-off"] })],
    });

    expect(calculateProgress(competencies, [newer, latest, older])).toMatchObject({
      latestScore: 8.4,
      trend: "improving",
      recentScores: [8.4, 7, 6.1],
      recurringWeaknesses: ["Name the trade-off", "State the metric first", "Be more specific"],
    });
  });

  it("classifies small movement as stable and negative movement beyond the boundary as declining", () => {
    const competencies = [competency({ id: "react", averageScore: 7, confidence: "medium" })];
    const stable = calculateProgress(competencies, [
      session({ id: "older", completedAt: "2026-08-20T10:00:00.000Z", updatedAt: "2026-08-20T10:00:00.000Z", overallScore: 7.5 }),
      session({ id: "newer", completedAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z", overallScore: 7.9 }),
    ]);
    const declining = calculateProgress(competencies, [
      session({ id: "older", completedAt: "2026-08-20T10:00:00.000Z", updatedAt: "2026-08-20T10:00:00.000Z", overallScore: 8.6 }),
      session({ id: "newer", completedAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z", overallScore: 7.6 }),
    ]);

    expect(stable.trend).toBe("stable");
    expect(declining.trend).toBe("declining");
  });

  it("deduplicates recurring weaknesses by newest evidence and clamps scores into range", () => {
    const competencies = [
      competency({
        id: "react",
        averageScore: 11,
        recentScore: 11,
        confidence: "high",
      }),
      competency({
        id: "testing",
        name: "Testing",
        relevance: 0.6,
        averageScore: -2,
        recentScore: -2,
        confidence: "low",
      }),
    ];

    const snapshot = calculateProgress(competencies, [
      session({
        id: "older",
        completedAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        overallScore: -5,
        evaluations: [
          evaluation({ competencyId: "react", needsWork: ["Add metrics", "Discuss constraints"] }),
        ],
      }),
      session({
        id: "newer",
        completedAt: "2026-08-28T10:00:00.000Z",
        updatedAt: "2026-08-28T10:00:00.000Z",
        overallScore: 11,
        evaluations: [
          evaluation({ competencyId: "react", needsWork: ["Discuss constraints", "Lead with impact"] }),
        ],
      }),
    ]);

    expect(snapshot.latestScore).toBe(10);
    expect(snapshot.recentScores).toEqual([10, 0]);
    expect(snapshot.strongest?.averageScore).toBe(10);
    expect(snapshot.weakest?.averageScore).toBe(0);
    expect(snapshot.recurringWeaknesses).toEqual(["Discuss constraints", "Lead with impact", "Add metrics"]);
  });

  it("does not mutate competency or session inputs", () => {
    const competencies = [competency({ id: "react", averageScore: 8, confidence: "high" })];
    const sessions = [session({ overallScore: 9, evaluations: [evaluation({ needsWork: ["Lead with impact"] })] })];
    const beforeCompetencies = structuredClone(competencies);
    const beforeSessions = structuredClone(sessions);

    calculateProgress(competencies, sessions);

    expect(competencies).toEqual(beforeCompetencies);
    expect(sessions).toEqual(beforeSessions);
  });
});
