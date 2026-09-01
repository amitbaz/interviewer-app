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

Add types:

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

Extend `ObservationEvidence` and `ObservationEvidenceSource` with `sessionEvaluationId` / `{ kind: "session_evaluation"; sessionEvaluationId: string }`.

- [ ] **Step 1: Write RED repository/type tests for the new observation shape and atomic review contract**

Add tests asserting mapper defaults/backward compatibility and the future RPC call:

```ts
it("maps Release 3 learning fields without changing legacy review text", async () => {
  const observation = await getCoachObservation(supabase as never, "user-1", "obs-1");
  expect(observation).toMatchObject({
    observationKey: "tradeoff_reasoning|global",
    learningState: "established",
    supportingSessionCount: 2,
    contradictingSessionCount: 0,
    needsReview: false,
  });
});

it("reviews through one atomic RPC rather than a direct table update", async () => {
  await reviewCoachObservation(supabase as never, "user-1", "obs-1", {
    state: "corrected",
    correction: "I know the trade-off; I need to state it earlier.",
  });
  expect(rpc).toHaveBeenCalledWith("review_coach_observation", expect.objectContaining({
    p_observation_id: "obs-1",
    p_review_state: "corrected",
  }));
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/repositories/observations.test.ts
```

- [ ] **Step 3: Create the migration's observation columns and key constraint**

Add to `coach_observations`:

```sql
observation_key text,
learning_state text not null default 'tentative' check (learning_state in ('tentative', 'established')),
supporting_session_count integer not null default 0 check (supporting_session_count >= 0),
contradicting_session_count integer not null default 0 check (contradicting_session_count >= 0),
needs_review boolean not null default false,
reviewed_evidence_count integer not null default 0 check (reviewed_evidence_count >= 0)
```

Add:

```sql
create unique index coach_observations_user_key_unique
  on public.coach_observations (user_id, observation_key)
  where observation_key is not null;
```

Backfill only reviewed rows:

```sql
update public.coach_observations
set learning_state = 'established'
where review_state in ('confirmed', 'corrected', 'dismissed');
```

Do not invent keys for existing rows.

- [ ] **Step 4: Add append-only `coach_observation_reviews` + RLS**

Create the table with the fields from the spec, same-user composite FK to `coach_observations`, own-row select/insert policies, no update/delete policy.

Backfill one review event for each existing non-`unreviewed` observation using the current review timestamp (`confirmed_at`, `corrected_at`, or `dismissed_at`) and current correction text when still available. Do not reconstruct lost old corrections.

- [ ] **Step 5: Add `review_coach_observation` transactional RPC**

Create a `security invoker` function:

```sql
review_coach_observation(
  p_observation_id uuid,
  p_review_state text,
  p_correction text default null
)
returns table(observation_id uuid)
```

The function must:

```text
require auth.uid()
validate review_state in confirmed/corrected/dismissed
require nonblank correction only for corrected
lock the owned observation for update
count current observation_evidence rows
insert one coach_observation_reviews snapshot
update current review columns/timestamps/user_correction
set reviewed_evidence_count to current evidence count
set needs_review = false
return observation id
```

No partial update may survive if review-event insertion fails.

- [ ] **Step 6: Extend observation evidence to hands-on session evaluations**

Ensure `session_evaluations` has `unique (id, user_id)`.

Add `session_evaluation_id uuid` to `observation_evidence`, replace the existing `num_nonnulls(...) = 1` check so it covers all five source columns, and add same-user composite FK to `session_evaluations`.

Add partial unique indexes preventing duplicate source attachment per observation:

```sql
(observation_id, profile_evidence_id) where profile_evidence_id is not null
(observation_id, question_evaluation_id) where question_evaluation_id is not null
(observation_id, session_evaluation_id) where session_evaluation_id is not null
(observation_id, career_story_id) where career_story_id is not null
(observation_id, opportunity_event_id) where opportunity_event_id is not null
```

- [ ] **Step 7: Add `coach_learning_runs` + claim/finalize RPCs**

Create table fields from the spec with:

```sql
unique (user_id, session_id)
foreign key (session_id, user_id) references public.interview_sessions(id, user_id)
```

Own-row select/insert/update RLS only; no delete policy.

Create `security invoker` RPCs:

```sql
claim_coach_learning_run(p_session_id uuid, p_stale_before timestamptz)
complete_coach_learning_run(p_run_id uuid, p_processing_mode text)
fail_coach_learning_run(p_run_id uuid, p_error_code text)
```

Claim semantics:

```text
session must be owned + complete
create pending row if absent
completed -> return claimed=false
recent processing -> claimed=false
failed/pending/stale processing -> set processing, increment attempt_count, set started_at=now, claimed=true
```

Finalization must update only the caller's owned run.

- [ ] **Step 8: Update TypeScript mappers and review repository**

`reviewCoachObservation` calls the new RPC, then reloads the observation with `getCoachObservation`. `observationEvidenceColumns` becomes exhaustive across five source variants.

Add:

```ts
export async function listCoachObservationReviews(
  supabase: SupabaseClient,
  userId: string,
  observationId: string,
): Promise<CoachObservationReviewEvent[]>;
```

- [ ] **Step 9: Verify migration on disposable Supabase**

```bash
supabase db push
```

Verify:

```text
legacy observation rows remain readable
reviewed rows become established but get no invented observation_key
review RPC appends history + updates current state atomically
correction is required only for corrected
session_evaluation evidence passes exactly-one-source check
same observation/source cannot be attached twice
cross-user references fail
learning run can be claimed once and reclaimed only after failure/staleness
```

- [ ] **Step 10: Run GREEN and commit**

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
  createdAt: string;
  updatedAt: string;
};

