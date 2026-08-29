import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Competency, InterviewSession, PlannedQuestion, Profile } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getProfile: vi.fn(),
  getSession: vi.fn(),
  listRecentSessions: vi.fn(),
  createHandsOnSession: vi.fn(),
  createSessionWithPlan: vi.fn(),
  recordConversationTurn: vi.fn(),
  saveHandsOnCheckpoint: vi.fn(),
  completeSession: vi.fn(),
  completeHandsOnSession: vi.fn(),
  buildInterviewPlan: vi.fn(),
  nextTurn: vi.fn(),
  initialQuestion: vi.fn(),
  summarizeSession: vi.fn(),
  evaluateHandsOn: vi.fn(),
  handsOnCheckpoint: vi.fn(),
  handsOnExercise: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/repositories/profile", () => ({ getProfile: mocks.getProfile }));
vi.mock("@/lib/repositories/interviews", () => ({
  getSession: mocks.getSession,
  listRecentSessions: mocks.listRecentSessions,
  createHandsOnSession: mocks.createHandsOnSession,
  createSessionWithPlan: mocks.createSessionWithPlan,
  recordConversationTurn: mocks.recordConversationTurn,
  saveHandsOnCheckpoint: mocks.saveHandsOnCheckpoint,
  completeSession: mocks.completeSession,
  completeHandsOnSession: mocks.completeHandsOnSession,
}));
vi.mock("@/lib/interview-planner", () => ({ buildInterviewPlan: mocks.buildInterviewPlan }));
vi.mock("@/lib/coach", () => ({
  nextTurn: mocks.nextTurn,
  initialQuestion: mocks.initialQuestion,
  completeSession: mocks.summarizeSession,
  evaluateHandsOn: mocks.evaluateHandsOn,
  handsOnCheckpoint: mocks.handsOnCheckpoint,
  handsOnExercise: mocks.handsOnExercise,
}));

import { GET, POST } from "@/app/api/interview/route";

const competency: Competency = {
  id: "react-id",
  name: "React architecture",
  relevance: 5,
  expectedLevel: "senior",
  estimatedLevel: "senior",
  confidence: "high",
  lastPracticedAt: "2026-08-29T10:00:00.000Z",
  questionCount: 4,
  averageScore: 8.4,
  recentScore: 9,
  strengths: ["Frames trade-offs clearly."],
  weaknesses: ["Adds too much implementation detail before the decision."],
};

const profile: Profile = {
  userId: "user-1",
  role: "Frontend Engineer",
  seniority: "Senior",
  summary: "Frontend engineer",
  narrative: "Owns frontend platforms.",
  expertise: ["React"],
  characteristics: ["Pragmatic"],
  competencies: [competency],
  source: { cvText: "At Acme I led a React migration.", coverLetter: "" },
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
};

function question(sequence: number, answer: string | null): PlannedQuestion {
  const categories: PlannedQuestion["category"][] = [
    "introduction", "experience", "technical", "architecture", "behavioral",
  ];
  return {
    id: `question-${sequence}`,
    sequence,
    category: categories[Math.min(sequence - 1, categories.length - 1)],
    competencyId: sequence === 1 ? null : "react-id",
    competencyName: sequence === 1 ? null : "React architecture",
    difficulty: "senior",
    isFollowUp: sequence > 5,
    prompt: `Question ${sequence}`,
    answer,
    createdAt: "2026-08-29T10:00:00.000Z",
  };
}

function session(questions: PlannedQuestion[], status: InterviewSession["status"] = "active"): InterviewSession {
  return {
    id: "session-1",
    userId: "user-1",
    kind: "conversation",
    status,
    startedAt: "2026-08-29T10:00:00.000Z",
    completedAt: status === "complete" ? "2026-08-29T11:00:00.000Z" : null,
    exercise: {},
    resultSummary: status === "complete" ? { summary: "Complete" } : {},
    overallScore: status === "complete" ? 7 : null,
    questions,
    checkpoints: [],
    evaluations: [],
    messages: [],
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
  };
}

