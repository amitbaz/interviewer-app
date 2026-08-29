import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mapSession } from "@/lib/repositories/interviews";

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
});
