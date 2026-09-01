# Career Brain Release 3 Adaptive Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make completed Relay practice automatically produce durable, evidence-backed coaching memory that deterministically changes future recommended practice while preserving user review authority and all existing Release 1/2 behavior.

**Architecture:** Add an idempotent per-session learning ledger, structured Gemini signal extraction, and a deterministic reconciliation engine over the existing `coach_observations`/`observation_evidence` model. Replace Release 2's precedence selector with a deterministic scored candidate engine whose winning factors are persisted in `practice_plans`. Learning runs synchronously after durable session completion as best-effort work; no worker, cron, bot integration, or background dependency is introduced.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 5, Tailwind CSS 4, Supabase Postgres/Auth/RLS, `@supabase/supabase-js` 2.x, Vitest 4.1.11, Zod, existing Gemini structured-JSON helper/provider path.

**Spec:** `docs/superpowers/specs/2026-09-01-career-brain-release-3-adaptive-learning-loop-design.md`

## Global Constraints

- Gemini extracts small structured signals; deterministic application code owns observation identity, evidence role, confidence, importance, trend, learning state, review attention, and recommendation selection.
- A single unreviewed observation is tentative and cannot automatically control recommended practice.
- An unreviewed observation becomes established only after supporting evidence from at least two distinct completed sessions and confidence >= 0.65.
- Confirm / Correct / Dismiss is authoritative. Automatic learning never overwrites `claim`, `review_state`, or `user_correction`, and never silently reactivates a dismissed observation.
- Observation evidence remains append-oriented and retries must be idempotent.
- Candidate/career facts remain grounded in persisted answer/evaluation evidence; job descriptions affect relevance only.
- No automatic career-story creation or confirmation.
- Learning failure must never roll back completed answers, evaluations, session completion, or existing practice-plan bookkeeping.
- Dashboard GET remains read-only and never launches model calls.
- All new tables/functions enforce authenticated same-user ownership and RLS; browser code never supplies a trusted `userId`.
- No service-role secret is introduced into browser code.
- No Google Sheet synchronization, job-hunter/SQLite/Telegram/GitHub Actions change, vector search, fine-tuning, cron, queue, or background worker.
- Preserve the existing exact-five generic interview contract and Release 2 planned-practice behavior.
- `COACH_LEARNING_EXTRACTOR_VERSION` is exactly `release3-v1` for this release.
- Follow red -> green -> refactor and make one scoped commit per independently reviewable task.
- Apply/verify migrations first against a disposable/development Supabase target, not production as the test environment.

## File Structure

Create:

```text
supabase/migrations/
  202609010001_adaptive_learning_loop.sql

src/lib/
  learning-signals.ts
  learning-signals.test.ts
  observation-reconciler.ts
  observation-reconciler.test.ts
  learning-service.ts
  learning-service.test.ts
  release3-learning-loop.test.ts

src/lib/repositories/
  learning.ts
  learning.test.ts

src/app/api/
  learning/route.ts
  learning/route.test.ts

src/app/
  learning-summary-card.tsx
  learning-summary-card.test.tsx
```

Modify:

```text
src/lib/types.ts
src/lib/coach.ts
src/lib/coach.test.ts
src/lib/coach-memory.ts
src/lib/coach-memory.test.ts
src/lib/practice-recommendation.ts
src/lib/practice-recommendation.test.ts
src/lib/practice-service.ts
src/lib/practice-service.test.ts
src/lib/career-dashboard.ts
src/lib/career-dashboard.test.ts
src/lib/repositories/observations.ts
src/lib/repositories/observations.test.ts
src/app/api/interview/route.ts
src/app/api/interview/route.test.ts
src/app/api/observations/route.ts
src/app/api/observations/route.test.ts
src/app/api/career/dashboard/route.ts
src/app/api/career/dashboard/route.test.ts
src/app/api-client.ts
src/app/relay-shell.tsx
src/app/page.test.tsx
src/app/views/home-view.tsx
src/app/views/home-view.test.tsx
src/app/views/coach-view.tsx
src/app/views/coach-view.test.tsx
README.md
```

Do not create a second generic memory store or replace the Release 1 Career Brain tables.

---

### Task 1: Add adaptive-memory schema, review history, session-evaluation provenance, and learning runs

**Files:**
- Create: `supabase/migrations/202609010001_adaptive_learning_loop.sql`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/repositories/observations.ts`
- Modify: `src/lib/repositories/observations.test.ts`

**Interfaces:**

Add these types to `src/lib/types.ts`:

```ts
export type ObservationTopic =
  | "answer_structure"
  | "clarity"
  | "conciseness"
  | "communication"
  | "confidence"
  | "ownership"
  | "technical_depth"
  | "tradeoff_reasoning"
  | "practical_evidence"
  | "relevance"
  | "unsupported_claims"
  | "story_completeness"
  | "behavioral_resolution";

export type CoachObservationLearningState = "tentative" | "established";

export type CoachObservationReviewEvent = {
  id: string;
  userId: string;
  observationId: string;
  reviewState: Exclude<CoachObservationReviewState, "unreviewed">;
  correctionText: string | null;
  supportingSessionCountAtReview: number;
  contradictingSessionCountAtReview: number;
  evidenceCountAtReview: number;
  createdAt: string;
};

export type CoachLearningRunStatus = "pending" | "processing" | "completed" | "failed";
export type CoachLearningProcessingMode = "live" | "deterministic_fallback";
```

Extend `CoachObservation` with:

```ts
observationKey: string | null;
learningState: CoachObservationLearningState;
supportingSessionCount: number;
contradictingSessionCount: number;
needsReview: boolean;
reviewedEvidenceCount: number;
```

Extend `ObservationEvidence` with `sessionEvaluationId: string | null` and extend `ObservationEvidenceSource` with:

```ts
{ kind: "session_evaluation"; sessionEvaluationId: string }
```

- [ ] **Step 1: Write failing mapper/review tests**

Add concrete tests in `observations.test.ts`:

```ts
it("maps adaptive learning fields from a coach observation row", async () => {
  selectSingle.mockResolvedValueOnce({
    data: {
      id: "obs-1",
      user_id: "user-1",
      observation_type: "weakness",
      claim: "Trade-off reasoning is incomplete.",
      confidence: 0.7,
      importance: 0.8,
      trend: "stable",
      review_state: "unreviewed",
      user_correction: null,
      observation_key: "tradeoff_reasoning|competency:comp-1",
      learning_state: "established",
      supporting_session_count: 2,
      contradicting_session_count: 0,
      needs_review: false,
      reviewed_evidence_count: 0,
      first_seen_at: "2026-09-01T10:00:00Z",
      last_seen_at: "2026-09-01T12:00:00Z",
      confirmed_at: null,
      corrected_at: null,
      dismissed_at: null,
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T12:00:00Z",
    },
    error: null,
  });

  await expect(getCoachObservation(supabase as never, "user-1", "obs-1"))
    .resolves.toMatchObject({
      observationKey: "tradeoff_reasoning|competency:comp-1",
      learningState: "established",
      supportingSessionCount: 2,
      contradictingSessionCount: 0,
      needsReview: false,
    });
});

