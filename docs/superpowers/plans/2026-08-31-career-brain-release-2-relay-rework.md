# Career Brain Release 2 Relay Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recenter Relay around an explainable recommended-practice command center, manual application/story/coach-memory management, and plan-driven short practice sessions while preserving the existing generic interview flow and leaving the job-hunter untouched.

**Architecture:** Keep the existing single authenticated client shell for Release 2, but split its large `page.tsx` into focused views and typed API calls. Add a deterministic baseline recommendation service and server-side Career Brain APIs. Add a separate planned-conversation persistence path for 1–5 base questions rather than loosening the existing exact five-question interview RPC.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 5, Tailwind CSS 4, Supabase Postgres/Auth/RLS, `@supabase/supabase-js` 2.x, Vitest 4.1.11, Gemini/OpenAI-compatible provider code already present in `src/lib/coach.ts`.

**Spec:** `docs/superpowers/specs/2026-08-31-career-brain-release-2-relay-rework-design.md`

## Global Constraints

- Release 2 is the user-visible Relay rework; the primary Home action is `Start recommended practice`.
- Recommendation selection is deterministic and does not call an LLM.
- Release 2 does not automatically create or reconcile coach observations.
- Existing manual generic conversation keeps the exact five-question backbone.
- Plan-driven conversational practice supports 1–5 base questions.
- Candidate facts remain grounded in profile/interview evidence; job descriptions shape questions but are never proof of candidate experience.
- All Career Brain APIs use `requireUser()` and server-only repositories; browser code never accepts or sends a trusted `userId`.
- Started/completed practice-plan context is immutable in normal UI flows.
- Interview evidence must remain saved even if post-session practice-plan bookkeeping fails.
- No Google Sheets synchronization/import is implemented.
- No job-hunter code, secrets, SQLite state, workflow, or Telegram behavior changes.
- Follow repository mobile-first animation rules: View Transitions API where already used, no layout-property animations, native scrolling, touch-friendly controls.
- Follow red → green → refactor for each task and commit each independently reviewable deliverable.
- Run migrations first on a disposable/development Supabase target, never production as the test environment.

## File Structure

Files expected to be created:

```text
supabase/migrations/
  202608310001_planned_practice_sessions.sql

src/lib/
  practice-recommendation.ts
  practice-recommendation.test.ts
  career-dashboard.ts
  career-dashboard.test.ts
  coach-memory.ts
  coach-memory.test.ts
  practice-service.ts
  practice-service.test.ts

src/app/api/
  career/dashboard/route.ts
  career/dashboard/route.test.ts
  opportunities/route.ts
  opportunities/route.test.ts
  stories/route.ts
  stories/route.test.ts
  observations/route.ts
  observations/route.test.ts
  practice/route.ts
  practice/route.test.ts

src/app/
  api-client.ts
  relay-shell.tsx
  views/
    home-view.tsx
    home-view.test.tsx
    applications-view.tsx
    applications-view.test.tsx
    practice-view.tsx
    practice-view.test.tsx
    stories-view.tsx
    stories-view.test.tsx
    coach-view.tsx
    coach-view.test.tsx
```

Existing files expected to be modified:

```text
src/lib/types.ts
src/lib/coach.ts
src/lib/coach.test.ts
src/lib/repositories/interviews.ts
src/lib/repositories/interviews.test.ts
src/lib/repositories/practice-plans.ts
src/app/api/interview/route.ts
src/app/page.tsx
src/app/page.test.tsx
README.md
```

Keep the exact final split pragmatic: existing `profile`, `progress`, `interview`, and `results` JSX may stay temporarily inside `relay-shell.tsx` if extracting them would create unrelated churn. The new Release 2 views must not be added back into the old `page.tsx` monolith.

---

### Task 1: Add the deterministic baseline practice recommendation engine

**Files:**
- Create: `src/lib/practice-recommendation.ts`
- Create: `src/lib/practice-recommendation.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces:

```ts
export type PracticeRecommendationSignal = {
  kind:
    | "upcoming_interview"
    | "interviewing_opportunity"
    | "reviewed_observation"
    | "story_bank_gap"
    | "progress_weakness"
    | "applied_opportunity"
    | "first_practice"
    | "fallback";
  label: string;
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
};

export type PracticeRecommendationInput = {
  opportunities: Opportunity[];
  observations: CoachObservation[];
  stories: CareerStory[];
  progress: ProgressSnapshot;
  recentSessions: InterviewSession[];
  recentPlans: PracticePlan[];
  now: Date;
};

export function recommendPractice(input: PracticeRecommendationInput): PracticeRecommendation;
```

- [ ] **Step 1: Write failing precedence tests**

Create fixtures for active/terminal opportunities, reviewed/dismissed observations, stories, progress, and sessions. Add the eight required spec cases.

Representative tests:

```ts
it("prioritizes an interview in three days over a generic weakness", () => {
  const recommendation = recommendPractice({
    ...baseInput,
    now: new Date("2026-08-31T08:00:00.000Z"),
    opportunities: [{
      ...opportunity,
      status: "interviewing",
      company: "Example Co",
      role: "Senior Frontend Engineer",
      nextInterviewAt: "2026-09-03T10:00:00.000Z",
    }],
    progress: { ...progress, recurringWeaknesses: ["Architecture framing"] },
  });

  expect(recommendation).toMatchObject({
    format: "role_prep",
    primaryOpportunityId: opportunity.id,
    estimatedMinutes: 18,
  });
  expect(recommendation.signals[0].kind).toBe("upcoming_interview");
});

