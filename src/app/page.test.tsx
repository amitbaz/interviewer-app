import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CareerDashboard, Competency, InterviewSession, Opportunity, PlannedQuestion, PracticeRecommendation, Profile, ProgressSnapshot } from "@/lib/types";
import App from "@/app/page";
import { ResultsFeedbackCards } from "@/app/results-feedback-cards";

const getUser = vi.fn();
const signInWithOAuth = vi.fn();
const signOut = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser,
      signInWithOAuth,
      signOut,
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
    practicePlanId: null,
    opportunityId: null,
    ...overrides,
  };
}

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    userId: "user-1",
    company: "Northwind",
    role: "Staff Engineer",
    status: "considering",
    location: null,
    remote: null,
    jobUrl: null,
    jobDescription: null,
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
    ...overrides,
  };
}

/** The baseline "no urgent signals" recommendation `recommendPractice` returns for an empty/quiet account. */
function fallbackRecommendation(): PracticeRecommendation {
  return {
    format: "full_simulation",
    primaryFocus: "Run a full mock interview simulation",
    secondaryFocus: null,
    rationale: "There's no urgent opportunity, reviewed observation, or progress signal driving practice right now, so a full simulation keeps every competency fresh.",
    estimatedMinutes: 30,
    successCriteria: [
      "Complete a full mock interview across the core competencies.",
      "Receive scored feedback on every answer.",
    ],
    primaryOpportunityId: null,
    supportingOpportunityIds: [],
    signals: [{ kind: "fallback", label: "general readiness", detail: "no urgent signals right now" }],
  };
}

/** The `GET /api/career/dashboard` payload shape -- the shell's canonical read model once a profile exists. */
function dashboardPayload(
  profilePayload: Profile,
  sessionsPayload: InterviewSession[],
  progressPayload: ProgressSnapshot,
  overrides: Partial<CareerDashboard> = {},
): CareerDashboard {
  return {
    profile: profilePayload,
    coachMode: "demo",
    progress: progressPayload,
    recentSessions: sessionsPayload,
    opportunities: [],
    upcomingOpportunities: [],
    observations: [],
    stories: [],
    recentPracticePlans: [],
    recommendation: fallbackRecommendation(),
    ...overrides,
  };
}

