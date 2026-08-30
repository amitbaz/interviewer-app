import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Competency, InterviewSession, PlannedQuestion, Profile, ProgressSnapshot } from "@/lib/types";
import App from "@/app/page";
import { ResultsFeedbackCards } from "@/app/results-feedback-cards";

const getUser = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser,
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
  }),
}));

function question(
  sequence: number,
  prompt: string,
  answer: string,
  competencyId: string | null,
  competencyName: string | null,
): PlannedQuestion {
  return {
    id: `question-${sequence}`,
    sequence,
    category: "technical",
    competencyId,
    competencyName,
    difficulty: "senior",
    isFollowUp: false,
    prompt,
    answer,
    createdAt: "2026-08-29T10:00:00.000Z",
  };
}

function competency(overrides: Partial<Competency>): Competency {
  return {
    id: "react-architecture",
    name: "React architecture",
    relevance: 1,
    expectedLevel: "senior",
    estimatedLevel: "senior",
    confidence: "high",
    lastPracticedAt: "2026-08-29T10:00:00.000Z",
    questionCount: 2,
    averageScore: 8,
    recentScore: 8,
    strengths: ["Frames migration trade-offs clearly."],
    weaknesses: ["Name rollback triggers earlier."],
    ...overrides,
  };
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    userId: "user-1",
    role: "Senior Frontend Engineer",
    seniority: "Senior",
    summary: "Builds product UIs and frontend systems.",
    narrative: "Leads complex React work.",
    expertise: ["React", "TypeScript"],
    characteristics: ["Clear communicator"],
    evidence: [
      {
        id: "evidence-1",
        sourceKind: "cv",
        sourceExcerpt: "Led the checkout migration from legacy React Router to App Router.",
        projectOrEmployer: "Checkout rewrite",
        ownership: "Frontend lead",
        technologies: ["React", "Next.js"],
        decision: "Phased the migration by route.",
        constraint: "Needed rollback safety.",
        outcome: "Reduced rollout risk during launch season.",
        recency: "2025",
        confidence: 0.92,
      },
      {
        id: "evidence-2",
        sourceKind: "cv",
        sourceExcerpt: "Improved a large search experience for a product catalog.",
        projectOrEmployer: "Catalog search",
        ownership: "Senior engineer",
        technologies: ["React", "TypeScript"],
        decision: "Virtualized the results list.",
        constraint: "Needed keyboard navigation to remain intact.",
        outcome: "Kept the UI responsive at high result counts.",
        recency: "2024",
        confidence: 0.85,
      },
    ],
    readiness: {
      ready: true,
      missing: [],
    },
    competencies: [
      competency({}),
      competency({
        id: "performance",
        name: "Performance",
        confidence: "medium",
        averageScore: 6,
        recentScore: 6,
        strengths: ["Recognizes virtualization quickly."],
        weaknesses: ["Explain keyboard state under virtualization."],
      }),
    ],
    source: { cvText: "Frontend engineer", coverLetter: "" },
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
    ...overrides,
  };
}

function session(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: "session-1",
    userId: "user-1",
    kind: "conversation",
    status: "complete",
    startedAt: "2026-08-29T10:00:00.000Z",
    completedAt: "2026-08-29T11:00:00.000Z",
    exercise: {},
    resultSummary: { summary: "Complete" },
    overallScore: 8,
    questions: [
      question(
        1,
        "How would you phase a large React migration?",
        "I would phase by route, keep the old shell available, and track rollback gates per milestone.",
        "react-architecture",
        "React architecture",
      ),
      question(
        2,
        "How do you keep a search UI responsive at 50,000 results?",
        "I would virtualize the list, debounce network work, and keep keyboard focus state outside each row.",
        "performance",
        "Performance",
      ),
    ],
    checkpoints: [],
    evaluations: [
      {
        score: 8,
        competencyId: "react-architecture",
        competency: "React architecture",
        dimensions: { structure: 9, tradeOffAwareness: 8, clarity: 7 },
        strengths: ["Phased the migration with rollback gates."],
        needsWork: ["Call out how you would verify each rollout stage."],
        missingPoints: ["Name the signal that would trigger a rollback."],
        betterStructure: ["Start with constraints, then walk through phases, and close with rollback criteria."],
        improvedAnswer: "I would begin with the constraints, phase the migration by route, and define explicit rollback criteria for each milestone.",
      },
      {
        score: 6,
        competencyId: "performance",
        competency: "Performance",
        dimensions: {},
        strengths: ["Recognized virtualization quickly."],
        needsWork: ["Explain how keyboard state survives list windowing."],
        missingPoints: [],
        betterStructure: [],
        improvedAnswer: "",
      },
    ],
    messages: [],
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T11:00:00.000Z",
    ...overrides,
  };
}

