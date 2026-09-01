import { describe, expect, it } from "vitest";
import { decideIntent, type DirectorInput } from "@/lib/interview-director";
import { modePolicyFor, roundFor } from "@/lib/interview-rounds";
import type { CoverageTarget, Intent, ModePolicy, TargetState } from "@/lib/types";

function target(id: string, required = true): CoverageTarget {
  return {
    id,
    competencyId: `comp-${id}`,
    competencyName: `Competency ${id}`,
    category: "experience",
    evidenceIds: [],
    difficulty: "senior",
    objective: `Probe ${id}.`,
    expectedSignals: ["ownership"],
    rubricCriteria: ["Name a concrete example."],
    required,
  };
}

function state(id: string, overrides: Partial<TargetState> = {}): TargetState {
  return {
    target: target(id),
    status: "unasked",
    turnsSpent: 0,
    rescuesSpent: 0,
    askedIntents: [],
    ...overrides,
  };
}

function input(overrides: Partial<DirectorInput> = {}): DirectorInput {
  return {
    round: roundFor("tech-lead"),
    policy: modePolicyFor("coach"),
    states: [state("a")],
    currentTargetId: "a",
    read: "answered",
    unsupportedClaims: [],
    answer: "I owned the design system migration.",
    turnsUsed: 1,
    turnBudget: 8,
    sessionRescues: 0,
    now: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("decideIntent — stuck candidates", () => {
  it("rescues rather than probes when the candidate is stuck", () => {
    const decision = decideIntent(input({
      read: "stuck",
      answer: "i am having a blackout",
      now: "2026-03-14T09:30:00.000Z",
    }));
    expect(decision.intent.kind).toBe("rescue");
    expect(decision.assistance).not.toBeNull();
    // The director must not read the clock itself -- the timestamp is exactly
    // the caller-supplied `now`, not a value it manufactured, which is what
    // makes this function assertable without freezing time.
    expect(decision.assistance?.at).toBe("2026-03-14T09:30:00.000Z");
  });

  it("never probes or challenges a stuck candidate", () => {
    for (const policy of [modePolicyFor("coach"), modePolicyFor("real")]) {
      const decision = decideIntent(input({ read: "stuck", policy }));
      expect(["probe", "challenge"]).not.toContain(decision.intent.kind);
    }
  });

  it("advances once the per-question rescue budget is spent", () => {
    const spent = state("a", {
      status: "open",
      turnsSpent: 2,
      rescuesSpent: 2,
      askedIntents: [{ kind: "open", targetId: "a" }],
    });
    const decision = decideIntent(input({
      read: "stuck",
      states: [spent, state("b")],
      policy: modePolicyFor("coach"),
    }));
    expect(decision.intent.kind).toBe("advance");
    expect(decision.assistance).toBeNull();
  });

  it("parks in coach mode but never in real mode", () => {
    const stuckTwice = state("a", {
      status: "open",
      turnsSpent: 1,
      rescuesSpent: 1,
      askedIntents: [{ kind: "rescue", targetId: "a", style: "narrow", hook: null }],
    });
    const coach = decideIntent(input({ read: "stuck", states: [stuckTwice, state("b")], policy: modePolicyFor("coach") }));
    expect(coach.intent).toMatchObject({ kind: "rescue", style: "park" });

    const real = decideIntent(input({ read: "stuck", states: [stuckTwice, state("b")], policy: modePolicyFor("real") }));
    expect(real.intent.kind).toBe("advance");
  });

  it("stops rescuing once the session budget is spent", () => {
    const decision = decideIntent(input({ read: "stuck", sessionRescues: 5, policy: modePolicyFor("coach") }));
    expect(decision.intent.kind).toBe("advance");
  });

  it("escalates rescue styles in the policy's own order, not a hardcoded one", () => {
    // A policy whose style order deliberately differs from the ["narrow", "hook",
    // "reframe", "park"] constant a hardcoded implementation would fall back to.
    // With no styles used yet, a hardcoded-order implementation would pick
    // "narrow" (first in its constant); the policy lists "reframe" first.
    const reorderedPolicy: ModePolicy = {
      rescuesPerQuestion: 3,
      rescuesPerSession: 5,
      rescueStyles: ["reframe", "narrow", "park"],
      pushback: "light",
      parkAndReturn: true,
      acknowledgeStruggle: true,
    };
    const decision = decideIntent(input({ read: "stuck", policy: reorderedPolicy }));
    expect(decision.intent).toMatchObject({ kind: "rescue", style: "reframe" });
  });
});

describe("decideIntent — repetition", () => {
  it("never issues an intent already asked for the target", () => {
    const asked: Intent[] = [
      { kind: "open", targetId: "a" },
      { kind: "probe", targetId: "a", aspect: "specifics", basis: "x" },
    ];
    const decision = decideIntent(input({
      read: "partial",
      states: [state("a", { status: "open", turnsSpent: 2, askedIntents: asked })],
    }));
    if (decision.intent.kind === "probe") {
      expect(decision.intent.aspect).not.toBe("specifics");
    }
  });

  it("advances when every available probe aspect is exhausted", () => {
    const asked: Intent[] = roundFor("tech-lead").probeAspects.map((aspect) => ({
      kind: "probe" as const,
      targetId: "a",
      aspect,
      basis: "x",
    }));
    const decision = decideIntent(input({
      read: "partial",
      states: [state("a", { status: "open", turnsSpent: 6, askedIntents: asked }), state("b")],
    }));
    expect(decision.intent).toMatchObject({ kind: "advance", reason: "line-exhausted" });
  });
});

describe("decideIntent — coverage", () => {
  it("advances to the next target when the current one is satisfied", () => {
    const decision = decideIntent(input({
      states: [state("a", { status: "satisfied", turnsSpent: 2 }), state("b")],
    }));
    expect(decision.intent).toMatchObject({ kind: "advance", targetId: "b", reason: "satisfied" });
  });

  it("prefers an unasked required target over deepening when turns run short", () => {
    const decision = decideIntent(input({
      states: [state("a", { status: "open", turnsSpent: 1 }), state("b"), state("c")],
      turnsUsed: 6,
      turnBudget: 8,
    }));
    expect(decision.intent).toMatchObject({ kind: "advance", reason: "turn-budget" });
  });

  it("returns to a parked target when turns remain and nothing required is unasked", () => {
    const decision = decideIntent(input({
      states: [
        state("a", { status: "satisfied", turnsSpent: 2 }),
        state("b", {
          status: "parked",
          turnsSpent: 1,
          rescuesSpent: 1,
          askedIntents: [{ kind: "rescue", targetId: "b", style: "park", hook: null }],
        }),
      ],
      currentTargetId: "a",
    }));
    expect(decision.intent).toMatchObject({ kind: "advance", targetId: "b" });
  });

  it("closes with the round's closing move when the turn budget is exhausted", () => {
    const decision = decideIntent(input({
      states: [state("a", { status: "satisfied", turnsSpent: 3 })],
      turnsUsed: 8,
      turnBudget: 8,
    }));
    expect(decision.intent.kind).toBe("candidate-questions");
  });

  it("closes at the turn-budget hard stop even though the current target is still open", () => {
    // Without the unconditional `remaining <= 0` check, this would fall through
    // to the probe branch: target "a" is open, not satisfied, with no asked
    // intents yet, so there is an aspect available to probe. Neither "b" (unasked
    // but not required, so it can't trip the turn-budget rule) nor "c" (parked)
    // should let the director advance or deepen instead of closing.
    const decision = decideIntent(input({
      states: [
        state("a", { status: "open", turnsSpent: 3 }),
        state("b", { target: target("b", false) }),
        state("c", {
          status: "parked",
          turnsSpent: 1,
          rescuesSpent: 1,
          askedIntents: [{ kind: "rescue", targetId: "c", style: "park", hook: null }],
        }),
      ],
      currentTargetId: "a",
      turnsUsed: 8,
      turnBudget: 8,
    }));
    expect(decision.intent.kind).toBe("candidate-questions");
  });
});

describe("decideIntent — pressure", () => {
  it("challenges an unsupported claim in real mode", () => {
    const decision = decideIntent(input({
      policy: modePolicyFor("real"),
      read: "partial",
      unsupportedClaims: ["cut load time by 80%"],
      states: [state("a", { status: "open", turnsSpent: 1, askedIntents: [{ kind: "open", targetId: "a" }] })],
    }));
    expect(decision.intent).toMatchObject({ kind: "challenge", claim: "cut load time by 80%" });
  });

  it("never re-issues a challenge for a claim already challenged on this target", () => {
    const decision = decideIntent(input({
      policy: modePolicyFor("real"),
      read: "partial",
      unsupportedClaims: ["cut load time by 80%"],
      states: [state("a", {
        status: "open",
        turnsSpent: 2,
        askedIntents: [
          { kind: "open", targetId: "a" },
          { kind: "challenge", targetId: "a", claim: "cut load time by 80%" },
        ],
      })],
    }));
    expect(decision.intent.kind).not.toBe("challenge");
  });

  it("only issues intents in the round's repertoire", () => {
    const round = roundFor("tech-lead");
    const reads = ["answered", "partial", "evasive", "stuck"] as const;
    for (const read of reads) {
      const decision = decideIntent(input({ read }));
      expect(round.moves).toContain(decision.intent.kind);
    }
  });
});
