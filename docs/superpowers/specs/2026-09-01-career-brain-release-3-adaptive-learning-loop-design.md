# Career Brain Release 3 — Adaptive Learning Loop Design

Date: 2026-09-01
Status: Approved product direction; implementation plan follows this written spec
Depends on:
- `docs/superpowers/specs/2026-08-30-career-brain-architecture-design.md`
- `docs/superpowers/specs/2026-08-30-career-brain-release-1-foundation-design.md`
- `docs/superpowers/specs/2026-08-31-career-brain-release-2-relay-rework-design.md`

## 1. Purpose

Release 3 makes Relay actually learn from practice.

Release 2 can already choose an explainable practice from explicit Career Brain data, applications, reviewed observations, stories, and progress. What it does not yet do is turn a completed answer into durable coaching memory automatically.

Release 3 closes that loop:

```text
practice
  -> answer/evaluation evidence
  -> structured learning signals
  -> deterministic observation reconciliation
  -> confidence/trend/recurrence update
  -> next recommendation changes
```

The release succeeds when repeated behavior in real practice changes Relay's future training priorities without requiring the user to manually create every observation, while user Confirm / Correct / Dismiss decisions remain authoritative.

## 2. Product principles

### 2.1 The model interprets; application logic decides memory

Gemini may identify a structured signal such as:

> This answer showed a recurring problem with trade-off reasoning.

Gemini must not decide whether to create a duplicate observation, overwrite a correction, reactivate a dismissed observation, set confidence, set trend, or choose the next practice target.

Those are deterministic application decisions.

### 2.2 One answer is evidence, not a personality trait

A single weak answer may create a tentative observation, but an unreviewed tentative observation does not automatically control training.

An automatic observation becomes established only after repeated supporting evidence across distinct completed sessions. A user can make it actionable earlier by confirming or correcting it.

### 2.3 User review outranks automatic learning

- `confirmed`: the user agrees with the observation.
- `corrected`: the user's wording is the effective coaching guidance; automatic learning never overwrites it.
- `dismissed`: the observation is excluded from recommendations and default active memory.

New evidence may be attached to a dismissed observation, but the system must never silently reactivate it. Sufficient new evidence may mark it `needsReview`, asking the user to reconsider explicitly.

### 2.4 Evidence is permanent; aggregate interpretation can evolve

`observation_evidence` remains append-oriented. A later strong answer does not delete the earlier weak answer; it becomes contradicting evidence. Confidence and trend are recomputed from the full evidence history.

### 2.5 Candidate facts stay grounded

Job descriptions, recommendation rationale, and model inference are not evidence that the candidate did something.

Observation extraction may use:
- the actual question;
- the candidate's actual answer/checkpoint;
- the persisted evaluation;
- the persisted rubric/objective;
- confirmed career-story text when relevant;
- linked opportunity context to understand relevance.

It must not invent career facts.

## 3. Approaches considered

### 3.1 Pure deterministic extraction from scores

Use evaluation dimensions and `needsWork`/`strengths` directly with no additional model call.

Pros: cheap, predictable, easy to test.

Cons: too shallow. It can learn `structure score low`, but not useful patterns such as “starts with implementation before stating the decision” or “describes team outcomes without making personal ownership explicit.”

### 3.2 Full-history LLM memory rewrite

Give Gemini the user's complete history and ask it to rewrite the current memory after every session.

Pros: simple conceptually.

Cons: unsafe and opaque. Identity, deduplication, correction authority, confidence, and historical evidence all become model judgment. A single model call could erase or distort prior learning.

### 3.3 Structured extraction + deterministic reconciliation — selected

Use the model only to extract small typed signals from persisted answer evidence. Match and reconcile those signals through deterministic keys and rules.

This preserves nuance without turning long-term memory into an LLM-written blob.

## 4. Release boundary

Release 3 includes:

- automatic learning from newly completed conversational and hands-on practice;
- idempotent per-session learning runs and retry state;
- structured observation signal extraction;
- deterministic observation identity, evidence roles, confidence, importance, recurrence, learning state, and trend;
- append-only observation review history;
- explicit handling of new evidence after Confirm / Correct / Dismiss;
- a scored, explainable recommendation engine that uses learned memory;
- Coach/Home/Results UX showing what Relay learned and why;
- an explicit way to process a previously completed unprocessed session.