it("never lets a dismissed observation drive the recommendation", () => {
  const recommendation = recommendPractice({
    ...baseInput,
    observations: [{
      ...observation,
      observationType: "story_gap",
      importance: 1,
      reviewState: "dismissed",
    }],
  });

  expect(recommendation.signals.some((signal) => signal.kind === "reviewed_observation")).toBe(false);
});
```

Also assert a corrected observation uses `userCorrection` in `primaryFocus`/rationale rather than the original claim.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -- src/lib/practice-recommendation.test.ts
```

Expected: FAIL because recommendation types/function do not exist.

- [ ] **Step 3: Add recommendation DTO types to `src/lib/types.ts`**

Add the exact interfaces above after `PracticePlan` types. Keep them UI/domain read models, not persisted database entities.

- [ ] **Step 4: Implement `recommendPractice` as a pure precedence function**

Use helpers with explicit semantics:

```ts
const terminalStatuses = new Set<OpportunityStatus>(["rejected", "withdrawn", "closed", "offer"]);

function effectiveObservationText(observation: CoachObservation): string {
  return observation.reviewState === "corrected" && observation.userCorrection?.trim()
    ? observation.userCorrection.trim()
    : observation.claim.trim();
}

function daysUntil(value: string, now: Date): number {
  return (new Date(value).getTime() - now.getTime()) / 86_400_000;
}
```

Implement the spec precedence exactly:

```text
1 upcoming interview <= 7 days
2 any interviewing opportunity
3 confirmed/corrected observation importance >= .6
4 applied/interviewing + zero confirmed stories
5 weakest/recurring progress signal
6 applied opportunity
7 zero completed sessions
8 full-simulation fallback
```

Sort competing upcoming interviews by earliest `nextInterviewAt`. Sort competing opportunities deterministically by status urgency then `updatedAt` descending. Do not use `Math.random()` or current global time.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- src/lib/practice-recommendation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/practice-recommendation.ts src/lib/practice-recommendation.test.ts
git commit -m "feat: add baseline practice recommendation"
```

---

### Task 2: Add a separate short planned-conversation persistence contract

**Files:**
- Create: `supabase/migrations/202608310001_planned_practice_sessions.sql`
- Modify: `src/lib/repositories/interviews.ts`
- Modify: `src/lib/repositories/interviews.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Keeps existing:

```ts
createSessionWithBlueprint(supabase, userId, blueprint): Promise<InterviewSession>
```

with exact five-question behavior.

- Produces:

```ts
export type PracticeSessionContext = {
  practicePlanId: string;
  opportunityId: string | null;
};

export function assertPracticeConversationBlueprint(blueprint: InterviewBlueprint): void;

export async function createSessionWithPracticeBlueprint(
  supabase: SupabaseClient,
  userId: string,
  blueprint: InterviewBlueprint,
  context: PracticeSessionContext,
): Promise<InterviewSession>;
```

- [ ] **Step 1: Write failing repository validation tests**

Add tests proving:

```ts
it("accepts a three-question planned conversation without weakening the generic backbone", () => {
  expect(() => assertPracticeConversationBlueprint(practiceBlueprint(3))).not.toThrow();
  expect(() => assertConversationPlan(practiceBlueprint(3).questions)).toThrow();
});

it("rejects zero or more than five planned base questions", () => {
  expect(() => assertPracticeConversationBlueprint(practiceBlueprint(0))).toThrow();
  expect(() => assertPracticeConversationBlueprint(practiceBlueprint(6))).toThrow();
});

it("uses the planned-session RPC with owned context", async () => {
  await createSessionWithPracticeBlueprint(supabase as never, "user-1", practiceBlueprint(3), {
    practicePlanId: "plan-1",
    opportunityId: "opp-1",
  });

  expect(rpc).toHaveBeenCalledWith(
    "create_planned_conversation_session_with_blueprint",
    expect.objectContaining({
      p_practice_plan_id: "plan-1",
      p_opportunity_id: "opp-1",
    }),
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npm test -- src/lib/repositories/interviews.test.ts
```

Expected: FAIL on the new interfaces.

- [ ] **Step 3: Add `PracticeSessionContext` and update blueprint comments/types**

In `src/lib/types.ts`, change documentation that currently describes `InterviewBlueprint` as inherently five-question. Keep its shape, but document that generic interviews use five base questions while plan-driven practice can use 1–5.

Do not rename the type in this release; that would create unnecessary churn through the existing coach/interview code.

- [ ] **Step 4: Implement TypeScript validation and RPC wrapper**

`assertPracticeConversationBlueprint` must require:

```ts
if (blueprint.questions.length < 1 || blueprint.questions.length > 5) {
  throw new RepositoryError("Planned practice must contain between one and five base questions.", "INVALID_PLAN");
}
for (let index = 0; index < blueprint.questions.length; index += 1) {
  if (blueprint.questions[index].sequence !== index + 1 || blueprint.questions[index].isFollowUp) {
    throw new RepositoryError("Planned practice questions must be contiguous base questions.", "INVALID_PLAN");
  }
}
```

Then map the same persisted blueprint fields used by `createSessionWithBlueprint` into the new RPC payload.

- [ ] **Step 5: Create `202608310001_planned_practice_sessions.sql`**

The migration must first widen only the session metadata check:

```sql
alter table public.interview_sessions
  drop constraint if exists interview_sessions_blueprint_max_questions_check;

alter table public.interview_sessions
  add constraint interview_sessions_blueprint_max_questions_check
  check (blueprint_max_questions between 1 and 8);
```

Do **not** change `create_conversation_session_with_blueprint`; it must still enforce five base questions and its own `greatest(5, ...)` behavior.