describe("POST /api/interview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ supabase: { client: true }, user: { id: "user-1" } });
    mocks.getProfile.mockResolvedValue(profile);
  });

  it("returns 401 before reading a request body when authentication is absent", async () => {
    mocks.requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
    const json = vi.fn();

    const response = await POST({ json } as unknown as Request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
  });

  it("keeps the session active when the fifth backbone answer creates a persisted follow-up", async () => {
    const current = session([1, 2, 3, 4, 5].map((sequence) => question(sequence, sequence < 5 ? "answered" : null)));
    const followUp = question(6, null);
    mocks.getSession.mockResolvedValue(current);
    mocks.nextTurn.mockResolvedValue({
      evaluation: { score: 5, competencyId: "react-id", competency: "React architecture", dimensions: {}, strengths: [], needsWork: ["Clarify"] },
      nextQuestion: null,
      followUp: { ...followUp, prompt: "Which trade-off did you choose?" },
    });
    mocks.recordConversationTurn.mockResolvedValue(session([
      ...current.questions.slice(0, 4),
      question(5, "short answer"),
      { ...followUp, prompt: "Which trade-off did you choose?" },
    ]));

    const response = await POST(new Request("http://localhost/api/interview", {
      method: "POST",
      body: JSON.stringify({ action: "respond", sessionId: "session-1", answer: "short answer" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session.status).toBe("active");
    expect(body.session.questions).toHaveLength(6);
    expect(mocks.recordConversationTurn).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "question-5",
      "short answer",
      expect.anything(),
      expect.objectContaining({ followUp: expect.objectContaining({ prompt: "Which trade-off did you choose?" }) }),
    );
    expect(mocks.completeSession).not.toHaveBeenCalled();
  });

  it("completes naturally only after the final persisted question is answered", async () => {
    const current = session([1, 2, 3, 4, 5].map((sequence) => question(sequence, sequence < 5 ? "answered" : null)));
    const answered = session([1, 2, 3, 4, 5].map((sequence) => question(sequence, "answered")));
    const completed = session(answered.questions, "complete");
    mocks.getSession.mockResolvedValue(current);
    mocks.nextTurn.mockResolvedValue({
      evaluation: { score: 8, competencyId: "react-id", competency: "React architecture", dimensions: {}, strengths: ["Specific"], needsWork: [] },
      nextQuestion: null,
      followUp: null,
    });
    mocks.recordConversationTurn.mockResolvedValue(answered);
    mocks.summarizeSession.mockReturnValue({ overallScore: 8, summary: "Complete" });
    mocks.completeSession.mockResolvedValue(completed);

    const response = await POST(new Request("http://localhost/api/interview", {
      method: "POST",
      body: JSON.stringify({ action: "respond", sessionId: "session-1", answer: "A complete answer." }),
    }));
    const body = await response.json();

    expect(body.session.status).toBe("complete");
    expect(mocks.completeSession).toHaveBeenCalledOnce();
  });

  it("allows an explicit finish after five answers even when a follow-up remains", async () => {
    const current = session([
      ...[1, 2, 3, 4, 5].map((sequence) => question(sequence, "answered")),
      question(6, null),
    ]);
    const completed = session(current.questions, "complete");
    mocks.getSession.mockResolvedValue(current);
    mocks.summarizeSession.mockReturnValue({ overallScore: 7, summary: "Complete" });
    mocks.completeSession.mockResolvedValue(completed);

    const response = await POST(new Request("http://localhost/api/interview", {
      method: "POST",
      body: JSON.stringify({ action: "complete", sessionId: "session-1" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.completeSession).toHaveBeenCalledOnce();
  });
});

describe("GET /api/interview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ supabase: { client: true }, user: { id: "user-1" } });
    mocks.getProfile.mockResolvedValue(profile);
  });

  it("returns completed-session progress with the authenticated session list", async () => {
    mocks.listRecentSessions.mockResolvedValue([
      session([question(1, "answered")], "complete"),
      session([question(1, "answered")]),
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessions).toHaveLength(2);
    expect(body.progress).toMatchObject({
      readiness: 81,
      latestScore: 7,
      trend: "baseline",
      recentScores: [7],
      strongest: expect.objectContaining({ id: "react-id" }),
      weakest: expect.objectContaining({ id: "react-id" }),
      recurringWeaknesses: [],
    });
    expect(mocks.getProfile).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(mocks.listRecentSessions).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("returns 401 without exposing progress when authentication is absent", async () => {
    mocks.requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Sign in to continue." });
    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(mocks.listRecentSessions).not.toHaveBeenCalled();
  });
});
