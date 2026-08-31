import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveObservationEvidence } from "@/lib/coach-memory";
import { recommendPractice } from "@/lib/practice-recommendation";
import { calculateProgress } from "@/lib/progress";
import { listRecentSessions } from "@/lib/repositories/interviews";
import { listCoachObservations, listObservationEvidence } from "@/lib/repositories/observations";
import { listOpportunities } from "@/lib/repositories/opportunities";
import { listPracticePlans } from "@/lib/repositories/practice-plans";
import { getProfile } from "@/lib/repositories/profile";
import { listCareerStories, listCareerStoryEvidence } from "@/lib/repositories/stories";
import type {
  CareerDashboard,
  CareerStory,
  CareerStorySummary,
  CoachObservation,
  CoachObservationSummary,
  Opportunity,
} from "@/lib/types";

/**
 * Raised when the dashboard cannot be built because the caller has not
 * finished profile onboarding yet. `CareerDashboard.profile` is
 * non-nullable by contract -- the client shell only ever routes to Home
 * once a profile exists, sending brand-new accounts to onboarding instead
 * (see `src/app/page.tsx`'s `setView(coachData.profile ? "home" : "onboarding")`)
 * -- so a missing profile here is a genuine invalid-state error, not a
 * normal empty-account case like zero opportunities or stories.
 */
export class CareerDashboardError extends Error {
  constructor(message: string, public readonly code: "PROFILE_REQUIRED") {
    super(message);
    this.name = "CareerDashboardError";
  }
}

/** Dismissed observations are archived, not surfaced -- everything else (including unreviewed) is still shown. */
function isDisplayableObservation(observation: CoachObservation): boolean {
  return observation.reviewState !== "dismissed";
}

/**
 * The text to show for an observation: the user's correction when they have
 * reviewed and corrected it, otherwise the original claim. Mirrors
 * `effectiveObservationText` in `src/lib/practice-recommendation.ts` --
 * duplicated rather than imported because that function is private to its
 * module and this rule is small and stable enough not to warrant exporting it.
 */
function effectiveObservationText(observation: CoachObservation): string {
  return observation.reviewState === "corrected" && observation.userCorrection?.trim()
    ? observation.userCorrection.trim()
    : observation.claim;
}

async function summarizeObservation(
  supabase: SupabaseClient,
  userId: string,
  observation: CoachObservation,
): Promise<CoachObservationSummary> {
  const evidenceRows = await listObservationEvidence(supabase, userId, observation.id);
  const evidence = await resolveObservationEvidence(supabase, userId, evidenceRows);
  return { ...observation, effectiveText: effectiveObservationText(observation), evidence };
}

async function summarizeStory(
  supabase: SupabaseClient,
  userId: string,
  story: CareerStory,
): Promise<CareerStorySummary> {
  const evidence = await listCareerStoryEvidence(supabase, userId, story.id);
  return { ...story, evidenceCount: evidence.length };
}

/** `opportunities` filtered to future-dated interviews and sorted soonest-first. */
function upcomingOpportunities(opportunities: Opportunity[], now: Date): Opportunity[] {
  return opportunities
    .filter((opportunity) => opportunity.nextInterviewAt !== null && Date.parse(opportunity.nextInterviewAt) > now.getTime())
    .sort((left, right) => Date.parse(left.nextInterviewAt as string) - Date.parse(right.nextInterviewAt as string));
}

/**
 * Builds the single canonical Career Brain dashboard read model for
 * `userId`. Composes existing repositories and `recommendPractice` --
 * AGGREGATION ONLY, never persistence: this issues no writes, so it is safe
 * to call on every `GET /api/career/dashboard` request without creating or
 * reconciling any Career Brain row (Release 2 does not auto-reconcile coach
 * observations).
 *
 * Loads every top-level repository in parallel, then resolves each
 * non-dismissed observation's evidence and each story's evidence count in
 * parallel as a second wave (each of those needs the first wave's rows
 * first). `now` is never read from the clock here -- it is threaded
 * straight through to `recommendPractice`, matching that selector's own
 * determinism contract.
 *
 * Throws {@link CareerDashboardError} with code `PROFILE_REQUIRED` when the
 * caller has no profile yet; every other empty Career Brain table (no
 * opportunities, observations, stories, plans, or sessions) is a valid
 * dashboard, not an error.
 */
export async function loadCareerDashboard(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
  coachMode: "demo" | "live",
): Promise<CareerDashboard> {
  const [profile, opportunities, observations, stories, recentSessions, recentPracticePlans] = await Promise.all([
    getProfile(supabase, userId),
    listOpportunities(supabase, userId),
    listCoachObservations(supabase, userId),
    listCareerStories(supabase, userId),
    listRecentSessions(supabase, userId),
    listPracticePlans(supabase, userId),
  ]);

  if (!profile) throw new CareerDashboardError("Create your profile first.", "PROFILE_REQUIRED");

  const progress = calculateProgress(profile.competencies, recentSessions);

  const [observationSummaries, storySummaries] = await Promise.all([
    Promise.all(
      observations.filter(isDisplayableObservation).map((observation) => summarizeObservation(supabase, userId, observation)),
    ),
    Promise.all(stories.map((story) => summarizeStory(supabase, userId, story))),
  ]);

  const recommendation = recommendPractice({
    opportunities,
    observations,
    stories,
    progress,
    recentSessions,
    recentPlans: recentPracticePlans,
    now,
  });

  return {
    profile,
    coachMode,
    progress,
    recentSessions,
    opportunities,
    upcomingOpportunities: upcomingOpportunities(opportunities, now),
    observations: observationSummaries,
    stories: storySummaries,
    recentPracticePlans,
    recommendation,
  };
}