Create:

```sql
public.create_planned_conversation_session_with_blueprint(
  p_blueprint jsonb,
  p_practice_plan_id uuid,
  p_opportunity_id uuid default null
)
returns table(session_id uuid)
```

The function must be `security invoker`, derive `v_user_id := auth.uid()`, and enforce:

1. authenticated user;
2. owned practice plan exists and status is `ready`;
3. question array length 1–5;
4. contiguous sequences 1..N;
5. valid existing category/difficulty/follow-up constraints;
6. if `p_opportunity_id` is non-null, it is owned and linked to the plan;
7. if the plan has a primary opportunity, a supplied opportunity must equal it;
8. insert the session with `practice_plan_id` and `opportunity_id` immediately;
9. insert base questions;
10. set the plan status to `started` in the same transaction;
11. return the session ID.

Use the plan's current status row `for update` so two start requests cannot create two sessions from the same `ready` plan.

- [ ] **Step 6: Verify migration invariants on disposable Supabase**

Run:

```bash
supabase db push
```

Then verify:

```text
- old five-question RPC still rejects 3-question input;
- new RPC accepts 1, 3, and 5 contiguous base questions;
- new RPC rejects 0 and 6;
- new RPC rejects non-owned plan/opportunity;
- new RPC rejects mismatched plan/opportunity;
- new RPC writes practice_plan_id/opportunity_id at session creation;
- plan becomes started in the same transaction;
- repeated start of the same plan is rejected.
```

- [ ] **Step 7: Run repository tests and verify GREEN**

```bash
npm test -- src/lib/repositories/interviews.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202608310001_planned_practice_sessions.sql src/lib/types.ts src/lib/repositories/interviews.ts src/lib/repositories/interviews.test.ts
git commit -m "feat: add short planned conversation sessions"
```

---

### Task 3: Generate practice-plan-specific blueprints without changing recommendation selection

**Files:**
- Modify: `src/lib/coach.ts`
- Modify: `src/lib/coach.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces:

```ts
export type PracticeBlueprintContext = {
  primaryOpportunity: Opportunity | null;
  supportingOpportunities: Opportunity[];
  observations: CoachObservation[];
  stories: CareerStory[];
};

export async function generatePracticeBlueprint(
  profile: Profile,
  evidence: EvidenceItem[],
  plan: PracticePlan,
  context: PracticeBlueprintContext,
): Promise<InterviewBlueprint>;
```

- [ ] **Step 1: Write failing practice blueprint tests**

Add deterministic/demo-provider tests for format question counts and context grounding.

```ts
it.each([
  ["targeted_drill", 3],
  ["story_work", 3],
  ["self_presentation", 2],
  ["behavioral", 3],
  ["technical_communication", 3],
  ["role_prep", 4],
  ["full_simulation", 5],
] as const)("generates %s with %d base questions", async (format, expectedCount) => {
  const blueprint = await generatePracticeBlueprint(
    profile,
    evidence,
    { ...plan, format },
    context,
  );
  expect(blueprint.questions).toHaveLength(expectedCount);
});
```

Also assert role-prep prompt construction may mention job requirements but expected candidate evidence IDs still come only from supplied profile evidence.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- src/lib/coach.test.ts
```

- [ ] **Step 3: Add format question-count helper**

Inside `coach.ts` or a focused adjacent helper:

```ts
function baseQuestionCountFor(format: PracticeFormat): number {
  switch (format) {
    case "self_presentation": return 2;
    case "role_prep": return 4;
    case "full_simulation": return 5;
    case "hands_on": return 0;
    default: return 3;
  }
}
```

`hands_on` must never call `generatePracticeBlueprint`; the practice service dispatches it separately.

- [ ] **Step 4: Implement grounded practice blueprint generation**

Reuse existing structured-generation/provider conventions from `generateInterviewBlueprint`, but give the model the persisted plan as the contract:

```text
Primary focus: <plan.primaryFocus>
Secondary focus: <plan.secondaryFocus>
Format: <plan.format>
Success criteria: <plan.successCriteria>
Question count: <exact count>
```

Include relevant opportunity description/context separately from candidate evidence. Prompt rules must explicitly state:

```text
- Job requirements shape what to probe.
- They are not evidence that the candidate has done those things.
- Candidate factual claims must be grounded only in supplied profile evidence or confirmed story content.
- Do not invent company interview process facts.
```

Use current fallback/demo behavior to return a deterministic plan-specific blueprint when the live provider is unavailable.

- [ ] **Step 5: Ensure `nextTurn` works with variable base-question arrays**

Add a coach test with a 2- or 3-question `InterviewBlueprint` and verify `nextTurn` can evaluate the current question and advance/follow up without assuming the generic five-category backbone.

If `nextTurn` has a hidden five-question assumption, remove only that assumption; do not change existing follow-up rubric/evaluation semantics.

- [ ] **Step 6: Run coach tests and verify GREEN**

```bash
npm test -- src/lib/coach.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/coach.ts src/lib/coach.test.ts
git commit -m "feat: generate plan-specific practice blueprints"
```

---

### Task 4: Add the practice orchestration service and authenticated practice API

**Files:**
- Create: `src/lib/practice-service.ts`
- Create: `src/lib/practice-service.test.ts`
- Create: `src/app/api/practice/route.ts`
- Create: `src/app/api/practice/route.test.ts`
- Modify: `src/lib/repositories/practice-plans.ts`
- Modify: `src/app/api/interview/route.ts`

**Interfaces:**
- Produces:

