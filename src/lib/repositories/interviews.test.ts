import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertConversationPlan, createSessionWithPlan, mapSession } from "@/lib/repositories/interviews";

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
});
