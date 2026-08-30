import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608300001_stable_profile_evidence.sql",
);

const opportunitiesMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608300002_opportunities.sql",
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

describe("opportunity lifecycle migration", () => {
  it("constrains opportunities.status and opportunity_events.event_type to the spec'd values", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    expect(migration).toContain(
      "check (status in ('considering', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn', 'closed'))",
    );
    expect(migration).toContain(
      "check (event_type in ('created', 'status_changed', 'interview_scheduled', 'interview_completed', 'note', 'source_updated'))",
    );
  });

  it("constrains match_score to the 0..100 range", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    expect(migration).toContain("check (match_score is null or match_score between 0 and 100)");
  });

  it("gives both tables unique (id, user_id) for composite ownership foreign keys", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    const uniqueIdUserId = migration.match(/unique \(id, user_id\)/g) ?? [];
    expect(uniqueIdUserId).toHaveLength(2);
  });

  it("prevents duplicate external identities per user with a partial unique index", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    expect(migration).toContain(
      "create unique index opportunities_user_source_identity_key\n  on public.opportunities (user_id, source_system, source_external_id)\n  where source_system is not null and source_external_id is not null;",
    );
  });

  it("keeps the opportunity_events foreign key ownership-preserving via the composite key", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    expect(migration).toContain(
      "foreign key (opportunity_id, user_id) references public.opportunities (id, user_id) on delete cascade",
    );
  });

  it("gives opportunities full own-row CRUD RLS policies", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    expect(migration).toContain("create policy select_own on public.opportunities for select using (auth.uid() = user_id);");
    expect(migration).toContain("create policy insert_own on public.opportunities for insert with check (auth.uid() = user_id);");
    expect(migration).toContain("create policy update_own on public.opportunities for update using (auth.uid() = user_id) with check (auth.uid() = user_id);");
    expect(migration).toContain("create policy delete_own on public.opportunities for delete using (auth.uid() = user_id);");
  });

  it("gives opportunity_events only select/insert RLS policies -- no update or delete", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    expect(migration).toContain("create policy select_own on public.opportunity_events for select using (auth.uid() = user_id);");
    expect(migration).toContain("create policy insert_own on public.opportunity_events for insert with check (auth.uid() = user_id);");
    expect(migration).not.toContain("for update on public.opportunity_events");
    expect(migration).not.toContain("for delete on public.opportunity_events");
    expect(migration).not.toMatch(/on public\.opportunity_events for (update|delete)/);
  });

  it("creates all three lifecycle functions as security invoker with no caller-supplied user_id", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    for (const name of ["create_opportunity", "transition_opportunity", "schedule_opportunity_interview"]) {
      const definition = migration.split(`function public.${name}(`)[1];
      expect(definition, `${name} definition`).toBeDefined();
      expect(definition).toContain("security invoker");
      expect(definition.split("$$;")[0]).not.toMatch(/p_user_id/);
    }
    expect(migration).toContain("v_user_id uuid := auth.uid();");
  });

  it("creates the opportunity through create_opportunity as a single 'considering' created event", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    const definition = migration.split("function public.create_opportunity(")[1].split("$$;")[0];
    expect(definition).toContain("'considering'");
    expect((definition.match(/insert into public\.opportunity_events/g) ?? [])).toHaveLength(1);
    expect(definition).toContain("'created', null, 'considering'");
  });

  it("locks and verifies the owned opportunity before transitioning status", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    const definition = migration.split("function public.transition_opportunity(")[1].split("$$;")[0];
    expect(definition).toContain("for update");
    expect(definition).toContain("raise exception 'Owned opportunity was not found' using errcode = 'P0002';");
    expect(definition).toContain("applied_at = case");
    expect(definition).toContain("when p_to_status = 'applied' then coalesce(applied_at, p_occurred_at, now())");
  });

  it("only moves a pre-interview opportunity into interviewing when scheduling an interview", async () => {
    const migration = await readFile(opportunitiesMigrationPath, "utf8");

    const definition = migration.split("function public.schedule_opportunity_interview(")[1].split("$$;")[0];
    expect(definition).toContain("when v_opportunity.status in ('considering', 'applied') then 'interviewing'");
    expect(definition).toContain("else v_opportunity.status");
    expect(definition).toContain("next_interview_at = p_interview_at");
    expect(definition).toContain("'interview_scheduled'");
  });
});