```ts
export type ManualPracticeRequest = {
  format: PracticeFormat;
  primaryFocus: string;
  secondaryFocus?: string | null;
  estimatedMinutes?: number | null;
  successCriteria?: string[];
  primaryOpportunityId?: string | null;
};

export async function startRecommendedPractice(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<{ plan: PracticePlan; session: InterviewSession }>;

export async function startManualPractice(
  supabase: SupabaseClient,
  userId: string,
  request: ManualPracticeRequest,
): Promise<{ plan: PracticePlan; session: InterviewSession }>;

export async function completeLinkedPracticePlanBestEffort(
  supabase: SupabaseClient,
  userId: string,
  session: InterviewSession,
): Promise<{ warning: string | null }>;
```

- [ ] **Step 1: Write failing orchestration tests**

Mock repositories/coach functions and assert:

```ts
it("recomputes the recommendation server-side before persisting a plan", async () => {
  await startRecommendedPractice(supabase as never, "user-1", new Date("2026-08-31T08:00:00Z"));
  expect(recommendPracticeMock).toHaveBeenCalled();
  expect(createPracticePlanMock).toHaveBeenCalledWith(
    expect.anything(),
    "user-1",
    expect.objectContaining({ status: "ready" }),
  );
});

it("does not roll back a completed interview when plan completion fails", async () => {
  updatePracticePlanMock.mockRejectedValue(new Error("plan write failed"));
  await expect(completeLinkedPracticePlanBestEffort(supabase as never, "user-1", completedSession))
    .resolves.toEqual({ warning: expect.stringContaining("practice plan") });
});
```

Add separate dispatch tests for conversational and `hands_on` formats.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- src/lib/practice-service.test.ts
```

- [ ] **Step 3: Implement context loading and plan creation**

The service must load:

```text
profile
recent sessions/progress
opportunities
observations
stories
recent practice plans
```

Use `recommendPractice` only for recommended start.

Create the plan with:

```ts
{
  status: "ready",
  primaryFocus: recommendation.primaryFocus,
  secondaryFocus: recommendation.secondaryFocus,
  rationale: recommendation.rationale,
  format: recommendation.format,
  estimatedMinutes: recommendation.estimatedMinutes,
  successCriteria: recommendation.successCriteria,
}
```

Then set primary/supporting opportunity links before creating the session.

- [ ] **Step 4: Dispatch plan delivery**

For non-hands-on formats:

1. call `generatePracticeBlueprint`;
2. call `createSessionWithPracticeBlueprint` — the DB transaction also marks the plan started;
3. reload/return the plan after session creation.

For `hands_on`, do **not** use the old unlinked client flow. Add a narrowly scoped server helper/RPC path so the session is created with `practice_plan_id`/`opportunity_id` and the plan becomes started in one transactional operation. Add this SQL function to `202608310001_planned_practice_sessions.sql` in Task 2 if implementation reaches this step before the migration is merged:

```sql
start_hands_on_practice_session(
  p_practice_plan_id uuid,
  p_opportunity_id uuid,
  p_exercise jsonb
)
returns table(session_id uuid)
```

Use the same ownership/link/status checks as planned conversation sessions.

Add repository wrapper:

```ts
createHandsOnPracticeSession(supabase, userId, exercise, context): Promise<InterviewSession>
```

and focused repository tests before calling it from the service.

- [ ] **Step 5: Mark failed generation safely**

If plan creation succeeds but blueprint/exercise generation or session creation fails before a session exists:

```ts
await updatePracticePlan(supabase, userId, plan.id, {
  status: "failed",
  generationError: userSafeGenerationFailure(error),
});
throw error;
```

Do not return a started practice with no session.

- [ ] **Step 6: Modify interview completion to complete linked plans best-effort**

In `/api/interview/route.ts`, after the existing conversation/hands-on completion has successfully persisted the completed session, call:

```ts
const { warning } = await completeLinkedPracticePlanBestEffort(supabase, user.id, completed);
```

Return the completed interview normally. If `warning` is non-null, include a non-fatal field such as:

```ts
{ session, profile, practicePlanWarning: warning }
```

Log the failure server-side. Do not turn it into HTTP 500 after interview evidence has already been safely completed.

- [ ] **Step 7: Replace the fixed completion guard only for linked planned conversations**

Extract a helper in the interview route or repository test seam:

```ts
function canExplicitlyCompleteConversation(session: InterviewSession): boolean {
  if (!session.practicePlanId) {
    return session.questions.filter((question) => question.answer).length >= 5;
  }
  return session.questions
    .filter((question) => !question.isFollowUp)
    .every((question) => Boolean(question.answer));
}
```

Keep generic conversation behavior unchanged.

- [ ] **Step 8: Implement `/api/practice`**

GET:

- authenticate;
- return current recommendation preview plus recent plans.

POST:

```json
{ "action": "start_recommended" }
```

or

```json
{
  "action": "start_manual",
  "format": "targeted_drill",
  "primaryFocus": "Architecture decision framing",
  "estimatedMinutes": 12,
  "primaryOpportunityId": "..."
}
```

Validate strings/format/minutes server-side. Never accept a persisted recommendation object from the browser for `start_recommended`.

- [ ] **Step 9: Write route tests and run service/route tests GREEN**

```bash
npm test -- src/lib/practice-service.test.ts src/app/api/practice/route.test.ts src/app/api/interview/route.test.ts
```

If `src/app/api/interview/route.test.ts` does not exist, add focused route tests in the repository's current mocking style for the changed completion branches rather than leaving the new behavior untested.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/202608310001_planned_practice_sessions.sql src/lib/practice-service.ts src/lib/practice-service.test.ts src/lib/repositories/practice-plans.ts src/lib/repositories/interviews.ts src/lib/repositories/interviews.test.ts src/app/api/practice src/app/api/interview/route.ts
git commit -m "feat: orchestrate persisted recommended practice"
```