it("reviews through the atomic review RPC", async () => {
  rpc.mockResolvedValueOnce({ data: [{ observation_id: "obs-1" }], error: null });
  await reviewCoachObservation(supabase as never, "user-1", "obs-1", {
    state: "corrected",
    correction: "I know the trade-off but need to state it earlier.",
  });
  expect(rpc).toHaveBeenCalledWith("review_coach_observation", {
    p_observation_id: "obs-1",
    p_review_state: "corrected",
    p_correction: "I know the trade-off but need to state it earlier.",
  });
});
```

Use the repository test's existing Supabase mock helpers rather than introducing a second mock style.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npm test -- src/lib/repositories/observations.test.ts
```

Expected: new mapping/RPC expectations fail.

- [ ] **Step 3: Add observation columns and system-key uniqueness**

In `202609010001_adaptive_learning_loop.sql` add:

```sql
alter table public.coach_observations
  add column observation_key text,
  add column learning_state text not null default 'tentative'
    check (learning_state in ('tentative', 'established')),
  add column supporting_session_count integer not null default 0
    check (supporting_session_count >= 0),
  add column contradicting_session_count integer not null default 0
    check (contradicting_session_count >= 0),
  add column needs_review boolean not null default false,
  add column reviewed_evidence_count integer not null default 0
    check (reviewed_evidence_count >= 0);

create unique index coach_observations_user_key_unique
  on public.coach_observations (user_id, observation_key)
  where observation_key is not null;

update public.coach_observations
set learning_state = 'established'
where review_state in ('confirmed', 'corrected', 'dismissed');
```

Do not backfill `observation_key` for existing arbitrary claims.

- [ ] **Step 4: Add append-only review history**

Create:

```sql
create table public.coach_observation_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observation_id uuid not null,
  review_state text not null check (review_state in ('confirmed', 'corrected', 'dismissed')),
  correction_text text,
  supporting_session_count_at_review integer not null default 0 check (supporting_session_count_at_review >= 0),
  contradicting_session_count_at_review integer not null default 0 check (contradicting_session_count_at_review >= 0),
  evidence_count_at_review integer not null default 0 check (evidence_count_at_review >= 0),
  created_at timestamptz not null default now(),
  foreign key (observation_id, user_id)
    references public.coach_observations (id, user_id) on delete cascade
);
```

Enable RLS with own-row `select` and `insert` only. Do not create update/delete policies.

Backfill exactly one event for each existing non-`unreviewed` observation. Use the current state's timestamp and correction text only when it still exists. Never fabricate lost historical correction text.

- [ ] **Step 5: Add one atomic observation-review RPC**

Create:

```sql
public.review_coach_observation(
  p_observation_id uuid,
  p_review_state text,
  p_correction text default null
)
returns table(observation_id uuid)
```

Use `security invoker`, `set search_path = public`, derive `auth.uid()`, lock the owned observation `for update`, validate the state/correction, count current evidence, insert the history snapshot, and update current review columns in the same transaction.

For `corrected`, persist trimmed `p_correction`. For `confirmed` and `dismissed`, set `user_correction = null`, preserving the Release 1/2 current-state behavior while the new review table keeps historical snapshots going forward.

Always set:

```text
reviewed_evidence_count = current observation_evidence count
needs_review = false
```

- [ ] **Step 6: Add hands-on session-evaluation provenance and source uniqueness**

Ensure:

```sql
alter table public.session_evaluations
  add constraint session_evaluations_id_user_key unique (id, user_id);
```

If that exact constraint already exists, guard/rename the migration operation based on the real schema rather than adding a duplicate.

Add `session_evaluation_id uuid` to `observation_evidence`, replace its exactly-one-source constraint to cover all five source columns, and add same-user composite FK to `session_evaluations`.

Add partial unique indexes for every typed source:

```sql
create unique index observation_evidence_profile_once
  on public.observation_evidence (observation_id, profile_evidence_id)
  where profile_evidence_id is not null;
create unique index observation_evidence_question_eval_once
  on public.observation_evidence (observation_id, question_evaluation_id)
  where question_evaluation_id is not null;
create unique index observation_evidence_session_eval_once
  on public.observation_evidence (observation_id, session_evaluation_id)
  where session_evaluation_id is not null;
create unique index observation_evidence_story_once
  on public.observation_evidence (observation_id, career_story_id)
  where career_story_id is not null;
create unique index observation_evidence_opportunity_event_once
  on public.observation_evidence (observation_id, opportunity_event_id)
  where opportunity_event_id is not null;
```

- [ ] **Step 7: Add idempotent learning-run ledger**

Create `coach_learning_runs` with:

```sql
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
session_id uuid not null,
status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
attempt_count integer not null default 0 check (attempt_count >= 0),
processing_mode text check (processing_mode is null or processing_mode in ('live','deterministic_fallback')),
extractor_version text not null,
started_at timestamptz,
completed_at timestamptz,
last_error_code text,
result_counts jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
unique (user_id, session_id),
foreign key (session_id, user_id)
  references public.interview_sessions (id, user_id)
```

`result_counts` stores safe integer result metadata only:

```json
{
  "createdObservations": 1,
  "updatedObservations": 2,
  "establishedObservations": 1,
  "needsReviewObservations": 0
}
```

It must never store model text, answers, CV text, claims, or reasons.

Enable own-row select/insert/update RLS; no delete policy.

- [ ] **Step 8: Add learning-run claim/finalize RPCs**

Create:

```sql
claim_coach_learning_run(
  p_session_id uuid,
  p_stale_before timestamptz,
  p_extractor_version text
)

complete_coach_learning_run(
  p_run_id uuid,
  p_processing_mode text,
  p_result_counts jsonb
)

fail_coach_learning_run(
  p_run_id uuid,
  p_error_code text
)
```

Claim semantics:

```text
owned session must exist and be complete
create row if absent
completed -> claimed=false
processing with started_at > p_stale_before -> claimed=false
pending/failed/stale processing -> status processing, increment attempt_count, set started_at now, clear completed/error/mode/result_counts, set extractor_version = p_extractor_version, claimed=true
```

Complete validates `p_processing_mode`, writes `completed`, mode, completed timestamp, safe `p_result_counts`, and clears error. Fail writes `failed`, safe error code, and completion timestamp null.

- [ ] **Step 9: Update TypeScript observation mappers/review repository**

Update `mapCoachObservation`, `mapObservationEvidence`, and `observationEvidenceColumns` exhaustively across five source variants.

Replace the direct table update inside `reviewCoachObservation` with the RPC, then reload through `getCoachObservation`.

Add:

```ts
export async function listCoachObservationReviews(
  supabase: SupabaseClient,
  userId: string,
  observationId: string,
): Promise<CoachObservationReviewEvent[]>;
```

- [ ] **Step 10: Verify migration invariants on disposable Supabase**

Run:

```bash
supabase db push
```

Verify:

```text
legacy observation rows remain readable
reviewed legacy rows are established but receive no invented key
review RPC appends history and updates current state atomically
correction is mandatory only for corrected
session-evaluation evidence passes the exactly-one-source check
same observation/source cannot be attached twice
cross-user references fail
learning run cannot be double-claimed while processing
failed/stale runs can be reclaimed
completed runs remain completed on another claim
```

- [ ] **Step 11: Run GREEN and commit**

```bash
npm test -- src/lib/repositories/observations.test.ts
git add supabase/migrations/202609010001_adaptive_learning_loop.sql src/lib/types.ts src/lib/repositories/observations.ts src/lib/repositories/observations.test.ts
git commit -m "feat: add adaptive coach memory schema"
```

