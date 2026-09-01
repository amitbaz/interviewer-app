import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  analyzeProfile,
  assessProfileReadiness,
  extractEngineeringEvidence,
  extractPdfText,
  evaluateAnswer,
  generateInterviewBlueprint,
  generatePracticeBlueprint,
  initialQuestion,
  nextTurn,
} from "@/lib/coach";
import type {
  BlueprintQuestion,
  EvidenceItem,
  InterviewBlueprint,
  InterviewSession,
  Opportunity,
  PlannedQuestion,
  PracticeBlueprintContext,
  PracticePlan,
  Profile,
  ProfileDraft,
} from "@/lib/types";

const planned = (overrides: Partial<PlannedQuestion>): PlannedQuestion => ({
  id: "question-1",
  sequence: 1,
  category: "technical",
  competencyId: "react-id",
  competencyName: "React architecture",
  difficulty: "senior",
  isFollowUp: false,
  prompt: "Generic prompt",
  answer: null,
  createdAt: "2026-08-29T10:00:00.000Z",
  ...overrides,
});

const session = (questions: PlannedQuestion[]): InterviewSession => ({
  id: "session-1",
  userId: "user-1",
  kind: "conversation",
  status: "active",
  startedAt: "2026-08-29T10:00:00.000Z",
  completedAt: null,
  exercise: {},
  resultSummary: {},
  overallScore: null,
  questions,
  checkpoints: [],
  evaluations: [],
  messages: [],
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  practicePlanId: null,
  opportunityId: null,
});

const dimensionKeys = [
  "correctness",
  "depth",
  "clarity",
  "structure",
  "practicalExperience",
  "tradeOffAwareness",
  "communication",
  "confidence",
  "relevance",
] as const;