---

### Task 5: Add Career Dashboard and coach-memory evidence read models

**Files:**
- Create: `src/lib/coach-memory.ts`
- Create: `src/lib/coach-memory.test.ts`
- Create: `src/lib/career-dashboard.ts`
- Create: `src/lib/career-dashboard.test.ts`
- Create: `src/app/api/career/dashboard/route.ts`
- Create: `src/app/api/career/dashboard/route.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces:

```ts
export type CoachEvidenceDisplay = {
  kind: "profile_evidence" | "question_evaluation" | "career_story" | "opportunity_event";
  label: string;
  summary: string;
  role: ObservationEvidenceRole;
  reason: string | null;
};

export type CoachObservationSummary = CoachObservation & {
  effectiveText: string;
  evidence: CoachEvidenceDisplay[];
};

export type CareerStorySummary = CareerStory & {
  evidenceCount: number;
};

export type CareerDashboard = {
  profile: Profile;
  progress: ProgressSnapshot;
  recentSessions: InterviewSession[];
  opportunities: Opportunity[];
  upcomingOpportunities: Opportunity[];
  observations: CoachObservationSummary[];
  stories: CareerStorySummary[];
  recentPracticePlans: PracticePlan[];
  recommendation: PracticeRecommendation;
};

export async function loadCareerDashboard(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<CareerDashboard>;
```

- [ ] **Step 1: Write failing coach-memory resolver tests**

Mock typed evidence links and source rows. Assert:

```ts
expect(resolveObservationEvidence(...)).resolves.toEqual(expect.arrayContaining([
  expect.objectContaining({
    kind: "question_evaluation",
    label: expect.stringContaining("architecture"),
    role: "supporting",
  }),
]));
```

For corrected observations assert `effectiveText === userCorrection`; for confirmed/unreviewed use `claim`; dismissed remains resolvable for history but will be filtered from active Home summaries.

- [ ] **Step 2: Implement `coach-memory.ts`**

Resolve evidence IDs server-side by source kind. Query only the authenticated user's rows. Build concise labels/summaries; do not expose raw full CV text unless the linked `profile_evidence.sourceExcerpt` itself is the supporting evidence.

- [ ] **Step 3: Write failing dashboard aggregation tests**

Assert:

```ts
it("returns active opportunity urgency, active observations, story summary, progress, and recommendation", async () => {
  const dashboard = await loadCareerDashboard(supabase as never, "user-1", now);
  expect(dashboard.recommendation).toBeDefined();
  expect(dashboard.upcomingOpportunities[0].nextInterviewAt).toBeTruthy();
  expect(dashboard.observations.every((item) => item.reviewState !== "dismissed")).toBe(true);
});
```

- [ ] **Step 4: Implement `career-dashboard.ts`**

Load independent repositories in parallel where safe:

```ts
const [profile, sessions, opportunities, observations, stories, plans] = await Promise.all([...]);
```

Calculate progress from completed sessions using existing `calculateProgress`. Resolve observation evidence. Build `upcomingOpportunities` from applied/interviewing non-terminal rows with future interview dates sorted ascending. Call `recommendPractice` with explicit `now`.

If the user has no profile, throw/use a stable domain error that the API maps to 400 rather than returning a malformed dashboard.

- [ ] **Step 5: Implement `GET /api/career/dashboard`**

Use `requireUser()`. Return the `CareerDashboard` plus the current demo/live provider indicator if the current shell still needs it; alternatively keep provider-mode loading through the existing profile route until shell refactor Task 8. Do not duplicate Career Brain aggregation in the client.

- [ ] **Step 6: Run focused tests GREEN**

```bash
npm test -- src/lib/coach-memory.test.ts src/lib/career-dashboard.test.ts src/app/api/career/dashboard/route.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/coach-memory.ts src/lib/coach-memory.test.ts src/lib/career-dashboard.ts src/lib/career-dashboard.test.ts src/app/api/career/dashboard
git commit -m "feat: add Career Brain dashboard read model"
```

---

### Task 6: Add authenticated Opportunity management API

**Files:**
- Create: `src/app/api/opportunities/route.ts`
- Create: `src/app/api/opportunities/route.test.ts`

**Interfaces:**
- GET returns:

```ts
{ opportunities: Opportunity[] }
```

- POST actions:

```text
create
update
transition
schedule_interview
add_note
```

- [ ] **Step 1: Write failing route tests for lifecycle-safe mutations**

Required cases:

```ts
it("creates an already-applied opportunity by creating then transitioning", async () => {
  await POST(request({
    action: "create",
    company: "Example",
    role: "Senior Frontend Engineer",
    initialStatus: "applied",
  }));

  expect(createOpportunityMock).toHaveBeenCalled();
  expect(transitionOpportunityMock).toHaveBeenCalledWith(
    expect.anything(),
    "user-1",
    "opp-1",
    "applied",
    expect.anything(),
  );
  expect(updateOpportunityDetailsMock).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ status: expect.anything() }),
  );
});
```

Also test unauthenticated 401, invalid status 400, non-owned 404, and scheduling calls `scheduleOpportunityInterview`.

- [ ] **Step 2: Implement input parsers**

Use explicit helper parsing rather than casting request JSON:

```ts
function optionalString(body: Record<string, unknown>, key: string): string | null | undefined { ... }
function requiredString(...): string { ... }
function parseOpportunityStatus(value: unknown): OpportunityStatus { ... }
```

Reject invalid match scores outside 0–100 and invalid interview timestamps.

- [ ] **Step 3: Implement GET/POST actions**

`add_note` should append an `opportunity_events` `note` event through an existing/new repository method rather than overwriting the history. If Release 1 lacks a public `addOpportunityNote`, add it in `src/lib/repositories/opportunities.ts` with a focused repository test and an authenticated small RPC/insert path consistent with append-only event policies.

Do not expose event update/delete.

- [ ] **Step 4: Run route tests GREEN**

```bash
npm test -- src/app/api/opportunities/route.test.ts src/lib/repositories/opportunities.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/opportunities src/lib/repositories/opportunities.ts src/lib/repositories/opportunities.test.ts
git commit -m "feat: expose application lifecycle API"
```

---

### Task 7: Add Story and Coach-memory review APIs plus deterministic story completeness

**Files:**
- Create: `src/app/api/stories/route.ts`
- Create: `src/app/api/stories/route.test.ts`
- Create: `src/app/api/observations/route.ts`
- Create: `src/app/api/observations/route.test.ts`
- Modify: `src/lib/types.ts`
- Modify or create a focused helper file: `src/lib/career-story.ts`
- Test: `src/lib/career-story.test.ts`

**Interfaces:**
- Produces:

```ts
export type CareerStoryDraftFields = Pick<
  CareerStory,
  "situation" | "responsibility" | "problem" | "actions" | "alternatives" |
  "tradeoffs" | "ownership" | "outcome" | "lessons"
