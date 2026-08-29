import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608290001_adaptive_interview_foundation.sql",
);

describe("adaptive interview foundation schema", () => {
  it("requires child records to reference parents owned by the same user", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("foreign key (session_id, user_id) references public.interview_sessions (id, user_id)");
    expect(migration).toContain("foreign key (competency_id, user_id) references public.competencies (id, user_id)");
    expect(migration).toContain("foreign key (question_id, user_id) references public.interview_questions (id, user_id)");
  });
});