const blueprintEvidence: EvidenceItem[] = [
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

const blueprintProfile: ProfileDraft = {
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

const practiceProfile: Profile = {
  userId: "user-1",
  role: "Frontend Engineer",
  seniority: "Senior",
  summary: "Frontend engineer focused on performance and delivery.",
  narrative: "Owns frontend platforms and reliability work.",
  expertise: ["React", "TypeScript", "Next.js"],
  characteristics: ["Pragmatic"],
  competencies: [
    {
      id: "react-architecture",
      name: "React architecture",
      relevance: 1,
      expectedLevel: "senior",
      estimatedLevel: "senior",
      confidence: "high",
      lastPracticedAt: null,
      questionCount: 0,
      averageScore: null,
      recentScore: null,
      strengths: [],
      weaknesses: [],
    },
  ],
  source: { cvText: "At Acme I led a React migration for checkout.", coverLetter: "" },
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
};

const practicePlan = (overrides: Partial<PracticePlan> = {}): PracticePlan => ({
  id: "plan-1",
  userId: "user-1",
  status: "ready",
  primaryFocus: "React architecture trade-offs",
  secondaryFocus: null,
  rationale: "Upcoming onsite focuses on frontend architecture decisions.",
  format: "targeted_drill",
  estimatedMinutes: 20,
  successCriteria: ["Name a concrete trade-off with a measured outcome."],
  priorityScore: null,
  priorityFactors: {},
  generationError: null,
  completedAt: null,
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  opportunities: [],
  ...overrides,
});

const practiceContext: PracticeBlueprintContext = {
  primaryOpportunity: null,
  supportingOpportunities: [],
  observations: [],
  stories: [],
};

const groundedBlueprint = (question: PlannedQuestion, overrides: Partial<InterviewBlueprint["questions"][number]> = {}): InterviewBlueprint => ({
  status: "grounded",
  fallbackReason: null,
  maxFollowUps: 3,
  maxQuestions: 8,
  createdAt: "2026-08-29T10:00:00.000Z",
  questions: [
    {
      ...question,
      objective: "Probe the migration ownership and impact.",
      evidenceIds: ["evidence-1"],
      expectedSignals: ["ownership", "trade-off", "impact"],
      missingSignalPrompts: ["Name the trade-off you accepted."],
      followUpLimit: 1,
      sourceConfidence: 0.94,
      rubricCriteria: [
        "Name the project or work example.",
        "Describe the candidate's role and ownership.",
        "Explain the decision, trade-off, and outcome.",
      ],
      ...overrides,
    },
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("initialQuestion", () => {
  it("grounds an experience prompt in the planned competency and CV context", () => {
    const question = initialQuestion(
      { role: "Frontend Engineer" },
      {
        id: "question-1", sequence: 2, category: "experience", competencyId: "react-id",
        competencyName: "React architecture", difficulty: "senior", isFollowUp: false,
        prompt: "", answer: null, createdAt: "",
      },
      { cvText: "At Acme I led a React migration for the checkout team.", coverLetter: "" },
    );

    expect(question).toContain("React architecture");
    expect(question).toContain("Acme");
  });

  it("falls back to a backend-oriented software-engineering profile when Gemini is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const profile = await analyzeProfile(
      "Built Node.js APIs for a payments platform. Owned Postgres migrations and improved production reliability.",
      "",
    );

    expect(profile.role).toBe("Backend Engineer");
    expect(profile.summary).toContain("software-engineering");
    expect(profile.expertise).toEqual(expect.arrayContaining(["Node.js", "Postgres", "Reliability"]));
    expect(profile.competencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Node.js" }),
      expect.objectContaining({ name: "Postgres" }),
    ]));
  });

  it("bounds a single long CV sentence before placing it in an interview prompt", () => {
    const cvText = `React migration ${"confidential detail ".repeat(80)}TAIL_MARKER.`;
    const question = initialQuestion(
      { role: "Frontend Engineer" },
      planned({ category: "experience" }),
      { cvText, coverLetter: "" },
    );

    expect(question.length).toBeLessThan(700);
    expect(question).not.toContain("TAIL_MARKER");
  });

  it("frames the first interviewer prompt around the candidate's engineering role", () => {
    const question = initialQuestion(
      { role: "Backend Engineer" },
      planned({ category: "introduction" }),
      { cvText: "Built backend systems and APIs.", coverLetter: "" },
    );

    expect(question).toContain("backend work");
    expect(question).not.toContain("frontend");
  });

  it("identifies the evaluator as a software-engineering interviewer", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              question: "How would you design the backend rollout?",
              shouldFollowUp: false,
              evaluation: {
                score: 7,
                competency: "Ignored by normalization",
                relevance: 7,
                dimensions: {
                  correctness: 7,
                  depth: 7,
                  clarity: 7,
                  structure: 7,
                  practicalExperience: 7,
                  tradeOffAwareness: 7,
                  communication: 7,
                  confidence: 7,
                  relevance: 7,
                },
                strengths: ["Specific example"],
                needsWork: ["Add one trade-off"],
                missingPoints: ["Call out the risk"],
                betterStructure: ["Start with the constraint, then the plan."],
                improvedAnswer: "I would start with the constraint, explain the plan, and close with the trade-off.",
                supportedClaims: ["I would start with the constraint."],
                expectedSignalsPresent: ["decision"],
                unsupportedClaims: [],
                dimensionReasons: {
                  correctness: "The answer addresses the prompt.",
                  depth: "It includes a concrete plan.",
                  clarity: "It is easy to follow.",
                  structure: "It has a clear sequence.",
                  practicalExperience: "It refers to shipped work.",
                  tradeOffAwareness: "It names the trade-off.",
                  communication: "It is concise.",
                  confidence: "It is direct.",
                  relevance: "It answers the backend rollout question.",
                },
              },
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const answeredQuestion = planned({ id: "question-1", sequence: 1, category: "experience", prompt: "Tell me about the rollout." });
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });

    await nextTurn(
      { role: "Backend Engineer", seniority: "Senior", expertise: ["Node.js"], narrative: "Owns backend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "Built backend systems and APIs.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I led the backend rollout, accepted a staged release, and measured the result.",
    );

    expect(fetchSpy).toHaveBeenCalled();
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.contents[0].parts[0].text).toContain("software-engineering interviewer");
    expect(requestBody.contents[0].parts[0].text).not.toContain("senior-frontend interviewer");
    expect(requestBody.contents[0].parts[0].text).toContain("rubricCriteria");
  });

  it("returns a generated prompt for the next planned question when no follow-up is warranted", async () => {
    const answeredQuestion = planned({ id: "question-1", sequence: 1, category: "experience" });
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "At Acme I led a React migration and measured checkout performance.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I measured the rollout, made the trade-off explicit, and compared alternatives with the team. ".repeat(4),
    );

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toContain("System design");
    expect(turn.nextQuestion).not.toBe(nextQuestion.prompt);
    expect(Object.keys(turn.evaluation.dimensions).sort()).toEqual([...dimensionKeys].sort());
    expect(turn.evaluation.missingPoints).toEqual([expect.any(String)]);
    expect(turn.evaluation.betterStructure.length).toBeGreaterThan(0);
    expect(turn.evaluation.improvedAnswer).toEqual(expect.any(String));
  });

  it("scores a relevant answer higher than an unrelated answer of the same length", async () => {
    const blueprint = groundedBlueprint(planned({
      id: "question-1",
      sequence: 2,
      category: "experience",
      competencyId: "react-id",
      competencyName: "React architecture",
      difficulty: "senior",
      isFollowUp: false,
      prompt: "Tell me about the checkout migration.",
      answer: null,
      createdAt: "2026-08-29T10:00:00.000Z",
    }));
    const relevantAnswer = "I led the checkout migration, split bundles, and measured a 28% drop in bundle size.";
    const unrelatedAnswer = "I enjoy solving puzzles and learning new things every day.".padEnd(relevantAnswer.length, ".");

    const relevant = await evaluateAnswer(
      blueprint.questions[0],
      blueprint,
      blueprintProfile,
      relevantAnswer,
      "interviewer: Tell me about the checkout migration.",
    );
    const unrelated = await evaluateAnswer(
      blueprint.questions[0],
      blueprint,
      blueprintProfile,
      unrelatedAnswer,
      "interviewer: Tell me about the checkout migration.",
    );

    expect(relevantAnswer.length).toBe(unrelatedAnswer.length);
    expect(relevant.score).toBeGreaterThan(unrelated.score);
    expect(relevant.relevance).toBeGreaterThan(unrelated.relevance);
    expect(relevant.supportedClaims.length).toBeGreaterThan(0);
    expect(relevant.expectedSignalsPresent).toEqual(expect.arrayContaining(["ownership", "trade-off", "impact"]));
    expect(unrelated.expectedSignalsPresent).toEqual([]);
    expect(unrelated.unsupportedClaims.length).toBeGreaterThan(0);
    expect(relevant.dimensionReasons.relevance).toContain("checkout migration");
  });

  it("does not create a follow-up when the rubric explicitly sets the follow-up limit to zero", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              question: "How would you shape the observability design for that rollout?",
              shouldFollowUp: true,
              evaluation: {
                score: 7.7,
                competency: "Ignored by normalization",
                relevance: 8.1,
                dimensions: {
                  correctness: 8,
                  depth: 7,
                  clarity: 8,
                  structure: 8,
                  practicalExperience: 7,
                  tradeOffAwareness: 8,
                  communication: 8,
                  confidence: 7,
                  relevance: 8,
                },
                strengths: ["Specific collaboration example"],
                needsWork: ["Name the trade-off earlier"],
                missingPoints: ["Add the launch constraint."],
                betterStructure: ["Start with the disagreement, then show the outcome."],
                improvedAnswer: "I aligned engineering and product on the rollout, named the trade-off, and measured the outcome.",
                supportedClaims: ["I aligned engineering and product on the rollout."],
                expectedSignalsPresent: ["ownership", "impact"],
                unsupportedClaims: [],
                dimensionReasons: {
                  correctness: "The answer addresses the rollout question.",
                  depth: "It includes a concrete coordination example.",
                  clarity: "It is concise and direct.",
                  structure: "It follows a clear sequence.",
                  practicalExperience: "It refers to shipped work.",
                  tradeOffAwareness: "It names the rollout trade-off.",
                  communication: "It is easy to follow.",
                  confidence: "It states the ownership directly.",
                  relevance: "It answers the rollout prompt.",
                },
              },
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const answeredQuestion = planned({
      id: "question-1",
      sequence: 1,
      category: "experience",
      prompt: "Tell me about the checkout migration.",
    });
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });
    const blueprint = groundedBlueprint(answeredQuestion, { followUpLimit: 0 });

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "At Acme I led the checkout migration and aligned engineering with product.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I aligned engineering and product on the checkout migration, accepted extra QA during rollout, and measured the impact after launch.",
      blueprint,
    );

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toBe("Design an approach involving System design. Start with the requirements you would clarify.");
  });

  it("respects the per-question follow-up cap when the same question already has a follow-up", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              question: "How would you shape the observability design for that rollout?",
              shouldFollowUp: true,
              evaluation: {
                score: 7.7,
                competency: "Ignored by normalization",
                relevance: 8.1,
                dimensions: {
                  correctness: 8,
                  depth: 7,
                  clarity: 8,
                  structure: 8,
                  practicalExperience: 7,
                  tradeOffAwareness: 8,
                  communication: 8,
                  confidence: 7,
                  relevance: 8,
                },
                strengths: ["Specific collaboration example"],
                needsWork: ["Name the trade-off earlier"],
                missingPoints: ["Add the launch constraint."],
                betterStructure: ["Start with the disagreement, then show the outcome."],
                improvedAnswer: "I aligned engineering and product on the rollout, named the trade-off, and measured the outcome.",
                supportedClaims: ["I aligned engineering and product on the rollout."],
                expectedSignalsPresent: ["ownership", "impact"],
                unsupportedClaims: [],
                dimensionReasons: {
                  correctness: "The answer addresses the rollout question.",
                  depth: "It includes a concrete coordination example.",
                  clarity: "It is concise and direct.",
                  structure: "It follows a clear sequence.",
                  practicalExperience: "It refers to shipped work.",
                  tradeOffAwareness: "It names the rollout trade-off.",
                  communication: "It is easy to follow.",
                  confidence: "It states the ownership directly.",
                  relevance: "It answers the rollout prompt.",
                },
              },
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const answeredQuestion = groundedBlueprint(planned({
      id: "question-1",
      sequence: 1,
      category: "experience",
      prompt: "Tell me about the checkout migration.",
    })).questions[0];
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });
    const priorFollowUp = {
      id: "question-1a",
      sequence: 2,
      category: "experience" as const,
      competencyId: answeredQuestion.competencyId,
      competencyName: answeredQuestion.competencyName,
      difficulty: answeredQuestion.difficulty,
      isFollowUp: true,
      prompt: "Tell me more about the migration trade-off.",
      answer: "I kept the release staged.",
      createdAt: "2026-08-29T10:00:00.000Z",
      parentQuestionId: answeredQuestion.id,
      objective: answeredQuestion.objective,
      evidenceIds: answeredQuestion.evidenceIds,
      expectedSignals: answeredQuestion.expectedSignals,
      missingSignalPrompts: answeredQuestion.missingSignalPrompts,
      rubricCriteria: answeredQuestion.rubricCriteria,
      followUpLimit: answeredQuestion.followUpLimit,
      sourceConfidence: answeredQuestion.sourceConfidence,
    } satisfies PlannedQuestion;
    const blueprint = groundedBlueprint(answeredQuestion);

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "At Acme I led a React migration and measured checkout performance.", coverLetter: "" },
      session([answeredQuestion, priorFollowUp, nextQuestion]),
      "I aligned engineering and product on the rollout, accepted extra QA during rollout, and measured the impact after launch.",
      blueprint,
    );

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toBe("Design an approach involving System design. Start with the requirements you would clarify.");
  });

  it("does not request a follow-up solely because a relevant answer is concise", async () => {
    const answeredQuestion = planned({
      id: "question-1",
      sequence: 1,
      category: "experience",
      prompt: "Tell me about the checkout migration.",
    });
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });
    const blueprint = groundedBlueprint(answeredQuestion);

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "At Acme I led a React migration and measured checkout performance.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I led the checkout migration, split bundles by route, accepted extra QA during rollout, and measured a 28% bundle-size drop.",
      blueprint,
    );

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toContain("System design");
    expect(turn.evaluation.relevance).toBeGreaterThan(6);
    expect(turn.evaluation.relevance).toBeLessThan(8);
    expect(turn.evaluation.expectedSignalsPresent).toEqual(expect.arrayContaining(["ownership", "trade-off", "impact"]));
  });

  it("rejects schema-valid Gemini praise when the answer is unrelated to the exact question", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              question: "What is your favorite CSS property?",
              shouldFollowUp: false,
              evaluation: {
                score: 9.1,
                competency: "Ignored by normalization",
                relevance: 9.4,
                dimensions: {
                  correctness: 9,
                  depth: 9,
                  clarity: 9,
                  structure: 9,
                  practicalExperience: 9,
                  tradeOffAwareness: 9,
                  communication: 9,
                  confidence: 9,
                  relevance: 9,
                },
                strengths: ["Clear migration ownership"],
                needsWork: ["Add a metric"],
                missingPoints: ["Explain the rollback trigger."],
                betterStructure: ["Start with the constraint, then the decision."],
                improvedAnswer: "I led the checkout migration, accepted the rollout trade-off, and measured the impact after launch.",
                supportedClaims: ["I led the checkout migration and measured the rollout."],
                expectedSignalsPresent: ["ownership", "trade-off", "impact"],
                unsupportedClaims: [],
                dimensionReasons: {
                  correctness: "The answer directly addresses the migration objective.",
                  depth: "It includes detailed rollout evidence.",
                  clarity: "It is organized and specific.",
                  structure: "It flows from constraint to result.",
                  practicalExperience: "It is grounded in the candidate's shipped migration.",
                  tradeOffAwareness: "It names the trade-off explicitly.",
                  communication: "It is concise and clear.",
                  confidence: "It states the ownership directly.",
                  relevance: "It answers the checkout migration question.",
                },
              },
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const question = groundedBlueprint(planned({
      id: "question-1",
      sequence: 2,
      category: "experience",
      competencyId: "react-id",
      competencyName: "React architecture",
      difficulty: "senior",
      isFollowUp: false,
      prompt: "Tell me about the checkout migration.",
      answer: null,
      createdAt: "2026-08-29T10:00:00.000Z",
    })).questions[0];

    const evaluation = await evaluateAnswer(
      question,
      { status: "grounded", fallbackReason: null, maxFollowUps: 3, maxQuestions: 8, createdAt: "2026-08-29T10:00:00.000Z", questions: [question] },
      blueprintProfile,
      "I enjoy mentoring, reading docs, and learning new tools every week.",
      "interviewer: Tell me about the checkout migration.",
    );

    expect(evaluation.score).toBeLessThan(6.5);
    expect(evaluation.relevance).toBeLessThan(5);
    expect(evaluation.expectedSignalsPresent).toEqual([]);
    expect(evaluation.supportedClaims).toEqual([]);
    expect(evaluation.unsupportedClaims.length).toBeGreaterThan(0);
    expect(evaluation.dimensionReasons.relevance).toContain("does not directly answer");
  });

  it("preserves grounded coaching fields while stripping ungrounded model claims", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              question: "How would you phase the migration?",
              shouldFollowUp: false,
              evaluation: {
                score: 8.4,
                competency: "Ignored by normalization",
                relevance: 8.7,
                dimensions: {
                  correctness: 8,
                  depth: 8,
                  clarity: 8,
                  structure: 9,
                  practicalExperience: 8,
                  tradeOffAwareness: 8,
                  communication: 8,
                  confidence: 7,
                  relevance: 9,
                },
                strengths: ["Specific trade-off framing"],
                needsWork: ["Quantify the rollout risk"],
                missingPoints: ["Explain the rollback trigger."],
                betterStructure: ["Start with constraints, then explain the migration phases."],
                improvedAnswer: "I would start with the constraints, phase the migration, and define the rollback trigger before rollout.",
                supportedClaims: ["I phased the rollout carefully."],
                expectedSignalsPresent: ["trade-off", "impact"],
                unsupportedClaims: ["We shipped it perfectly."],
                dimensionReasons: {
                  correctness: "The answer matches the migration question.",
                  depth: "The answer mentions rollout phases and a metric.",
                  clarity: "It is organized and specific.",
                  structure: "It starts with the constraint and ends with the rollback trigger.",
                  practicalExperience: "It refers to an actual migration.",
                  tradeOffAwareness: "It names the rollout trade-off.",
                  communication: "It is concise and explainable.",
                  confidence: "It is stated directly.",
                  relevance: "It answers the checkout migration question.",
                },
              },
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    // evidenceIds is non-empty so this question keeps a source-evidence
    // target: the model's unsupportedClaims must still pass through.
    const answeredQuestion = planned({ id: "question-1", sequence: 1, category: "experience", evidenceIds: ["evidence-1"] });
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "At Acme I led a React migration and measured checkout performance.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I phased the rollout carefully, compared alternatives with the team, made the trade-off explicit, and measured the impact after each milestone. ".repeat(2),
    );

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toBe("Design an approach involving System design. Start with the requirements you would clarify.");
    expect(turn.evaluation.competencyId).toBe("react-id");
    expect(turn.evaluation.competency).toBe("React architecture");
    expect(turn.evaluation.score).toBe(8.4);
    expect(turn.evaluation.relevance).toBe(8.7);
    expect(turn.evaluation.supportedClaims).toEqual(["I phased the rollout carefully."]);
    expect(turn.evaluation.expectedSignalsPresent).toEqual(["trade-off", "impact"]);
    expect(turn.evaluation.unsupportedClaims).toEqual(["We shipped it perfectly."]);
    expect(turn.evaluation.improvedAnswer).toContain("rollback trigger");
    expect(turn.evaluation.dimensionReasons).toBeDefined();
    expect(turn.evaluation.dimensionReasons?.correctness).toContain("migration question");
    expect(turn.evaluation.dimensionReasons?.relevance).toContain("checkout migration question");
  });

  describe("discovery answers with no source evidence target", () => {
    const discoveryQuestion: BlueprintQuestion = {
      ...planned({
        id: "discovery-question-1",
        category: "experience",
        prompt: "Think of one piece of work you remember clearly. What part were you responsible for?",
      }),
      objective: "Discover a real work example and personal ownership.",
      evidenceIds: [],
      expectedSignals: ["ownership", "trade-off", "impact"],
      missingSignalPrompts: ["What changed because of your work?"],
      rubricCriteria: [
        "Name a real work example.",
        "Describe personal responsibility.",
        "Explain one action or decision and its result when remembered.",
      ],
      followUpLimit: 1,
      sourceConfidence: null,
    };
    const discoveryBlueprint: InterviewBlueprint = {
      status: "limited-grounding",
      fallbackReason: null,
      maxFollowUps: 3,
      maxQuestions: 8,
      createdAt: "2026-08-29T10:00:00.000Z",
      questions: [discoveryQuestion],
    };

    it("scores a relevant discovery answer without treating newly supplied facts as unsupported", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");

      const relevantAnswer = "At my previous company I rebuilt our questionnaire editor. I shaped the component architecture, coordinated the migration with the team, and measured a 20% drop in load time.";
      const unrelatedAnswer = "I enjoy long weekend hikes and trying new recipes with friends after busy work weeks.".padEnd(relevantAnswer.length, ".");

      const relevant = await evaluateAnswer(
        discoveryQuestion,
        discoveryBlueprint,
        blueprintProfile,
        relevantAnswer,
        "interviewer: Think of one piece of work you remember clearly.",
      );
      const unrelated = await evaluateAnswer(
        discoveryQuestion,
        discoveryBlueprint,
        blueprintProfile,
        unrelatedAnswer,
        "interviewer: Think of one piece of work you remember clearly.",
      );

      expect(relevant.relevance).toBeGreaterThan(5);
      expect(relevant.unsupportedClaims).toEqual([]);
      expect(relevant.supportedClaims.length).toBeGreaterThan(0);
      expect(relevant.relevance).toBeGreaterThan(unrelated.relevance);
    });

    it("never surfaces a model-flagged first-person discovery detail as unsupported", async () => {
      vi.stubEnv("GEMINI_API_KEY", "private-test-key");
      vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
      const mockResponseBody = JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                question: "What was the outcome of that work?",
                shouldFollowUp: false,
                evaluation: {
                  score: 7.2,
                  competency: "Ignored by normalization",
                  relevance: 7.5,
                  dimensions: {
                    correctness: 7, depth: 7, clarity: 7, structure: 7,
                    practicalExperience: 7, tradeOffAwareness: 7, communication: 7,
                    confidence: 7, relevance: 7,
                  },
                  strengths: ["Names a concrete example"],
                  needsWork: ["Add the outcome"],
                  missingPoints: ["What changed because of your work?"],
                  betterStructure: ["Lead with the responsibility, then the outcome."],
                  improvedAnswer: "I rebuilt our questionnaire editor and shaped the component architecture.",
                  supportedClaims: ["I shaped the component architecture and coordinated the migration."],
                  expectedSignalsPresent: ["role"],
                  unsupportedClaims: ["I rebuilt our questionnaire editor."],
                  dimensionReasons: {
                    correctness: "The answer names a real example.",
                    depth: "It includes a concrete example.",
                    clarity: "It is concise.",
                    structure: "It follows a clear sequence.",
                    practicalExperience: "It refers to hands-on work.",
                    tradeOffAwareness: "It does not name a trade-off yet.",
                    communication: "It reads as a full answer.",
                    confidence: "It states the example directly.",
                    relevance: "It answers the discovery prompt.",
                  },
                },
              }),
            }],
          },
        }],
      });
      // Two evaluateAnswer calls share this mock; each needs its own Response
      // instance because a Response body can only be read once.
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(mockResponseBody, { status: 200, headers: { "Content-Type": "application/json" } }));

      const discoveryAnswer = "At my previous company I rebuilt our questionnaire editor. I shaped the component architecture and coordinated the migration with the team.";

      const discoveryResult = await evaluateAnswer(
        discoveryQuestion,
        discoveryBlueprint,
        blueprintProfile,
        discoveryAnswer,
        "interviewer: Think of one piece of work you remember clearly.",
      );

      expect(discoveryResult.unsupportedClaims).toEqual([]);

      const groundedQuestion: BlueprintQuestion = { ...discoveryQuestion, evidenceIds: ["evidence-1"] };
      const groundedBlueprintWithEvidence: InterviewBlueprint = {
        ...discoveryBlueprint,
        status: "grounded",
        questions: [groundedQuestion],
      };

      const groundedResult = await evaluateAnswer(
        groundedQuestion,
        groundedBlueprintWithEvidence,
        blueprintProfile,
        discoveryAnswer,
        "interviewer: Think of one piece of work you remember clearly.",
      );

      expect(groundedResult.unsupportedClaims).toEqual(["I rebuilt our questionnaire editor."]);
    });

    it("still asks a follow-up for a vague discovery answer even though nothing is unsupported", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");

      const nextQuestion = planned({
        id: "question-2",
        sequence: 2,
        category: "architecture",
        competencyId: "system-design-id",
        competencyName: "System design",
        prompt: "Generic architecture prompt",
      });

      const turn = await nextTurn(
        { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "" },
        discoveryQuestion,
        nextQuestion,
        { cvText: "", coverLetter: "" },
        session([discoveryQuestion, nextQuestion]),
        "I did some work once.",
        discoveryBlueprint,
      );

      expect(turn.followUp).not.toBeNull();
      expect(turn.evaluation.unsupportedClaims).toEqual([]);
    });
  });

  it("requests a bounded follow-up when a weak answer needs clarification", async () => {
    const answeredQuestion = planned({ id: "question-1", sequence: 1 });
    const nextQuestion = planned({ id: "question-2", sequence: 2, category: "architecture" });

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "" },
      answeredQuestion,
      nextQuestion,
      { cvText: "React engineer at Acme.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I used React.",
    );

    expect(turn.followUp).toMatchObject({
      category: "technical",
      competencyId: "react-id",
      competencyName: "React architecture",
      isFollowUp: true,
    });
    expect(turn.nextQuestion).toBeNull();
    expect(Object.keys(turn.evaluation.dimensions).sort()).toEqual([...dimensionKeys].sort());
    expect(turn.evaluation.missingPoints).toEqual([expect.any(String)]);
    expect(turn.evaluation.betterStructure.length).toBeGreaterThan(0);
    expect(turn.evaluation.improvedAnswer).toEqual(expect.any(String));
  });

  it("preserves the follow-up rubric contract when a clarification is needed", async () => {
    const answeredQuestion = groundedBlueprint(planned({
      id: "question-1",
      sequence: 1,
      category: "experience",
      prompt: "Tell me about the checkout migration.",
    })).questions[0];
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });

    const blueprint = groundedBlueprint(answeredQuestion);

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "At Acme I led a React migration and measured checkout performance.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I used React.",
      blueprint,
    );

    expect(turn.followUp).toMatchObject({
      objective: answeredQuestion.objective,
      evidenceIds: answeredQuestion.evidenceIds,
      expectedSignals: answeredQuestion.expectedSignals,
      missingSignalPrompts: answeredQuestion.missingSignalPrompts,
      followUpLimit: answeredQuestion.followUpLimit,
      sourceConfidence: answeredQuestion.sourceConfidence,
      rubricCriteria: answeredQuestion.rubricCriteria,
    });
  });

  it("calibrates schema-valid model praise against verified answer signals", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              question: "How would you phase the migration?",
              shouldFollowUp: false,
              evaluation: {
                score: 9.9,
                competency: "Ignored by normalization",
                relevance: 9.9,
                dimensions: {
                  correctness: 10,
                  depth: 10,
                  clarity: 10,
                  structure: 10,
                  practicalExperience: 10,
                  tradeOffAwareness: 10,
                  communication: 10,
                  confidence: 10,
                  relevance: 10,
                },
                strengths: ["Perfect migration answer"],
                needsWork: ["None"],
                missingPoints: ["None"],
                betterStructure: ["None"],
                improvedAnswer: "I would lead the checkout migration, explain the rollout trade-off, and measure the impact.",
                supportedClaims: ["I led the checkout migration and measured the rollout."],
                expectedSignalsPresent: ["ownership", "trade-off", "impact"],
                unsupportedClaims: [],
                dimensionReasons: {
                  correctness: "The answer directly addresses the migration objective.",
                  depth: "It includes detailed rollout evidence.",
                  clarity: "It is organized and specific.",
                  structure: "It flows from constraint to result.",
                  practicalExperience: "It is grounded in the candidate's shipped migration.",
                  tradeOffAwareness: "It names the trade-off explicitly.",
                  communication: "It is concise and clear.",
                  confidence: "It states the ownership directly.",
                  relevance: "It answers the checkout migration question.",
                },
              },
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const question = groundedBlueprint(planned({
      id: "question-1",
      sequence: 2,
      category: "experience",
      competencyId: "react-id",
      competencyName: "React architecture",
      difficulty: "senior",
      isFollowUp: false,
      prompt: "Tell me about the checkout migration.",
      answer: null,
      createdAt: "2026-08-29T10:00:00.000Z",
    })).questions[0];

    const evaluation = await evaluateAnswer(
      question,
      { status: "grounded", fallbackReason: null, maxFollowUps: 3, maxQuestions: 8, createdAt: "2026-08-29T10:00:00.000Z", questions: [question] },
      blueprintProfile,
      "I led the checkout migration, split bundles by route, accepted extra QA during rollout, and measured a 28% bundle-size drop.",
      "interviewer: Tell me about the checkout migration.",
    );

    expect(evaluation.score).toBe(9.9);
    expect(evaluation.relevance).toBe(9.9);
    expect(evaluation.supportedClaims).toEqual(["I led the checkout migration and measured the rollout."]);
    expect(evaluation.expectedSignalsPresent).toEqual(["ownership", "trade-off", "impact"]);
    expect(evaluation.improvedAnswer).toContain("checkout migration");
    expect(evaluation.dimensionReasons.relevance).toContain("checkout migration");
  });

  it("falls back to a deterministic evaluation when the model omits any required dimension", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              question: "How would you phase the migration?",
              shouldFollowUp: false,
              evaluation: {
                score: 8.4,
                competency: "Ignored by normalization",
                dimensions: { structure: 9, tradeOffAwareness: 8 },
                strengths: ["Specific trade-off framing"],
                needsWork: ["Quantify the rollout risk"],
                missingPoints: ["Explain the rollback trigger."],
                betterStructure: ["Start with constraints, then explain the migration phases."],
                improvedAnswer: "I would start with the constraints, phase the migration, and define the rollback trigger before rollout.",
              },
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const answeredQuestion = planned({ id: "question-1", sequence: 1, category: "experience" });
    const nextQuestion = planned({
      id: "question-2",
      sequence: 2,
      category: "architecture",
      competencyId: "system-design-id",
      competencyName: "System design",
      prompt: "Generic architecture prompt",
    });

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      answeredQuestion,
      nextQuestion,
      { cvText: "At Acme I led a React migration and measured checkout performance.", coverLetter: "" },
      session([answeredQuestion, nextQuestion]),
      "I phased the rollout carefully, compared alternatives with the team, made the trade-off explicit, and measured the impact after each milestone. ".repeat(2),
    );

    expect(turn.nextQuestion).toContain("System design");
    expect(Object.keys(turn.evaluation.dimensions).sort()).toEqual([...dimensionKeys].sort());
    expect(turn.evaluation.dimensions.structure).not.toBe(9);
  });

  it("advances a two-question practice blueprint without assuming the five-question backbone", async () => {
    const firstQuestion = groundedBlueprint(planned({
      id: "question-1",
      sequence: 1,
      category: "experience",
      prompt: "Tell me about the checkout migration.",
    })).questions[0];
    const secondQuestionPlanned = planned({
      id: "question-2",
      sequence: 2,
      category: "technical",
      competencyId: "react-id",
      competencyName: "React architecture",
      prompt: "Generic technical prompt",
    });
    const blueprint: InterviewBlueprint = {
      status: "grounded",
      fallbackReason: null,
      maxFollowUps: 1,
      maxQuestions: 3,
      createdAt: "2026-08-29T10:00:00.000Z",
      questions: [
        firstQuestion,
        {
          ...secondQuestionPlanned,
          objective: "Probe the route-splitting technical decision.",
          evidenceIds: [],
          expectedSignals: ["decision", "trade-off"],
          missingSignalPrompts: ["Name the trade-off you rejected."],
          rubricCriteria: ["Name the decision.", "Explain the trade-off."],
          followUpLimit: 1,
          sourceConfidence: null,
        },
      ],
    };

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "Owns frontend platforms." },
      firstQuestion,
      secondQuestionPlanned,
      { cvText: "At Acme I led a React migration and measured checkout performance.", coverLetter: "" },
      session([firstQuestion, secondQuestionPlanned]),
      "I led the checkout migration, split bundles by route, accepted extra QA during rollout, and measured a 28% bundle-size drop.",
      blueprint,
    );

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toContain("React architecture");
  });

  it("gates follow-ups on a three-question blueprint's own maxFollowUps rather than the generic eight-question ceiling", async () => {
    const firstQuestion = groundedBlueprint(planned({
      id: "question-1",
      sequence: 1,
      category: "experience",
      prompt: "Tell me about the checkout migration.",
    })).questions[0];
    const secondQuestion = {
      ...planned({ id: "question-2", sequence: 2, category: "technical", prompt: "Second prompt" }),
      objective: "Probe the technical decision.",
      evidenceIds: [],
      expectedSignals: ["decision", "trade-off"],
      missingSignalPrompts: ["Name the trade-off."],
      rubricCriteria: ["Name the decision.", "Explain the trade-off."],
      followUpLimit: 1,
      sourceConfidence: null,
    };
    const thirdQuestionPlanned = planned({ id: "question-3", sequence: 3, category: "behavioral", prompt: "Third prompt" });
    const blueprint: InterviewBlueprint = {
      status: "grounded",
      fallbackReason: null,
      maxFollowUps: 1,
      maxQuestions: 4,
      createdAt: "2026-08-29T10:00:00.000Z",
      questions: [
        firstQuestion,
        secondQuestion,
        {
          ...thirdQuestionPlanned,
          objective: "Probe a collaboration challenge.",
          evidenceIds: [],
          expectedSignals: ["collaboration"],
          missingSignalPrompts: ["Who did you need alignment from?"],
          rubricCriteria: ["Name the collaboration challenge."],
          followUpLimit: 1,
          sourceConfidence: null,
        },
      ],
    };
    const priorFollowUp = {
      id: "question-1a",
      sequence: 4,
      category: "experience" as const,
      competencyId: firstQuestion.competencyId,
      competencyName: firstQuestion.competencyName,
      difficulty: firstQuestion.difficulty,
      isFollowUp: true,
      prompt: "Make that migration example more concrete.",
      answer: "I kept the release staged.",
      createdAt: "2026-08-29T10:00:00.000Z",
      parentQuestionId: firstQuestion.id,
      objective: firstQuestion.objective,
      evidenceIds: firstQuestion.evidenceIds,
      expectedSignals: firstQuestion.expectedSignals,
      missingSignalPrompts: firstQuestion.missingSignalPrompts,
      rubricCriteria: firstQuestion.rubricCriteria,
      followUpLimit: firstQuestion.followUpLimit,
      sourceConfidence: firstQuestion.sourceConfidence,
    } satisfies PlannedQuestion;

    const turn = await nextTurn(
      { role: "Frontend Engineer", seniority: "Senior", expertise: ["React"], narrative: "" },
      secondQuestion,
      thirdQuestionPlanned,
      { cvText: "React engineer at Acme.", coverLetter: "" },
      session([firstQuestion, priorFollowUp, secondQuestion, thirdQuestionPlanned]),
      "I used React.",
      blueprint,
    );

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toContain("collaboration challenge related to React architecture");
  });

  it("sends PDF input without unsupported sampling parameters", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Extracted CV text with enough detail to pass the minimum response length requirement for this test." }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await extractPdfText(new File(["%PDF-1.7 test"], "cv.pdf", { type: "application/pdf" }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/models/gemini-3.6-flash:generateContent");
    const payload = JSON.parse(String(init?.body));
    expect(payload.generationConfig).toBeUndefined();
  });

  it("surfaces a sanitized Gemini status and provider message", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { code: 400, message: "Unknown name temperature. key=private-test-key" },
    }), { status: 400, headers: { "Content-Type": "application/json" } }));

    await expect(extractPdfText(
      new File(["%PDF-1.7 test"], "cv.pdf", { type: "application/pdf" }),
    )).rejects.toThrow("Gemini rejected the PDF (400): Unknown name temperature. key=[redacted]");
  });

  it("logs a safe operation label when PDF extraction is rate limited", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { code: 429, message: "Too many requests key=private-test-key" },
    }), { status: 429, headers: { "Content-Type": "application/json" } }));

    await expect(extractPdfText(
      new File(["%PDF-1.7 test"], "cv.pdf", { type: "application/pdf" }),
    )).rejects.toThrow("Gemini rate limit reached for the PDF (429)");
    expect(consoleWarn).toHaveBeenCalledWith("[gemini] request failed", expect.objectContaining({
      operation: "the PDF",
      state: "rate-limited",
      status: 429,
      model: "gemini-3.6-flash",
    }));
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("private-test-key");
    consoleWarn.mockRestore();
  });

  it("rejects PDFs above the safe Vercel request limit before calling Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const oversizedPdf = new File(
      [new Uint8Array(4 * 1024 * 1024 + 1)],
      "large-cv.pdf",
      { type: "application/pdf" },
    );

    await expect(extractPdfText(oversizedPdf)).rejects.toThrow("under 4 MB");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("extractEngineeringEvidence", () => {
  it("verifies Gemini evidence against the supplied text and nulls unsupported facts", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify([
              {
                id: "evidence-1",
                sourceKind: "cv",
                sourceExcerpt: "Led a React migration for the checkout flow.",
                projectOrEmployer: "Checkout Platform",
                ownership: "Owned the frontend migration end to end.",
                technologies: ["React", "TypeScript"],
                decision: "Split a large route into smaller bundles.",
                constraint: "Tight launch window.",
                outcome: "Cut bundle size by 28%.",
                recency: "2025-02",
                confidence: 0.94,
              },
            ]),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(extractEngineeringEvidence(
      "I led a React migration for checkout.",
      "",
    )).resolves.toEqual([expect.objectContaining({
      id: "evidence-1",
      sourceKind: "cv",
      sourceExcerpt: "I led a React migration for checkout.",
      projectOrEmployer: null,
      ownership: null,
      technologies: ["React"],
      decision: null,
      constraint: null,
      outcome: null,
      recency: null,
      confidence: 0.94,
    })]);
  });
});

