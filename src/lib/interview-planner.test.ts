import { describe, expect, it } from "vitest";
import {
  appendFollowUp,
  buildFallbackInterviewBlueprint,
  buildInterviewPlan,
  chooseDifficulty,
  validateInterviewBlueprint,
} from "@/lib/interview-planner";
import type { Competency, EvidenceItem, InterviewBlueprint, PlannedQuestion, ProfileDraft } from "@/lib/types";

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

const evidence: EvidenceItem[] = [
  {
    id: "evidence-1",
    sourceKind: "cv",
    sourceExcerpt: "Led a React migration for checkout.",
    projectOrEmployer: "Checkout Platform",
    ownership: "Owned the frontend migration end to end.",
    technologies: ["React", "TypeScript"],
    decision: "Split a large route into smaller bundles.",
    constraint: "Tight launch window.",
    outcome: "Cut bundle size by 28%.",
    recency: "2025-02",
    confidence: 0.94,
  },
  {
    id: "evidence-2",
    sourceKind: "cv",
    sourceExcerpt: "Built observability for API regressions.",
    projectOrEmployer: "Reliability Tooling",
    ownership: "Designed the dashboard and alerting flow.",
    technologies: ["Next.js", "Postgres"],
    decision: "Added release health dashboards.",
    constraint: "Small team with limited bandwidth.",
    outcome: "Reduced incident triage time by 35%.",
    recency: "2024-11",
    confidence: 0.91,
  },
];

