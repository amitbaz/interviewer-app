import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InterviewSession, PlannedQuestion } from "@/lib/types";
import { ResultsFeedbackCards } from "@/app/results-feedback-cards";

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

function session(): InterviewSession {
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
  };
}

describe("ResultsFeedbackCards", () => {
  it("starts collapsed and expands to show the answered question with non-empty coaching details", () => {
    render(<ResultsFeedbackCards session={session()} />);

    const toggle = screen.getByRole("button", { name: "React architecture feedback" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "React architecture feedback details" })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "React architecture feedback details" });
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

  it("omits legacy-empty sections while still showing question and answer content", () => {
    render(<ResultsFeedbackCards session={session()} />);

    fireEvent.click(screen.getByRole("button", { name: "Performance feedback" }));

    const details = screen.getByRole("region", { name: "Performance feedback details" });
    expect(details).toBeInTheDocument();
    expect(screen.getByText("How do you keep a search UI responsive at 50,000 results?")).toBeInTheDocument();
    expect(screen.getByText("I would virtualize the list, debounce network work, and keep keyboard focus state outside each row.")).toBeInTheDocument();
    expect(within(details).queryByText("Missing points")).not.toBeInTheDocument();
    expect(within(details).queryByText("Better structure")).not.toBeInTheDocument();
    expect(within(details).queryByText("Improved answer")).not.toBeInTheDocument();
  });
});
