import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertConversationPlan,
  completeHandsOnSession,
  createSessionWithPlan,
  mapSession,
  recordAnswerAndEvaluation,
  recordConversationTurn,
} from "@/lib/repositories/interviews";

describe("mapSession", () => {
  it("maps persisted questions into an ordered plan and transcript", () => {
    const session = mapSession(
      {
        id: "session-1", user_id: "user-1", kind: "conversation", status: "active",
        started_at: "2026-08-29T10:00:00.000Z", completed_at: null, exercise: {}, result_summary: {},
        overall_score: null, created_at: "2026-08-29T10:00:00.000Z", updated_at: "2026-08-29T10:00:00.000Z",
      },
      [{
        id: "question-1", sequence: 1, category: "experience", competency_id: "competency-1",
        difficulty: "senior", is_follow_up: false, prompt: "Tell me about React.", answer: "I owned it.",
        created_at: "2026-08-29T10:01:00.000Z", answered_at: "2026-08-29T10:02:00.000Z",
      }],
      [{ id: "evaluation-1", question_id: "question-1", overall_score: 8, dimensions: { depth: 8 }, strengths: ["Specific"], weaknesses: ["Short"] }],
      [],
      new Map([["competency-1", "React architecture"]]),
    );

    expect(session.questions).toMatchObject([{ id: "question-1", competencyName: "React architecture", answer: "I owned it." }]);
    expect(session.messages).toEqual([
      { id: "question-1:question", role: "interviewer", content: "Tell me about React.", createdAt: "2026-08-29T10:01:00.000Z" },
      { id: "question-1:answer", role: "candidate", content: "I owned it.", createdAt: "2026-08-29T10:02:00.000Z" },
    ]);
    expect(session.evaluations).toMatchObject([{ competency: "React architecture", score: 8, dimensions: { depth: 8 } }]);
    expect(session.evaluations).toMatchObject([{
      missingPoints: [],
      betterStructure: [],
      improvedAnswer: "",
    }]);
  });

  it("orders question evaluations by their persisted question sequence before hydrating results feedback", () => {
    const mapped = mapSession(
      {
        id: "session-1", user_id: "user-1", kind: "conversation", status: "complete",
        started_at: "2026-08-29T10:00:00.000Z", completed_at: "2026-08-29T10:30:00.000Z", exercise: {}, result_summary: {},
        overall_score: 7, created_at: "2026-08-29T10:00:00.000Z", updated_at: "2026-08-29T10:30:00.000Z",
      },
      [
        {
          id: "question-1", sequence: 1, category: "experience", competency_id: "competency-1",
          difficulty: "senior", is_follow_up: false, prompt: "Tell me about the migration.", answer: "I phased by route.",
          created_at: "2026-08-29T10:01:00.000Z", answered_at: "2026-08-29T10:02:00.000Z",
        },
        {
          id: "question-2", sequence: 2, category: "technical", competency_id: "competency-2",
          difficulty: "senior", is_follow_up: false, prompt: "How did you handle focus state?", answer: "I kept it outside each row.",
          created_at: "2026-08-29T10:03:00.000Z", answered_at: "2026-08-29T10:04:00.000Z",
        },
      ],
      [
        { id: "evaluation-2", question_id: "question-2", overall_score: 6, dimensions: {}, strengths: ["Scoped focus state"], weaknesses: ["Quantify latency"] },
        { id: "evaluation-1", question_id: "question-1", overall_score: 8, dimensions: {}, strengths: ["Clear rollout"], weaknesses: ["Name the rollback trigger"] },
      ],
      [],
      new Map([
        ["competency-1", "React architecture"],
        ["competency-2", "Performance"],
      ]),
    );

    expect(mapped.evaluations.map((evaluation) => evaluation.competency)).toEqual([
      "React architecture",
      "Performance",
    ]);
    expect(mapped.questions.map((question) => question.prompt)).toEqual([
      "Tell me about the migration.",
      "How did you handle focus state?",
    ]);
  });

  it("rejects a plan that is not the exact five-question backbone before persistence", () => {
    expect(() => assertConversationPlan([
      { id: "1", sequence: 1, category: "introduction", competencyId: null, competencyName: null, difficulty: "senior", isFollowUp: false, prompt: "one", answer: null, createdAt: "" },
      { id: "2", sequence: 2, category: "experience", competencyId: null, competencyName: null, difficulty: "senior", isFollowUp: false, prompt: "two", answer: null, createdAt: "" },
      { id: "3", sequence: 3, category: "technical", competencyId: null, competencyName: null, difficulty: "senior", isFollowUp: false, prompt: "three", answer: null, createdAt: "" },
      { id: "4", sequence: 4, category: "architecture", competencyId: null, competencyName: null, difficulty: "senior", isFollowUp: false, prompt: "four", answer: null, createdAt: "" },
    ])).toThrow("five-question backbone");
  });

  it("creates the exact backbone through the atomic plan RPC", async () => {
    const calls: Array<{ name: string; payload: unknown }> = [];
    const sessionRow = {
      id: "session-1", user_id: "user-1", kind: "conversation", status: "active",
      started_at: "2026-08-29T10:00:00.000Z", completed_at: null, exercise: {}, result_summary: {},
      overall_score: null, created_at: "2026-08-29T10:00:00.000Z", updated_at: "2026-08-29T10:00:00.000Z",
    };
    const emptyQuery = {
      eq: () => emptyQuery,
      order: async () => ({ data: [], error: null }),
    };
    const sessionQuery = {
      eq: () => sessionQuery,
      maybeSingle: async () => ({ data: sessionRow, error: null }),
    };
    const supabase = {
      rpc: async (name: string, payload: unknown) => {
        calls.push({ name, payload });
        return { data: [{ session_id: "session-1" }], error: null };
      },
      from: (table: string) => ({ select: () => table === "interview_sessions" ? sessionQuery : emptyQuery }),
    };
    const plan = ["introduction", "experience", "technical", "architecture", "behavioral"].map((category, index) => ({
      id: `question-${index + 1}`, sequence: index + 1, category, competencyId: null, competencyName: null,
      difficulty: "senior", isFollowUp: false, prompt: `prompt-${index + 1}`, answer: null, createdAt: "",
    }));

    const session = await createSessionWithPlan(supabase as never, "user-1", plan as never);

    expect(session.id).toBe("session-1");
    expect(calls).toEqual([{
      name: "create_conversation_session_with_plan",
      payload: { p_plan: expect.arrayContaining([expect.objectContaining({ sequence: 1, category: "introduction" })]) },
    }]);
  });

  it("hydrates persisted hands-on evaluations and interviewer history", () => {
    const mapped = mapSession(
      {
        id: "hands-on-1", user_id: "user-1", kind: "hands-on", status: "complete",
        started_at: "2026-08-29T10:00:00.000Z", completed_at: "2026-08-29T11:00:00.000Z",
        exercise: { interviewerOpening: "Clarify the brief first." }, result_summary: { summary: "Review" },
        overall_score: 7, created_at: "2026-08-29T10:00:00.000Z", updated_at: "2026-08-29T11:00:00.000Z",
      },
      [],
      [],
      [{
        id: "checkpoint-1", code: "const result = true;", note: "I separated state ownership.",
        interviewer_prompt: "How will you prevent stale responses?", created_at: "2026-08-29T10:20:00.000Z",
      }],
      new Map([["architecture-id", "React architecture"]]),
      [{
        id: "evaluation-1", competency_id: "architecture-id", overall_score: 7,
        dimensions: { structure: 8 }, strengths: ["Clear ownership"], weaknesses: ["Add cancellation"],
      }],
    );

    expect(mapped.evaluations).toEqual([expect.objectContaining({
      competencyId: "architecture-id",
      competency: "React architecture",
      score: 7,
      missingPoints: [],
      betterStructure: [],
      improvedAnswer: "",
    })]);
    expect(mapped.messages.map((message) => message.content)).toEqual([
      "Clarify the brief first.",
      "Checkpoint: I separated state ownership.",
      "How will you prevent stale responses?",
    ]);
  });

  it("records an answer and its next persisted question in one RPC", async () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const supabase = rpcHydrationClient(calls, "conversation");

    await recordConversationTurn(
      supabase as never,
      "user-1",
      "question-1",
      "I compared the trade-offs.",
      {
        score: 7,
        competencyId: "react-id",
        competency: "React",
        dimensions: {},
        strengths: ["Specific"],
        needsWork: ["Quantify"],
        missingPoints: ["Name the fallback path."],
        betterStructure: ["Lead with the requirement, then the trade-off."],
        improvedAnswer: "I would start with the requirement, compare the trade-offs, and justify the fallback path.",
      },
      { nextQuestionId: "question-2", nextPrompt: "How would you design the system?", followUp: null },
    );

    expect(calls).toEqual([{
      name: "record_conversation_turn",
      payload: expect.objectContaining({
        p_question_id: "question-1",
        p_next_question_id: "question-2",
        p_next_prompt: "How would you design the system?",
        p_follow_up: null,
        p_missing_points: ["Name the fallback path."],
        p_better_structure: ["Lead with the requirement, then the trade-off."],
        p_improved_answer: "I would start with the requirement, compare the trade-offs, and justify the fallback path.",
      }),
    }]);
  });

  it("records richer evaluation coaching through the question-evidence RPC", async () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const supabase = rpcHydrationClient(calls, "conversation");

    await recordAnswerAndEvaluation(
      supabase as never,
      "user-1",
      "question-1",
      "I compared the trade-offs.",
      {
        score: 7,
        competencyId: "react-id",
        competency: "React",
        dimensions: {},
        strengths: ["Specific"],
        needsWork: ["Quantify"],
        missingPoints: ["Name the fallback path."],
        betterStructure: ["Lead with the requirement, then the trade-off."],
        improvedAnswer: "I would start with the requirement, compare the trade-offs, and justify the fallback path.",
      },
    );

    expect(calls).toEqual([{
      name: "record_interview_evidence",
      payload: expect.objectContaining({
        p_question_id: "question-1",
        p_missing_points: ["Name the fallback path."],
        p_better_structure: ["Lead with the requirement, then the trade-off."],
        p_improved_answer: "I would start with the requirement, compare the trade-offs, and justify the fallback path.",
      }),
    }]);
  });

  it("completes hands-on evaluation and competency evidence in one RPC", async () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const supabase = rpcHydrationClient(calls, "hands-on", "complete");

    await completeHandsOnSession(
      supabase as never,
      "user-1",
      "session-1",
      {
        overallScore: 7,
        summary: "A useful signal.",
        evaluations: [{
          score: 7,
          competencyId: null,
          competency: "React architecture",
          dimensions: { structure: 8 },
          strengths: ["Clear ownership"],
          needsWork: ["Add cancellation"],
          missingPoints: ["Call out keyboard focus recovery."],
          betterStructure: ["Start with interaction states, then discuss implementation."],
          improvedAnswer: "I would begin with the interaction states, then explain how the implementation preserves keyboard focus.",
        }],
      },
    );

    expect(calls).toEqual([{
      name: "complete_hands_on_session",
      payload: expect.objectContaining({
        p_session_id: "session-1",
        p_overall_score: 7,
        p_evaluations: [expect.objectContaining({
          competency: "React architecture",
          score: 7,
          missing_points: ["Call out keyboard focus recovery."],
          better_structure: ["Start with interaction states, then discuss implementation."],
          improved_answer: "I would begin with the interaction states, then explain how the implementation preserves keyboard focus.",
        })],
      }),
    }]);
  });
});

function rpcHydrationClient(
  calls: Array<{ name: string; payload: Record<string, unknown> }>,
  kind: "conversation" | "hands-on",
  status: "active" | "complete" = "active",
) {
  const sessionRow = {
    id: "session-1", user_id: "user-1", kind, status,
    started_at: "2026-08-29T10:00:00.000Z", completed_at: status === "complete" ? "2026-08-29T11:00:00.000Z" : null,
    exercise: {}, result_summary: {}, overall_score: status === "complete" ? 7 : null,
    created_at: "2026-08-29T10:00:00.000Z", updated_at: "2026-08-29T10:00:00.000Z",
  };
  const emptyQuery = {
    eq: () => emptyQuery,
    in: async () => ({ data: [], error: null }),
    order: async () => ({ data: [], error: null }),
  };
  const sessionQuery = {
    eq: () => sessionQuery,
    maybeSingle: async () => ({ data: sessionRow, error: null }),
  };
  return {
    rpc: async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      return { data: [{ session_id: "session-1" }], error: null };
    },
    from: (table: string) => ({ select: () => table === "interview_sessions" ? sessionQuery : emptyQuery }),
  };
}
