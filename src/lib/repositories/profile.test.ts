import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { competencyScopeFor, profileScopeRows, saveProfile } from "@/lib/repositories/profile";

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

  it("limits related relevance to the named baseline competencies", () => {
    expect(competencyScopeFor(["Backend platform"])).toEqual(expect.arrayContaining([
      { name: "System design", relevance: 0.9 },
      { name: "Performance", relevance: 0.7 },
      { name: "Communication", relevance: 0.7 },
    ]));
  });

  it("normalizes generated scope instead of persisting model relevance or assessment evidence", () => {
    const rows = profileScopeRows("user-1", {
      role: "Frontend Engineer",
      seniority: "Senior",
      summary: "",
      narrative: "",
      expertise: ["React"],
      characteristics: [],
      competencies: [{ name: "Invented competency", relevance: 0.01 }],
    });

    expect(rows).toContainEqual(expect.objectContaining({
      user_id: "user-1",
      name: "React architecture",
      relevance: 0.9,
      expected_level: "senior",
    }));
    expect(rows).not.toContainEqual(expect.objectContaining({ name: "Invented competency" }));
    expect(rows.every((row) => !("estimated_level" in row) && !("average_score" in row))).toBe(true);
  });

  it("saves profile, sources, and active scope through one ownership-scoped RPC", async () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const profileRow = {
      user_id: "user-1", role: "Frontend Engineer", seniority: "Senior", summary: "", narrative: "",
      expertise: ["React"], characteristics: [], created_at: "created", updated_at: "updated",
    };
    const supabase = {
      rpc: async (name: string, payload: Record<string, unknown>) => {
        calls.push({ name, payload });
        return { data: null, error: null };
      },
      from: (table: string) => {
        if (table === "profiles") return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRow, error: null }) }) }),
        };
        if (table === "source_documents") return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        };
        return {
          select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
        };
      },
    };

    await saveProfile(supabase as never, "user-1", {
      role: "Frontend Engineer", seniority: "Senior", summary: "", narrative: "", expertise: ["React"], characteristics: [],
      competencies: [{ name: "Model supplied but ignored", relevance: 0.01 }],
    }, { cvText: "CV", coverLetter: "" });

    expect(calls).toEqual([{
      name: "save_profile_bundle",
      payload: expect.objectContaining({
        p_scope: expect.arrayContaining([expect.objectContaining({ name: "React architecture", relevance: 0.9 })]),
      }),
    }]);
    expect((calls[0].payload.p_scope as Array<Record<string, unknown>>)).not.toContainEqual(
      expect.objectContaining({ name: "Model supplied but ignored" }),
    );
  });
});