function mockCoachData(options: {
  profile?: Profile;
  progress: ProgressSnapshot;
  sessions?: InterviewSession[];
  dashboardOverrides?: Partial<CareerDashboard>;
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

    if (url === "/api/career/dashboard") {
      return {
        ok: true,
        status: 200,
        json: async () => dashboardPayload(profilePayload, sessionsPayload, options.progress, options.dashboardOverrides),
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

type RouteResponse = { ok?: boolean; status?: number; body: unknown };
type RouteHandler = (init: RequestInit | undefined) => RouteResponse;

/**
 * Stubs `fetch` with a per-path handler map so interaction tests can drive the
 * shell's real request/response cycle instead of only its first paint. Each
 * handler receives the `RequestInit`, so one path can answer both its GET read
 * model and its POST actions.
 */
function mockRoutes(routes: Record<string, RouteHandler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const handler = routes[url];
    if (!handler) throw new Error(`Unexpected request: ${url}`);
    const { ok = true, status = 200, body } = handler(init);
    return { ok, status, json: async () => body } satisfies Partial<Response>;
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

function emptyProgress(): ProgressSnapshot {
  return {
    readiness: null,
    latestScore: null,
    trend: null,
    recentScores: [],
    strongest: null,
    weakest: null,
    recurringWeaknesses: [],
  };
}

/** The shape `/api/interview` returns for a freshly started conversation: one open question, no evaluations. */
function activeConversationSession(): InterviewSession {
  return session({
    id: "session-active",
    status: "active",
    completedAt: null,
    overallScore: null,
    resultSummary: {},
    evaluations: [],
    questions: [question(1, "How would you phase a large React migration?", "", "react-architecture", "React architecture")],
    messages: [
      {
        id: "question-1:prompt",
        role: "interviewer",
        content: "How would you phase a large React migration?",
        createdAt: "2026-08-29T10:00:00.000Z",
      },
    ],
  });
}

/** The shape `/api/interview` returns for a freshly started hands-on exercise. */
function activeHandsOnSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return session({
    id: "session-hands-on",
    kind: "hands-on",
    status: "active",
    completedAt: null,
    overallScore: null,
    resultSummary: {},
    evaluations: [],
    questions: [],
    exercise: {
      title: "Accessible product search",
      durationMinutes: 60,
      briefing: "Build an accessible product search over a large catalog.",
      requirements: ["Debounce the query", "Keep keyboard focus stable"],
      starterCode: "export function ProductSearch() {}",
      interviewerOpening: "Talk me through your plan before you type.",
    },
    messages: [
      {
        id: "opening",
        role: "interviewer",
        content: "Talk me through your plan before you type.",
        createdAt: "2026-08-29T10:00:00.000Z",
      },
    ],
    ...overrides,
  });
}

/**
 * Drives the shell from home into an active interview so answer, checkpoint,
 * and transcription assertions all start from the same place. Home's own CTA
 * starts the server-recommended practice, not an ad-hoc mixed interview, so
 * this goes through the Practice view's manual start actions instead.
 */
async function startInterviewFrom(mode: "conversation" | "hands-on", started: InterviewSession, routes: Record<string, RouteHandler>) {
  const fetchMock = mockRoutes(routes);
  render(<App />);

  await screen.findByRole("heading", { name: "Ready when you are." });
  fireEvent.click(screen.getByRole("button", { name: "practice" }));
  await screen.findByRole("heading", { name: "Choose deliberate practice." });
  fireEvent.click(screen.getByRole("button", { name: mode === "hands-on" ? "Start hands-on" : "Start now" }));
  await screen.findByRole("heading", {
    name: started.kind === "hands-on" ? "Build, narrate, adapt." : "Stay in the conversation.",
  });

  return fetchMock;
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  signInWithOAuth.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
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
  it("blocks the recommended-practice CTA when the profile readiness gate is failing", async () => {
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

    expect(screen.getByRole("button", { name: "Start recommended practice" })).toBeDisabled();
    expect(screen.getByText(/two concrete engineering projects or work examples/)).toBeInTheDocument();
  });

  it("navigates to Applications when its open-affordance button is clicked", async () => {
    await renderHomeView({ progress: emptyProgress() });

    fireEvent.click(screen.getByRole("button", { name: "Open applications" }));

    expect(await screen.findByRole("heading", { name: "Applications" })).toBeInTheDocument();
  });

  // The shell wires Home's onOpenStories/onOpenCoach to navigate("stories")/navigate("coach").
  // Task 10 owns what those views render (both are intentionally empty for now, per R20), so
  // this only proves the navigation happened -- Home's own content unmounting is the signal --
  // not what replaces it.
  it.each([
    ["Open story bank", "stories"],
    ["Open coach", "coach"],
  ])("navigates away from Home when %s is clicked", async (buttonName) => {
    await renderHomeView({ progress: emptyProgress() });

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Start recommended practice" })).not.toBeInTheDocument());
  });
});

describe("App applications view", () => {
  /**
   * Drives an Applications mutation through the *real* shell (not
   * ApplicationsView's own isolated tests, which mock every callback) so
   * `handleCreateOpportunity`'s `setBusy`/`setError`/`refreshDashboard()`/
   * rethrow wiring in `relay-shell.tsx` is actually exercised. The dashboard
   * route's handler tracks its own call count and only starts returning the
   * created opportunity from its second response onward, so the new
   * opportunity appearing in the list can only mean the shell re-fetched the
   * dashboard after the mutation succeeded -- not that it read the create
   * response directly (the view never does that; it navigates by prop).
   */
  it("creates an opportunity through the real shell and refreshes the dashboard so it appears in the list", async () => {
    const created = opportunity({ id: "opp-new", company: "Globex", role: "Principal Engineer" });
    let dashboardCalls = 0;
    mockRoutes({
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => {
        dashboardCalls += 1;
        return { body: dashboardPayload(profile(), [], emptyProgress(), { opportunities: dashboardCalls > 1 ? [created] : [] }) };
      },
      "/api/opportunities": (init) => {
        const body = requestBody(init);
        if (body.action === "create") return { body: { opportunity: created } };
        throw new Error(`Unexpected /api/opportunities action in this test: ${body.action}`);
      },
      "/api/opportunities?opportunityId=opp-new": () => ({ body: { events: [] } }),
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Ready when you are." });
    fireEvent.click(screen.getByRole("button", { name: "applications" }));
    await screen.findByRole("heading", { name: "Applications" });

    expect(dashboardCalls).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Globex" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Principal Engineer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));

    // The detail heading (not the list row, which would also match "Globex")
    // confirms the freshly created opportunity was auto-selected from the
    // refreshed dashboard's own data.
    expect(await screen.findByRole("heading", { name: "Globex" })).toBeInTheDocument();
    expect(dashboardCalls).toBe(2);
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

describe("App authentication shell", () => {
  it("shows the sign-in screen while nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    mockRoutes({});

    render(<App />);
    expect(screen.getByText("Checking your sign-in…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Practice with your own career context." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("starts Google OAuth from the sign-in screen", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    mockRoutes({});

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    }));
  });

  it("surfaces a failed sign-in without leaving the sign-in screen", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    signInWithOAuth.mockResolvedValue({ error: new Error("Google rejected the request.") });
    mockRoutes({});

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Google rejected the request.");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("signs out back to the sign-in screen", async () => {
    mockRoutes({
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Ready when you are." });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("returns to the sign-in screen when coach data comes back unauthenticated", async () => {
    mockRoutes({
      "/api/profile": () => ({ ok: false, status: 401, body: { error: "Sign in to continue." } }),
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    // A 401 signs the shell out silently; it never shows the raw request error.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("App onboarding and profile review", () => {
  it("creates a profile from pasted CV text and opens profile review", async () => {
    const created = profile();
    const fetchMock = mockRoutes({
      "/api/profile": (init) => init?.method
        ? { body: { profile: created, demoMode: false } }
        : { body: { profile: null, demoMode: false } },
      "/api/career/dashboard": () => ({ body: dashboardPayload(created, [], emptyProgress()) }),
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Make your next interview feel familiar." });

    fireEvent.change(screen.getByPlaceholderText("Senior Frontend Engineer · React · TypeScript · achievements…"), {
      target: { value: "Senior frontend engineer with checkout migration experience." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));

    await screen.findByRole("heading", { name: "Make the coach accurate." });
    const createCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(requestBody(createCall?.[1] as RequestInit)).toEqual({
      cvText: "Senior frontend engineer with checkout migration experience.",
      coverLetter: "",
    });
    // The review form is seeded from the returned profile, not left blank.
    expect(screen.getByDisplayValue("Senior Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("React, TypeScript")).toBeInTheDocument();
  });

  it("reports a failed profile creation instead of advancing to review", async () => {
    mockRoutes({
      "/api/profile": (init) => init?.method
        ? { ok: false, status: 500, body: { error: "Could not read that CV." } }
        : { body: { profile: null, demoMode: false } },
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Make your next interview feel familiar." });

    fireEvent.change(screen.getByPlaceholderText("Senior Frontend Engineer · React · TypeScript · achievements…"), {
      target: { value: "Frontend engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read that CV.");
    expect(screen.queryByRole("heading", { name: "Make the coach accurate." })).not.toBeInTheDocument();
  });

  it("confirms an edited profile and lands on home", async () => {
    const created = profile();
    const fetchMock = mockRoutes({
      "/api/profile": (init) => init?.method
        ? { body: { profile: created, demoMode: false } }
        : { body: { profile: null, demoMode: false } },
      "/api/career/dashboard": () => ({ body: dashboardPayload(created, [], emptyProgress()) }),
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Make your next interview feel familiar." });
    fireEvent.change(screen.getByPlaceholderText("Senior Frontend Engineer · React · TypeScript · achievements…"), {
      target: { value: "Frontend engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));

    await screen.findByRole("heading", { name: "Make the coach accurate." });
    fireEvent.change(screen.getByDisplayValue("Senior Frontend Engineer"), { target: { value: "Staff Frontend Engineer" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm profile" }));

    await screen.findByRole("heading", { name: "Ready when you are." });
    const confirmCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(requestBody(confirmCall?.[1] as RequestInit)).toEqual({
      profile: {
        role: "Staff Frontend Engineer",
        seniority: "Senior",
        narrative: "Leads complex React work.",
        expertise: ["React", "TypeScript"],
      },
    });
  });
});

describe("App conversation interview", () => {
  it("starts a grounded conversation and renders the interviewer message", async () => {
    const started = activeConversationSession();
    const fetchMock = await startInterviewFrom("conversation", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": () => ({ body: { session: started } }),
    });

    const startCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(requestBody(startCall?.[1] as RequestInit)).toEqual({ action: "start", mode: "conversation" });
    expect(screen.getByText("Mixed interview · 0 of 1 answered")).toBeInTheDocument();
    expect(screen.getByText("How would you phase a large React migration?")).toBeInTheDocument();
    expect(screen.getByText("Grounded question")).toBeInTheDocument();
  });

  it("sends an answer and clears the composer", async () => {
    const started = activeConversationSession();
    const answered = session({
      ...started,
      questions: [question(1, "How would you phase a large React migration?", "Phase by route.", "react-architecture", "React architecture")],
      messages: [
        ...started.messages,
        { id: "question-1:answer", role: "candidate", content: "Phase by route.", createdAt: "2026-08-29T10:05:00.000Z" },
      ],
    });
    const fetchMock = await startInterviewFrom("conversation", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": (init) => requestBody(init).action === "start" ? { body: { session: started } } : { body: { session: answered } },
    });

    const composer = screen.getByPlaceholderText("Answer as if you were in the room…");
    fireEvent.change(composer, { target: { value: "Phase by route." } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    await screen.findByText("Mixed interview · 1 of 1 answered");
    expect(composer).toHaveValue("");
    const respondCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST"
      && requestBody(init as RequestInit).action === "respond");
    expect(requestBody(respondCall?.[1] as RequestInit)).toEqual({
      action: "respond",
      sessionId: "session-active",
      answer: "Phase by route.",
    });
  });

  it("shows the results view once the interview completes", async () => {
    const started = activeConversationSession();
    const completed = session({ id: "session-active", overallScore: 7.5, resultSummary: { summary: "Strong migration reasoning." } });
    await startInterviewFrom("conversation", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [completed], emptyProgress()) }),
      "/api/interview": (init) => requestBody(init).action === "start"
        ? { body: { session: started } }
        : { body: { session: completed, profile: profile() } },
    });

    fireEvent.change(screen.getByPlaceholderText("Answer as if you were in the room…"), { target: { value: "Phase by route." } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(await screen.findByRole("heading", { name: "A useful baseline." })).toBeInTheDocument();
    expect(screen.getByText("Strong migration reasoning.")).toBeInTheDocument();
    expect(screen.getByText("7.5")).toBeInTheDocument();
  });

  it("reports a failed answer without clearing the composer", async () => {
    const started = activeConversationSession();
    await startInterviewFrom("conversation", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": (init) => requestBody(init).action === "start"
        ? { body: { session: started } }
        : { ok: false, status: 500, body: { error: "The coach is unavailable." } },
    });

    fireEvent.change(screen.getByPlaceholderText("Answer as if you were in the room…"), { target: { value: "Phase by route." } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The coach is unavailable.");
    expect(screen.getByPlaceholderText("Answer as if you were in the room…")).toHaveValue("Phase by route.");
  });
});

describe("App hands-on interview", () => {
  it("opens the exercise brief with the starter code loaded into the workspace", async () => {
    const started = activeHandsOnSession();
    const fetchMock = await startInterviewFrom("hands-on", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": () => ({ body: { session: started } }),
    });

    const startCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(requestBody(startCall?.[1] as RequestInit)).toEqual({ action: "start", mode: "hands-on" });
    expect(screen.getByRole("heading", { name: "Accessible product search" })).toBeInTheDocument();
    expect(screen.getByText("Debounce the query")).toBeInTheDocument();
    expect(screen.getByLabelText("TypeScript code workspace")).toHaveValue("export function ProductSearch() {}");
    expect(screen.getByText("0 checkpoints saved")).toBeInTheDocument();
  });

  it("saves a checkpoint and clears the note", async () => {
    const started = activeHandsOnSession();
    const withCheckpoint = activeHandsOnSession({
      checkpoints: [
        {
          id: "checkpoint-1",
          code: "export function ProductSearch() {}",
          note: "Cancelling in-flight searches first.",
          interviewerPrompt: "How will you keep focus stable?",
          createdAt: "2026-08-29T10:10:00.000Z",
        },
      ],
    });
    const fetchMock = await startInterviewFrom("hands-on", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": (init) => requestBody(init).action === "start" ? { body: { session: started } } : { body: { session: withCheckpoint } },
    });

    const note = screen.getByPlaceholderText("For example: I am cancelling in-flight searches and will add keyboard state next…");
    fireEvent.change(note, { target: { value: "Cancelling in-flight searches first." } });
    fireEvent.click(screen.getByRole("button", { name: "Save checkpoint" }));

    await screen.findByText("1 checkpoint saved");
    expect(note).toHaveValue("");
    const checkpointCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST"
      && requestBody(init as RequestInit).action === "checkpoint");
    expect(requestBody(checkpointCall?.[1] as RequestInit)).toEqual({
      action: "checkpoint",
      sessionId: "session-hands-on",
      code: "export function ProductSearch() {}",
      note: "Cancelling in-flight searches first.",
    });
  });
});

describe("App answer transcription", () => {
  /**
   * Minimal `MediaRecorder` stand-in: jsdom has none, and the shell only uses
   * `state`, `mimeType`, `ondataavailable`, `onstop`, `start`, and `stop`.
   */
  class FakeMediaRecorder {
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;

    constructor(readonly stream: MediaStream) {}

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }

  function stubMicrophone() {
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    return { getUserMedia, track };
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("appends the transcript of a recorded answer to the composer", async () => {
    const { track } = stubMicrophone();
    const started = activeConversationSession();
    await startInterviewFrom("conversation", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": () => ({ body: { session: started } }),
      "/api/transcribe": () => ({ body: { transcript: "I would phase the migration by route." } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "● Record answer" }));
    fireEvent.click(await screen.findByRole("button", { name: "■ Stop & transcribe" }));

    await waitFor(() => expect(screen.getByPlaceholderText("Answer as if you were in the room…"))
      .toHaveValue("I would phase the migration by route."));
    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "● Record answer" })).toBeInTheDocument();
  });

  it("reports a failed transcription and leaves the composer untouched", async () => {
    stubMicrophone();
    const started = activeConversationSession();
    await startInterviewFrom("conversation", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": () => ({ body: { session: started } }),
      "/api/transcribe": () => ({ ok: false, status: 500, body: { error: "Could not transcribe recording." } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "● Record answer" }));
    fireEvent.click(await screen.findByRole("button", { name: "■ Stop & transcribe" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not transcribe recording.");
    expect(screen.getByPlaceholderText("Answer as if you were in the room…")).toHaveValue("");
  });

  it("explains that recording is unavailable when the browser has no MediaRecorder", async () => {
    const started = activeConversationSession();
    await startInterviewFrom("conversation", started, {
      "/api/profile": () => ({ body: { profile: profile(), demoMode: false } }),
      "/api/career/dashboard": () => ({ body: dashboardPayload(profile(), [], emptyProgress()) }),
      "/api/interview": () => ({ body: { session: started } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "● Record answer" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Voice recording is not available in this browser. Type your answer instead.");
  });
});