function mockCoachData(options: {
  profile?: Profile;
  progress: ProgressSnapshot;
  sessions?: InterviewSession[];
}) {
  const profilePayload = options.profile ?? profile();
  const sessionsPayload = options.sessions ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;

    if (url === "/api/profile") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ profile: profilePayload, demoMode: false }),
      } satisfies Partial<Response>;
    }

    if (url === "/api/interview") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessions: sessionsPayload, progress: options.progress }),
      } satisfies Partial<Response>;
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderProgressView(options: {
  profile?: Profile;
  progress: ProgressSnapshot;
  sessions?: InterviewSession[];
}) {
  mockCoachData(options);
  render(<App />);

  await screen.findByRole("heading", { name: "Ready when you are." });
  fireEvent.click(screen.getByRole("button", { name: "progress" }));
  await screen.findByRole("heading", { name: "Practice with a memory." });
}

async function renderHomeView(options: {
  profile?: Profile;
  progress: ProgressSnapshot;
  sessions?: InterviewSession[];
}) {
  mockCoachData(options);
  render(<App />);

  await screen.findByRole("heading", { name: "Ready when you are." });
}

async function renderPracticeView(options: {
  profile?: Profile;
  progress: ProgressSnapshot;
  sessions?: InterviewSession[];
}) {
  mockCoachData(options);
  render(<App />);

  await screen.findByRole("heading", { name: "Ready when you are." });
  fireEvent.click(screen.getByRole("button", { name: "practice" }));
  await screen.findByRole("heading", { name: "Choose deliberate practice." });
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("App progress view", () => {
  it("shows a no-evidence state before the first completed interview", async () => {
    await renderProgressView({
      progress: {
        readiness: null,
        latestScore: null,
        trend: null,
        recentScores: [],
        strongest: null,
        weakest: null,
        recurringWeaknesses: [],
      },
      profile: profile({
        competencies: [
          competency({ averageScore: null, recentScore: null, confidence: null, strengths: [], weaknesses: [] }),
        ],
      }),
    });

    expect(screen.getByRole("heading", { name: "Not enough data yet" })).toBeInTheDocument();
    expect(screen.getByText("Finish your first mixed interview to establish a baseline before Relay shows readiness or competency scores.")).toBeInTheDocument();
    expect(screen.queryByText("Baseline established")).not.toBeInTheDocument();
  });

  it("shows the profile evidence gate state on the progress view", async () => {
    await renderProgressView({
      progress: {
        readiness: 75,
        latestScore: 8.2,
        trend: "baseline",
        recentScores: [8.2],
        strongest: competency({}),
        weakest: competency({
          id: "system-design",
          name: "System design",
          averageScore: 6,
          recentScore: 6,
          confidence: "low",
          strengths: ["Recognizes system boundaries."],
          weaknesses: ["Open with requirements before the solution."],
        }),
        recurringWeaknesses: ["Open with requirements before the solution."],
      },
      profile: profile({
        readiness: {
          ready: false,
          missing: [
            "two concrete engineering projects or work examples",
            "identifiable technologies",
            "responsibilities or outcomes",
          ],
        },
      }),
      sessions: [session({ overallScore: 8.2 })],
    });

    expect(screen.getByText("Profile evidence gate still needs two concrete engineering projects or work examples, identifiable technologies, responsibilities or outcomes.")).toBeInTheDocument();
  });

  it("shows a one-session baseline state with coaching guidance", async () => {
    const baselineCompetency = competency({
      id: "system-design",
      name: "System design",
      averageScore: 6,
      recentScore: 6,
      confidence: "low",
      strengths: ["Recognizes system boundaries."],
      weaknesses: ["Open with requirements before the solution."],
    });

    await renderProgressView({
      progress: {
        readiness: 75,
        latestScore: 8.2,
        trend: "baseline",
        recentScores: [8.2],
        strongest: competency({}),
        weakest: baselineCompetency,
        recurringWeaknesses: ["Open with requirements before the solution."],
      },
      profile: profile({ competencies: [competency({}), baselineCompetency] }),
      sessions: [session({ overallScore: 8.2 })],
    });

    expect(screen.getAllByText("Baseline established")).toHaveLength(2);
    expect(screen.getByText("A coaching signal based on your completed practice, not a hiring prediction.")).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText("8.2/10")).toBeInTheDocument();
    expect(screen.getAllByText("Open with requirements before the solution.")).toHaveLength(2);
  });

  it("shows multi-session readiness insights, trend, and recurring weaknesses", async () => {
    const strongest = competency({
      id: "communication",
      name: "Communication",
      averageScore: 8.8,
      recentScore: 9,
      strengths: ["Summarizes recommendations crisply."],
      weaknesses: [],
    });
    const weakest = competency({
      id: "performance",
      name: "Performance",
      averageScore: 6.2,
      recentScore: 6,
      confidence: "medium",
      strengths: ["Recognizes virtualization quickly."],
      weaknesses: ["Quantify bottlenecks before proposing fixes."],
    });

    await renderProgressView({
      progress: {
        readiness: 81,
        latestScore: 8.4,
        trend: "improving",
        recentScores: [8.4, 7.3, 6.7],
        strongest,
        weakest,
        recurringWeaknesses: [
          "Quantify bottlenecks before proposing fixes.",
          "State the baseline metric before the optimization.",
        ],
      },
      profile: profile({ competencies: [strongest, weakest] }),
      sessions: [session({ id: "latest", overallScore: 8.4 }), session({ id: "previous", overallScore: 7.3 })],
    });

    await waitFor(() => expect(screen.getByText("81")).toBeInTheDocument());

    expect(screen.getByText("A coaching signal based on your completed practice, not a hiring prediction.")).toBeInTheDocument();
    expect(screen.getByText("8.4/10")).toBeInTheDocument();
    expect(screen.getAllByText("Improving")).toHaveLength(2);
    expect(screen.getAllByText("Communication")).toHaveLength(2);
    expect(screen.getAllByText("Performance")).toHaveLength(2);
    expect(screen.getAllByText("Quantify bottlenecks before proposing fixes.")).toHaveLength(2);
    expect(screen.getByText("State the baseline metric before the optimization.")).toBeInTheDocument();
  });
});