describe("generateInterviewBlueprint", () => {
  it("returns a validated grounded blueprint that preserves evidence ids and objectives", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              status: "grounded",
              fallbackReason: null,
              maxFollowUps: 3,
              maxQuestions: 8,
              questions: [
                {
                  sequence: 1,
                  category: "introduction",
                  competencyName: null,
                  difficulty: "senior",
                  objective: "Establish recent engineering ownership.",
                  evidenceIds: [],
                  expectedSignals: ["role summary", "recent ownership"],
                  missingSignalPrompts: ["Name the most recent engineering area you owned."],
                  rubricCriteria: [
                    "Establish the candidate's recent engineering ownership.",
                    "Keep the summary grounded in the role context.",
                    "Do not drift into unrelated background details.",
                  ],
                  followUpLimit: 0,
                  prompt: "Give me a concise introduction to yourself and the frontend work you have owned recently.",
                  sourceConfidence: null,
                },
                {
                  sequence: 2,
                  category: "experience",
                  competencyId: "react",
                  competencyName: "React architecture",
                  difficulty: "senior",
                  objective: "Probe the checkout migration ownership and impact.",
                  evidenceIds: ["evidence-1"],
                  expectedSignals: ["role", "trade-off", "outcome"],
                  missingSignalPrompts: ["Name the launch trade-off you accepted."],
                  rubricCriteria: [
                    "Name the project or work example in Checkout Platform.",
                    "Describe the candidate's role and ownership.",
                    "Explain the decision, trade-off, and outcome.",
                  ],
                  followUpLimit: 1,
                  prompt: "Tell me about the Checkout Platform migration.",
                  sourceConfidence: 0.94,
                },
                {
                  sequence: 3,
                  category: "technical",
                  competencyName: "React architecture",
                  difficulty: "senior",
                  objective: "Probe the migration trade-off decision.",
                  evidenceIds: ["evidence-1"],
                  expectedSignals: ["decision", "constraint", "trade-off"],
                  missingSignalPrompts: ["What trade-off did you reject?"],
                  rubricCriteria: [
                    "Name the technical decision being discussed in React architecture.",
                    "Explain the constraint or rejected alternative.",
                    "Describe the trade-off and result.",
                  ],
                  followUpLimit: 1,
                  prompt: "Walk me through the route-splitting decision.",
                  sourceConfidence: 0.94,
                },
                {
                  sequence: 4,
                  category: "architecture",
                  competencyName: "System design",
                  difficulty: "senior",
                  objective: "Probe observability system design choices.",
                  evidenceIds: ["evidence-2"],
                  expectedSignals: ["requirements", "signal design", "constraint"],
                  missingSignalPrompts: ["Which alert trade-off mattered most?"],
                  rubricCriteria: [
                    "Explain the requirements or constraints that shaped System design.",
                    "Describe the system-level decision or architecture choice.",
                    "State the outcome or reliability impact.",
                  ],
                  followUpLimit: 1,
                  prompt: "How did you shape observability for API regressions?",
                  sourceConfidence: 0.91,
                },
                {
                  sequence: 5,
                  category: "behavioral",
                  competencyName: "System design",
                  difficulty: "senior",
                  objective: "Probe cross-functional delivery around observability work.",
                  evidenceIds: ["evidence-2"],
                  expectedSignals: ["collaboration", "decision", "impact"],
                  missingSignalPrompts: ["Who disagreed and how did you resolve it?"],
                  rubricCriteria: [
                    "Name the collaboration challenge around System design.",
                    "Describe how the team aligned on the decision.",
                    "State what changed because of the collaboration.",
                  ],
                  followUpLimit: 0,
                  prompt: "How did you align the team on the release-health dashboards?",
                  sourceConfidence: 0.91,
                },
              ],
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(generateInterviewBlueprint(blueprintProfile, blueprintEvidence)).resolves.toMatchObject({
      status: "grounded",
      questions: expect.arrayContaining([
        expect.objectContaining({
          sequence: 2,
          competencyId: "react",
          evidenceIds: ["evidence-1"],
          objective: "Probe the checkout migration ownership and impact.",
        }),
      ]),
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("uses deterministic discovery planning when source readiness is incomplete", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await generateInterviewBlueprint(
      {
        ...blueprintProfile,
        competencies: [{ name: "React", relevance: 1 }],
      },
      [],
    );

    expect(result.status).toBe("limited-grounding");
    expect(result.questions).toHaveLength(5);
    expect(result.questions[1].prompt).toContain("strong interview story");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retries once when the first blueprint response fails validation", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                status: "grounded",
                fallbackReason: null,
                maxFollowUps: 3,
                maxQuestions: 8,
                questions: [{
                  sequence: 1,
                  category: "experience",
                  competencyName: "React architecture",
                  difficulty: "senior",
                  objective: "",
                  evidenceIds: ["missing-evidence"],
                  expectedSignals: [],
                  missingSignalPrompts: [],
                  followUpLimit: 4,
                  prompt: "bad",
                  sourceConfidence: 0.9,
                }],
              }),
            }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                status: "grounded",
                fallbackReason: null,
                maxFollowUps: 3,
                maxQuestions: 8,
                questions: [
                  {
                    sequence: 1,
                    category: "introduction",
                    competencyName: null,
                    difficulty: "senior",
                  objective: "Establish recent engineering ownership.",
                  evidenceIds: [],
                  expectedSignals: ["role summary"],
                  missingSignalPrompts: ["Name the area you owned."],
                  rubricCriteria: [
                    "Establish the candidate's recent engineering ownership.",
                    "Keep the summary grounded in the role context.",
                    "Do not drift into unrelated background details.",
                  ],
                  followUpLimit: 0,
                  prompt: "Give me a concise introduction to yourself and the frontend work you have owned recently.",
                  sourceConfidence: null,
                },
                  {
                    sequence: 2,
                    category: "experience",
                    competencyName: "React architecture",
                    difficulty: "senior",
                  objective: "Probe the checkout migration ownership and impact.",
                  evidenceIds: ["evidence-1"],
                  expectedSignals: ["role", "outcome"],
                  missingSignalPrompts: ["Name the trade-off."],
                  rubricCriteria: [
                    "Name the project or work example in Checkout Platform.",
                    "Describe the candidate's role and ownership.",
                    "Explain the decision, trade-off, and outcome.",
                  ],
                  followUpLimit: 1,
                  prompt: "Tell me about the Checkout Platform migration.",
                  sourceConfidence: 0.94,
                },
                  {
                    sequence: 3,
                    category: "technical",
                    competencyName: "React architecture",
                    difficulty: "senior",
                  objective: "Probe the route-splitting decision.",
                  evidenceIds: ["evidence-1"],
                  expectedSignals: ["decision", "constraint"],
                  missingSignalPrompts: ["What option did you reject?"],
                  rubricCriteria: [
                    "Name the technical decision being discussed in React architecture.",
                    "Explain the constraint or rejected alternative.",
                    "Describe the trade-off and result.",
                  ],
                  followUpLimit: 1,
                  prompt: "Walk me through the route-splitting decision.",
                  sourceConfidence: 0.94,
                },
                  {
                    sequence: 4,
                    category: "architecture",
                    competencyName: "System design",
                    difficulty: "senior",
                  objective: "Probe the observability system design choices.",
                  evidenceIds: ["evidence-2"],
                  expectedSignals: ["requirements", "signal design"],
                  missingSignalPrompts: ["How did you tune the alerts?"],
                  rubricCriteria: [
                    "Explain the requirements or constraints that shaped System design.",
                    "Describe the system-level decision or architecture choice.",
                    "State the outcome or reliability impact.",
                  ],
                  followUpLimit: 1,
                  prompt: "How did you shape observability for API regressions?",
                  sourceConfidence: 0.91,
                },
                  {
                    sequence: 5,
                    category: "behavioral",
                    competencyName: "System design",
                    difficulty: "senior",
                  objective: "Probe collaboration during observability delivery.",
                  evidenceIds: ["evidence-2"],
                  expectedSignals: ["collaboration", "impact"],
                  missingSignalPrompts: ["Who did you need alignment from?"],
                  rubricCriteria: [
                    "Name the collaboration challenge around System design.",
                    "Describe how the team aligned on the decision.",
                    "State what changed because of the collaboration.",
                  ],
                  followUpLimit: 0,
                  prompt: "How did you align the team on release health?",
                  sourceConfidence: 0.91,
                },
                ],
              }),
            }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const blueprint = await generateInterviewBlueprint(blueprintProfile, blueprintEvidence);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(blueprint.status).toBe("grounded");
    expect(blueprint.questions[1].evidenceIds).toEqual(["evidence-1"]);
  });

  it("falls back to a limited-grounding blueprint after two invalid model responses", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const blueprint = await generateInterviewBlueprint(blueprintProfile, blueprintEvidence);

    expect(blueprint.status).toBe("limited-grounding");
    expect(blueprint.fallbackReason).toContain("Gemini");
    expect(blueprint.questions).toHaveLength(5);
    expect(blueprint.questions[1].evidenceIds).toEqual(["evidence-1"]);
  });
});

