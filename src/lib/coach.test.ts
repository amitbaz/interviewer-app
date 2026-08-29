import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { initialQuestion } from "@/lib/coach";

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
});
