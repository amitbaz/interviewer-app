import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { competencyScopeFor } from "@/lib/repositories/profile";

describe("competencyScopeFor", () => {
  it("keeps expertise at full relevance and adds related frontend scope without evidence", () => {
    expect(competencyScopeFor(["React", "TypeScript"])).toEqual([
      { name: "React", relevance: 1 },
      { name: "TypeScript", relevance: 1 },
      { name: "React architecture", relevance: 0.9 },
      { name: "System design", relevance: 0.7 },
      { name: "Performance", relevance: 0.7 },
      { name: "Accessibility", relevance: 0.7 },
      { name: "Testing", relevance: 0.7 },
      { name: "Communication", relevance: 0.7 },
    ]);
  });
});
