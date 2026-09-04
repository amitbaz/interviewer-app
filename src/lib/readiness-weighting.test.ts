import { describe, expect, it } from "vitest";
import { evidenceStrength } from "@/lib/readiness-weighting";

const conditions = (overrides: Partial<Parameters<typeof evidenceStrength>[0]> = {}) => ({
  mode: "real" as const,
  degraded: false,
  assistanceCount: 0,
  ...overrides,
});

describe("evidenceStrength", () => {
  it("gives full strength to an unassisted answer under real interview conditions", () => {
    expect(evidenceStrength(conditions())).toBe(1);
  });

  it("materially discounts a coach-mode answer against a real-mode one", () => {
    expect(evidenceStrength(conditions({ mode: "coach" }))).toBeLessThan(
      evidenceStrength(conditions({ mode: "real" })) / 2,
    );
  });

  it("discounts each rescue the interviewer had to give", () => {
    const none = evidenceStrength(conditions({ assistanceCount: 0 }));
    const one = evidenceStrength(conditions({ assistanceCount: 1 }));
    const two = evidenceStrength(conditions({ assistanceCount: 2 }));
    expect(one).toBeLessThan(none);
    expect(two).toBeLessThan(one);
  });

  it("does not discount further beyond two rescues", () => {
    expect(evidenceStrength(conditions({ assistanceCount: 5 }))).toBe(
      evidenceStrength(conditions({ assistanceCount: 2 })),
    );
  });

  it("halves a degraded session, which ran on the fallback interviewer", () => {
    expect(evidenceStrength(conditions({ degraded: true }))).toBe(0.5);
  });

  it("never returns a negative or above-one strength", () => {
    const worst = evidenceStrength(conditions({ mode: "coach", degraded: true, assistanceCount: 9 }));
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.1);
  });
});