describe("App profile view", () => {
  it("shows the profile evidence gate state on the profile screen", async () => {
    mockCoachData({
      progress: {
        readiness: 75,
        latestScore: 8.2,
        trend: "baseline",
        recentScores: [8.2],
        strongest: competency({}),
        weakest: competency({}),
        recurringWeaknesses: [],
      },
      profile: profile({
        readiness: {
          ready: true,
          missing: [],
        },
      }),
    });
    render(<App />);

    await screen.findByRole("heading", { name: "Ready when you are." });
    fireEvent.click(screen.getByRole("button", { name: "profile" }));

    expect(await screen.findByText("Grounded profile ready for personalized interviews.")).toBeInTheDocument();
  });

  it("shows source-backed evidence and no-fabrication copy on the profile screen", async () => {
    mockCoachData({
      progress: {
        readiness: 75,
        latestScore: 8.2,
        trend: "baseline",
        recentScores: [8.2],
        strongest: competency({}),
        weakest: competency({}),
        recurringWeaknesses: [],
      },
      profile: profile(),
    });
    render(<App />);

    await screen.findByRole("heading", { name: "Ready when you are." });
    fireEvent.click(screen.getByRole("button", { name: "profile" }));

    expect(await screen.findByRole("heading", { name: "Grounded evidence" })).toBeInTheDocument();
    expect(screen.getByText("Checkout rewrite")).toBeInTheDocument();
    expect(screen.getByText("Led the checkout migration from legacy React Router to App Router.")).toBeInTheDocument();
    expect(screen.getByText("Relay will only plan and critique against source-backed details shown here.")).toBeInTheDocument();
  });
});

