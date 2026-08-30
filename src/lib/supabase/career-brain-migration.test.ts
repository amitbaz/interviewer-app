import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608300001_stable_profile_evidence.sql",
);

describe("stable profile evidence migration", () => {
  it("adds the durable identity columns to profile_evidence", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("add column evidence_key text");
    expect(migration).toContain("add column is_active boolean not null default true");
    expect(migration).toContain("add column retired_at timestamptz");
  });

  it("backfills a unique legacy key for existing rows before enforcing not null", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("'legacy:' || id::text");
    expect(migration).toContain("alter column evidence_key set not null");
  });

  it("enforces one evidence identity per user", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("unique (user_id, evidence_key)");
  });

  it("reconciles evidence by stable key instead of deleting and reinserting it", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("function public.save_profile_bundle");
    expect(migration).toContain("is_active = false");
    expect(migration).toContain("on conflict (user_id, evidence_key) do update");
    expect(migration).not.toContain("delete from public.profile_evidence");
  });
});
