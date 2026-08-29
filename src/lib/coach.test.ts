import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractPdfText, initialQuestion, nextTurn } from "@/lib/coach";
import type { InterviewSession, PlannedQuestion } from "@/lib/types";

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