const profile: ProfileDraft = {
  role: "Frontend Engineer",
  seniority: "Senior",
  summary: "Frontend engineer focused on performance and delivery.",
  narrative: "Owns frontend platforms and reliability work.",
  expertise: ["React", "TypeScript", "Next.js"],
  characteristics: ["Pragmatic"],
  competencies: [
    { name: "React architecture", relevance: 1 },
    { name: "System design", relevance: 0.8 },
  ],
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

  it("uses the injected current time when ranking practice recency", () => {
    const practicedLongAgo: Competency = {
      ...unassessedReact,
      id: "older-practice",
      name: "JavaScript",
      relevance: 0.72,
      confidence: "high",
      lastPracticedAt: "2026-01-01T00:00:00.000Z",
    };
    const practicedRecently: Competency = {
      ...unassessedReact,
      id: "recent-practice",
      name: "TypeScript",
      relevance: 0.9,
      confidence: "high",
      lastPracticedAt: "2026-12-31T00:00:00.000Z",
    };

    const plan = buildInterviewPlan(
      [practicedRecently, practicedLongAgo],
      "Senior",
      new Date("2027-01-01T00:00:00.000Z"),
    );

    expect(plan[1].competencyName).toBe("JavaScript");
  });

  it("validates a grounded five-question blueprint that only references known evidence", () => {
    const blueprint: InterviewBlueprint = {
      status: "grounded",
      fallbackReason: null,
      maxFollowUps: 3,
      maxQuestions: 8,
      createdAt: "2026-08-29T00:00:00.000Z",
      questions: [
        {
          id: "question-1",
          sequence: 1,
          category: "introduction",
          competencyId: null,
          competencyName: null,
          difficulty: "senior",
          isFollowUp: false,
          prompt: "Give me a concise introduction to yourself and the frontend work you have owned recently.",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "Establish recent engineering ownership.",
          evidenceIds: [],
          expectedSignals: ["role summary", "recent ownership"],
          missingSignalPrompts: ["Name the most recent engineering area you owned."],
          followUpLimit: 0,
          sourceConfidence: null,
        },
        {
          id: "question-2",
          sequence: 2,
          category: "experience",
          competencyId: "react",
          competencyName: "React",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "Tell me about the Checkout Platform migration.",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "Probe the checkout migration ownership and impact.",
          evidenceIds: ["evidence-1"],
          expectedSignals: ["role", "trade-off", "outcome"],
          missingSignalPrompts: ["Name the launch trade-off you accepted."],
          followUpLimit: 1,
          sourceConfidence: 0.94,
        },
        {
          id: "question-3",
          sequence: 3,
          category: "technical",
          competencyId: "react",
          competencyName: "React",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "Walk me through the route-splitting decision.",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "Probe the migration trade-off decision.",
          evidenceIds: ["evidence-1"],
          expectedSignals: ["decision", "constraint", "trade-off"],
          missingSignalPrompts: ["What trade-off did you reject?"],
          followUpLimit: 1,
          sourceConfidence: 0.94,
        },
        {
          id: "question-4",
          sequence: 4,
          category: "architecture",
          competencyId: "system-design",
          competencyName: "System design",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "How did you shape observability for API regressions?",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "Probe observability system design choices.",
          evidenceIds: ["evidence-2"],
          expectedSignals: ["requirements", "signal design", "constraint"],
          missingSignalPrompts: ["Which alert trade-off mattered most?"],
          followUpLimit: 1,
          sourceConfidence: 0.91,
        },
        {
          id: "question-5",
          sequence: 5,
          category: "behavioral",
          competencyId: "system-design",
          competencyName: "System design",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "How did you align the team on the release-health dashboards?",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "Probe cross-functional delivery around observability work.",
          evidenceIds: ["evidence-2"],
          expectedSignals: ["collaboration", "decision", "impact"],
          missingSignalPrompts: ["Who disagreed and how did you resolve it?"],
          followUpLimit: 0,
          sourceConfidence: 0.91,
        },
      ],
    };

    expect(validateInterviewBlueprint(blueprint, evidence)).toEqual(blueprint);
  });

  it("rejects blueprint questions that reference missing evidence ids", () => {
    expect(() => validateInterviewBlueprint({
      status: "grounded",
      fallbackReason: null,
      maxFollowUps: 3,
      maxQuestions: 8,
      createdAt: "2026-08-29T00:00:00.000Z",
      questions: [
        {
          id: "question-1",
          sequence: 1,
          category: "introduction",
          competencyId: null,
          competencyName: null,
          difficulty: "senior",
          isFollowUp: false,
          prompt: "intro",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "intro",
          evidenceIds: [],
          expectedSignals: ["signal"],
          missingSignalPrompts: ["prompt"],
          followUpLimit: 0,
          sourceConfidence: null,
        },
        {
          id: "question-2",
          sequence: 2,
          category: "experience",
          competencyId: null,
          competencyName: "React",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "experience",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "experience",
          evidenceIds: ["missing-evidence"],
          expectedSignals: ["signal"],
          missingSignalPrompts: ["prompt"],
          followUpLimit: 1,
          sourceConfidence: 0.9,
        },
        {
          id: "question-3",
          sequence: 3,
          category: "technical",
          competencyId: null,
          competencyName: "React",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "technical",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "technical",
          evidenceIds: ["evidence-1"],
          expectedSignals: ["signal"],
          missingSignalPrompts: ["prompt"],
          followUpLimit: 1,
          sourceConfidence: 0.9,
        },
        {
          id: "question-4",
          sequence: 4,
          category: "architecture",
          competencyId: null,
          competencyName: "System design",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "architecture",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "architecture",
          evidenceIds: ["evidence-2"],
          expectedSignals: ["signal"],
          missingSignalPrompts: ["prompt"],
          followUpLimit: 1,
          sourceConfidence: 0.9,
        },
        {
          id: "question-5",
          sequence: 5,
          category: "behavioral",
          competencyId: null,
          competencyName: "System design",
          difficulty: "senior",
          isFollowUp: false,
          prompt: "behavioral",
          answer: null,
          createdAt: "2026-08-29T00:00:00.000Z",
          objective: "behavioral",
          evidenceIds: ["evidence-2"],
          expectedSignals: ["signal"],
          missingSignalPrompts: ["prompt"],
          followUpLimit: 0,
          sourceConfidence: 0.9,
        },
      ],
    }, evidence)).toThrow("unknown evidence");
  });

  it("builds a deterministic limited-grounding fallback blueprint with bounded follow-ups", () => {
    const blueprint = buildFallbackInterviewBlueprint(
      profile,
      [strongReact, weakSystemDesign],
      evidence,
      new Date("2026-08-29T00:00:00.000Z"),
    );

    expect(blueprint.status).toBe("limited-grounding");
    expect(blueprint.maxFollowUps).toBe(3);
    expect(blueprint.maxQuestions).toBe(8);
    expect(blueprint.questions).toHaveLength(5);
    expect(blueprint.questions[1]).toMatchObject({
      category: "experience",
      evidenceIds: ["evidence-1"],
      objective: expect.stringContaining("Checkout Platform"),
    });
    expect(validateInterviewBlueprint(blueprint, evidence)).toEqual(blueprint);
  });

  it("matches fallback evidence to the selected competency instead of the evidence array position", () => {
    const reversedEvidence = [...evidence].reverse();
    const blueprint = buildFallbackInterviewBlueprint(
      profile,
      [strongReact, weakSystemDesign],
      reversedEvidence,
      new Date("2026-08-29T00:00:00.000Z"),
    );

    expect(blueprint.questions[1]).toMatchObject({
      category: "experience",
      competencyName: "React",
      evidenceIds: ["evidence-1"],
    });
    expect(blueprint.questions[3]).toMatchObject({
      category: "architecture",
      competencyName: "System design",
      evidenceIds: ["evidence-2"],
    });
  });
});
