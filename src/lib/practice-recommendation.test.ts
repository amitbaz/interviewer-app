import { describe, expect, it } from "vitest";
import { recommendPractice } from "@/lib/practice-recommendation";
import type {
  CareerStory,
  CoachObservation,
  Competency,
  InterviewSession,
  Opportunity,
  OpportunityStatus,
  PracticeRecommendationInput,
  ProgressSnapshot,
} from "@/lib/types";

const now = new Date("2026-08-31T08:00:00.000Z");

const opportunity: Opportunity = {
  id: "opportunity-1",
  userId: "user-1",
  company: "Example Co",
  role: "Staff Engineer",
  status: "considering",
  location: null,
  remote: null,
  jobUrl: null,
  jobDescription: null,
  sourceLabel: null,
  sourceSystem: null,
  sourceExternalId: null,
  matchScore: null,
  strengths: [],
  gaps: [],
  notes: null,
  appliedAt: null,
  nextInterviewAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const observation: CoachObservation = {
  id: "observation-1",
  userId: "user-1",
  observationType: "knowledge_gap",
  claim: "Skips discussing trade-offs.",
  confidence: 0.7,
  importance: 0.7,
  trend: "unresolved",
  reviewState: "unreviewed",
  userCorrection: null,
  firstSeenAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: "2026-08-20T00:00:00.000Z",
  confirmedAt: null,
  correctedAt: null,
  dismissedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const story = (overrides: Partial<CareerStory> = {}): CareerStory => ({
  id: "story-1",
  userId: "user-1",
  title: "Migrated the billing pipeline",
  situation: null,
  responsibility: null,
  problem: null,
  actions: null,
  alternatives: null,
  tradeoffs: null,
  ownership: null,
  outcome: null,
  lessons: null,
  tags: [],
  completeness: 0.5,
  reviewState: "confirmed",
  confirmedAt: "2026-08-10T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  ...overrides,
});

const competency = (overrides: Partial<Competency> = {}): Competency => ({
  id: "competency-1",
  name: "Architecture framing",
  relevance: 1,
  expectedLevel: "senior",
  estimatedLevel: "senior",
  confidence: "medium",
  lastPracticedAt: "2026-08-20T00:00:00.000Z",
  questionCount: 3,
  averageScore: 6,
  recentScore: 6,
  strengths: [],
  weaknesses: [],
  ...overrides,
});

const progress: ProgressSnapshot = {
  readiness: 60,
  latestScore: 7,
  trend: "stable",
  recentScores: [7],
  strongest: null,
  weakest: null,
  recurringWeaknesses: [],
};

const completedSession: InterviewSession = {
  id: "session-1",
  userId: "user-1",
  kind: "conversation",
  roundId: "tech-lead",
  mode: "real",
  degraded: false,
  status: "complete",
  startedAt: "2026-08-20T09:00:00.000Z",
  completedAt: "2026-08-20T10:00:00.000Z",
  exercise: {},
  resultSummary: {},
  overallScore: 7,
  questions: [],
  checkpoints: [],
  evaluations: [],
  messages: [],
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
  practicePlanId: null,
  opportunityId: null,
};

// A neutral baseline: one completed session (so branch 7 does not fire) and
// no other signals, so the default falls through to the branch-8 fallback
// unless a test overrides fields to exercise an earlier branch.
const baseInput: PracticeRecommendationInput = {
  opportunities: [],
  observations: [],
  stories: [],
  progress,
  recentSessions: [completedSession],
  recentPlans: [],
  now,
};

describe("recommendPractice", () => {
  it("prioritizes an interview in three days over a generic weakness", () => {
    const result = recommendPractice({
      ...baseInput,
      now: new Date("2026-08-31T08:00:00Z"),
      opportunities: [{
        ...opportunity,
        status: "interviewing",
        nextInterviewAt: "2026-09-03T10:00:00Z",
      }],
      progress: { ...progress, recurringWeaknesses: ["Architecture framing"] },
    });
    expect(result).toMatchObject({ format: "role_prep", primaryOpportunityId: opportunity.id });
    expect(result.signals[0]).toMatchObject({ kind: "upcoming_interview", detail: "Example Co · in 3 days" });
    expect(result.signals[0].detail).not.toContain(opportunity.id);
    expect(result.rationale.length).toBeGreaterThan(0);
    expect(result.rationale).toContain("Example Co");
  });

  it("uses corrected observation text", () => {
    const result = recommendPractice({
      ...baseInput,
      observations: [{
        ...observation,
        reviewState: "corrected",
        importance: 0.9,
        userCorrection: "Make ownership explicit.",
      }],
    });
    expect(result.primaryFocus).toContain("Make ownership explicit");
  });

  it("recommends role prep for any interviewing opportunity without a near-term date", () => {
    const result = recommendPractice({
      ...baseInput,
      opportunities: [{ ...opportunity, status: "interviewing", nextInterviewAt: null }],
    });
    expect(result).toMatchObject({ format: "role_prep", primaryOpportunityId: opportunity.id });
    expect(result.signals[0].kind).toBe("interviewing_opportunity");
  });

  it("selects a confirmed high-importance observation and maps story_gap to story_work", () => {
    const result = recommendPractice({
      ...baseInput,
      observations: [{
        ...observation,
        observationType: "story_gap",
        reviewState: "confirmed",
        importance: 0.8,
      }],
    });
    expect(result.format).toBe("story_work");
    expect(result.estimatedMinutes).toBe(12);
  });

  it("never lets a dismissed observation drive the recommendation", () => {
    const result = recommendPractice({
      ...baseInput,
      observations: [{ ...observation, reviewState: "dismissed", importance: 0.95 }],
    });
    expect(result.format).toBe("full_simulation");
  });

  it("never lets an unreviewed observation drive the recommendation", () => {
    const result = recommendPractice({
      ...baseInput,
      observations: [{ ...observation, reviewState: "unreviewed", importance: 0.95 }],
    });
    expect(result.format).toBe("full_simulation");
  });

  /**
   * A confirmed strength is not a practice target. Without a type filter the
   * catch-all in `formatForObservation` routes it to `targeted_drill`, and the
   * user is told to "Work on:" something they already do well.
   */
  it.each(["strength", "story_strength"] as const)(
    "never lets a confirmed %s drive the recommendation",
    (observationType) => {
      const result = recommendPractice({
        ...baseInput,
        observations: [{
          ...observation,
          observationType,
          reviewState: "confirmed",
          importance: 0.95,
          claim: "You consistently give clear architecture answers",
        }],
      });

      expect(result.format).toBe("full_simulation");
      expect(result.primaryFocus).not.toContain("You consistently give clear architecture answers");
    },
  );

  it("still selects a lower-importance reviewed weakness over a confirmed strength", () => {
    const result = recommendPractice({
      ...baseInput,
      observations: [
        { ...observation, id: "observation-strength", observationType: "strength", reviewState: "confirmed", importance: 0.95 },
        {
          ...observation,
          id: "observation-weakness",
          observationType: "weakness",
          reviewState: "confirmed",
          importance: 0.7,
          claim: "You skip the trade-off when you close an answer",
        },
      ],
    });

    expect(result.format).toBe("targeted_drill");
    expect(result.primaryFocus).toContain("You skip the trade-off when you close an answer");
  });

  it("maps a reviewed answer_habit/delivery_pattern observation to technical_communication by default", () => {
    const result = recommendPractice({
      ...baseInput,
      observations: [{
        ...observation,
        observationType: "answer_habit",
        reviewState: "confirmed",
        importance: 0.7,
        claim: "Rambles before getting to the point.",
      }],
    });
    expect(result.format).toBe("technical_communication");
  });

  it("maps a reviewed answer_habit/delivery_pattern observation to behavioral when clearly behavioral", () => {
    const result = recommendPractice({
      ...baseInput,
      observations: [{
        ...observation,
        observationType: "delivery_pattern",
        reviewState: "confirmed",
        importance: 0.7,
        claim: "Avoids naming their role in team conflict stories.",
      }],
    });
    expect(result.format).toBe("behavioral");
  });

  it("recommends story_work for an active application with zero confirmed stories", () => {
    const result = recommendPractice({
      ...baseInput,
      opportunities: [{ ...opportunity, status: "applied", appliedAt: "2026-08-15T00:00:00.000Z" }],
      stories: [story({ reviewState: "draft" })],
    });
    expect(result).toMatchObject({ format: "story_work", primaryOpportunityId: opportunity.id });
    expect(result.signals[0]).toMatchObject({ kind: "story_bank_gap", detail: "no confirmed stories yet" });
  });

  it("recommends a targeted drill for the weakest competency when no stronger signal exists", () => {
    const result = recommendPractice({
      ...baseInput,
      progress: { ...progress, weakest: competency({ name: "System design" }) },
    });
    expect(result.format).toBe("targeted_drill");
    expect(result.primaryFocus).toContain("System design");
  });

  it("recommends a targeted drill for a recurring weakness when there is no weakest competency", () => {
    const result = recommendPractice({
      ...baseInput,
      progress: { ...progress, recurringWeaknesses: ["Quantify trade-offs"] },
    });
    expect(result.format).toBe("targeted_drill");
    expect(result.primaryFocus).toContain("Quantify trade-offs");
  });

  it("recommends role prep for an applied opportunity once stories and progress are covered", () => {
    const result = recommendPractice({
      ...baseInput,
      opportunities: [{ ...opportunity, status: "applied" }],
      stories: [story({ reviewState: "confirmed" })],
    });
    expect(result).toMatchObject({ format: "role_prep", primaryOpportunityId: opportunity.id });
    expect(result.signals[0].kind).toBe("applied_opportunity");
  });

  it("falls back to self-presentation for a first-time user with no completed sessions", () => {
    const result = recommendPractice({ ...baseInput, recentSessions: [] });
    expect(result.format).toBe("self_presentation");
    expect(result.estimatedMinutes).toBe(10);
  });

  it("falls back to a full simulation when no other signal applies", () => {
    const result = recommendPractice(baseInput);
    expect(result.format).toBe("full_simulation");
    expect(result.estimatedMinutes).toBe(30);
    expect(result.primaryOpportunityId).toBeNull();
  });

  it("never lets a terminal opportunity create urgency even with a near-term interview date", () => {
    const terminalStatuses: OpportunityStatus[] = ["offer", "rejected", "withdrawn", "closed"];
    for (const status of terminalStatuses) {
      const result = recommendPractice({
        ...baseInput,
        opportunities: [{ ...opportunity, status, nextInterviewAt: "2026-09-03T10:00:00Z" }],
      });
      expect(result.format).toBe("full_simulation");
      expect(result.primaryOpportunityId).toBeNull();
    }
  });

  it("produces a deterministic, sorted supportingOpportunityIds excluding the primary and any terminal opportunity", () => {
    const primaryOpportunity = { ...opportunity, id: "opportunity-b", status: "interviewing" as const, nextInterviewAt: null };
    const supportingOpportunity = { ...opportunity, id: "opportunity-a", status: "considering" as const };
    const terminalOpportunity = { ...opportunity, id: "opportunity-c", status: "rejected" as const };
    const result = recommendPractice({
      ...baseInput,
      opportunities: [primaryOpportunity, supportingOpportunity, terminalOpportunity],
    });
    expect(result.primaryOpportunityId).toBe("opportunity-b");
    expect(result.supportingOpportunityIds).toEqual(["opportunity-a"]);
  });
});