export async function listSessionLearningEvidence(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<LearningEvidenceSource[]>;

export async function claimCoachLearningRun(...): Promise<{ run: CoachLearningRun; claimed: boolean }>;
export async function completeCoachLearningRun(...): Promise<CoachLearningRun>;
export async function failCoachLearningRun(...): Promise<CoachLearningRun>;
export async function listUnprocessedCompletedSessionIds(...): Promise<string[]>;
export async function listFailedCoachLearningRuns(...): Promise<CoachLearningRun[]>;
```

- [ ] **Step 1: Write RED evidence-hydration tests**

For conversation rows, assert the returned `sourceId` is the actual `question_evaluations.id`, not `question_id`, while prompt/answer/category/competency come from the owned question.

For hands-on rows, assert `sourceId` is `session_evaluations.id`, the source kind is `session_evaluation`, and the exercise/checkpoint summary is exposed without inventing a question ID.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/repositories/learning.test.ts
```

- [ ] **Step 3: Implement `listSessionLearningEvidence` with owned joins**

Validate the session is owned and `status = complete`. Query owned question evaluations/questions and session evaluations. Reuse existing Evaluation field semantics (`strengths`, `weaknesses`, grounded arrays, dimensions) rather than inventing a second evaluation meaning.

Sort evidence deterministically by question sequence then source ID; session-level evidence comes last.

- [ ] **Step 4: Implement learning-run wrappers**

Wrap the Task 1 claim/complete/fail RPCs and map rows. Use a fixed stale threshold at the service call site rather than `Date.now()` inside repository functions.

`listUnprocessedCompletedSessionIds` returns owned completed sessions with no completed learning run, newest first, and is read-only.

- [ ] **Step 5: Run GREEN and commit**

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

export async function extractLearningSignalDrafts(
  evidence: LearningEvidenceSource[],
): Promise<LearningSignalDraft[]>;

export function prepareLearningSignals(
  evidence: LearningEvidenceSource[],
  drafts: LearningSignalDraft[],
): WeightedLearningSignal[];

export function fallbackLearningSignals(
  evidence: LearningEvidenceSource[],
): WeightedLearningSignal[];
```

- [ ] **Step 1: Write RED deterministic key/scope/weight tests**

Examples:

```ts
expect(observationKeyFor(sourceWithArchitectureCompetency, "tradeoff_reasoning"))
  .toBe(`tradeoff_reasoning|competency:${architectureId}`);
expect(observationKeyFor(sourceWithArchitectureCompetency, "answer_structure"))
  .toBe("answer_structure|global");
expect(observationKeyFor(behavioralSource, "story_completeness"))
  .toBe("story_completeness|category:behavioral");
```

Assert dimension-derived weights exactly:

```text
structure=3 + negative answer_structure -> .7
structure=9 + positive answer_structure -> .9
structure=8 + negative answer_structure raw .2 -> signal discarded (< .4)
```

- [ ] **Step 2: Implement topic scope and weight helpers**

Keep the taxonomy exactly equal to the design spec. There is no automatic `other` topic.

For non-dimension topics, use explicit grounded rules:

```text
unsupported_claims negative: require unsupportedClaims.length > 0; weight grows with count but max 1
story_completeness negative: require missingPoints/expected-signal gap on experience/behavioral answer
behavioral_resolution negative: require behavioral question + missing resolution/outcome signal
ownership: use ownership-related expected/missing signals when present, otherwise overall score conservatively
```

Ambiguous evidence returns no signal rather than guessing.

- [ ] **Step 3: Write RED live extractor contract tests in `coach.test.ts`**

Mock the Gemini response and assert:

```text
sourceId is restricted to supplied evaluation IDs
sourceId not in supplied evidence is rejected
only ObservationTopic enum values are accepted
positive/negative only
claim/reason required and nonblank
max total candidates <= evidence.length * 2
```

Add a post-processing test that discards candidates beyond two for the same source ID deterministically.

- [ ] **Step 4: Implement `extractLearningSignalDrafts` through the existing `modelJson` path**

Define a dynamic Zod schema using the supplied `sourceId` values. The prompt includes only the learning evidence bundle and rules:

```text
identify durable coaching patterns only when directly supported
no candidate career facts outside the answer/evaluation
use the fixed topic taxonomy
one or two strongest signals per source at most
return no signal for ambiguous mediocre evidence
```

Do not expose observation key/type/confidence/importance/trend/review state to the model.

- [ ] **Step 5: Implement deterministic fallback**

Use high/low thresholds only:

```text
dimension <= 4 -> corresponding negative signal
dimension >= 8 -> corresponding positive signal
5..7 -> no deterministic dimension signal
unsupportedClaims.length > 0 -> negative unsupported_claims
```

Generate generic grounded claim wording from the evaluation dimension/reason; never from unsupplied career facts.

- [ ] **Step 6: Run GREEN and commit**

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

```ts
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

export async function reconcileLearningSignals(
  supabase: SupabaseClient,
  userId: string,
  signals: WeightedLearningSignal[],
): Promise<LearningReconciliationSummary>;
```

Add repository helpers:

```ts
getCoachObservationByKey(...): Promise<CoachObservation | null>;
updateCoachObservationLearning(...): Promise<CoachObservation>;
attachObservationEvidenceIfAbsent(...): Promise<{ evidence: ObservationEvidence; inserted: boolean }>;
listObservationLearningFacts(...): Promise<Array<{ sessionId: string; occurredAt: string; role: ObservationEvidenceRole; weight: number }>>;
```

- [ ] **Step 1: Write RED pure aggregate tests before database orchestration**

Extract/export a pure calculator:

```ts
export function calculateObservationLearningState(
  observationType: CoachObservationType,
  facts: ObservationLearningFact[],
  latestReview: CoachObservationReviewEvent | null,
): ObservationLearningAggregate;
```

Required exact assertions:

```text
1 supporting session -> confidence .55, tentative, unresolved
2 supporting sessions -> confidence .70, established
2 supporting + 1 contradicting -> confidence .60, tentative unless user-reviewed
importance = .25 + .35*maxSupportWeight + .10*min(supportSessions,3)
<3 distinct sessions -> unresolved trend
```

Test the 0.20 recent-vs-previous trend threshold for negative and positive observation types.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/observation-reconciler.test.ts
```

- [ ] **Step 3: Implement deterministic new-observation type mapping**

Map negative topics exactly as the spec states. `technical_depth` becomes `knowledge_gap` only when the source evaluation's correctness is clearly low (<=4); otherwise `weakness`. Positive story topics become `story_strength`; all other positive signals become `strength`.

- [ ] **Step 4: Make evidence insertion idempotent**

`attachObservationEvidenceIfAbsent` uses the partial unique indexes from Task 1 and returns `{ inserted: false }` on duplicate source for the same observation rather than throwing. It still throws cross-user/invalid-source errors.

Evidence role is derived from stored observation polarity and incoming positive/negative signal; never accepted from Gemini.

- [ ] **Step 5: Implement learning-fact resolution**

`listObservationLearningFacts` resolves question-evaluation evidence through its question -> session and session-evaluation evidence directly through session. Profile/story/opportunity context evidence does not count toward supporting/contradicting session recurrence.

Group multiple facts from the same session before confidence/trend calculations.

- [ ] **Step 6: Implement reconciliation orchestration**

For each signal, stable-sort by `observationKey` + `sourceId`, then:

```text
get keyed observation
create if absent with immutable claim + tentative state
derive evidence role
attach source if absent
reload all learning facts
load latest review event
calculate aggregate
update confidence/importance/trend/learning_state/session counts/first_seen/last_seen/needs_review
never update claim/review_state/user_correction
```

For dismissed observations, reuse the same row and attach new evidence; never create a replacement row with the same key.

`needsReview` rules use the latest review snapshot and require two additional distinct sessions in the relevant direction.

- [ ] **Step 7: Run GREEN and commit**

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

```ts
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

export async function processSessionLearningBestEffort(...): Promise<SessionLearningOutcome>;
export async function loadLearningStatus(...): Promise<LearningStatusSummary>;
export async function processNextUnprocessedSession(...): Promise<SessionLearningOutcome | null>;
```

- [ ] **Step 1: Write RED orchestration tests**

Required cases:

```ts
it("uses live extraction and completes the run when reconciliation succeeds", async () => { ... });
it("falls back deterministically when structured extraction fails", async () => { ... });
it("returns already_processed without extracting twice", async () => { ... });
it("marks the run failed when persistence/reconciliation fails", async () => { ... });
it("best-effort converts failure to a warning instead of throwing", async () => { ... });
```

Use explicit fixed `now`; no global clock reads in deterministic tests.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/learning-service.test.ts
```

- [ ] **Step 3: Implement strict processing flow**

```text
claim run with stale-before = now - 10 minutes
if not claimed + completed -> already_processed
if not claimed + processing -> processing
load durable learning evidence
if empty -> complete live run with zero changes
try extractLearningSignalDrafts + prepareLearningSignals
if live extraction throws -> fallbackLearningSignals and mode deterministic_fallback
reconcile signals
complete run with processing mode
return counts/changes
```

A database/reconciliation failure calls `failCoachLearningRun` with a safe stable error code and rethrows.

Never store raw draft/model output in `coach_learning_runs`.

- [ ] **Step 4: Implement best-effort wrapper**

Catch strict-processing errors, log only run/session/error metadata, and return:

```ts
{
  status: "failed",
  ...zeroCounts,
  warning: "Your interview was saved, but Relay could not update coach memory from it.",
}
```

Do not log candidate claims, reasons, answers, or CV text.

- [ ] **Step 5: Implement `GET /api/learning`**

Authenticate and return `loadLearningStatus`. GET performs no model calls/writes.

- [ ] **Step 6: Implement bounded POST actions**

Accept only:

```json
{ "action": "retry", "sessionId": "owned-completed-session-id" }
```

or:

```json
{ "action": "process_next" }
```

`process_next` chooses one newest owned completed session with no completed run. One request processes one session only.

Map unauthenticated -> 401, missing/non-owned session -> 404, active session -> 400. Never accept userId or raw evidence from the browser.

- [ ] **Step 7: Run GREEN and commit**

```bash
npm test -- src/lib/learning-service.test.ts src/app/api/learning/route.test.ts
git add src/lib/types.ts src/lib/learning-service.ts src/lib/learning-service.test.ts src/app/api/learning
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

Completion responses gain:

```ts
{
  session: InterviewSession;
  profile: Profile;
  practicePlanWarning?: string | null;
  learning: SessionLearningOutcome;
}
```

- [ ] **Step 1: Write RED route tests for all completion paths**

Cover:

```text
conversation auto-finish after final response -> learning called once
explicit planned conversation completion -> learning called once
hands-on completion -> learning called once
learning failure -> HTTP 200 + completed session + learning.status failed
practice-plan warning does not prevent learning attempt
```

- [ ] **Step 2: Run RED**

```bash
npm test -- src/app/api/interview/route.test.ts
```

- [ ] **Step 3: Centralize post-completion response assembly**

Create one internal route helper such as:

```ts
async function completedSessionResponse(
  supabase: SupabaseClient,
  userId: string,
  completed: InterviewSession,
  profile: Profile,
): Promise<NextResponse>;
```

It must run, in order:

```text
completeLinkedPracticePlanBestEffort
processSessionLearningBestEffort
return completed session/profile/warnings/learning
```

Both `finishConversation` and explicit `complete` use it so there is no path that forgets learning.

- [ ] **Step 4: Update typed API client response handling**

Preserve existing callers that only need `session/profile`, while Relay shell can store the returned learning outcome.

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

Extend recommendation read model:

```ts
export type PracticePriorityFactor = {
  key: string;
  label: string;
  points: number;
  detail: string;
};

export type PracticeRecommendation = {
  // existing fields
  targetKey: string;
  priorityScore: number;
  priorityFactors: PracticePriorityFactor[];
};
```

- [ ] **Step 1: Rewrite tests first around exact score fixtures**

Keep existing near-term behavior but assert score/factors, not branch implementation.

Required fixtures:

```text
interview tomorrow beats established weakness
interview in 5 days beats generic weakness
worsening established observation beats stable lower-confidence observation
improving established observation loses 15 points
confirmed/corrected observation gets +15 review factor
established unreviewed observation gets +10 maturity factor
tentative unreviewed observation produces no candidate
dismissed observation produces no candidate
strength/story_strength produces no problem candidate
same target last 24h gets -25
same target within 3 days gets -12
competency/job description relevance adds points
stable tie resolves deterministically by targetKey
```

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/practice-recommendation.test.ts
```

- [ ] **Step 3: Build candidate functions rather than one long selector**

Use internal shape:

```ts
type ScoredPracticeCandidate = PracticeRecommendation;

function rolePrepCandidates(input: PracticeRecommendationInput): ScoredPracticeCandidate[];
function observationCandidates(input: PracticeRecommendationInput): ScoredPracticeCandidate[];
function fallbackCandidates(input: PracticeRecommendationInput): ScoredPracticeCandidate[];
```

Use the exact point schedule in design section 9. Do not use randomness or implicit clock time.

- [ ] **Step 4: Add deterministic job relevance**

Normalize strings to lowercase tokens. Competency-scoped observation relevance searches active opportunity `gaps`, `strengths`, and `jobDescription` for the competency name. Global structure/delivery patterns receive only the design's small general-active-application boost. Story gaps receive moderate active-application relevance.

Never convert job text into candidate experience evidence.

- [ ] **Step 5: Add over-practice lookup from persisted plan snapshots**

Recent recommended plans store `priorityFactors` containing `targetKey`; compare their `createdAt` against explicit `now` to apply 24-hour / 3-day penalties. Manual plans without a target key do not create an automatic penalty.

- [ ] **Step 6: Persist winning priority snapshot on start**

Add `priorityScore`/`priorityFactors` to recommended `PracticeDraft`. `startRecommendedPractice` passes them into `createPracticePlan` using the already-existing persistence columns. Manual start keeps `priorityScore: null` and a minimal manual/source factor only if useful for display.

- [ ] **Step 7: Run GREEN and commit**

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

Extend evidence display kind with `session_evaluation`.

Extend observation summary:

```ts
export type CoachObservationSummary = CoachObservation & {
  effectiveText: string;
  evidence: CoachEvidenceDisplay[];
  reviewHistory: CoachObservationReviewEvent[];
};
```

Extend dashboard:

```ts
learningStatus: LearningStatusSummary;
homeObservations: CoachObservationSummary[];
needsReviewObservations: CoachObservationSummary[];
```

- [ ] **Step 1: Write RED coach-memory test for session evaluation evidence**

Resolve a session evaluation to a safe label such as the hands-on exercise/competency and a concise evaluation summary. Never surface a raw UUID when source resolution fails.

- [ ] **Step 2: Update `resolveObservationEvidence`**

Batch `session_evaluations` as the fifth source kind and preserve current batching/ownership behavior.

- [ ] **Step 3: Write RED observation API grouping tests**

GET returns:

```ts
{
  established: CoachObservationSummary[];
  tentative: CoachObservationSummary[];
  needsReview: CoachObservationSummary[];
  history: CoachObservationSummary[];
}
```

Grouping rules:

```text
needsReview: needsReview === true regardless of dismissed/current reviewed state
history: dismissed && !needsReview
tentative: unreviewed + tentative + !needsReview
established: all other non-dismissed + !needsReview
```

Every summary includes review history.

- [ ] **Step 4: Update observation route and tests**

POST review actions still call only `reviewCoachObservation`; the new transactional repository now preserves history. No create action is added.

- [ ] **Step 5: Write RED dashboard tests**

Assert:

```text
homeObservations excludes tentative one-off observations and dismissed rows
homeObservations includes established unreviewed + confirmed/corrected
needsReviewObservations includes dismissed row flagged needsReview
learningStatus reports failed/unprocessed without processing anything
recommendation contains score/factors
```

- [ ] **Step 6: Implement dashboard aggregation read-only**

Call `loadLearningStatus` in parallel with existing data loading where possible. Dashboard GET must not call `processSessionLearning` or Gemini.

- [ ] **Step 7: Run GREEN and commit**

```bash
npm test -- src/lib/coach-memory.test.ts src/lib/career-dashboard.test.ts src/app/api/observations/route.test.ts src/app/api/career/dashboard/route.test.ts
git add src/lib/types.ts src/lib/coach-memory.ts src/lib/coach-memory.test.ts src/lib/career-dashboard.ts src/lib/career-dashboard.test.ts src/app/api/observations src/app/api/career/dashboard
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

Add API client helpers:

```ts
export async function getLearningStatus(): Promise<LearningStatusSummary>;
export async function retrySessionLearning(sessionId: string): Promise<SessionLearningOutcome>;
export async function processNextPastSession(): Promise<SessionLearningOutcome | null>;
```

- [ ] **Step 1: Write RED learning-summary card tests**

Render persisted outcome changes only:

```text
created pattern
established pattern
needs-review change
fallback status label
failed warning
```

No raw priority numbers or model wording not already persisted in `changes`.

- [ ] **Step 2: Implement `LearningSummaryCard`**

Use concise copy headed `What Relay learned`. Hide entirely for `already_processed`/completed zero-change outcome with no warning.

- [ ] **Step 3: Wire completion outcomes into Relay shell/results**

Store the last completion's `SessionLearningOutcome` in shell state. Clear it when a new practice starts. Render the card on Results beside existing feedback, without replacing answer-level evaluation.

- [ ] **Step 4: Write RED Home tests for adaptive explanation**

Assert recommendation card shows human-readable `priorityFactors` such as recurrence/trend/job relevance, while the main CTA remains `Start recommended practice`.

If `learningStatus.failedRuns.length > 0`, show a non-blocking retry notice/action. Do not disable normal practice.

- [ ] **Step 5: Implement Home adaptive summaries**

Use `dashboard.homeObservations`, not raw `dashboard.observations`, for `What Relay is noticing`. Do not show tentative one-off observations there.

- [ ] **Step 6: Write RED Coach view tests for four groups**

Required copy/behavior:

```text
Established / reviewed
Tentative — does not affect recommended practice yet
Needs your review — new evidence since your decision
History
seen in N sessions
trend
Why does Relay think this?
review history
```

A dismissed+needsReview observation remains labeled dismissed until the user explicitly reviews it again.

- [ ] **Step 7: Add Retry and past-practice processing**

Coach view receives callbacks from shell:

```ts
onRetryLearning(sessionId)
onProcessPastPractice()
```

`Learn from past practice` processes one session per click/request and refreshes dashboard/Coach data afterward. It must never silently loop through all history.

- [ ] **Step 8: Run UI tests GREEN and commit**

```bash
npm test -- src/app/learning-summary-card.test.tsx src/app/views/home-view.test.tsx src/app/views/coach-view.test.tsx src/app/page.test.tsx
git add src/app/learning-summary-card.tsx src/app/learning-summary-card.test.tsx src/app/api-client.ts src/app/relay-shell.tsx src/app/page.test.tsx src/app/views/home-view.tsx src/app/views/home-view.test.tsx src/app/views/coach-view.tsx src/app/views/coach-view.test.tsx
git commit -m "feat: surface adaptive coach learning"
```

---

### Task 10: Prove the full adaptive loop and Release 1/2 regression boundary

**Files:**
- Create: `src/lib/release3-learning-loop.test.ts`
- Modify: `README.md`
- Test: full repository
- Verify: `supabase/migrations/202609010001_adaptive_learning_loop.sql`

- [ ] **Step 1: Add the deterministic end-to-end learning-loop test**

Use real pure recommendation/reconciliation functions and repository/service seams with fixed IDs/timestamps:

```text
Session 1
  architecture trade-off signal negative
  -> observation tradeoff_reasoning|competency:<id>
  -> supportingSessionCount=1
  -> confidence=.55
  -> tentative
  -> recommendation must NOT select it

Session 2
  same key negative
  -> same observation, no duplicate
  -> supportingSessionCount=2
  -> confidence=.70
  -> established
  -> recommendation selects it when no near-term interview outranks it

Session 3
  same key positive
  -> contradicting evidence
  -> original claim unchanged
  -> evidence retained

Sessions 4/5 positive
  -> trend improving
  -> priority loses improving factor / falls relative to another stable problem
```

Also assert correction text survives every reconciliation and a dismissed row never becomes selected.

- [ ] **Step 2: Add idempotency/failure integration cases**

Cover:

```text
process same completed session twice -> one run + one evidence link per source
learning DB failure -> interview already complete and result remains valid
fallback extractor -> completed learning run with deterministic_fallback mode
review RPC failure -> neither current state nor review history partially changes
hands-on session evaluation -> visible provenance + observation learning
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass; baseline before Release 3 is 514 tests/38 files after the Gemini response-schema fix, so any lower count must be explained rather than assumed valid.

- [ ] **Step 4: Run lint and production build**

```bash
npm run lint
npx next build --webpack
```

Expected: PASS.

- [ ] **Step 5: Verify migration on disposable/development Supabase**

```bash
supabase db push
```

Manually verify:

```text
existing Release 1/2 rows survive
review history is atomic + append-only
question/session evaluation provenance is same-user constrained
learning run double-claim is safe
same observation/source duplicate evidence is ignored/rejected idempotently
cross-user observation/evaluation/session references fail
```

- [ ] **Step 6: Live-provider smoke test on development deployment**

With one authenticated development account:

```text
complete a practice answer with an obvious structure/trade-off issue
Results shows What Relay learned
Coach shows tentative after first supporting session
complete a second session with same pattern -> observation becomes established
Home recommendation now cites repeated pattern when no interview urgency outranks it
correct the observation wording -> Home/Coach uses correction
complete strong contradictory sessions -> trend eventually moves improving and priority falls
retry one failed learning run if a safe failure fixture exists
process one previously unprocessed completed session explicitly
```

Confirm Vercel logs contain no answer/CV/model-candidate text.

- [ ] **Step 7: Update README boundary accurately**

Document:

```md
- Relay now learns evidence-backed coaching observations from completed practice, reconciles repeated/contradicting evidence, and uses established memory in deterministic recommended-practice scoring.
- User Confirm / Correct / Dismiss decisions remain authoritative; dismissed observations are never silently reactivated.
- Learning runs synchronously after session completion with deterministic fallback/retry support; there is no background worker or cron dependency.
- Career stories remain user-controlled factual artifacts; Relay does not auto-create career history from answers.
- The external job-hunter remains independent until Release 4.
```

- [ ] **Step 8: Boundary/security diff check**

Confirm:

```text
no job-hunter repository/config/workflow changes
no Google Sheet integration
no service-role secret in client bundle
no browser direct writes to learning/observation tables
no model-written observation confidence/trend/review state
no automatic story creation
```

- [ ] **Step 9: Final verification and commit**

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
- confidence/importance/trend/session counts are deterministic;
- automatic learning never mutates claim/review state/user correction;
- Confirm / Correct / Dismiss writes append-only review history atomically;
- dismissed observations are never recommendation-eligible automatically;
- significant new evidence after review sets needsReview without changing review state;
- recommendation v2 is deterministic, scored, explainable, and persists score/factors in the started PracticePlan;
- near-term real interviews remain dominant;
- established recurring/worsening problems gain priority;
- improving/recently-practiced problems can lose priority;
- Results shows durable learning changes;
- Home hides tentative one-offs from its main coaching summary;
- Coach exposes established/tentative/needs-review/history groups and evidence/review history;
- learning failure never invalidates completed interview evidence;
- dashboard GET never triggers model learning;
- existing Release 1/2 onboarding, applications, stories, practice, voice, results, progress, and profile flows still work;
- no career-story fabrication, background worker, job-hunter migration, Google Sheet sync, vector search, or fine-tuning is introduced.