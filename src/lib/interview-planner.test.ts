import { describe, expect, it } from "vitest";
import { buildInterviewPlan } from "@/lib/interview-planner";

describe("buildInterviewPlan", () => {
  it("creates a five-question backbone", () => {
    expect(buildInterviewPlan([], "senior")).toHaveLength(5);
  });
});