>;

export function careerStoryCompleteness(story: CareerStoryDraftFields): number;
```

- [ ] **Step 1: Write failing completeness tests**

Cover six dimensions:

```text
context/problem
responsibility/ownership
actions/decisions
tradeoff/alternative
outcome
lesson/reflection
```

Example:

```ts
it("scores factual structure without pretending to score delivery quality", () => {
  expect(careerStoryCompleteness({
    situation: "Checkout migration",
    problem: "Large bundle",
    responsibility: "I led the frontend work",
    ownership: null,
    actions: "Split routes",
    alternatives: null,
    tradeoffs: "More chunks vs caching complexity",
    outcome: "28% smaller bundle",
    lessons: "Measure route-level impact earlier",
  })).toBe(1);
});
```

- [ ] **Step 2: Implement completeness helper**

Return `coveredDimensions / 6`. Never inspect style, eloquence, STAR structure quality, or model scores.

- [ ] **Step 3: Write Story route tests**

POST actions:

```text
create
update
confirm
retire
attach_profile_evidence
```

For create/update, compute completeness server-side from factual fields and ignore any browser-supplied completeness number.

`confirm` sets `reviewState: "confirmed"` and `confirmedAt` to server time; `retire` sets `reviewState: "retired"`.

`attach_profile_evidence` calls the typed repository source:

```ts
{ kind: "profile_evidence", profileEvidenceId }
```

- [ ] **Step 4: Implement Story route**

GET returns stories and their provenance summaries or evidence counts. Use repositories only; no direct browser table knowledge.

- [ ] **Step 5: Write Observation route tests**

Only allow:

```text
confirm
correct
dismiss
```

Test that no `create` action exists and that correction requires non-empty replacement text.

- [ ] **Step 6: Implement Observation route**

Call `reviewCoachObservation` with typed review objects. GET may return active/history groups with resolved evidence from `coach-memory.ts`.

- [ ] **Step 7: Run focused tests GREEN**

```bash
npm test -- src/lib/career-story.test.ts src/app/api/stories/route.test.ts src/app/api/observations/route.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/career-story.ts src/lib/career-story.test.ts src/app/api/stories src/app/api/observations
git commit -m "feat: expose stories and coach memory review"
```

---

### Task 8: Extract a typed client shell and API client without changing existing behavior

**Files:**
- Create: `src/app/api-client.ts`
- Create: `src/app/relay-shell.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx`

**Interfaces:**
- `page.tsx` becomes approximately:

```tsx
import { RelayShell } from "@/app/relay-shell";