Release 3 does not include:

- job-hunter/Supabase migration;
- Google Sheet synchronization;
- model fine-tuning;
- embeddings/vector search;
- background workers, queues, or scheduled jobs;
- automatically creating or confirming career-story rows;
- public-product billing/multi-profession work;
- automatic ingestion of real external interviews beyond data already stored in Relay.

## 5. Domain model changes

### 5.1 Observation topics

Automatic learning uses a deliberately small taxonomy rather than arbitrary model-generated identity strings:

```text
answer_structure
clarity
conciseness
communication
confidence
ownership
technical_depth
tradeoff_reasoning
practical_evidence
relevance
unsupported_claims
story_completeness
behavioral_resolution
```

There is no automatic `other` topic. If a signal cannot fit this taxonomy reliably, it is not persisted as automatic memory.

### 5.2 Deterministic observation scope

Topic policy determines the scope used in identity:

```text
global:
  answer_structure, clarity, conciseness, communication,
  confidence, ownership, unsupported_claims

competency-scoped:
  technical_depth, tradeoff_reasoning, practical_evidence, relevance

question-category-scoped:
  story_completeness, behavioral_resolution
```

The source evaluation supplies the competency/category. The model does not invent scope IDs.

### 5.3 Observation identity

System-generated observations receive a stable `observation_key`:

```text
<topic>|global
<topic>|competency:<competency-id>
<topic>|category:<question-category>
```

`(user_id, observation_key)` is unique when `observation_key` is non-null.

Existing/legacy manually-created observations may keep a null key. Release 3 does not guess identities for old arbitrary claims.

This key is polarity-independent. If `tradeoff_reasoning|competency:architecture-id` is first observed as a weakness and later an answer demonstrates strong trade-off reasoning, the later evidence contradicts the same observation rather than creating a second “strength” row.

### 5.4 New observation aggregate fields

`coach_observations` gains:

```text
observation_key nullable
learning_state tentative | established
supporting_session_count
contradicting_session_count
needs_review boolean
reviewed_evidence_count
```

The existing fields remain meaningful:

```text
claim             original system wording, immutable by learning
confidence        current confidence that the claim still describes a pattern
importance        current significance/recurrence estimate
trend             unresolved | improving | stable | worsening
review_state      user review state
user_correction   authoritative effective wording when corrected
first_seen_at
last_seen_at
```

Reviewed legacy observations are backfilled to `learning_state = established`; unreviewed legacy observations remain `tentative`.

### 5.5 Append-only observation review history

Add `coach_observation_reviews`:

```text
id
user_id
observation_id
review_state
correction_text nullable
supporting_session_count_at_review
contradicting_session_count_at_review
evidence_count_at_review
created_at
```

Review actions become one atomic database operation:

```text
append review event
+
update coach_observations current review columns
+
clear needs_review
+
record reviewed_evidence_count
```

The existing current-state columns remain for fast reads. The review table is the durable history.

Existing reviewed observations get one best-effort migration event representing their current state. Lost historical corrections from pre-Release-3 state changes cannot be reconstructed and must not be fabricated.

### 5.6 Session-level evaluation provenance

Hands-on coaching is evaluated at `session_evaluations`, while the current observation evidence model only supports question evaluations.

Release 3 extends `observation_evidence` with nullable `session_evaluation_id` and updates the exactly-one-source constraint to include it.

`session_evaluations` receives `(id, user_id)` uniqueness if needed so the new composite ownership foreign key can be enforced.

The typed evidence union and Coach-memory resolver gain `session_evaluation`.

### 5.7 Evidence idempotency

Retries must not duplicate provenance. Add partial unique constraints so one observation can reference the same source only once for each evidence type, including question and session evaluations.

## 6. Learning-run ledger

Add `coach_learning_runs` with one row per completed interview session:

```text
id
user_id
session_id unique per user
status pending | processing | completed | failed
attempt_count
processing_mode live | deterministic_fallback nullable
extractor_version
started_at
completed_at
last_error_code nullable
created_at
updated_at
```

The table stores process metadata only, never raw model output or CV/answer content.

### 6.1 Idempotency

Before processing a completed session, the service claims its learning run.

- `completed` -> no-op and return previous summary/status.
- `processing` and not stale -> no-op/reject duplicate processing.
- `failed` -> eligible for explicit retry.
- stale processing rows may be reclaimed after a fixed timeout.

The unique session constraint plus evidence uniqueness makes repeated calls safe.

### 6.2 No background dependency

Release 3 does not require a worker or cron task.

After session evidence is durably completed, the interview request calls the learning service synchronously as a best-effort post-completion step.

If learning fails:

- the interview remains complete;
- evaluation/results remain available;
- the learning run becomes `failed`;
- the response contains a non-fatal learning warning/status;
- Home/Coach can offer Retry.

This follows the same principle already used for practice-plan completion: coaching evidence is more important than secondary bookkeeping.

## 7. Learning evidence extraction

### 7.1 Input bundle

A repository/service read model exposes source records with durable IDs:

For conversational practice:

```text
question_evaluation_id
question_id
session_id
question category / competency
prompt
answer
objective/rubric
persisted Evaluation fields
```

For hands-on practice:

```text
session_evaluation_id
session_id
exercise/checkpoint summary
competency
persisted session Evaluation fields
```

The current hydrated `Evaluation` object does not expose the evaluation-row ID, so Release 3 adds a dedicated learning-evidence read model rather than changing every consumer of `Evaluation` just to support provenance.

### 7.2 Extracted signal schema

One model call per completed session returns zero or more constrained signals, with a maximum of two signals per evaluation source:

```text
source_kind: question_evaluation | session_evaluation
source_id: one of the supplied owned IDs
topic: ObservationTopic
signal: positive | negative
claim: concise coaching-language description
reason: concise explanation tied to the answer/evaluation
```

The response schema dynamically restricts `source_id` to IDs supplied in that request, using the existing JSON-schema-constrained Gemini path.

The model does not output:

```text
observation_key
observation_type
evidence_role
confidence
importance
trend
learning_state
review_state
```

Those remain deterministic.

### 7.3 Signal weight

Weight is calculated from the persisted evaluation, not accepted from the model.

Topic-to-dimension mapping:

```text
answer_structure      -> structure
clarity               -> clarity
conciseness           -> clarity
communication         -> communication
confidence            -> confidence
technical_depth       -> depth
tradeoff_reasoning    -> tradeOffAwareness
practical_evidence    -> practicalExperience
relevance             -> relevance
```

For a mapped dimension score `s` on the existing 0-10 scale:

```text
positive weight = clamp(s / 10, 0.4, 1)
negative weight = clamp((10 - s) / 10, 0.4, 1)
```

Signals whose raw calculated weight would be below `0.4` are discarded as too weak.

For `ownership`, `unsupported_claims`, `story_completeness`, and `behavioral_resolution`, deterministic rules use the persisted overall score plus the relevant grounded arrays (`supportedClaims`, `unsupportedClaims`, `missingPoints`, `expectedSignalsPresent`) and clamp to the same 0.4-1 range.

### 7.4 Deterministic fallback extraction

If live structured extraction is unavailable or invalid after the existing repair path, Release 3 may derive conservative signals from the persisted evaluation only:

- clearly low dimensions create negative signals;
- clearly high dimensions create positive signals;
- unsupported-claim evidence may create `unsupported_claims` negative signals;
- ambiguous mid-range evidence creates nothing.

Fallback output is deliberately less nuanced but still grounded and deterministic. The learning run records `processing_mode = deterministic_fallback`.

## 8. Reconciliation

### 8.1 Creating a new observation

For a signal whose key does not exist:

- negative `story_completeness` / `behavioral_resolution` -> `story_gap`;
- negative `answer_structure` / `ownership` / `conciseness` -> `answer_habit`;
- negative `clarity` / `communication` / `confidence` -> `delivery_pattern`;
- negative `technical_depth` with clearly low correctness -> `knowledge_gap`;
- other negative competency signals -> `weakness`;
- positive story topics -> `story_strength`;
- other positive topics -> `strength`.

The initial `claim` comes from the grounded signal and is never automatically rewritten later.

Initial state:

```text
review_state = unreviewed
learning_state = tentative
trend = unresolved
```

### 8.2 Existing observation

If the key exists, the observation is reused regardless of current review state.

Determine evidence role from the observation's polarity:

```text
positive observation (strength/story_strength):
  positive signal -> supporting
  negative signal -> contradicting

negative observation (all actionable problem types):
  negative signal -> supporting
  positive signal -> contradicting
```

The reconciler attaches evidence if it is not already present, then recomputes aggregate state from all linked evidence.

Automatic learning never overwrites `claim`, `review_state`, or `user_correction`.

### 8.3 Confidence

Confidence measures whether the stored claim represents a repeated pattern, not answer quality.

Use distinct completed sessions, not raw question count, so five similar questions in one session cannot manufacture certainty.

```text
confidence = clamp(
  0.40
  + 0.15 * min(distinct supporting sessions, 4)
  - 0.10 * min(distinct contradicting sessions, 3),
  0.15,
  0.95
)
```

### 8.4 Learning state

An unreviewed observation is `established` only when:

```text
distinct supporting sessions >= 2
AND confidence >= 0.65
```

Otherwise it is `tentative`.

User-confirmed/corrected observations remain user-reviewed regardless of learning state. Learning state describes automatic evidence maturity, not user agreement.

### 8.5 Importance

Importance reflects evidence strength and recurrence, leaving job relevance to the recommendation engine:

```text
importance = clamp(
  0.25
  + 0.35 * max supporting evidence weight
  + 0.10 * min(distinct supporting sessions, 3),
  0,
  1
)
```

If no supporting evidence remains, importance may fall but the historical observation/evidence is retained.

### 8.6 Trend

Trend uses chronological per-session evidence balance.

For each distinct session:

```text
session net = supporting weight - contradicting weight
```

With fewer than three evidence-bearing sessions: `unresolved`.

Otherwise compare the average of the latest two sessions with up to two immediately preceding sessions using a `0.20` material-change threshold.

For negative/problem observations:

```text
recent net <= previous net - 0.20 -> improving
recent net >= previous net + 0.20 -> worsening
otherwise                         -> stable
```

For positive/strength observations, the direction is reversed: more support means improving, less support means worsening.

### 8.7 Review attention

Automatic learning never changes a user review state.

After a review, the review event snapshots supporting/contradicting session counts.

Set `needs_review = true` when:

- a dismissed observation gains supporting evidence from at least two additional distinct sessions since dismissal; or
- a confirmed/corrected observation gains contradicting evidence from at least two additional distinct sessions since that review.

This surfaces meaningful changed evidence without silently undoing the user's decision.

## 9. Recommendation engine v2

Release 2's precedence selector becomes an explainable scoring engine. Selection remains fully deterministic.

Every candidate has:

```text
target_key
format
primary_focus
primary/supporting opportunities
priority_score
priority_factors
success_criteria
```

When a recommendation is started, `priority_score` and `priority_factors` are persisted into the existing `practice_plans` fields reserved for this purpose.

### 9.1 Role-prep candidates

For each active applied/interviewing opportunity:

```text
base                                       +20
interview <= 2 days                       +120
interview 3-7 days                        +100
interviewing without date                  +75
applied                                    +45
match score                                +0..10
same-opportunity practice in last 24h      -30
same-opportunity practice in last 3 days   -15
```

Near-term interviews therefore remain dominant without requiring a separate hard-coded branch.

### 9.2 Observation candidates

Eligible observations:

- confirmed or corrected actionable observations; or
- unreviewed actionable observations with `learning_state = established`.

Never eligible:

- dismissed observations;
- tentative unreviewed observations;
- strength/story-strength observations as problem targets.

Score:

```text
base                                      +20
importance * 30                           +0..30
confidence * 25                           +0..25
confirmed/corrected                       +15
established automatic memory              +10
trend worsening                           +15
trend stable                               +5
trend improving                           -15
supporting-session recurrence              +5 each, max +15
active-job relevance                       +0..20
same target practiced in last 24h         -25
same target practiced in last 3 days      -12
```

### 9.3 Job relevance

Relevance is deterministic and explainable:

- competency-scoped observation whose competency name appears in an active opportunity's gaps/strengths/job description -> strong relevance;
- global delivery/structure observation with active applied/interviewing opportunities -> small general relevance;
- story-gap observation with active applications -> moderate relevance.

This does not assert the candidate has any job requirement; it only determines training relevance.

### 9.4 Fallback candidates

Existing progress weakness, first-practice, and full-simulation candidates remain as deterministic fallbacks when no higher-value role/observation target exists.

### 9.5 Explanation

The winning recommendation exposes factors such as:

```text
Seen in 3 practice sessions
High-confidence recurring weakness
Worsening in the last two sessions
Relevant to 2 active applications
Not practiced for 5 days
```

The user should be able to understand why this target won without seeing the raw numeric formula unless they open details.

## 10. Processing lifecycle

### 10.1 New session completion

```text
persist completed session/evaluations
  -> complete linked practice plan best-effort
  -> process session learning best-effort
  -> return results + learning status/change summary
```

Learning may add a few seconds to completion, but there is no asynchronous promise or hidden background job.

### 10.2 Learning result

Return a safe summary, for example:

```text
status: completed | fallback | failed | already_processed
created_observations: 1
updated_observations: 2
established_observations: 1
needs_review_observations: 0
```

Do not return or log raw model output.

### 10.3 Existing unprocessed sessions

Release 3 does not automatically launch model calls from dashboard GET requests.

`GET /api/learning` may report completed sessions with no learning run. Coach can offer an explicit `Learn from past practice` action that processes one owned completed unprocessed session per request. This keeps history bootstrap bounded and observable.

Failed runs expose Retry through the same API.

## 11. UI changes

### 11.1 Results

After a completed practice, show a small `What Relay learned` section when learning produced changes:

```text
New pattern: You often state implementation before the architectural decision.
Strength reinforced: Concrete production debugging examples.
Improving: Trade-off reasoning.
```

This is a summary of persisted memory changes, not ephemeral model copy.

### 11.2 Coach

Split active memory into:

```text
Established / reviewed
Tentative observations
Needs your review
History (dismissed)
```

Each observation may show:

```text
seen in N sessions
confidence
importance (secondary)
trend
last seen
evidence
review history
```

Tentative observations explicitly say they do not yet control recommended practice.

A dismissed observation with `needs_review` remains dismissed but appears in `Needs your review` with clear copy that new evidence exists.

### 11.3 Home

`What Relay is noticing` shows established/reviewed memory, not every tentative one-off signal.

The recommendation card includes human-readable scoring factors from the winning target.

If learning from the most recent session failed, Home may show a non-blocking retry notice.

### 11.4 Practice

No new configuration burden. The primary action remains `Start recommended practice`.

## 12. Error handling and privacy

### 12.1 Interview completion always wins

A learning failure after completion must never roll back:

- answers;
- evaluations;
- session completion;
- practice-plan completion attempt.

### 12.2 Safe logs

Learning logs may include:

```text
session id
run id
operation name
status/error code
schema issue paths/codes
candidate counts
```

They must not include:

```text
CV text
answers
model raw text
parsed candidate claims/reasons
career-story text
```

### 12.3 RLS and ownership

All new tables carry `user_id`, RLS, and same-user composite foreign keys following Release 1 conventions.

Browser code never supplies a trusted user ID.

### 12.4 No service-role browser path

Learning runs execute through authenticated server APIs and existing server Supabase access. No service-role key is introduced into client code.

## 13. Testing strategy

### 13.1 Extraction contract tests

Verify:

- model schema restricts topic/signal/source IDs;
- at most two signals per source;
- invalid IDs/topics are rejected;
- candidate facts are grounded in supplied answer/evaluation context;
- deterministic fallback produces only high-confidence low/high-dimension signals.