describe("App home view", () => {
  it("blocks grounded interview start when the profile readiness gate is failing", async () => {
    await renderHomeView({
      progress: {
        readiness: null,
        latestScore: null,
        trend: null,
        recentScores: [],
        strongest: null,
        weakest: null,
        recurringWeaknesses: [],
      },
      profile: profile({
        readiness: {
          ready: false,
          missing: ["two concrete engineering projects or work examples"],
        },
      }),
    });

    expect(screen.getByRole("button", { name: "Start interview" })).toBeDisabled();
    expect(screen.getByText("Add the missing source detail in your profile before Relay starts a grounded interview.")).toBeInTheDocument();
  });
});

describe("App practice view", () => {
  it("renders a single grounded start action that respects the readiness gate", async () => {
    await renderPracticeView({
      progress: {
        readiness: null,
        latestScore: null,
        trend: null,
        recentScores: [],
        strongest: null,
        weakest: null,
        recurringWeaknesses: [],
      },
      profile: profile({
        readiness: {
          ready: false,
          missing: ["two concrete engineering projects or work examples"],
        },
      }),
    });

    const startButtons = screen.getAllByRole("button", { name: "Start now" });
    expect(startButtons).toHaveLength(1);
    expect(startButtons[0]).toBeDisabled();
    expect(screen.getByText("Add the missing source detail in your profile before Relay starts a grounded interview.")).toBeInTheDocument();
  });
});