export default function App() {
  return <RelayShell />;
}
```

- `api-client.ts` produces typed functions such as:

```ts
export async function getCareerDashboard(): Promise<CareerDashboard>;
export async function mutateOpportunity(...): Promise<...>;
export async function mutateStory(...): Promise<...>;
export async function reviewObservation(...): Promise<...>;
export async function startRecommendedPractice(): Promise<{ plan: PracticePlan; session: InterviewSession }>;
export async function startManualPractice(input: ManualPracticeRequest): Promise<...>;
```

- [ ] **Step 1: Freeze existing page behavior with tests before extraction**

Run current page tests first:

```bash
npm test -- src/app/page.test.tsx
```

Add any missing regression assertion needed to preserve:

```text
sign in/out
profile onboarding/review
manual conversation start
hands-on start
voice/transcription behavior
results/progress rendering
```

Do not rewrite expectations for new Release 2 behavior yet.

- [ ] **Step 2: Extract the generic API helper**

Move `ApiError` and JSON `api<T>` logic into `api-client.ts`. Add small unit tests if the current page tests cannot cover 401/500 parsing reliably.

- [ ] **Step 3: Extract `RelayShell` with no product redesign yet**

Move current state/effects/handlers/render tree from `page.tsx` to `relay-shell.tsx`. Keep existing `View` values initially. Confirm tests pass before adding new views.

- [ ] **Step 4: Run page tests GREEN after pure extraction**

```bash
npm test -- src/app/page.test.tsx
```

Expected: existing tests pass with no product behavior changes.

- [ ] **Step 5: Commit pure refactor**

```bash
git add src/app/page.tsx src/app/page.test.tsx src/app/relay-shell.tsx src/app/api-client.ts
git commit -m "refactor: split Relay client shell"
```

---

### Task 9: Build Home command center and Applications view

**Files:**
- Create: `src/app/views/home-view.tsx`
- Create: `src/app/views/home-view.test.tsx`
- Create: `src/app/views/applications-view.tsx`
- Create: `src/app/views/applications-view.test.tsx`
- Modify: `src/app/relay-shell.tsx`
- Modify: `src/app/page.test.tsx`

**Interfaces:**
- `HomeView` props:

```ts
type HomeViewProps = {
  dashboard: CareerDashboard;
  busy: boolean;
  onStartRecommended: () => Promise<void>;
  onOpenApplications: () => void;
  onOpenStories: () => void;
  onOpenCoach: () => void;
  onOpenProgress: () => void;
};
```

- `ApplicationsView` receives current opportunities and mutation callbacks; it does not call Supabase directly.

- [ ] **Step 1: Write failing Home view tests**

Required tests:

```tsx
it("makes recommended practice the dominant home action", () => {
  render(<HomeView dashboard={dashboard} ... />);
  expect(screen.getByRole("button", { name: /start recommended practice/i })).toBeVisible();
  expect(screen.getByText(dashboard.recommendation.rationale)).toBeVisible();
});

