/**
 * The browser's typed request layer for Relay's client shell.
 *
 * Every function here is a thin, typed wrapper over one route handler under
 * `src/app/api/`. Two invariants hold across all of them:
 *
 * - **No `userId` parameter, ever.** Each route derives the caller from the
 *   Supabase session server-side, so the browser can neither choose nor spoof
 *   an owner. A signature that accepted one would be a security hazard, not a
 *   convenience.
 * - **Server-owned fields are not accepted.** Request types deliberately omit
 *   anything the routes compute or ignore (a story's `completeness` and
 *   `reviewState`, a practice plan's rationale/priority/status, an
 *   opportunity's `status` outside an explicit transition), so a caller cannot
 *   express a request the server would silently discard.
 *
 * Failures surface uniformly as {@link ApiError} carrying the route's
 * user-safe message and HTTP status; callers distinguish `401` to sign out.
 */

import type {
  CareerDashboard,
  CareerStory,
  CareerStoryDraftFields,
  CareerStoryEvidence,
  CoachObservation,
  CreateOpportunityInput,
  InterviewSession,
  Opportunity,
  OpportunityEvent,
  OpportunityStatus,
  PracticeFormat,
  PracticePlan,
  UpdateOpportunityDetailsInput,
} from "@/lib/types";

/**
 * A failed API response, carrying the route's user-safe `error` message and
 * its HTTP `status`. The shell keys off `status === 401` to drop back to the
 * signed-out screen instead of showing a request error.
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Sends a JSON request and returns the parsed body, throwing {@link ApiError}
 * for any non-2xx response. The thrown message is the route's `error` field —
 * never a raw exception — so nothing internal reaches the UI.
 */
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error ?? "Something went wrong.", response.status);
  return body as T;
}

/** Sends one `{ action, ... }` command to an action-style route. */
async function postAction<T>(url: string, body: Record<string, unknown>): Promise<T> {
  return api<T>(url, { method: "POST", body: JSON.stringify(body) });
}

// --- Career dashboard -------------------------------------------------------

/**
 * Loads the single canonical Career Brain read model — profile, progress,
 * recent sessions, opportunities, observations, stories, recent practice
 * plans, and the current practice recommendation — from
 * `GET /api/career/dashboard`.
 *
 * Throws {@link ApiError} with status 400 when the caller has not finished
 * profile onboarding yet; the shell routes brand-new accounts to onboarding
 * rather than calling this.
 */
export async function fetchCareerDashboard(): Promise<CareerDashboard> {
  return api<CareerDashboard>("/api/career/dashboard");
}

// --- Opportunities ----------------------------------------------------------

const OPPORTUNITIES_URL = "/api/opportunities";

/**
 * A new opportunity. `initialStatus` logs an application that is already past
 * `considering`; the route creates in `considering` and then transitions, so
 * the status change always keeps its history event.
 */
export type CreateOpportunityRequest = CreateOpportunityInput & {
  initialStatus?: OpportunityStatus;
};

/** Optional history detail recorded alongside a status transition. */
export type OpportunityTransitionOptions = {
  occurredAt?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
};