---

### Task 2: Add learning-run and durable evaluation-evidence repositories

**Files:**
- Create: `src/lib/repositories/learning.ts`
- Create: `src/lib/repositories/learning.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**

Add:

```ts
export type LearningEvidenceSource = {
  kind: "question_evaluation" | "session_evaluation";
  sourceId: string;
  sessionId: string;
  occurredAt: string;
  category: QuestionCategory | null;
  competencyId: string | null;
  competencyName: string | null;
  prompt: string;
  answer: string;
  evaluation: Evaluation;
};

export type CoachLearningResultCounts = {
  createdObservations: number;
  updatedObservations: number;
  establishedObservations: number;
  needsReviewObservations: number;
};

export type CoachLearningRun = {
  id: string;
  userId: string;
  sessionId: string;
  status: CoachLearningRunStatus;
  attemptCount: number;
  processingMode: CoachLearningProcessingMode | null;
  extractorVersion: string;
  startedAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  resultCounts: CoachLearningResultCounts;
  createdAt: string;
  updatedAt: string;
};

export async function listSessionLearningEvidence(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<LearningEvidenceSource[]>;

export async function claimCoachLearningRun(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  staleBefore: string,
  extractorVersion: string,
): Promise<{ run: CoachLearningRun; claimed: boolean }>;

export async function completeCoachLearningRun(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  mode: CoachLearningProcessingMode,
  resultCounts: CoachLearningResultCounts,
): Promise<CoachLearningRun>;

export async function failCoachLearningRun(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  errorCode: string,
): Promise<CoachLearningRun>;

export async function listUnprocessedCompletedSessionIds(
  supabase: SupabaseClient,
  userId: string,
  limit?: number,
): Promise<string[]>;

export async function listFailedCoachLearningRuns(
  supabase: SupabaseClient,
  userId: string,
  limit?: number,
): Promise<CoachLearningRun[]>;
```

- [ ] **Step 1: Write failing learning-evidence hydration tests**

Conversation test:

```ts
it("uses the durable question evaluation id as learning provenance", async () => {
  const evidence = await listSessionLearningEvidence(supabase as never, "user-1", "session-1");
  expect(evidence[0]).toMatchObject({
    kind: "question_evaluation",
    sourceId: "question-evaluation-1",
    sessionId: "session-1",
    category: "architecture",
    competencyId: "competency-1",
    prompt: "How did you choose between the two approaches?",
    answer: "I chose option A because of latency and migration risk.",
  });
});
```

Hands-on test:

```ts
it("uses session evaluation ids for hands-on learning provenance", async () => {
  const evidence = await listSessionLearningEvidence(supabase as never, "user-1", "hands-on-session");
  expect(evidence.at(-1)).toMatchObject({
    kind: "session_evaluation",
    sourceId: "session-evaluation-1",
    sessionId: "hands-on-session",
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/repositories/learning.test.ts
```

Expected: module/functions do not exist.

- [ ] **Step 3: Implement `listSessionLearningEvidence` with owned joins**

Validate the session is owned and complete before returning evidence.

For conversational evidence query owned `question_evaluations` and join the owned `interview_questions` by `question_id`. Rehydrate `Evaluation` with the same persisted meanings used in `interviews.ts`.

For hands-on evidence query owned `session_evaluations`; build a concise `prompt` from the exercise title/briefing and an `answer` from checkpoint notes. Do not invent a fake question ID.

Use `answered_at`/evaluation `created_at` as the chronological evidence timestamp. Sort question evidence by question sequence/source ID, then session-level evidence.

- [ ] **Step 4: Implement learning-run mappers and wrappers**

Map malformed/missing `result_counts` to four zero counts rather than throwing on historical rows.

`claimCoachLearningRun` passes all five RPC arguments including `extractorVersion`. After every RPC, reload/validate the owned run so the caller never trusts a row belonging to another user.

- [ ] **Step 5: Implement bounded status reads**

`listUnprocessedCompletedSessionIds` returns newest owned completed session IDs that have no `completed` learning run, default limit 10 and hard cap 25.

`listFailedCoachLearningRuns` returns newest failed owned runs, default limit 10 and hard cap 25.

Neither function writes or invokes Gemini.

- [ ] **Step 6: Run GREEN and commit**

```bash
npm test -- src/lib/repositories/learning.test.ts
git add src/lib/types.ts src/lib/repositories/learning.ts src/lib/repositories/learning.test.ts
git commit -m "feat: expose learning evidence and runs"
```

---

### Task 3: Add structured learning signal extraction and deterministic fallback

**Files:**
- Create: `src/lib/learning-signals.ts`
- Create: `src/lib/learning-signals.test.ts`
- Modify: `src/lib/coach.ts`
- Modify: `src/lib/coach.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**

Add:

```ts
export type LearningSignalPolarity = "positive" | "negative";

export type LearningSignalDraft = {
  sourceId: string;
  topic: ObservationTopic;
  signal: LearningSignalPolarity;
  claim: string;
  reason: string;
};

export type WeightedLearningSignal = LearningSignalDraft & {
  source: LearningEvidenceSource;
  observationKey: string;
  weight: number;
};

export function observationKeyFor(
  source: LearningEvidenceSource,
  topic: ObservationTopic,
): string | null;

export function prepareLearningSignals(
  evidence: LearningEvidenceSource[],
  drafts: LearningSignalDraft[],
): WeightedLearningSignal[];

export function fallbackLearningSignals(
  evidence: LearningEvidenceSource[],
): WeightedLearningSignal[];

export async function extractLearningSignalDrafts(
  evidence: LearningEvidenceSource[],
): Promise<LearningSignalDraft[]>;
```

`observationKeyFor` returns `null` when a competency-scoped topic has no real persisted `competencyId`; such a candidate is discarded rather than reclassified globally.

- [ ] **Step 1: Write failing deterministic scope and weight tests**

Use fixed evidence fixtures:

```ts
expect(observationKeyFor(architectureEvidence, "tradeoff_reasoning"))
  .toBe("tradeoff_reasoning|competency:competency-architecture");
expect(observationKeyFor(architectureEvidence, "answer_structure"))
  .toBe("answer_structure|global");
expect(observationKeyFor(behavioralEvidence, "story_completeness"))
  .toBe("story_completeness|category:behavioral");
```

Test exact weight behavior:

```ts
const negativeStructure = prepareLearningSignals(
  [{ ...architectureEvidence, evaluation: { ...architectureEvidence.evaluation, dimensions: { structure: 3 } } }],
  [{ sourceId: architectureEvidence.sourceId, topic: "answer_structure", signal: "negative", claim: "The decision appears too late.", reason: "The answer starts with implementation." }],
);
expect(negativeStructure[0].weight).toBe(0.7);
```

Also assert structure=9 positive -> 0.9, and structure=8 negative is discarded because its raw weight is 0.2.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/learning-signals.test.ts
```

- [ ] **Step 3: Implement fixed topic scope and deterministic weights**

Use one exhaustive topic-to-dimension map. There is no automatic `other` topic.

For special topics implement conservative rules:

```text
unsupported_claims negative: require unsupportedClaims.length > 0; weight = min(1, 0.5 + 0.1 * count)
story_completeness negative: only experience/behavioral sources with an outcome/result-style missing point or expected-signal gap; base .6, raise from low overall score
behavioral_resolution negative: only behavioral sources with missing resolution/outcome language in missingPoints; base .6
ownership: prefer ownership-related expected/missing signal evidence; otherwise require overall score <=4 for negative or >=8 for positive
```

Any candidate that cannot be justified by these deterministic rules is discarded.

- [ ] **Step 4: Write failing structured-extractor tests in `coach.test.ts`**

Add a fixture with exactly two supplied source IDs and mock the Gemini JSON response. Assert the generated response schema permits only those IDs and the fixed topic/polarity enums.

Add a test where the model returns an unknown source ID and assert extraction rejects it through Zod before reconciliation.

Add a test where three signals refer to the same source and assert post-processing deterministically keeps only the first two valid candidates for that source.

- [ ] **Step 5: Implement `extractLearningSignalDrafts` through the existing structured JSON helper**

Build a dynamic source-ID schema:

```ts
function sourceIdSchema(ids: string[]): z.ZodType<string> {
  if (ids.length === 1) return z.literal(ids[0]);
  const [first, second, ...rest] = ids;
  return z.enum([first, second, ...rest]);
}
```

If `evidence.length === 0`, return `[]` without a model call.

The prompt includes only supplied learning evidence and these rules:

```text
identify durable coaching patterns directly supported by the answer/evaluation
never infer candidate career facts outside supplied evidence
use only the fixed topics
return zero signals for ambiguous evidence
return at most two strongest signals per source
```

The model does not receive/output observation key/type/evidence role/confidence/importance/trend/learning state/review state.

- [ ] **Step 6: Implement deterministic fallback**

For mapped dimensions:

```text
score <= 4 -> negative signal
score >= 8 -> positive signal
score 5..7 -> no signal
```

Also emit negative `unsupported_claims` when unsupported claims exist. Generate generic coaching claim/reason text from the persisted dimension name/reason only.

- [ ] **Step 7: Run GREEN and commit**

```bash
npm test -- src/lib/learning-signals.test.ts src/lib/coach.test.ts
git add src/lib/types.ts src/lib/learning-signals.ts src/lib/learning-signals.test.ts src/lib/coach.ts src/lib/coach.test.ts
git commit -m "feat: extract grounded coach learning signals"
```

---

### Task 4: Add deterministic observation reconciliation and aggregate learning state

**Files:**
- Create: `src/lib/observation-reconciler.ts`
- Create: `src/lib/observation-reconciler.test.ts`
- Modify: `src/lib/repositories/observations.ts`
- Modify: `src/lib/repositories/observations.test.ts`
- Modify: `src/lib/repositories/learning.ts`
- Modify: `src/lib/repositories/learning.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**

Add:

```ts
export type ObservationLearningFact = {
  sessionId: string;
  occurredAt: string;
  role: ObservationEvidenceRole;
  weight: number;
};

export type ObservationLearningAggregate = {
  confidence: number;
  importance: number;
  trend: CoachObservationTrend;
  learningState: CoachObservationLearningState;
  supportingSessionCount: number;
  contradictingSessionCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  needsReview: boolean;
};

export type LearningReconciliationChange = {
  observationId: string;
  observationKey: string;
  kind: "created" | "updated" | "established" | "needs_review";
  effectiveText: string;
};

export type LearningReconciliationSummary = {
  created: number;
  updated: number;
  established: number;
  needsReview: number;
  changes: LearningReconciliationChange[];
};

export function calculateObservationLearningState(
  observationType: CoachObservationType,
  facts: ObservationLearningFact[],
  latestReview: CoachObservationReviewEvent | null,
): ObservationLearningAggregate;

export async function reconcileLearningSignals(
  supabase: SupabaseClient,
  userId: string,
  signals: WeightedLearningSignal[],
): Promise<LearningReconciliationSummary>;
```

Repository helpers:

```ts
export async function getCoachObservationByKey(
  supabase: SupabaseClient,
  userId: string,
  observationKey: string,
): Promise<CoachObservation | null>;

export async function updateCoachObservationLearning(
  supabase: SupabaseClient,
  userId: string,
  observationId: string,
  patch: Pick<
    CoachObservation,
    "confidence" | "importance" | "trend" | "learningState" |
    "supportingSessionCount" | "contradictingSessionCount" |
    "firstSeenAt" | "lastSeenAt" | "needsReview"
  >,
): Promise<CoachObservation>;

export async function attachObservationEvidenceIfAbsent(
  supabase: SupabaseClient,
  userId: string,
  observationId: string,
  source: ObservationEvidenceSource,
  options: Required<Pick<AttachObservationEvidenceOptions, "role" | "weight">> & { reason: string | null },
): Promise<{ evidence: ObservationEvidence; inserted: boolean }>;

export async function listObservationLearningFacts(
  supabase: SupabaseClient,
  userId: string,
  observationId: string,
): Promise<ObservationLearningFact[]>;
```

- [ ] **Step 1: Write failing pure aggregate tests**

Use one fact per distinct session for the basic formula assertions:

```ts
expect(calculateObservationLearningState("weakness", [supportFact("s1", 0.8)], null))
  .toMatchObject({ confidence: 0.55, learningState: "tentative", trend: "unresolved", supportingSessionCount: 1 });

expect(calculateObservationLearningState("weakness", [supportFact("s1", 0.8), supportFact("s2", 0.9)], null))
  .toMatchObject({ confidence: 0.7, learningState: "established", supportingSessionCount: 2 });

expect(calculateObservationLearningState("weakness", [
  supportFact("s1", 0.8),
  supportFact("s2", 0.9),
  contradictFact("s3", 0.9),
], null)).toMatchObject({ confidence: 0.6, learningState: "tentative", contradictingSessionCount: 1 });
```

Assert importance exactly from `.25 + .35 * maxSupportWeight + .10 * min(supportSessions,3)` and clamp to 0..1.

Add negative-observation and strength-observation trend tests that cross the exact 0.20 threshold.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/observation-reconciler.test.ts
```

- [ ] **Step 3: Implement polarity/type mapping for newly keyed observations**

Use deterministic mapping from the design. For negative `technical_depth`, choose `knowledge_gap` only when the source evaluation has `dimensions.correctness <= 4`; otherwise choose `weakness`.

Positive `story_completeness`/`behavioral_resolution` becomes `story_strength`; every other positive topic becomes `strength`.

- [ ] **Step 4: Make evidence attachment idempotent**

`attachObservationEvidenceIfAbsent` inserts using the Task 1 unique indexes. If the database reports the unique-violation code for an identical observation/source pair, reload that evidence row and return `inserted: false`. Do not swallow ownership/FK/check violations.

Evidence role is derived from stored observation polarity:

```text
strength/story_strength + positive signal -> supporting
strength/story_strength + negative signal -> contradicting
all other observation types + negative signal -> supporting
all other observation types + positive signal -> contradicting
```

- [ ] **Step 5: Implement learning-fact resolution from durable provenance**

For `question_evaluation_id`, resolve evaluation -> question -> session and use the evidence row's `weight`, `evidence_role`, and the question's `answered_at`/evaluation timestamp.

For `session_evaluation_id`, resolve directly to its session and timestamp.

Profile/story/opportunity context evidence does not create recurrence facts.

When several evidence rows for one observation belong to the same session, aggregate per role using the maximum weight for that role before confidence/trend calculation. This prevents many questions inside one session from inflating distinct-session confidence.

- [ ] **Step 6: Implement `calculateObservationLearningState`**

Confidence:

```ts
const confidence = clamp(
  0.40 + 0.15 * Math.min(supportingSessionCount, 4) - 0.10 * Math.min(contradictingSessionCount, 3),
  0.15,
  0.95,
);
```

Learning state is `established` iff supporting distinct sessions >=2 and confidence >=0.65; otherwise `tentative`.

Trend uses chronological distinct-session nets. Fewer than 3 evidence-bearing sessions -> unresolved. Otherwise compare latest two average with up to two immediately preceding sessions, threshold 0.20, reversing direction for strength/story-strength.

For `needsReview`, compare counts with the latest review snapshot exactly as the design specifies. Automatic calculation never changes review state.

- [ ] **Step 7: Implement reconciliation orchestration**

Stable-sort incoming signals by `observationKey`, then `sourceId`.

For each signal:

```text
find keyed observation
if missing, create it with immutable claim, mapped observation type, unreviewed/tentative/unresolved
derive typed evidence source from signal.source.kind
attach evidence idempotently
reload learning facts
load latest review history event
recalculate aggregate
update only learning aggregate columns
build persisted-memory change summary using effectiveObservationText
```

Never patch `claim`, `reviewState`, or `userCorrection` in `updateCoachObservationLearning`.

A dismissed keyed row is reused; never create a replacement row for the same key.

- [ ] **Step 8: Run GREEN and commit**

```bash
npm test -- src/lib/observation-reconciler.test.ts src/lib/repositories/observations.test.ts src/lib/repositories/learning.test.ts
git add src/lib/types.ts src/lib/observation-reconciler.ts src/lib/observation-reconciler.test.ts src/lib/repositories/observations.ts src/lib/repositories/observations.test.ts src/lib/repositories/learning.ts src/lib/repositories/learning.test.ts
git commit -m "feat: reconcile adaptive coach observations"
```

---

### Task 5: Add per-session learning orchestration and retry/history API

**Files:**
- Create: `src/lib/learning-service.ts`
- Create: `src/lib/learning-service.test.ts`
- Create: `src/app/api/learning/route.ts`
- Create: `src/app/api/learning/route.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**

Add:

```ts
export const COACH_LEARNING_EXTRACTOR_VERSION = "release3-v1";

export type SessionLearningOutcome = {
  status: "completed" | "fallback" | "failed" | "already_processed" | "processing";
  runId: string | null;
  sessionId: string;
  createdObservations: number;
  updatedObservations: number;
  establishedObservations: number;
  needsReviewObservations: number;
  changes: LearningReconciliationChange[];
  warning: string | null;
};

export type LearningStatusSummary = {
  unprocessedCompletedSessions: number;
  failedRuns: CoachLearningRun[];
};

export async function processSessionLearning(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  now: Date,
): Promise<SessionLearningOutcome>;

export async function processSessionLearningBestEffort(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  now: Date,
): Promise<SessionLearningOutcome>;

export async function loadLearningStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearningStatusSummary>;

export async function processNextUnprocessedSession(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<SessionLearningOutcome | null>;
```

- [ ] **Step 1: Write failing orchestration tests**

Concrete live-success test:

```ts
it("completes a live learning run after reconciliation", async () => {
  claimMock.mockResolvedValue({ run: processingRun, claimed: true });
  evidenceMock.mockResolvedValue([architectureEvidence]);
  extractMock.mockResolvedValue([{ sourceId: architectureEvidence.sourceId, topic: "tradeoff_reasoning", signal: "negative", claim: "Trade-offs are not stated explicitly.", reason: "The answer chose an approach without comparing alternatives." }]);
  reconcileMock.mockResolvedValue({ created: 1, updated: 0, established: 0, needsReview: 0, changes: [createdChange] });

  await expect(processSessionLearning(supabase as never, "user-1", "session-1", fixedNow))
    .resolves.toMatchObject({ status: "completed", createdObservations: 1, warning: null });
  expect(completeRunMock).toHaveBeenCalledWith(expect.anything(), "user-1", processingRun.id, "live", {
    createdObservations: 1,
    updatedObservations: 0,
    establishedObservations: 0,
    needsReviewObservations: 0,
  });
});
```

Add explicit tests, with concrete mocks/expectations, for:

```text
structured extraction throws -> fallbackLearningSignals is used and run completes as deterministic_fallback with outcome status fallback
claim returns completed -> extractor is never called and outcome status already_processed replays persisted result_counts with changes=[]
claim returns recent processing -> extractor is never called and outcome status processing
reconciliation/storage throws -> failCoachLearningRun called with safe code and strict function rejects
best-effort wrapper catches strict failure -> outcome status failed with warning, no throw
```

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/learning-service.test.ts
```

- [ ] **Step 3: Implement strict processing flow**

Compute stale threshold only from explicit `now`:

```ts
const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
```

Call `claimCoachLearningRun` with `COACH_LEARNING_EXTRACTOR_VERSION`.

Branch:

```text
not claimed + completed -> already_processed using run.resultCounts and changes=[]
not claimed + processing -> processing with zero changes
claimed -> load evidence
```

If evidence is empty, complete a `live` run with zero counts without calling Gemini.

Try `extractLearningSignalDrafts` then `prepareLearningSignals`. If structured extraction fails, call `fallbackLearningSignals` and mark the eventual mode `deterministic_fallback`. Reconciliation/database errors are not extractor fallback conditions; fail the run and throw.

- [ ] **Step 4: Persist only safe result counts in the run ledger**

After reconciliation call `completeCoachLearningRun` with counts only. Return the in-memory `changes` for the current completion response, but never store those claim strings/reasons in `coach_learning_runs`.

- [ ] **Step 5: Implement best-effort wrapper with privacy-safe logs**

Catch strict failures and log only:

```ts
console.error("[learning-service] session learning failed", {
  sessionId,
  name: error instanceof Error ? error.name : "UnknownError",
  code: safeLearningErrorCode(error),
});
```

Return status `failed`, zero counts, empty changes, and:

```text
Your interview was saved, but Relay could not update coach memory from it.
```

Do not log answers, CV text, model raw output, claims, or reasons.

- [ ] **Step 6: Implement read-only `loadLearningStatus`**

Call `listUnprocessedCompletedSessionIds(..., 25)` and `listFailedCoachLearningRuns(..., 10)` in parallel. Return only the count of unprocessed session IDs plus failed runs.

- [ ] **Step 7: Implement `GET /api/learning`**

Authenticate with `requireUser`, call `loadLearningStatus`, return JSON. This route must have no model call or write path.

- [ ] **Step 8: Implement bounded POST actions**

Accept only:

```json
{ "action": "retry", "sessionId": "session-id" }
```

or:

```json
{ "action": "process_next" }
```

`retry` calls `processSessionLearning` for the requested owned completed session. `process_next` calls `processNextUnprocessedSession`, which processes only the first/newest returned session ID and never loops.

Map unauthenticated ->401, active/non-complete ->400, missing/non-owned ->404.

- [ ] **Step 9: Run GREEN and commit**

```bash
npm test -- src/lib/learning-service.test.ts src/app/api/learning/route.test.ts
git add src/lib/types.ts src/lib/learning-service.ts src/lib/learning-service.test.ts src/app/api/learning/route.ts src/app/api/learning/route.test.ts
git commit -m "feat: orchestrate coach learning runs"
```

---

### Task 6: Run learning after durable interview completion without blocking results

**Files:**
- Modify: `src/app/api/interview/route.ts`
- Modify: `src/app/api/interview/route.test.ts`
- Modify: `src/app/api-client.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**

Add a response type:

```ts
export type CompletedInterviewResponse = {
  session: InterviewSession;
  profile: Profile;
  practicePlanWarning: string | null;
  learning: SessionLearningOutcome;
};
```

- [ ] **Step 1: Write failing completion-route tests**

Add concrete expectations for each existing completion branch:

```ts
expect(processSessionLearningBestEffortMock).toHaveBeenCalledWith(
  supabase,
  "user-1",
  completedSession.id,
  expect.any(Date),
);
```

Required cases:

```text
conversation auto-finish after final response -> learning called exactly once
explicit planned conversation completion -> learning called exactly once
hands-on completion -> learning called exactly once
learning service returns failed -> HTTP 200, completed session remains returned, learning.status=failed
practice-plan completion returns warning -> learning is still attempted and both warning/learning are returned
```

- [ ] **Step 2: Run RED**

```bash
npm test -- src/app/api/interview/route.test.ts
```

- [ ] **Step 3: Centralize post-completion response assembly**

Create one internal helper:

```ts
async function completedSessionResponse(
  supabase: SupabaseClient,
  userId: string,
  completed: InterviewSession,
  profile: Profile,
): Promise<NextResponse<CompletedInterviewResponse>>;
```

Inside it:

```text
1 completeLinkedPracticePlanBestEffort
2 processSessionLearningBestEffort using new Date() created once for this post-completion operation
3 return session/profile/practicePlanWarning/learning
```

Both `finishConversation` and explicit `complete` branches call this helper. Do not duplicate learning calls in their callers.

- [ ] **Step 4: Update typed API client and shell-compatible response parsing**

`sendAnswer`/`finishInterview` callers can keep reading `session/profile`, but the API client response type exposes `learning` so Task 9 can render it.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- src/app/api/interview/route.test.ts src/app/page.test.tsx
git add src/app/api/interview/route.ts src/app/api/interview/route.test.ts src/app/api-client.ts src/lib/types.ts
git commit -m "feat: learn from completed practice"
```

---

### Task 7: Replace Release 2 precedence with deterministic scored practice candidates

**Files:**
- Modify: `src/lib/practice-recommendation.ts`
- Modify: `src/lib/practice-recommendation.test.ts`
- Modify: `src/lib/practice-service.ts`
- Modify: `src/lib/practice-service.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**

Extend the non-persisted recommendation type only:

```ts
export type PracticePriorityFactor = {
  key: string;
  label: string;
  points: number;
  detail: string;
};

export type PracticeRecommendation = {
  format: PracticeFormat;
  primaryFocus: string;
  secondaryFocus: string | null;
  rationale: string;
  estimatedMinutes: number;
  successCriteria: string[];
  primaryOpportunityId: string | null;
  supportingOpportunityIds: string[];
  signals: PracticeRecommendationSignal[];
  targetKey: string;
  priorityScore: number;
  priorityFactors: PracticePriorityFactor[];
};
```

Do **not** change persisted `PracticePlan.priorityFactors`; it remains `Record<string, unknown>`.

Persist the recommendation snapshot as:

```ts
const persistedPriorityFactors: Record<string, unknown> = {
  targetKey: recommendation.targetKey,
  factors: recommendation.priorityFactors,
};
```

- [ ] **Step 1: Rewrite recommendation tests around exact scores/factors**

Required deterministic fixtures:

```text
interview tomorrow beats established weakness
interview in five days beats generic weakness
worsening established observation beats stable lower-confidence observation
improving observation receives -15 trend factor
confirmed/corrected observation receives +15 review factor
established unreviewed observation receives +10 maturity factor
tentative unreviewed observation produces no observation candidate
dismissed observation produces no observation candidate
strength/story_strength produces no problem candidate
same target <=24 hours receives only the 24-hour penalty
same target >24 and <=72 hours receives the 3-day penalty
competency/job relevance changes an otherwise-close ordering
equal score resolves by lexical targetKey
```

Use fixed `now` in every time-sensitive fixture.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/practice-recommendation.test.ts
```

- [ ] **Step 3: Build isolated candidate generators**

Use:

```ts
type ScoredPracticeCandidate = PracticeRecommendation;

function rolePrepCandidates(input: PracticeRecommendationInput): ScoredPracticeCandidate[];
function observationCandidates(input: PracticeRecommendationInput): ScoredPracticeCandidate[];
function fallbackCandidates(input: PracticeRecommendationInput): ScoredPracticeCandidate[];
```

Target keys:

```text
role prep: opportunity:<opportunity-id>
keyed observation: observation:<observation-key>
legacy reviewed observation: observation-id:<observation-id>
progress weakness: progress:<normalized-focus>
first practice: first-practice
full simulation: full-simulation
```

- [ ] **Step 4: Implement exact role scoring**

For each non-terminal applied/interviewing opportunity:

```text
base +20
interview <=2 days +120
interview >2 and <=7 days +100
interviewing with no near-term date +75
applied +45
match score + clamp(matchScore / 10, 0, 10)
```

Recency penalty from previous recommended plans for the same `targetKey`:

```text
age <=24h -> -30
24h < age <=72h -> -15
older -> 0
```

Do not add both recency penalties.

- [ ] **Step 5: Implement exact observation scoring**

Eligible:

```text
confirmed/corrected actionable observations regardless of legacy key
unreviewed + established actionable observations
```

Exclude dismissed, tentative-unreviewed, strength, story_strength.

Score:

```text
base +20
importance * 30
confidence * 25
confirmed/corrected +15
established unreviewed +10
worsening +15
stable +5
improving -15
supporting session count *5 capped +15
job relevance +0/+5/+10/+20
```

Recency:

```text
same target <=24h -> -25
24h < age <=72h -> -12
```

- [ ] **Step 6: Pin deterministic job relevance**

Use these exact points:

```text
competency-scoped keyed observation + competency name found in active opportunity gaps/strengths/jobDescription -> +20
global answer/delivery observation + at least one active applied/interviewing opportunity -> +5
story_gap + at least one active applied/interviewing opportunity -> +10
otherwise -> 0
```

Matching normalizes case and whitespace; no embeddings or LLM.

Job text affects priority only, never candidate evidence.

- [ ] **Step 7: Preserve deterministic fallback candidates**

Retain Release 2 progress weakness/first practice/full simulation behavior as scored fallback candidates. Give them fixed low base scores so role prep/established memory wins when appropriate; encode those scores in tests rather than hidden branches.

- [ ] **Step 8: Persist the winning snapshot when recommended practice starts**

Extend internal `PracticeDraft` with:

```ts
priorityScore: number | null;
priorityFactors: Record<string, unknown>;
```

`startRecommendedPractice` writes:

```ts
priorityScore: recommendation.priorityScore,
priorityFactors: {
  targetKey: recommendation.targetKey,
  factors: recommendation.priorityFactors,
},
```

`startManualPractice` writes `priorityScore: null` and `priorityFactors: { source: "manual" }`.

Over-practice lookup reads `plan.priorityFactors.targetKey` only when it is a string.

- [ ] **Step 9: Run GREEN and commit**

```bash
npm test -- src/lib/practice-recommendation.test.ts src/lib/practice-service.test.ts
git add src/lib/types.ts src/lib/practice-recommendation.ts src/lib/practice-recommendation.test.ts src/lib/practice-service.ts src/lib/practice-service.test.ts
git commit -m "feat: score adaptive practice priorities"
```

---

### Task 8: Extend Coach-memory/dashboard read models with learning maturity, review history, and status

**Files:**
- Modify: `src/lib/coach-memory.ts`
- Modify: `src/lib/coach-memory.test.ts`
- Modify: `src/lib/career-dashboard.ts`
- Modify: `src/lib/career-dashboard.test.ts`
- Modify: `src/app/api/observations/route.ts`
- Modify: `src/app/api/observations/route.test.ts`
- Modify: `src/app/api/career/dashboard/route.ts`
- Modify: `src/app/api/career/dashboard/route.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**

Extend:

```ts
export type CoachEvidenceDisplay = {
  kind: "profile_evidence" | "question_evaluation" | "session_evaluation" | "career_story" | "opportunity_event";
  label: string;
  summary: string;
  role: ObservationEvidenceRole;
  reason: string | null;
};

export type CoachObservationSummary = CoachObservation & {
  effectiveText: string;
  evidence: CoachEvidenceDisplay[];
  reviewHistory: CoachObservationReviewEvent[];
};
```

Extend `CareerDashboard` with:

```ts
learningStatus: LearningStatusSummary;
homeObservations: CoachObservationSummary[];
needsReviewObservations: CoachObservationSummary[];
```

Keep existing `observations` for the broader non-history read model so current consumers do not lose data unexpectedly.

- [ ] **Step 1: Write failing session-evaluation evidence display test**

Given one observation evidence row with `sessionEvaluationId`, assert `resolveObservationEvidence` returns:

```ts
expect(display).toMatchObject({
  kind: "session_evaluation",
  label: expect.stringContaining("Hands-on"),
  role: "supporting",
});
```

The summary uses persisted strengths/weaknesses; unresolved owned source rows are omitted rather than shown as raw IDs.

- [ ] **Step 2: Update `resolveObservationEvidence` batching**

Add one batched owned query for `session_evaluations`, plus any owned session lookup needed for a useful exercise/competency label. Preserve the existing one-query-per-source-kind style.

- [ ] **Step 3: Write failing Observation API grouping/history tests**

GET now returns:

```ts
{
  established: CoachObservationSummary[];
  tentative: CoachObservationSummary[];
  needsReview: CoachObservationSummary[];
  history: CoachObservationSummary[];
}
```

Grouping:

```text
needsReview = needsReview true, regardless of current review state
tentative = unreviewed + tentative + !needsReview
history = dismissed + !needsReview
established = every other non-dismissed + !needsReview
```

Every summary loads `listCoachObservationReviews` and includes `reviewHistory` newest-first.

- [ ] **Step 4: Update observation GET/POST implementation**

POST actions remain exactly `confirm`, `correct`, `dismiss` and continue to call only `reviewCoachObservation`. Do not add manual create through this API.

After review the returned row has `needsReview=false` because the Task 1 RPC handles it atomically.

- [ ] **Step 5: Write failing dashboard tests**

Assert:

```text
homeObservations excludes tentative unreviewed rows
homeObservations excludes dismissed rows
homeObservations includes established unreviewed + confirmed/corrected rows
needsReviewObservations includes dismissed rows flagged needsReview
learningStatus includes failed-run list and unprocessed count
recommendation exposes priorityScore/priorityFactors
loading dashboard never calls processSessionLearning or Gemini
```

- [ ] **Step 6: Implement read-only dashboard aggregation**

Call `loadLearningStatus` in parallel with other independent reads where practical. `homeObservations` uses only established/reviewed non-dismissed observations. `needsReviewObservations` is separate.

Do not initiate historical learning from `loadCareerDashboard` or its GET route.

- [ ] **Step 7: Run GREEN and commit**

```bash
npm test -- src/lib/coach-memory.test.ts src/lib/career-dashboard.test.ts src/app/api/observations/route.test.ts src/app/api/career/dashboard/route.test.ts
git add src/lib/types.ts src/lib/coach-memory.ts src/lib/coach-memory.test.ts src/lib/career-dashboard.ts src/lib/career-dashboard.test.ts src/app/api/observations/route.ts src/app/api/observations/route.test.ts src/app/api/career/dashboard/route.ts src/app/api/career/dashboard/route.test.ts
git commit -m "feat: expose adaptive coach memory state"
```

---

### Task 9: Show learning changes, recommendation factors, review attention, and bounded history processing in the UI

**Files:**
- Create: `src/app/learning-summary-card.tsx`
- Create: `src/app/learning-summary-card.test.tsx`
- Modify: `src/app/api-client.ts`
- Modify: `src/app/relay-shell.tsx`
- Modify: `src/app/page.test.tsx`
- Modify: `src/app/views/home-view.tsx`
- Modify: `src/app/views/home-view.test.tsx`
- Modify: `src/app/views/coach-view.tsx`
- Modify: `src/app/views/coach-view.test.tsx`

**Interfaces:**

Add API client functions:

```ts
export async function getLearningStatus(): Promise<LearningStatusSummary>;
export async function retrySessionLearning(sessionId: string): Promise<SessionLearningOutcome>;
export async function processNextPastSession(): Promise<SessionLearningOutcome | null>;
```

- [ ] **Step 1: Write failing LearningSummaryCard tests**

Use concrete outcomes:

```ts
render(<LearningSummaryCard outcome={{
  status: "completed",
  runId: "run-1",
  sessionId: "session-1",
  createdObservations: 1,
  updatedObservations: 0,
  establishedObservations: 0,
  needsReviewObservations: 0,
  changes: [{ observationId: "obs-1", observationKey: "answer_structure|global", kind: "created", effectiveText: "State the decision before implementation detail." }],
  warning: null,
}} />);
expect(screen.getByText(/What Relay learned/i)).toBeVisible();
expect(screen.getByText(/State the decision before implementation detail/i)).toBeVisible();
```

Also test fallback labeling, needs-review change, failed warning, and hiding an already-processed/completed zero-change outcome with no warning.

- [ ] **Step 2: Implement `LearningSummaryCard`**

Render only persisted-memory `changes` plus safe status/warning. Do not render raw Gemini text or hidden model candidates.

- [ ] **Step 3: Wire completion learning outcome into Relay results**

Add shell state:

```ts
const [lastLearningOutcome, setLastLearningOutcome] = useState<SessionLearningOutcome | null>(null);
```

Set it from completion responses, clear it when a new session starts/sign-out occurs, and render the card in Results next to existing detailed answer feedback. Do not replace `ResultsFeedbackCards`.

- [ ] **Step 4: Write failing Home adaptive-explanation tests**

Assert:

```text
primary Start recommended practice CTA remains dominant
human-readable priority factors render under Why this
raw numeric formula is not the primary text
home What Relay is noticing uses dashboard.homeObservations
failed learning run creates a non-blocking Retry notice/action
normal Start recommended practice remains enabled despite a failed learning run
```

- [ ] **Step 5: Implement Home adaptive summaries**

Show up to the highest-value factors from `recommendation.priorityFactors`, preserving factor details such as recurrence, trend, job relevance, and recency.

Use `dashboard.homeObservations`; never surface every tentative one-off on Home.

- [ ] **Step 6: Write failing Coach grouping/review-attention tests**

Assert visible groups and copy:

```text
Established / reviewed
Tentative
Needs your review
History
```

Tentative copy explicitly says it does not affect recommended practice yet.

For a dismissed+needsReview observation assert the UI still says it is dismissed and that new evidence is asking for reconsideration; do not label it reactivated.

Assert review history and `seen in N sessions` are visible in detail.

- [ ] **Step 7: Implement bounded historical processing callbacks**

Wire:

```ts
async function handleRetryLearning(sessionId: string): Promise<void>;
async function handleProcessPastPractice(): Promise<void>;
```

Each invokes exactly one API request, stores returned outcome if useful, refreshes dashboard/Coach data, and never loops across all history.

Expose `Learn from past practice` only when `learningStatus.unprocessedCompletedSessions > 0`.

- [ ] **Step 8: Run GREEN and commit**

```bash
npm test -- src/app/learning-summary-card.test.tsx src/app/views/home-view.test.tsx src/app/views/coach-view.test.tsx src/app/page.test.tsx
git add src/app/learning-summary-card.tsx src/app/learning-summary-card.test.tsx src/app/api-client.ts src/app/relay-shell.tsx src/app/page.test.tsx src/app/views/home-view.tsx src/app/views/home-view.test.tsx src/app/views/coach-view.tsx src/app/views/coach-view.test.tsx
git commit -m "feat: surface adaptive coach learning"
```

---

### Task 10: Prove the adaptive loop and Release 1/2 regression boundary

**Files:**
- Create: `src/lib/release3-learning-loop.test.ts`
- Modify: `README.md`
- Verify: full repository and `supabase/migrations/202609010001_adaptive_learning_loop.sql`

- [ ] **Step 1: Add the deterministic learning-loop acceptance test**

Use fixed IDs/timestamps and the real pure aggregate/recommendation functions around repository/service seams.

Required sequence:

```text
Session 1 negative architecture trade-off evidence
  -> observation key tradeoff_reasoning|competency:architecture-id
  -> supportingSessionCount 1
  -> confidence .55
  -> tentative
  -> recommendation cannot select this observation

Session 2 same negative key
  -> same observation id, no duplicate
  -> supportingSessionCount 2
  -> confidence .70
  -> established
  -> recommendation selects it when no near-term opportunity outranks it

Session 3 positive same key
  -> contradicting evidence on same observation
  -> original claim unchanged
  -> historical negative evidence retained

Sessions 4 and 5 positive same key
  -> trend becomes improving under the exact recent-vs-previous formula
  -> priority loses the improving factor and falls below a stable comparable problem
```

Add assertions that corrected effective text survives every reconciliation and a dismissed row never becomes recommendation-eligible.

- [ ] **Step 2: Add idempotency/failure/hands-on integration cases**

Concrete cases:

```text
process same completed session twice -> one coach_learning_runs row and one observation/source evidence link
structured extractor failure -> deterministic_fallback completed run
reconciliation/storage failure -> failed run while previously completed interview data stays complete
atomic review RPC failure -> no new review event and no partial current-state mutation
hands-on session_evaluation -> visible observation provenance and recurrence fact
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

The pre-Release-3 main baseline after the Gemini response-schema fix is 514 passing tests across 38 files. A lower count after this release must be investigated and explained, not accepted silently.

- [ ] **Step 4: Run lint and production build**

```bash
npm run lint
npx next build --webpack
```

Expected: both pass.

- [ ] **Step 5: Verify migration on disposable/development Supabase**

```bash
supabase db push
```

Verify:

```text
existing Release 1/2 rows survive
review history is append-only and atomic
question/session evaluation provenance is same-user constrained
learning run double claim is safe
same observation/source retry does not duplicate evidence
cross-user observation/evaluation/session references fail
```

- [ ] **Step 6: Live-provider smoke test on development deployment**

With one authenticated development account:

```text
complete a practice answer with a clear structure/trade-off issue
Results shows What Relay learned
Coach shows tentative after first supporting session
complete a second session with same pattern -> same observation becomes established
Home can recommend it when no real interview urgency outranks it
correct the observation -> Home/Coach uses correction text
complete strong contradictory sessions -> trend eventually becomes improving and priority falls
retry one failed run if a safe failure fixture exists
process one previously unprocessed completed session explicitly
```

Inspect Vercel logs and confirm no CV text, answer text, model candidate claim/reason, or raw model JSON is logged.

- [ ] **Step 7: Update README accurately**

Document:

```md
- Relay learns evidence-backed coaching observations from completed practice, reconciles repeated and contradictory evidence, and uses established memory in deterministic recommended-practice scoring.
- User Confirm / Correct / Dismiss decisions remain authoritative; dismissed observations are never silently reactivated.
- Learning runs synchronously after durable session completion with deterministic fallback and retry support; there is no background worker or cron dependency.
- Career stories remain user-controlled factual artifacts; Relay does not auto-create career history from answers.
- The external job-hunter remains independent until Release 4.
```

- [ ] **Step 8: Run the final boundary/security diff check**

Confirm:

```text
no job-hunter repository/config/workflow changes
no Google Sheet integration
no service-role secret in client code
no browser direct writes to learning/observation tables
no Gemini-authored observation confidence/importance/trend/review state
no automatic career-story creation
```

- [ ] **Step 9: Final verification and scoped commit**

```bash
npm test && npm run lint && npx next build --webpack
git add src/lib/release3-learning-loop.test.ts README.md
git commit -m "docs: describe adaptive Relay learning"
```

## Completion Gate

Do not mark Release 3 complete unless all of these are proven:

- completed conversation and hands-on practice can produce durable observation evidence;
- one supporting session creates only tentative automatic memory;
- two supporting distinct sessions establish it at the specified confidence threshold;
- same topic/scope reconciles into one keyed observation regardless of changed model wording;
- retries cannot duplicate evidence;
- contradictory evidence is retained and changes aggregate state rather than deleting history;
- confidence, importance, trend, and supporting/contradicting session counts are deterministic;
- automatic learning never mutates `claim`, `review_state`, or `user_correction`;
- Confirm / Correct / Dismiss writes append-only review history atomically;
- dismissed observations are never recommendation-eligible automatically;
- significant new evidence after review sets `needsReview` without changing review state;
- recommendation v2 is deterministic, scored, explainable, and persists a `targetKey`/factor snapshot in the existing PracticePlan JSON object;
- near-term real interviews remain dominant;
- established recurring/worsening problems gain priority;
- improving/recently-practiced problems can lose priority;
- Results shows durable learning changes;
- Home hides tentative one-offs from its main coaching summary;
- Coach exposes established/tentative/needs-review/history groups plus evidence/review history;
- learning failure never invalidates completed interview evidence;
- dashboard GET never triggers model learning;
- existing Release 1/2 onboarding, applications, stories, practice, voice, results, progress, and profile flows still work;
- no career-story fabrication, background worker, job-hunter migration, Google Sheet sync, vector search, or fine-tuning is introduced.