### 13.2 Reconciliation unit tests

Required scenarios:

1. first weak answer creates tentative observation;
2. second supporting session establishes it;
3. repeated processing of the same session creates no duplicate evidence;
4. strong later answers attach contradicting evidence and can move trend to improving;
5. corrected wording is never overwritten;
6. dismissed observation never becomes recommendation-eligible automatically;
7. sufficient new supporting sessions after dismissal set `needs_review` only;
8. strength evidence does not become a weakness target;
9. same topic/scope reuses one observation regardless of changed model wording;
10. different competencies create separate competency-scoped observations.

### 13.3 Recommendation tests

Use fixed fixtures/time and assert exact scores/factors for:

- interview tomorrow beating every general weakness;
- worsening established weakness beating stable lower-priority weakness;
- improving recently-practiced weakness dropping in priority;
- confirmed/corrected observation becoming actionable immediately;
- tentative one-session inference not controlling training;
- dismissed observation never selected;
- job relevance changing otherwise-close rankings;
- over-practice penalty causing diversity.

### 13.4 Review-history tests

Confirm/correct/dismiss must atomically append review history and update current state. A failed append must not leave current review columns changed without history.

### 13.5 Full learning-loop acceptance test

A deterministic fixture must prove:

```text
Session 1: weak architecture trade-off answer
  -> tentative observation
  -> not yet recommendation target

Session 2: same problem
  -> same observation receives evidence
  -> becomes established
  -> next recommendation targets trade-off reasoning

Session 3: strong trade-off answer
  -> contradicting evidence
  -> confidence/importance/trend update

Further strong evidence
  -> trend becomes improving
  -> target priority falls
```

This is the Release 3 acceptance criterion that matters most.

## 14. Migration and compatibility

The migration is additive.

Existing:

- observations;
- evidence;
- review state;
- practice plans;
- sessions;
- recommendations;
- Career Brain UI

remain valid.

Existing observation rows with no system key are displayed/reviewed as before and are not automatically merged into system-generated keyed observations.

Existing completed sessions remain valid with no `coach_learning_runs` row. They can be explicitly processed through history learning if desired.

## 15. Rollout sequence

Implementation should proceed in this order:

1. schema/idempotency/review-history foundation;
2. learning-evidence repository read models;
3. structured extractor + deterministic fallback;
4. deterministic reconciler/aggregate rules;
5. per-session learning run orchestration;
6. hook best-effort learning into session completion;
7. recommendation engine v2 with persisted factor snapshot;
8. Coach/Home/Results learning UX and retry/history processing;
9. full regression and live-provider verification.

Do not make the UI depend on partially deployed schema/API changes.

## 16. Release gate

Release 3 is complete only when all of the following are demonstrably true:

- a completed answer can automatically create evidence-backed coaching memory;
- one-off unreviewed evidence does not automatically control practice;
- repeated evidence establishes a pattern;
- same-topic evidence reconciles into one observation rather than duplicate claims;
- contradicting evidence changes aggregate confidence/trend instead of deleting history;
- Confirm / Correct / Dismiss remains authoritative;
- corrections are never automatically overwritten;
- dismissed observations are never silently reactivated;
- new evidence can request explicit re-review without changing review state;
- hands-on session evaluations can be observation provenance;
- retries are idempotent;
- failed learning never invalidates completed interview evidence;
- recommendation scoring is deterministic, explainable, and persisted when a plan starts;
- near-term real interviews retain priority;
- improving/recently-practiced patterns can fall in priority;
- Results tells the user what durable memory changed;
- existing Release 1/2 data and flows continue working;
- no automatic career-story fabrication exists;
- no job-hunter, Google Tracker, cron/worker, or fine-tuning migration is introduced.

## 17. Release 4 boundary

Only after this release is deployed and the adaptive loop proves useful should the job hunter begin publishing into the shared Supabase Career Brain.

Release 3 must not require any change to the working Python bot, SQLite state, GitHub Actions workflow, Telegram delivery, or job-discovery behavior.