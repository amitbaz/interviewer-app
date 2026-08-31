import type {
  CoachObservation,
  CoachObservationType,
  Opportunity,
  OpportunityStatus,
  PracticeFormat,
  PracticeRecommendation,
  PracticeRecommendationInput,
  PracticeRecommendationSignal,
  ProgressSnapshot,
} from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NEAR_TERM_INTERVIEW_WINDOW_MS = 7 * DAY_MS;
const REVIEWED_OBSERVATION_MIN_IMPORTANCE = 0.6;

/** Terminal opportunity lifecycle states never create recommendation urgency (design section 5.3). */
const TERMINAL_STATUSES = new Set<OpportunityStatus>(["offer", "rejected", "withdrawn", "closed"]);

/**
 * `CoachObservation` has no dedicated field distinguishing a behavioral
 * observation from a technical-delivery one. This keyword heuristic is the
 * deterministic stand-in the design spec asks for ("unless clearly
 * behavioral") for the `answer_habit`/`delivery_pattern` branch-3 mapping,
 * until Release 3 defines a real classification.
 */
const BEHAVIORAL_KEYWORDS = [
  "behavioral",
  "leadership",
  "conflict",
  "teamwork",
  "collaborat",
  "stakeholder",
  "interpersonal",
];

function isTerminal(status: OpportunityStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * The text to show for a reviewed observation. A user correction always
 * supersedes the original AI-authored claim for display purposes -- the
 * `claim` field itself is never overwritten in storage (see
 * `CoachObservation.claim`).
 */
function effectiveObservationText(item: CoachObservation): string {
  return item.reviewState === "corrected" && item.userCorrection?.trim()
    ? item.userCorrection.trim()
    : item.claim.trim();
}

function daysUntil(target: Date, now: Date): number {
  return Math.round((target.getTime() - now.getTime()) / DAY_MS);
}

function daysUntilLabel(target: Date, now: Date): string {
  const days = daysUntil(target, now);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function statusRank(status: OpportunityStatus): number {
  if (status === "interviewing") return 0;
  if (status === "applied") return 1;
  return 2;
}

function compareOpportunityUrgency(left: Opportunity, right: Opportunity): number {
  const rankDelta = statusRank(left.status) - statusRank(right.status);
  if (rankDelta !== 0) return rankDelta;
  const leftTime = left.nextInterviewAt ? Date.parse(left.nextInterviewAt) : Infinity;
  const rightTime = right.nextInterviewAt ? Date.parse(right.nextInterviewAt) : Infinity;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
}

/** The other non-terminal active opportunities relevant to a chosen focus, stable-sorted for determinism. */
function otherActiveOpportunityIds(activeOpportunities: Opportunity[], primaryId: string): string[] {
  return activeOpportunities
    .filter((opportunity) => opportunity.id !== primaryId)
    .map((opportunity) => opportunity.id)
    .sort((left, right) => left.localeCompare(right));
}

function isClearlyBehavioral(observation: CoachObservation): boolean {
  const text = effectiveObservationText(observation).toLowerCase();
  return BEHAVIORAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function humanizeObservationType(type: CoachObservationType): string {
  switch (type) {
    case "story_gap":
      return "story gap";
    case "story_strength":
      return "story strength";
    case "answer_habit":
      return "answer habit";
    case "delivery_pattern":
      return "delivery pattern";
    case "knowledge_gap":
      return "knowledge gap";
    case "weakness":
      return "weakness";
    case "strength":
      return "strength";
    case "other":
      return "observation";
  }
}

/**
 * Maps a reviewed coach observation to a practice format per the Release 2
 * design spec's branch-3 mapping (section 5.3): `story_gap` routes to
 * `story_work`; `answer_habit`/`delivery_pattern` route to
 * `technical_communication` unless the observation reads as clearly
 * behavioral (see `isClearlyBehavioral`), in which case `behavioral`; every
 * other reviewed type -- including the catch-all "other reviewed
 * weaknesses" case -- routes to `targeted_drill`.
 */
function formatForObservation(observation: CoachObservation): PracticeFormat {
  switch (observation.observationType) {
    case "story_gap":
      return "story_work";
    case "answer_habit":
    case "delivery_pattern":
      return isClearlyBehavioral(observation) ? "behavioral" : "technical_communication";
    case "knowledge_gap":
    case "weakness":
      return "targeted_drill";
    default:
      return "targeted_drill";
  }
}

function successCriteriaFor(format: PracticeFormat): string[] {
  switch (format) {
    case "role_prep":
      return [
        "Answer role-specific questions grounded in the job description.",
        "State one concrete reason you fit this role.",
        "Name one open question to resolve before the interview.",
      ];
    case "story_work":
      return [
        "Produce one complete story with a situation, your actions, and a measurable outcome.",
        "Confirm the story in the story bank so it is ready to reuse.",
      ];
    case "targeted_drill":
      return [
        "Answer at least three questions on the target competency.",
        "Name one concrete change to apply in the next real interview.",
      ];
    case "self_presentation":
      return [
        "Deliver a concise self-introduction in under two minutes.",
        "Cover your role, your strengths, and what you're looking for next.",
      ];
    case "technical_communication":
      return [
        "Structure at least two answers with a clear beginning, middle, and end.",
        "Reduce filler and state the point before the supporting detail.",
      ];
    case "behavioral":
      return [
        "Answer at least two behavioral questions with a clear resolution.",
        "Name the interpersonal outcome, not just the technical one.",
      ];
    case "full_simulation":
      return [
        "Complete a full mock interview across the core competencies.",
        "Receive scored feedback on every answer.",
      ];
    case "hands_on":
      return [
        "Complete the hands-on exercise within the allotted time.",
        "Narrate your approach while working through it.",
      ];
  }
}

function withCommonFields(
  format: PracticeFormat,
  fields: Omit<PracticeRecommendation, "format" | "successCriteria">,
): PracticeRecommendation {
  return { format, successCriteria: successCriteriaFor(format), ...fields };
}

function pickNearTermInterview(
  activeOpportunities: Opportunity[],
  now: Date,
): { opportunity: Opportunity; interviewAt: Date } | null {
  const candidates = activeOpportunities
    .filter((opportunity) => opportunity.status === "applied" || opportunity.status === "interviewing")
    .flatMap((opportunity) => {
      if (!opportunity.nextInterviewAt) return [];
      const interviewAt = new Date(opportunity.nextInterviewAt);
      if (Number.isNaN(interviewAt.getTime())) return [];
      const msUntil = interviewAt.getTime() - now.getTime();
      if (msUntil < 0 || msUntil > NEAR_TERM_INTERVIEW_WINDOW_MS) return [];
      return [{ opportunity, interviewAt, msUntil }];
    })
    .sort((left, right) => left.msUntil - right.msUntil || left.opportunity.id.localeCompare(right.opportunity.id));

  const first = candidates[0];
  return first ? { opportunity: first.opportunity, interviewAt: first.interviewAt } : null;
}

function pickInterviewingOpportunity(activeOpportunities: Opportunity[]): Opportunity | null {
  const candidates = activeOpportunities
    .filter((opportunity) => opportunity.status === "interviewing")
    .sort((left, right) => {
      const leftTime = left.nextInterviewAt ? Date.parse(left.nextInterviewAt) : Infinity;
      const rightTime = right.nextInterviewAt ? Date.parse(right.nextInterviewAt) : Infinity;
      return leftTime - rightTime || left.id.localeCompare(right.id);
    });
  return candidates[0] ?? null;
}

function pickReviewedObservation(observations: CoachObservation[]): CoachObservation | null {
  const candidates = observations
    .filter((observation) => (observation.reviewState === "confirmed" || observation.reviewState === "corrected")
      && observation.importance >= REVIEWED_OBSERVATION_MIN_IMPORTANCE)
    .sort((left, right) => right.importance - left.importance || left.id.localeCompare(right.id));
  return candidates[0] ?? null;
}

function pickActiveApplicationOpportunity(activeOpportunities: Opportunity[]): Opportunity | null {
  const candidates = activeOpportunities
    .filter((opportunity) => opportunity.status === "applied" || opportunity.status === "interviewing")
    .sort(compareOpportunityUrgency);
  return candidates[0] ?? null;
}

function pickAppliedOpportunity(activeOpportunities: Opportunity[]): Opportunity | null {
  const candidates = activeOpportunities
    .filter((opportunity) => opportunity.status === "applied")
    .sort((left, right) => {
      const leftTime = left.appliedAt ? Date.parse(left.appliedAt) : Infinity;
      const rightTime = right.appliedAt ? Date.parse(right.appliedAt) : Infinity;
      return leftTime - rightTime || left.id.localeCompare(right.id);
    });
  return candidates[0] ?? null;
}

function buildNearTermInterviewRecommendation(
  match: { opportunity: Opportunity; interviewAt: Date },
  activeOpportunities: Opportunity[],
  now: Date,
): PracticeRecommendation {
  const { opportunity, interviewAt } = match;
  const label = daysUntilLabel(interviewAt, now);
  const signal: PracticeRecommendationSignal = {
    kind: "upcoming_interview",
    label: "upcoming interview",
    detail: `${opportunity.company} · ${label}`,
  };
  return withCommonFields("role_prep", {
    primaryFocus: `Prepare for the ${opportunity.company} ${opportunity.role} interview`,
    secondaryFocus: null,
    rationale: `Your ${opportunity.role} interview at ${opportunity.company} is ${label}, so role-specific preparation takes priority over everything else right now.`,
    estimatedMinutes: 18,
    primaryOpportunityId: opportunity.id,
    supportingOpportunityIds: otherActiveOpportunityIds(activeOpportunities, opportunity.id),
    signals: [signal],
  });
}

function buildInterviewingRecommendation(
  opportunity: Opportunity,
  activeOpportunities: Opportunity[],
): PracticeRecommendation {
  const signal: PracticeRecommendationSignal = {
    kind: "interviewing_opportunity",
    label: "interviewing",
    detail: `${opportunity.company} · active interview process`,
  };
  return withCommonFields("role_prep", {
    primaryFocus: `Prepare for the ${opportunity.company} ${opportunity.role} interview`,
    secondaryFocus: null,
    rationale: `You're actively interviewing at ${opportunity.company}, so role-specific preparation is the highest-value practice right now even without a scheduled date yet.`,
    estimatedMinutes: 18,
    primaryOpportunityId: opportunity.id,
    supportingOpportunityIds: otherActiveOpportunityIds(activeOpportunities, opportunity.id),
    signals: [signal],
  });
}

function buildReviewedObservationRecommendation(observation: CoachObservation): PracticeRecommendation {
  const text = effectiveObservationText(observation);
  const format = formatForObservation(observation);
  const signal: PracticeRecommendationSignal = {
    kind: "reviewed_observation",
    label: `reviewed ${humanizeObservationType(observation.observationType)}`,
    detail: text,
  };
  return withCommonFields(format, {
    primaryFocus: `Work on: ${text}`,
    secondaryFocus: null,
    rationale: `You confirmed a coaching observation -- ${text} -- so this practice targets it directly.`,
    estimatedMinutes: 12,
    primaryOpportunityId: null,
    supportingOpportunityIds: [],
    signals: [signal],
  });
}

function buildStoryGapRecommendation(
  opportunity: Opportunity,
  activeOpportunities: Opportunity[],
): PracticeRecommendation {
  const signal: PracticeRecommendationSignal = {
    kind: "story_bank_gap",
    label: "story bank",
    detail: "no confirmed stories yet",
  };
  return withCommonFields("story_work", {
    primaryFocus: `Build a confirmed story for the ${opportunity.company} ${opportunity.role} application`,
    secondaryFocus: null,
    rationale: `You have an active application at ${opportunity.company} but no confirmed career story yet, so building one reusable, real example comes before generic drilling.`,
    estimatedMinutes: 15,
    primaryOpportunityId: opportunity.id,
    supportingOpportunityIds: otherActiveOpportunityIds(activeOpportunities, opportunity.id),
    signals: [signal],
  });
}

function buildProgressWeaknessRecommendation(progress: ProgressSnapshot): PracticeRecommendation {
  const focusText = progress.weakest?.name ?? progress.recurringWeaknesses[0] ?? "your current weakest area";
  const signal: PracticeRecommendationSignal = {
    kind: "progress_weakness",
    label: "progress signal",
    detail: progress.weakest
      ? `${progress.weakest.name} is currently weakest`
      : `recurring theme: ${progress.recurringWeaknesses[0]}`,
  };
  return withCommonFields("targeted_drill", {
    primaryFocus: `Strengthen: ${focusText}`,
    secondaryFocus: null,
    rationale: `Your coaching progress points to ${focusText} as the area most worth drilling next.`,
    estimatedMinutes: 12,
    primaryOpportunityId: null,
    supportingOpportunityIds: [],
    signals: [signal],
  });
}

function buildAppliedOpportunityRecommendation(
  opportunity: Opportunity,
  activeOpportunities: Opportunity[],
): PracticeRecommendation {
  const signal: PracticeRecommendationSignal = {
    kind: "applied_opportunity",
    label: "active application",
    detail: `${opportunity.company} · applied`,
  };
  return withCommonFields("role_prep", {
    primaryFocus: `Prepare for the ${opportunity.company} ${opportunity.role} application`,
    secondaryFocus: null,
    rationale: `You've applied to ${opportunity.company}, so getting role-ready ahead of any interview invite is the best use of practice time.`,
    estimatedMinutes: 18,
    primaryOpportunityId: opportunity.id,
    supportingOpportunityIds: otherActiveOpportunityIds(activeOpportunities, opportunity.id),
    signals: [signal],
  });
}

function buildFirstPracticeRecommendation(): PracticeRecommendation {
  const signal: PracticeRecommendationSignal = {
    kind: "first_practice",
    label: "first practice",
    detail: "no completed practice sessions yet",
  };
  return withCommonFields("self_presentation", {
    primaryFocus: "Build your self-presentation foundation",
    secondaryFocus: null,
    rationale: "You haven't completed a practice session yet, so starting with a short self-presentation warm-up builds a baseline before longer formats.",
    estimatedMinutes: 10,
    primaryOpportunityId: null,
    supportingOpportunityIds: [],
    signals: [signal],
  });
}

function buildFallbackRecommendation(): PracticeRecommendation {
  const signal: PracticeRecommendationSignal = {
    kind: "fallback",
    label: "general readiness",
    detail: "no urgent signals right now",
  };
  return withCommonFields("full_simulation", {
    primaryFocus: "Run a full mock interview simulation",
    secondaryFocus: null,
    rationale: "There's no urgent opportunity, reviewed observation, or progress signal driving practice right now, so a full simulation keeps every competency fresh.",
    estimatedMinutes: 30,
    primaryOpportunityId: null,
    supportingOpportunityIds: [],
    signals: [signal],
  });
}

/**
 * Deterministically selects the single highest-priority baseline practice
 * recommendation for the Release 2 Home command center. Pure and
 * synchronous: never calls an LLM, never reads the clock itself (`now` is
 * always caller-supplied), and never mutates its inputs. See
 * `docs/superpowers/specs/2026-08-31-career-brain-release-2-relay-rework-design.md`
 * section 5 for the precedence contract implemented here; the first
 * satisfied branch wins:
 *
 * 1. an upcoming interview within 7 days for a non-terminal applied/interviewing opportunity;
 * 2. any interviewing opportunity without a near-term date;
 * 3. a confirmed/corrected coach observation with importance >= 0.6;
 * 4. an applied/interviewing opportunity with zero confirmed career stories;
 * 5. a weakest competency or recurring weakness on the progress snapshot;
 * 6. an applied opportunity;
 * 7. zero completed practice sessions;
 * 8. fallback to a full simulation.
 *
 * Terminal opportunity statuses (`offer`, `rejected`, `withdrawn`, `closed`)
 * never create urgency and are excluded up front. `recentPlans` is accepted
 * for interface parity with the design's stated inputs but is not yet
 * consulted -- Release 2's precedence rules do not reference prior plans.
 */
export function recommendPractice(input: PracticeRecommendationInput): PracticeRecommendation {
  const { opportunities, observations, stories, progress, recentSessions, now } = input;
  const activeOpportunities = opportunities.filter((opportunity) => !isTerminal(opportunity.status));

  const nearTermInterview = pickNearTermInterview(activeOpportunities, now);
  if (nearTermInterview) {
    return buildNearTermInterviewRecommendation(nearTermInterview, activeOpportunities, now);
  }

  const interviewingOpportunity = pickInterviewingOpportunity(activeOpportunities);
  if (interviewingOpportunity) {
    return buildInterviewingRecommendation(interviewingOpportunity, activeOpportunities);
  }

  const reviewedObservation = pickReviewedObservation(observations);
  if (reviewedObservation) {
    return buildReviewedObservationRecommendation(reviewedObservation);
  }

  const hasConfirmedStory = stories.some((story) => story.reviewState === "confirmed");
  const activeApplication = pickActiveApplicationOpportunity(activeOpportunities);
  if (activeApplication && !hasConfirmedStory) {
    return buildStoryGapRecommendation(activeApplication, activeOpportunities);
  }

  if (progress.weakest || progress.recurringWeaknesses.length > 0) {
    return buildProgressWeaknessRecommendation(progress);
  }

  const appliedOpportunity = pickAppliedOpportunity(activeOpportunities);
  if (appliedOpportunity) {
    return buildAppliedOpportunityRecommendation(appliedOpportunity, activeOpportunities);
  }

  const hasCompletedSession = recentSessions.some((session) => session.status === "complete");
  if (!hasCompletedSession) {
    return buildFirstPracticeRecommendation();
  }

  return buildFallbackRecommendation();
}