it("shows honest empty states for Career Brain data", () => {
  render(<HomeView dashboard={{ ...dashboard, opportunities: [], stories: [], observations: [] }} ... />);
  expect(screen.getByText(/add an application/i)).toBeVisible();
  expect(screen.getByText(/story bank/i)).toBeVisible();
});
```

- [ ] **Step 2: Implement Home view**

Required visual order:

```text
Recommended practice card
Applications needing attention
What Relay is noticing
Story bank summary
Progress summary
```

The recommendation card shows format, minutes, rationale, up to three signals, success criteria preview, and primary opportunity label if present.

If profile readiness is false, disable/replace the start CTA with a profile-evidence action rather than making a request known to fail.

- [ ] **Step 3: Write failing Applications tests**

Cover:

```text
create considering
create already applied
edit details
transition status
schedule interview
show lifecycle history
filter terminal vs active
```

Use callback mocks; do not mock Supabase.

- [ ] **Step 4: Implement Applications view**

Use mobile-first cards/list plus selected detail/editor. Keep destructive terminal actions explicit. Show job description in a collapsible/detail section rather than flooding the list.

Interview scheduling UI passes the actual future timestamp to the API; event history can display `occurredAt` as “recorded” time and `nextInterviewAt` as the actual appointment.

- [ ] **Step 5: Wire the shell to Career Dashboard and mutations**

After auth/profile readiness, load `/api/career/dashboard` instead of building new Career Brain state through direct client joins.

Add `applications` to `View` and navigation. On successful opportunity mutation, refresh the dashboard from the server so recommendation/application summaries remain consistent.

Starting recommended practice calls `/api/practice` `start_recommended`, stores returned session, clears answer/checkpoint state, and navigates to `interview`.

- [ ] **Step 6: Run view + page tests GREEN**

```bash
npm test -- src/app/views/home-view.test.tsx src/app/views/applications-view.test.tsx src/app/page.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add src/app/views/home-view.tsx src/app/views/home-view.test.tsx src/app/views/applications-view.tsx src/app/views/applications-view.test.tsx src/app/relay-shell.tsx src/app/page.test.tsx
git commit -m "feat: add preparation command center"
```

---

### Task 10: Build Stories, Coach, and manual Practice views

**Files:**
- Create: `src/app/views/stories-view.tsx`
- Create: `src/app/views/stories-view.test.tsx`
- Create: `src/app/views/coach-view.tsx`
- Create: `src/app/views/coach-view.test.tsx`
- Create: `src/app/views/practice-view.tsx`
- Create: `src/app/views/practice-view.test.tsx`
- Modify: `src/app/relay-shell.tsx`
- Modify: `src/app/page.test.tsx`

**Interfaces:**
- New top-level `View` values:

```text
stories
coach
practice
```

`practice` now means manual override/history, not the primary recommended entry.

- [ ] **Step 1: Write failing Stories UI tests**

Cover:

```tsx
create/edit structured fields
show completeness separately from delivery language
confirm
retire
show provenance/evidence count
attach profile evidence
```

Test copy must never describe `completeness` as “answer quality” or a score of interview performance.

- [ ] **Step 2: Implement Stories view**

Use a story list and editor. Structured field groups should mirror the domain:

```text
Situation/context
Responsibility/problem
Actions/decisions
Alternatives/tradeoffs
Ownership
Outcome
Lessons
Tags
```

Show completeness as `N of 6 factual dimensions covered` or equivalent, not a gamified score.

- [ ] **Step 3: Write failing Coach view tests**

Required cases:

```tsx
shows corrected user text as effective guidance
shows original claim in details/history
shows evidence under Why does Relay think this?
confirm action
dismiss action
correction requires replacement text
dismissed observations are excluded from default active list
honest no-observations empty state
```

- [ ] **Step 4: Implement Coach view**

Keep confidence/importance secondary. The main UX is claim/effective guidance, evidence, trend, review actions.

Do not add “new observation” UI.

- [ ] **Step 5: Write failing Practice view tests**

Cover:

```text
current recommendation summary
manual format/focus form
optional opportunity selector
recent practice plans/sessions
hands-on option
```

- [ ] **Step 6: Implement Practice view and manual start**

Manual form maps to `/api/practice` `start_manual` and then uses the same returned `{ plan, session }` behavior as recommended start.

Keep format choices human-readable:

```text
Focused drill
Story work
Self-presentation
Behavioral
Technical communication
Role prep
Full simulation
Hands-on
```

- [ ] **Step 7: Wire navigation and shared refresh**

Top-level primary navigation becomes:

```text
Home
Applications
Practice
Stories
Coach
Profile
```

Keep Progress reachable from Home, and keep interview/results transient.

After Story or Observation mutations, refresh dashboard data so Home recommendation and summaries update from canonical server state.

- [ ] **Step 8: Run UI tests GREEN**

```bash
npm test -- src/app/views/stories-view.test.tsx src/app/views/coach-view.test.tsx src/app/views/practice-view.test.tsx src/app/page.test.tsx
```

- [ ] **Step 9: Commit**

```bash
git add src/app/views/stories-view.tsx src/app/views/stories-view.test.tsx src/app/views/coach-view.tsx src/app/views/coach-view.test.tsx src/app/views/practice-view.tsx src/app/views/practice-view.test.tsx src/app/relay-shell.tsx src/app/page.test.tsx
git commit -m "feat: add stories coach and manual practice views"
```

---

### Task 11: Verify short-practice completion, legacy interview compatibility, and full Release 2 regression

**Files:**
- Modify: `README.md`
- Test: all test files
- Verify: `202608310001_planned_practice_sessions.sql` on disposable/development Supabase

**Interfaces:**
- Produces no new runtime interface.
- Documents the Release 2 product boundary accurately.

- [ ] **Step 1: Add integration-style test cases around the full planned conversation lifecycle**

Using repository/service mocks or the strongest existing test harness, cover:

```text
recommendation -> ready plan -> 3-question planned session -> linked context
answers/followups -> completion -> session complete -> plan complete
```

Also cover:

```text
generic manual conversation still requires/exposes five backbone questions
legacy sessions with null practicePlanId/opportunityId still hydrate
plan completion failure after session completion returns non-fatal warning
```

- [ ] **Step 2: Run complete test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run production build**

```bash
npx next build --webpack
```

Expected: PASS.

- [ ] **Step 5: Verify database behavior on disposable/development Supabase**

Apply migrations:

```bash
supabase db push
```

Manually verify:

```text
1. Existing create_conversation_session_with_blueprint still requires exact 5-question backbone.
2. Planned RPC accepts 1–5 contiguous base questions.
3. Planned RPC creates session context and marks ready plan started atomically.
4. Started plan cannot be started a second time.
5. Cross-user plan/opportunity context is rejected.
6. Existing sessions remain valid with null Career Brain context.
```

- [ ] **Step 6: Perform user-flow smoke test against deployed/development app**

Use one real authenticated account and verify:

```text
Home -> recommendation explanation visible
Add already-applied application -> Home refresh reflects it
Schedule interview -> role prep becomes recommendation when due within 7 days
Create/confirm story -> story summary updates
Review/correct/dismiss observation fixture if observations exist
Start recommended 2/3/4-question practice -> complete it
Manual full simulation -> still five base questions
Manual hands-on -> still works
```

Do not seed fake durable observations into production merely for the smoke test; use development data or skip observation mutation if none exist.

- [ ] **Step 7: Update README accurately**

Replace/extend current product-boundary bullets with concise statements such as:

```md
- Career Brain command center with application tracking, story bank, inspectable coach memory, and explainable recommended practice.
- Recommended practice currently uses deterministic explicit Career Brain/progress signals; automatic observation learning and richer adaptive prioritization arrive in the next release.
- The external job-hunter bot is still independent and has not yet been migrated to Supabase.
```

Do not claim automatic learning exists yet.

- [ ] **Step 8: Final diff boundary check**

Verify no files outside `interviewer-app` or job-hunter integration/configuration were changed. Search for accidental service-role secret usage and direct browser `.from("opportunities")`/Career Brain table writes.

- [ ] **Step 9: Final verification after documentation commit**

```bash
npm test && npm run lint && npx next build --webpack
```

Expected: all commands succeed.

- [ ] **Step 10: Commit**

```bash
git add README.md src
# include migration only if it was adjusted during final verification
git commit -m "docs: describe Relay command center"
```

## Completion Gate

Do not mark Release 2 complete unless all of these are demonstrably true:

- Home's dominant action is recommended practice with an explanation.
- Baseline recommendation is deterministic and fully unit tested.
- Upcoming interviews/applications affect recommendations.
- Reviewed/corrected/dismissed observations are respected; unreviewed observations do not silently control the recommendation.
- Applications can be created, edited, transitioned, scheduled, and viewed with history.
- Stories can be created, edited, confirmed, retired, and shown with factual completeness/provenance.
- Coach observations can be inspected with evidence and Confirm/Correct/Dismiss works.
- Recommended/manual practice persists a `PracticePlan` and links the resulting session.
- Plan-driven conversation supports 1–5 base questions.
- Existing generic manual conversation remains exact five-question backbone.
- Hands-on remains functional and can carry practice-plan context.
- Completed interview evidence survives post-session plan bookkeeping failures.
- Existing onboarding/profile/history/progress functionality still works.
- Empty Career Brain tables remain a valid usable state.
- No automatic observation extraction/reconciliation has been added.
- No Google Tracker sync/import has been added.
- No job-hunter migration/change has been added.
