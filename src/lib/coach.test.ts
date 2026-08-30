import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assessProfileReadiness,
  extractEngineeringEvidence,
  extractPdfText,
  evaluateAnswer,
  generateInterviewBlueprint,
  initialQuestion,
  nextTurn,
} from "@/lib/coach";
import type { EvidenceItem, InterviewBlueprint, InterviewSession, PlannedQuestion, ProfileDraft } from "@/lib/types";

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
    expect(turn.nextQuestion).toBe("How would you shape the observability design for that rollout?");
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
    expect(turn.evaluation.relevance).toBeGreaterThan(6.5);
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
              question: "How would you phase the migration?",
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
                supportedClaims: ["phase the rollout carefully"],
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

    expect(turn.followUp).toBeNull();
    expect(turn.nextQuestion).toBe("How would you phase the migration?");
    expect(turn.evaluation).toMatchObject({
      score: 8.4,
      competencyId: "react-id",
      competency: "React architecture",
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
      supportedClaims: ["phase the rollout carefully"],
      expectedSignalsPresent: ["impact"],
      unsupportedClaims: [],
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
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