describe("generatePracticeBlueprint", () => {
  it.each([
    ["targeted_drill", 3],
    ["story_work", 3],
    ["self_presentation", 2],
    ["behavioral", 3],
    ["technical_communication", 3],
    ["role_prep", 4],
    ["full_simulation", 5],
  ] as const)("generates %s with %d base questions", async (format, count) => {
    const blueprint = await generatePracticeBlueprint(
      practiceProfile,
      blueprintEvidence,
      practicePlan({ format }),
      practiceContext,
    );

    expect(blueprint.questions).toHaveLength(count);
    // Ruling R5: maxQuestions must always leave follow-up headroom above the
    // base question count -- the persisted floor in the Task 2 migration
    // would otherwise refuse every follow-up on a plan-driven session.
    expect(blueprint.maxQuestions).toBeGreaterThan(blueprint.questions.length);
  });

  it("rejects an AI response that exceeds the plan's base question count and falls back instead of silently expanding", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    // role_prep's base count is 4 (baseQuestionCountFor). This response
    // returns 5 -- schema-valid on its own (practiceBlueprintDraftSchema
    // allows up to 5 questions), but it must still be rejected by
    // validatePracticeBlueprint's over-count check and never silently
    // accepted as a 5-question role_prep blueprint.
    const overCountQuestion = (sequence: number) => ({
      sequence,
      category: "technical",
      competencyName: "React architecture",
      difficulty: "senior",
      objective: `Probe decision ${sequence}.`,
      evidenceIds: ["evidence-1"],
      expectedSignals: ["decision", "trade-off"],
      missingSignalPrompts: ["Name the trade-off."],
      rubricCriteria: ["Name the decision.", "Explain the trade-off."],
      followUpLimit: 1,
      prompt: `Walk me through decision ${sequence}.`,
      sourceConfidence: 0.9,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              status: "grounded",
              fallbackReason: null,
              maxFollowUps: 2,
              maxQuestions: 7,
              questions: [1, 2, 3, 4, 5].map(overCountQuestion),
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const blueprint = await generatePracticeBlueprint(
      practiceProfile,
      blueprintEvidence,
      practicePlan({ format: "role_prep" }),
      practiceContext,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2); // one attempt, one repair retry, both over-count
    expect(blueprint.questions).toHaveLength(4);
    expect(blueprint.status).toBe("limited-grounding");
  });

  it("accepts a conforming AI response sized to a second (non-role_prep) format's base count", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    // self_presentation's base count is 2 -- drives the AI path (not the
    // fallback) for a second format so the count matrix above is not
    // exclusively exercising buildFallbackPracticeBlueprint.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              status: "grounded",
              fallbackReason: null,
              maxFollowUps: 1,
              maxQuestions: 3,
              questions: [
                {
                  sequence: 1,
                  category: "introduction",
                  competencyName: null,
                  difficulty: "senior",
                  objective: "Establish recent engineering ownership.",
                  evidenceIds: [],
                  expectedSignals: ["role summary", "recent ownership"],
                  missingSignalPrompts: ["Name the most recent engineering area you owned."],
                  rubricCriteria: ["Establish the candidate's recent engineering ownership."],
                  followUpLimit: 0,
                  prompt: "Give me a concise introduction to yourself.",
                  sourceConfidence: null,
                },
                {
                  sequence: 2,
                  category: "experience",
                  competencyId: "react",
                  competencyName: "React architecture",
                  difficulty: "senior",
                  objective: "Probe the checkout migration ownership and impact.",
                  evidenceIds: ["evidence-1"],
                  expectedSignals: ["role", "trade-off", "outcome"],
                  missingSignalPrompts: ["Name the launch trade-off you accepted."],
                  rubricCriteria: ["Name the project or work example.", "Describe ownership.", "Explain the outcome."],
                  followUpLimit: 1,
                  prompt: "Tell me about the Checkout Platform migration.",
                  sourceConfidence: 0.94,
                },
              ],
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const blueprint = await generatePracticeBlueprint(
      practiceProfile,
      blueprintEvidence,
      practicePlan({ format: "self_presentation" }),
      practiceContext,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(blueprint.status).toBe("grounded");
    expect(blueprint.questions).toHaveLength(2);
    expect(blueprint.maxQuestions).toBeGreaterThan(2);
  });

  it("keeps evidence ids traceable to candidate evidence when job-description requirements shape the prompt", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    const opportunity: Opportunity = {
      id: "opportunity-1",
      userId: "user-1",
      company: "Northwind",
      role: "Senior Frontend Engineer",
      status: "interviewing",
      location: null,
      remote: null,
      jobUrl: null,
      jobDescription: "Requires deep experience leading large-scale React migrations and mentoring engineers on rollout risk.",
      sourceLabel: null,
      sourceSystem: null,
      sourceExternalId: null,
      matchScore: null,
      strengths: [],
      gaps: [],
      notes: null,
      appliedAt: null,
      nextInterviewAt: null,
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              status: "grounded",
              fallbackReason: null,
              maxFollowUps: 2,
              maxQuestions: 6,
              questions: [
                {
                  sequence: 1,
                  category: "introduction",
                  competencyName: null,
                  difficulty: "senior",
                  objective: "Establish recent engineering ownership relevant to the role.",
                  evidenceIds: [],
                  expectedSignals: ["role summary", "recent ownership"],
                  missingSignalPrompts: ["Name the most recent engineering area you owned."],
                  rubricCriteria: ["Establish the candidate's recent engineering ownership."],
                  followUpLimit: 0,
                  prompt: "Give me a concise introduction focused on leading React migrations.",
                  sourceConfidence: null,
                },
                {
                  sequence: 2,
                  category: "experience",
                  competencyId: "react",
                  competencyName: "React architecture",
                  difficulty: "senior",
                  objective: "Probe the checkout migration ownership and impact.",
                  evidenceIds: ["evidence-1"],
                  expectedSignals: ["role", "trade-off", "outcome"],
                  missingSignalPrompts: ["Name the launch trade-off you accepted."],
                  rubricCriteria: ["Name the project or work example.", "Describe ownership.", "Explain the outcome."],
                  followUpLimit: 1,
                  prompt: "Tell me about the Checkout Platform migration.",
                  sourceConfidence: 0.94,
                },
                {
                  sequence: 3,
                  category: "technical",
                  competencyName: "React architecture",
                  difficulty: "senior",
                  objective: "Probe the migration trade-off decision.",
                  evidenceIds: ["evidence-1"],
                  expectedSignals: ["decision", "constraint", "trade-off"],
                  missingSignalPrompts: ["What trade-off did you reject?"],
                  rubricCriteria: ["Name the technical decision.", "Explain the constraint.", "Describe the trade-off."],
                  followUpLimit: 1,
                  prompt: "Walk me through the route-splitting decision.",
                  sourceConfidence: 0.94,
                },
                {
                  sequence: 4,
                  category: "architecture",
                  competencyName: "React architecture",
                  difficulty: "senior",
                  objective: "Probe rollout mentoring readiness for large-scale migrations.",
                  evidenceIds: ["evidence-2"],
                  expectedSignals: ["requirements", "mentoring", "constraint"],
                  missingSignalPrompts: ["Who did you mentor through the rollout?"],
                  rubricCriteria: ["Explain the requirements.", "Describe the design choice.", "State the outcome."],
                  followUpLimit: 0,
                  prompt: "How would you mentor a team through a large-scale React migration rollout?",
                  sourceConfidence: 0.91,
                },
              ],
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const blueprint = await generatePracticeBlueprint(
      practiceProfile,
      blueprintEvidence,
      practicePlan({ format: "role_prep" }),
      { ...practiceContext, primaryOpportunity: opportunity },
    );

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.contents[0].parts[0].text).toContain("leading large-scale React migrations");
    expect(requestBody.contents[0].parts[0].text).toContain("Job requirements are targets to probe, not candidate evidence.");
    expect(requestBody.contents[0].parts[0].text).toContain("Candidate factual claims must be grounded in supplied evidence or confirmed story facts.");
    expect(requestBody.contents[0].parts[0].text).toContain("Do not invent company interview-process facts.");

    const knownEvidenceIds = new Set(blueprintEvidence.map((item) => item.id));
    for (const question of blueprint.questions) {
      for (const evidenceId of question.evidenceIds) {
        expect(knownEvidenceIds.has(evidenceId)).toBe(true);
      }
    }
  });

  it("only grounds on confirmed or corrected observations and confirmed stories, preferring a user correction over the original claim", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.6-flash");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{}" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const context: PracticeBlueprintContext = {
      primaryOpportunity: null,
      supportingOpportunities: [],
      observations: [
        {
          id: "observation-unreviewed",
          userId: "user-1",
          observationType: "weakness",
          claim: "Skips trade-offs entirely, never seen this candidate mention one.",
          confidence: 0.8,
          importance: 0.9,
          trend: "unresolved",
          reviewState: "unreviewed",
          userCorrection: null,
          firstSeenAt: null,
          lastSeenAt: null,
          confirmedAt: null,
          correctedAt: null,
          dismissedAt: null,
          createdAt: "2026-08-29T10:00:00.000Z",
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
        {
          id: "observation-corrected",
          userId: "user-1",
          observationType: "weakness",
          claim: "Never explains trade-offs.",
          confidence: 0.8,
          importance: 0.9,
          trend: "unresolved",
          reviewState: "corrected",
          userCorrection: "Explains trade-offs but rushes the outcome.",
          firstSeenAt: null,
          lastSeenAt: null,
          confirmedAt: null,
          correctedAt: "2026-08-29T10:00:00.000Z",
          dismissedAt: null,
          createdAt: "2026-08-29T10:00:00.000Z",
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
      ],
      stories: [
        {
          id: "story-draft",
          userId: "user-1",
          title: "Unfinished draft story, never seen elsewhere in this test.",
          situation: null,
          responsibility: null,
          problem: null,
          actions: null,
          alternatives: null,
          tradeoffs: null,
          ownership: null,
          outcome: null,
          lessons: null,
          tags: [],
          completeness: 0.2,
          reviewState: "draft",
          confirmedAt: null,
          createdAt: "2026-08-29T10:00:00.000Z",
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
        {
          id: "story-confirmed",
          userId: "user-1",
          title: "Checkout migration rollback story",
          situation: "Rollout risk on the checkout migration.",
          responsibility: "Owned the rollback plan.",
          problem: null,
          actions: null,
          alternatives: null,
          tradeoffs: null,
          ownership: null,
          outcome: null,
          lessons: null,
          tags: [],
          completeness: 0.9,
          reviewState: "confirmed",
          confirmedAt: "2026-08-29T10:00:00.000Z",
          createdAt: "2026-08-29T10:00:00.000Z",
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
      ],
    };

    await generatePracticeBlueprint(practiceProfile, blueprintEvidence, practicePlan(), context);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const promptText = requestBody.contents[0].parts[0].text as string;
    expect(promptText).toContain("Explains trade-offs but rushes the outcome.");
    expect(promptText).not.toContain("Skips trade-offs entirely, never seen this candidate mention one.");
    expect(promptText).not.toContain("Never explains trade-offs.");
    expect(promptText).toContain("Checkout migration rollback story");
    expect(promptText).not.toContain("Unfinished draft story, never seen elsewhere in this test.");
  });
});

describe("assessProfileReadiness", () => {
  it("deduplicates equivalent evidence before counting readiness", () => {
    expect(assessProfileReadiness([
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
        sourceExcerpt: "Led a React migration for checkout.",
        projectOrEmployer: "Checkout Platform",
        ownership: "Owned the frontend migration end to end.",
        technologies: ["TypeScript", "React"],
        decision: "Split a large route into smaller bundles.",
        constraint: "Tight launch window.",
        outcome: "Cut bundle size by 28%.",
        recency: "2025-02",
        confidence: 0.94,
      },
    ])).toEqual({
      ready: false,
      missing: expect.arrayContaining([
        "two concrete engineering projects or work examples",
      ]),
    });
  });

  it("does not treat generic skill summaries as two concrete work examples", () => {
    expect(assessProfileReadiness([
      {
        id: "evidence-1",
        sourceKind: "cv",
        sourceExcerpt: "React and TypeScript developer.",
        projectOrEmployer: null,
        ownership: null,
        technologies: ["React", "TypeScript"],
        decision: null,
        constraint: null,
        outcome: null,
        recency: null,
        confidence: 0.3,
      },
      {
        id: "evidence-2",
        sourceKind: "cv",
        sourceExcerpt: "Built user interfaces with JavaScript.",
        projectOrEmployer: null,
        ownership: null,
        technologies: ["JavaScript"],
        decision: null,
        constraint: null,
        outcome: null,
        recency: null,
        confidence: 0.3,
      },
    ])).toEqual({
      ready: false,
      missing: expect.arrayContaining([
        "two concrete engineering projects or work examples",
        "responsibilities or outcomes",
      ]),
    });
  });

  it("rejects a generic profile with only one vague work example", () => {
    expect(assessProfileReadiness([{
      id: "evidence-1",
      sourceKind: null,
      sourceExcerpt: "Worked on a project.",
      projectOrEmployer: null,
      ownership: null,
      technologies: [],
      decision: null,
      constraint: null,
      outcome: null,
      recency: null,
      confidence: 0.2,
    }])).toEqual({
      ready: false,
      missing: expect.arrayContaining([
        "two concrete engineering projects or work examples",
        "identifiable technologies",
        "responsibilities or outcomes",
      ]),
    });
  });

  it("accepts concise evidence with an excerpt, technologies, and ownership without a duplicated project label", () => {
    expect(assessProfileReadiness([
      {
        id: "evidence-1",
        sourceKind: "cv",
        sourceExcerpt: "React checkout flow with route-splitting.",
        projectOrEmployer: null,
        ownership: "Owned the frontend migration end to end.",
        technologies: ["React", "TypeScript"],
        decision: null,
        constraint: null,
        outcome: "Cut bundle size by 28%.",
        recency: "2025-02",
        confidence: 0.94,
      },
      {
        id: "evidence-2",
        sourceKind: "cv",
        sourceExcerpt: "Observability flow for API regressions.",
        projectOrEmployer: null,
        ownership: "Designed the dashboard and alerting flow.",
        technologies: ["Next.js", "Postgres"],
        decision: null,
        constraint: null,
        outcome: "Reduced incident triage time by 35%.",
        recency: "2024-11",
        confidence: 0.91,
      },
    ])).toEqual({
      ready: true,
      missing: [],
    });
  });

  it("accepts concise bullets when the source excerpt itself carries the action and outcome", () => {
    expect(assessProfileReadiness([
      {
        id: "evidence-1",
        sourceKind: "cv",
        sourceExcerpt: "Created a React checkout flow and cut bundle size by 28%.",
        projectOrEmployer: null,
        ownership: null,
        technologies: ["React", "TypeScript"],
        decision: null,
        constraint: null,
        outcome: null,
        recency: "2025-02",
        confidence: 0.94,
      },
      {
        id: "evidence-2",
        sourceKind: "cv",
        sourceExcerpt: "Refactored API observability dashboards and reduced triage time by 35%.",
        projectOrEmployer: null,
        ownership: null,
        technologies: ["Next.js", "Postgres"],
        decision: null,
        constraint: null,
        outcome: null,
        recency: "2024-11",
        confidence: 0.91,
      },
    ])).toEqual({
      ready: true,
      missing: [],
    });
  });

  it("rejects employer-label-only evidence even when technologies are listed", () => {
    expect(assessProfileReadiness([
      {
        id: "evidence-1",
        sourceKind: "cv",
        sourceExcerpt: "Checkout Platform",
        projectOrEmployer: "Checkout Platform",
        ownership: null,
        technologies: ["React", "TypeScript"],
        decision: null,
        constraint: null,
        outcome: null,
        recency: null,
        confidence: 0.3,
      },
      {
        id: "evidence-2",
        sourceKind: "cv",
        sourceExcerpt: "Reliability Tooling",
        projectOrEmployer: "Reliability Tooling",
        ownership: null,
        technologies: ["Next.js"],
        decision: null,
        constraint: null,
        outcome: null,
        recency: null,
        confidence: 0.35,
      },
    ])).toEqual({
      ready: false,
      missing: expect.arrayContaining([
        "two concrete engineering projects or work examples",
        "responsibilities or outcomes",
      ]),
    });
  });

  it("rejects labeled projects with metrics when no action or ownership semantics are present", () => {
    expect(assessProfileReadiness([
      {
        id: "evidence-1",
        sourceKind: "cv",
        sourceExcerpt: "Checkout Platform",
        projectOrEmployer: "Checkout Platform",
        ownership: null,
        technologies: ["React", "TypeScript"],
        decision: null,
        constraint: null,
        outcome: "28% faster.",
        recency: null,
        confidence: 0.35,
      },
      {
        id: "evidence-2",
        sourceKind: "cv",
        sourceExcerpt: "Reliability Tooling",
        projectOrEmployer: "Reliability Tooling",
        ownership: null,
        technologies: ["Next.js", "Postgres"],
        decision: null,
        constraint: null,
        outcome: "35% lower triage time.",
        recency: null,
        confidence: 0.35,
      },
    ])).toEqual({
      ready: false,
      missing: expect.arrayContaining([
        "two concrete engineering projects or work examples",
        "responsibilities or outcomes",
      ]),
    });
  });

  it("accepts two concrete engineering projects with technologies and outcomes", () => {
    expect(assessProfileReadiness([
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
    ])).toEqual({
      ready: true,
      missing: [],
    });
  });
});
