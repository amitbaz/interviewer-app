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

  it("upserts deterministic scope through the persisted normalized-name conflict target", async () => {
    let conflictTarget = "";
    let competencyRows: Array<Record<string, unknown>> = [];
    const profileRow = {
      user_id: "user-1", role: "Frontend Engineer", seniority: "Senior", summary: "", narrative: "",
      expertise: ["React"], characteristics: [], created_at: "created", updated_at: "updated",
    };
    const supabase = {
      from: (table: string) => {
        if (table === "profiles") return {
          upsert: () => ({ select: () => ({ single: async () => ({ data: profileRow, error: null }) }) }),
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRow, error: null }) }) }),
        };
        if (table === "source_documents") return {
          delete: () => ({ eq: async () => ({ error: null }) }),
          insert: async () => ({ error: null }),
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        };
        return {
          upsert: async (rows: Array<Record<string, unknown>>, options: { onConflict: string }) => {
            competencyRows = rows;
            conflictTarget = options.onConflict;
            return { error: null };
          },
          select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
        };
      },
    };

    await saveProfile(supabase as never, "user-1", {
      role: "Frontend Engineer", seniority: "Senior", summary: "", narrative: "", expertise: ["React"], characteristics: [],
      competencies: [{ name: "Model supplied but ignored", relevance: 0.01 }],
    }, { cvText: "CV", coverLetter: "" });

    expect(conflictTarget).toBe("user_id,normalized_name");
    expect(competencyRows).toContainEqual(expect.objectContaining({ name: "React architecture", relevance: 0.9 }));
    expect(competencyRows).not.toContainEqual(expect.objectContaining({ name: "Model supplied but ignored" }));
  });
});