describe("ResultsFeedbackCards", () => {
  it("starts collapsed and expands to show the answered question with non-empty coaching details", () => {
    render(<ResultsFeedbackCards session={session()} />);

    const toggle = screen.getByRole("button", { name: "React architecture feedback" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "React architecture feedback" })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "React architecture feedback" });
    expect(details).toBeInTheDocument();
    expect(screen.getByText("How would you phase a large React migration?")).toBeInTheDocument();
    expect(screen.getByText("I would phase by route, keep the old shell available, and track rollback gates per milestone.")).toBeInTheDocument();
    expect(within(details).getByText("Structure")).toBeInTheDocument();
    expect(within(details).getByText("9/10")).toBeInTheDocument();
    expect(within(details).getByText("Trade-off awareness")).toBeInTheDocument();
    expect(within(details).getByText("8/10")).toBeInTheDocument();
    expect(within(details).getByText("Phased the migration with rollback gates.")).toBeInTheDocument();
    expect(within(details).getByText("Name the signal that would trigger a rollback.")).toBeInTheDocument();
    expect(within(details).getByText("Start with constraints, then walk through phases, and close with rollback criteria.")).toBeInTheDocument();
    expect(within(details).getByText("I would begin with the constraints, phase the migration by route, and define explicit rollback criteria for each milestone.")).toBeInTheDocument();
  });

  it("surfaces exact question grounding, relevance, claims, and dimension reasons", () => {
    render(<ResultsFeedbackCards
      session={session({
      blueprint: {
        status: "grounded",
        fallbackReason: null,
        maxFollowUps: 3,
        maxQuestions: 5,
        createdAt: "2026-08-29T10:00:00.000Z",
        questions: [
          {
            id: "question-1",
            sequence: 1,
            category: "experience",
            competencyId: "react-architecture",
            competencyName: "React architecture",
            difficulty: "senior",
            isFollowUp: false,
            prompt: "How would you phase a large React migration?",
            answer: null,
            createdAt: "2026-08-29T10:00:00.000Z",
            objective: "Probe migration ownership and rollout trade-offs.",
            evidenceIds: ["evidence-1", "evidence-2"],
            expectedSignals: ["ownership", "trade-off", "impact"],
            missingSignalPrompts: ["Name the rollback trigger."],
            followUpLimit: 1,
            sourceConfidence: 0.92,
          },
        ],
      },
      evaluations: [
        {
          score: 8,
          questionId: "question-1",
          competencyId: "react-architecture",
          competency: "React architecture",
          relevance: 8.7,
          dimensions: { structure: 9, tradeOffAwareness: 8, clarity: 7 },
          strengths: ["Phased the migration with rollback gates."],
          needsWork: ["Call out how you would verify each rollout stage."],
          missingPoints: ["Name the signal that would trigger a rollback."],
          betterStructure: ["Start with constraints, then walk through phases, and close with rollback criteria."],
          improvedAnswer: "I would begin with the constraints, phase the migration by route, and define explicit rollback criteria for each milestone.",
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
      ],
    })}
      evidence={profile().evidence}
    />);

    fireEvent.click(screen.getByRole("button", { name: "React architecture feedback" }));

    const details = screen.getByRole("region", { name: "React architecture feedback" });
    expect(within(details).getByText("Question objective")).toBeInTheDocument();
    expect(within(details).getByText("Probe migration ownership and rollout trade-offs.")).toBeInTheDocument();
    expect(within(details).getByText("Evidence target")).toBeInTheDocument();
    expect(within(details).getByText("Checkout rewrite · Frontend lead · Reduced rollout risk during launch season.")).toBeInTheDocument();
    expect(within(details).getByText("Expected signals")).toBeInTheDocument();
    expect(within(details).getByText("Relevance")).toBeInTheDocument();
    expect(within(details).getByText("8.7/10")).toBeInTheDocument();
    expect(within(details).getByText("Supported claims")).toBeInTheDocument();
    expect(within(details).getByText("phase the rollout carefully")).toBeInTheDocument();
    expect(within(details).getByText("Expected signals present")).toBeInTheDocument();
    expect(within(details).getByText("trade-off")).toBeInTheDocument();
    expect(within(details).getByText("Unsupported claims")).toBeInTheDocument();
    expect(within(details).getByText("We shipped it perfectly.")).toBeInTheDocument();
    expect(within(details).getByText("Dimension reasons")).toBeInTheDocument();
    expect(within(details).getByText("answers the checkout migration question", { exact: false })).toBeInTheDocument();
  });

  it("labels limited-grounding legacy sessions clearly", () => {
    render(<ResultsFeedbackCards session={session({
      blueprint: {
        status: "limited-grounding",
        fallbackReason: "Gemini returned invalid blueprint JSON after one repair attempt.",
        maxFollowUps: 3,
        maxQuestions: 5,
        createdAt: "2026-08-29T10:00:00.000Z",
        questions: [
          {
            id: "question-1",
            sequence: 1,
            category: "experience",
            competencyId: "react-architecture",
            competencyName: "React architecture",
            difficulty: "senior",
            isFollowUp: false,
            prompt: "How would you phase a large React migration?",
            answer: null,
            createdAt: "2026-08-29T10:00:00.000Z",
            objective: "Probe migration ownership and rollout trade-offs.",
            evidenceIds: ["evidence-1"],
            expectedSignals: ["ownership"],
            missingSignalPrompts: ["Name the rollback trigger."],
            followUpLimit: 1,
            sourceConfidence: 0.64,
          },
        ],
      },
      evaluations: [
        {
          score: 6,
          questionId: "question-1",
          competencyId: "react-architecture",
          competency: "React architecture",
          relevance: 5.1,
          dimensions: {},
          strengths: ["Stayed broadly on topic."],
          needsWork: ["Tie the answer back to the source evidence."],
          missingPoints: [],
          betterStructure: [],
          improvedAnswer: "",
          supportedClaims: [],
          expectedSignalsPresent: [],
          unsupportedClaims: [],
          dimensionReasons: {
            correctness: "The answer stays on the interview topic.",
            depth: "The answer is broad rather than specific.",
            clarity: "The answer is easy to follow.",
            structure: "The answer is concise but generic.",
            practicalExperience: "The answer does not anchor to a concrete project.",
            tradeOffAwareness: "The answer does not name a trade-off.",
            communication: "The answer is understandable.",
            confidence: "The answer is tentative.",
            relevance: "The answer is only partially aligned with the exact question.",
          },
        },
      ],
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "React architecture feedback" }));

    const details = screen.getByRole("region", { name: "React architecture feedback" });
    expect(within(details).getByText("Limited grounding")).toBeInTheDocument();
    expect(within(details).getByText("Gemini returned invalid blueprint JSON after one repair attempt.")).toBeInTheDocument();
  });

  it("omits legacy-empty sections while still showing question and answer content", () => {
    render(<ResultsFeedbackCards session={session()} />);

    fireEvent.click(screen.getByRole("button", { name: "Performance feedback" }));

    const details = screen.getByRole("region", { name: "Performance feedback" });
    expect(details).toBeInTheDocument();
    expect(screen.getByText("How do you keep a search UI responsive at 50,000 results?")).toBeInTheDocument();
    expect(screen.getByText("I would virtualize the list, debounce network work, and keep keyboard focus state outside each row.")).toBeInTheDocument();
    expect(within(details).queryByText("Missing points")).not.toBeInTheDocument();
    expect(within(details).queryByText("Better structure")).not.toBeInTheDocument();
    expect(within(details).queryByText("Improved answer")).not.toBeInTheDocument();
  });

  it("pairs each evaluation with the matching answered question even when evaluation rows were hydrated out of order", () => {
    render(<ResultsFeedbackCards session={session({
      evaluations: [
        {
          score: 6,
          questionId: "question-2",
          competencyId: "performance",
          competency: "Performance",
          dimensions: {},
          strengths: ["Recognized virtualization quickly."],
          needsWork: ["Explain how keyboard state survives list windowing."],
          missingPoints: [],
          betterStructure: [],
          improvedAnswer: "",
        },
        {
          score: 8,
          questionId: "question-1",
          competencyId: "react-architecture",
          competency: "React architecture",
          dimensions: { structure: 9, tradeOffAwareness: 8, clarity: 7 },
          strengths: ["Phased the migration with rollback gates."],
          needsWork: ["Call out how you would verify each rollout stage."],
          missingPoints: ["Name the signal that would trigger a rollback."],
          betterStructure: ["Start with constraints, then walk through phases, and close with rollback criteria."],
          improvedAnswer: "I would begin with the constraints, phase the migration by route, and define explicit rollback criteria for each milestone.",
        },
      ],
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "Performance feedback" }));

    const details = screen.getByRole("region", { name: "Performance feedback" });
    expect(within(details).getByText("How do you keep a search UI responsive at 50,000 results?")).toBeInTheDocument();
    expect(within(details).getByText("I would virtualize the list, debounce network work, and keep keyboard focus state outside each row.")).toBeInTheDocument();
    expect(within(details).queryByText("How would you phase a large React migration?")).not.toBeInTheDocument();
  });

  it("uses whitespace-free stable disclosure ids and labels the region from its toggle", () => {
    render(<ResultsFeedbackCards session={session({
      evaluations: [
        {
          score: 8,
          questionId: "question-1",
          competencyId: "react architecture",
          competency: "React architecture",
          dimensions: { structure: 9, tradeOffAwareness: 8, clarity: 7 },
          strengths: ["Phased the migration with rollback gates."],
          needsWork: ["Call out how you would verify each rollout stage."],
          missingPoints: ["Name the signal that would trigger a rollback."],
          betterStructure: ["Start with constraints, then walk through phases, and close with rollback criteria."],
          improvedAnswer: "I would begin with the constraints, phase the migration by route, and define explicit rollback criteria for each milestone.",
        },
      ],
    })} />);

    const toggle = screen.getByRole("button", { name: "React architecture feedback" });
    fireEvent.click(toggle);

    const region = screen.getByRole("region", { name: "React architecture feedback" });
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(controls).not.toMatch(/\s/);
    expect(toggle.id).not.toMatch(/\s/);
    expect(region.id).toBe(controls);
    expect(region).toHaveAttribute("aria-labelledby", toggle.id);
    expect(region.parentElement?.style.viewTransitionName).toBe("evaluation-card-question-question-1-0");
  });
});
