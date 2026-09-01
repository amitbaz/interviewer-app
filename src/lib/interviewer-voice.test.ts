import { describe, expect, it } from "vitest";
import { deterministicLine, validateInterviewerLine } from "@/lib/interviewer-voice";
import { modePolicyFor } from "@/lib/interview-rounds";

const context = {
  forbiddenRubricText: ["Probe Frontend Architecture with concrete evidence.", "ownership"],
  askedPrompts: ["Tell me about the design system migration."],
  policy: modePolicyFor("real"),
};

describe("validateInterviewerLine", () => {
  it("accepts a short, single, final question", () => {
    expect(validateInterviewerLine("What did you change first?", context)).toBeNull();
  });

  it("rejects rubric text", () => {
    const line = "Probe Frontend Architecture with concrete evidence. What did you own?";
    expect(validateInterviewerLine(line, context)).toBe("rubric-leak");
  });

  it("rejects contact details and URLs", () => {
    expect(validateInterviewerLine("Your CV lists amitbaz2@gmail.com. What did you own?", context)).toBe("contact-details");
    expect(validateInterviewerLine("You link linkedin.com/in/amit-baz. What did you own?", context)).toBe("contact-details");
    expect(validateInterviewerLine("Your number is +49 177 2276319. What did you own?", context)).toBe("contact-details");
  });

  it("rejects more than two sentences", () => {
    const line = "You mentioned the migration. It sounds involved. It ran for months. What did you own?";
    expect(validateInterviewerLine(line, context)).toBe("too-long");
  });

  it("rejects a line whose question is not last", () => {
    const line = "What did you own? Take your time with that.";
    expect(validateInterviewerLine(line, context)).toBe("question-not-last");
  });

  it("rejects a line with no question", () => {
    expect(validateInterviewerLine("That sounds like a big migration.", context)).toBe("no-question");
  });

  it("rejects a line with more than one question, even with the last sentence a question", () => {
    const line = "What did you mean? What did you own?";
    expect(validateInterviewerLine(line, context)).toBe("no-question");
  });

  it("accepts a single question containing a question mark inside a quoted clause", () => {
    const line = 'When you asked yourself "why not?" what did you decide to do?';
    expect(validateInterviewerLine(line, context)).toBeNull();
  });

  it("rejects a paraphrase of a question already asked", () => {
    const line = "Tell me about the design system migration.";
    expect(validateInterviewerLine(line, { ...context, askedPrompts: [line] })).toBe("repeats-asked");
  });

  it("rejects praise in real mode but allows a brief acknowledgement in coach mode", () => {
    const line = "Great answer. What did you own?";
    expect(validateInterviewerLine(line, context)).toBe("coaching");
    expect(validateInterviewerLine(line, { ...context, policy: modePolicyFor("coach") })).toBeNull();
  });
});

describe("deterministicLine", () => {
  it("returns a distinct line for every intent kind", () => {
    const lines = new Set([
      deterministicLine({ kind: "open", targetId: "a" }, "Frontend Architecture"),
      deterministicLine({ kind: "probe", targetId: "a", aspect: "ownership", basis: "x" }, "Frontend Architecture"),
      deterministicLine({ kind: "challenge", targetId: "a", claim: "80% faster" }, "Frontend Architecture"),
      deterministicLine({ kind: "rescue", targetId: "a", style: "narrow", hook: null }, "Frontend Architecture"),
      deterministicLine({ kind: "advance", targetId: "b", reason: "satisfied" }, "System Design"),
      deterministicLine({ kind: "hypothetical", targetId: "a", basis: "x" }, "Frontend Architecture"),
      deterministicLine({ kind: "candidate-questions" }, null),
      deterministicLine({ kind: "close" }, null),
    ]);
    expect(lines.size).toBe(8);
  });

  it("passes its own validation", () => {
    const line = deterministicLine({ kind: "probe", targetId: "a", aspect: "ownership", basis: "x" }, "Frontend Architecture");
    expect(validateInterviewerLine(line, { forbiddenRubricText: [], askedPrompts: [], policy: modePolicyFor("real") })).toBeNull();
  });
});