/** Optional history detail recorded alongside a scheduled interview. */
export type ScheduleOpportunityInterviewOptions = {
  note?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createOpportunity(input: CreateOpportunityRequest): Promise<Opportunity> {
  return (await postAction<{ opportunity: Opportunity }>(OPPORTUNITIES_URL, { action: "create", ...input })).opportunity;
}

/**
 * Updates descriptive fields only. An omitted field is left alone and an
 * explicit `null` clears it, so callers must not send `null` for a field they
 * simply are not editing. Lifecycle fields (`status`, `nextInterviewAt`) are
 * unreachable here by design — use {@link transitionOpportunity} and
 * {@link scheduleOpportunityInterview}.
 */
export async function updateOpportunity(opportunityId: string, input: UpdateOpportunityDetailsInput): Promise<Opportunity> {
  return (await postAction<{ opportunity: Opportunity }>(OPPORTUNITIES_URL, { action: "update", opportunityId, ...input })).opportunity;
}

export async function transitionOpportunity(
  opportunityId: string,
  toStatus: OpportunityStatus,
  options: OpportunityTransitionOptions = {},
): Promise<Opportunity> {
  return (await postAction<{ opportunity: Opportunity }>(OPPORTUNITIES_URL, {
    action: "transition",
    opportunityId,
    toStatus,
    ...options,
  })).opportunity;
}

/** `interviewAt` must be a future ISO timestamp; the route rejects anything else with a 400. */
export async function scheduleOpportunityInterview(
  opportunityId: string,
  interviewAt: string,
  options: ScheduleOpportunityInterviewOptions = {},
): Promise<Opportunity> {
  return (await postAction<{ opportunity: Opportunity }>(OPPORTUNITIES_URL, {
    action: "schedule_interview",
    opportunityId,
    interviewAt,
    ...options,
  })).opportunity;
}

/** Appends a history event rather than changing the opportunity row, so it resolves to the event. */
export async function addOpportunityNote(opportunityId: string, note: string): Promise<OpportunityEvent> {
  return (await postAction<{ event: OpportunityEvent }>(OPPORTUNITIES_URL, { action: "add_note", opportunityId, note })).event;
}

// --- Career stories ---------------------------------------------------------

const STORIES_URL = "/api/stories";

/**
 * The nine narrative fields of a story draft. On update an omitted field is
 * left untouched while an explicit `null` clears it — the distinction the
 * route relies on when it recomputes completeness against untouched fields.
 */
export type CareerStoryFields = {
  [Field in keyof CareerStoryDraftFields]?: string | null;
};

/** `completeness` and `reviewState` are absent on purpose: the route always derives them. */
export type CreateCareerStoryRequest = CareerStoryFields & {
  title: string;
  tags?: string[];
};

/** Review-state changes are not expressible here — use {@link confirmCareerStory} or {@link retireCareerStory}. */
export type UpdateCareerStoryRequest = CareerStoryFields & {
  title?: string;
  tags?: string[];
};

export async function createCareerStory(input: CreateCareerStoryRequest): Promise<CareerStory> {
  return (await postAction<{ story: CareerStory }>(STORIES_URL, { action: "create", ...input })).story;
}

export async function updateCareerStory(storyId: string, input: UpdateCareerStoryRequest): Promise<CareerStory> {
  return (await postAction<{ story: CareerStory }>(STORIES_URL, { action: "update", storyId, ...input })).story;
}

/** Marks the story confirmed; the route stamps `confirmedAt` server-side. */
export async function confirmCareerStory(storyId: string): Promise<CareerStory> {
  return (await postAction<{ story: CareerStory }>(STORIES_URL, { action: "confirm", storyId })).story;
}

/** A state change, not a delete — the row and its attached evidence are preserved. */
export async function retireCareerStory(storyId: string): Promise<CareerStory> {
  return (await postAction<{ story: CareerStory }>(STORIES_URL, { action: "retire", storyId })).story;
}

/** Links an existing profile evidence item to a story, resolving to the new provenance row. */
export async function attachCareerStoryProfileEvidence(
  storyId: string,
  profileEvidenceId: string,
  note?: string | null,
): Promise<CareerStoryEvidence> {
  return (await postAction<{ evidence: CareerStoryEvidence }>(STORIES_URL, {
    action: "attach_profile_evidence",
    storyId,
    profileEvidenceId,
    note,
  })).evidence;
}

// --- Coach observations -----------------------------------------------------

const OBSERVATIONS_URL = "/api/observations";

/**
 * Reviewing is the only write the browser can make to coach memory: Release 2
 * never creates or reconciles observations from the client, so `confirm`,
 * `correct`, and `dismiss` are the complete surface.
 */
export async function confirmObservation(observationId: string): Promise<CoachObservation> {
  return (await postAction<{ observation: CoachObservation }>(OBSERVATIONS_URL, { action: "confirm", observationId })).observation;
}

/** `correction` must be non-empty; the route rejects blank replacement text with a 400. */
export async function correctObservation(observationId: string, correction: string): Promise<CoachObservation> {
  return (await postAction<{ observation: CoachObservation }>(OBSERVATIONS_URL, {
    action: "correct",
    observationId,
    correction,
  })).observation;
}

export async function dismissObservation(observationId: string): Promise<CoachObservation> {
  return (await postAction<{ observation: CoachObservation }>(OBSERVATIONS_URL, { action: "dismiss", observationId })).observation;
}

// --- Practice ---------------------------------------------------------------

const PRACTICE_URL = "/api/practice";

/**
 * The practice choices a user may make themselves. Plan status, rationale, and
 * priority are server-owned and so have no field here. Every value is
 * re-validated server-side.
 */
export type ManualPracticeRequest = {
  format: PracticeFormat;
  primaryFocus: string;
  secondaryFocus?: string | null;
  estimatedMinutes?: number | null;
  successCriteria?: string[];
  primaryOpportunityId?: string | null;
};

/** The persisted plan and the session started from it. */
export type StartedPractice = {
  plan: PracticePlan;
  session: InterviewSession;
};

/**
 * Starts the practice Relay recommends. The recommendation is recomputed
 * server-side, so nothing recommendation-shaped is sent — a stale
 * recommendation on screen can never be replayed as a start request.
 */
export async function startRecommendedPractice(): Promise<StartedPractice> {
  return postAction<StartedPractice>(PRACTICE_URL, { action: "start_recommended" });
}

/**
 * Starts practice the user chose. Throws {@link ApiError} with status 400 for
 * invalid choices, 404 when `primaryOpportunityId` is not the caller's, and
 * 409 when a linked plan is no longer startable.
 */
export async function startManualPractice(request: ManualPracticeRequest): Promise<StartedPractice> {
  return postAction<StartedPractice>(PRACTICE_URL, { action: "start_manual", ...request });
}
