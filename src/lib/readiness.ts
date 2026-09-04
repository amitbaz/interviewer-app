/**
 * Relay's single interview-readiness model.
 *
 * One graded answer is one piece of evidence. Each is assigned to exactly one
 * of the seven readiness dimensions and weighted by
 *
 *   weight = strength(interview conditions) x recency(age) x relevance(role fit)
 *
 * A dimension's score is the weight-weighted mean of its evidence, rescaled
 * from the 0-10 rubric to 0-100. Confidence comes from total accumulated
 * weight, not from a raw count -- three cold demonstrations should read as
 * more confident than eight walked-through answers.
 *
 * Everything here is a pure function of persisted rows. No model call, no
 * clock read (the caller injects `asOf`), so the same evidence always yields
 * the same result.
 */
import { READINESS_DIMENSIONS, dimensionFor, type ReadinessDimension } from "@/lib/readiness-dimensions";
import { RECENCY_HALF_LIFE_DAYS, evidenceStrength, recencyFactor } from "@/lib/readiness-weighting";
import type {
  ReadinessContribution,
  ReadinessDimensionResult,
  ReadinessEvidence,
  ReadinessModel,
  ReadinessTrend,
} from "@/lib/types";

/**
 * Confidence thresholds on total weight. 1.5 is roughly two fresh unassisted
 * real-mode answers; 3.5 is roughly four. Coach-mode evidence accumulates weight
 * far more slowly, which is the point.
 */
const CONFIDENCE_THRESHOLDS = { medium: 1.5, high: 3.5 } as const;

type WeightedEvidence = ReadinessEvidence & { dimension: ReadinessDimension; weight: number };

function weigh(item: ReadinessEvidence, asOf: Date): number {
  const strength = evidenceStrength({
    mode: item.mode,
    degraded: item.degraded,
    assistanceCount: item.assistanceCount,
  });
  const recency = recencyFactor(item.recordedAt, asOf);
  const relevance = Math.max(0, Math.min(1, item.relevance));
  return strength * recency * relevance;
}

function confidenceFor(totalWeight: number): ReadinessDimensionResult["confidence"] {
  if (totalWeight <= 0) return null;
  if (totalWeight >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (totalWeight >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

function weightedMean(items: ReadonlyArray<{ score: number; weight: number }>): number | null {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  const total = items.reduce((sum, item) => sum + item.score * item.weight, 0);
  return total / totalWeight;
}

/** The 0-10 rubric mean presented on the 0-100 readiness scale. */
function toReadinessScale(rubricMean: number): number {
  return Math.round(Math.max(0, Math.min(10, rubricMean)) * 10);
}

function contributionsFor(items: ReadonlyArray<WeightedEvidence>): ReadinessContribution[] {
  return items
    .map((item) => ({
      questionEvaluationId: item.questionEvaluationId,
      sessionId: item.sessionId,
      recordedAt: item.recordedAt,
      score: item.score,
      weight: Number(item.weight.toFixed(4)),
    }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Comparison boundary on the 0-10 rubric scale. This compares weighted means
 * of two windows rather than two raw session scores, so it needs a wider
 * boundary than the old score-to-score comparison did to stop a single weak
 * answer from flipping the trend -- which is the swing issue #14 asks to
 * eliminate.
 */
const TREND_DELTA_BOUNDARY = 1.25;

/**
 * Each half of the comparison needs this much weight before a trend is
 * claimed. Below it the honest answer is `unresolved`, not a guess -- the
 * fourth trend value exists precisely so sparse history has somewhere to go.
 */
const TREND_MINIMUM_WEIGHT = 0.75;

/**
 * Splits the evidence at one half-life ago and compares the weighted means of
 * the two halves.
 *
 * A window comparison rather than a last-two-scores comparison: the old rule
 * flipped on any single weak answer, which is exactly the swing issue #14 asks
 * us to stop.
 */
function trendFor(items: ReadonlyArray<WeightedEvidence>, asOf: Date): ReadinessTrend {
  const boundary = asOf.getTime() - RECENCY_HALF_LIFE_DAYS * 86_400_000;
  const recent: WeightedEvidence[] = [];
  const older: WeightedEvidence[] = [];
  for (const item of items) {
    const at = new Date(item.recordedAt).getTime();
    if (Number.isNaN(at)) continue;
    (at >= boundary ? recent : older).push(item);
  }

  const recentWeight = recent.reduce((sum, item) => sum + item.weight, 0);
  const olderWeight = older.reduce((sum, item) => sum + item.weight, 0);
  if (recentWeight < TREND_MINIMUM_WEIGHT || olderWeight < TREND_MINIMUM_WEIGHT) return "unresolved";

  const recentMean = weightedMean(recent);
  const olderMean = weightedMean(older);
  if (recentMean === null || olderMean === null) return "unresolved";

  const delta = recentMean - olderMean;
  if (delta >= TREND_DELTA_BOUNDARY) return "improving";
  if (delta <= -TREND_DELTA_BOUNDARY) return "worsening";
  return "stable";
}

export function calculateReadiness(evidence: ReadinessEvidence[], asOf: Date = new Date()): ReadinessModel {
  const weighted: WeightedEvidence[] = [];
  let unmappedEvidenceCount = 0;

  for (const item of evidence) {
    const dimension = dimensionFor({ competencyName: item.competencyName, category: item.category });
    if (!dimension) {
      unmappedEvidenceCount += 1;
      continue;
    }
    weighted.push({ ...item, dimension, weight: weigh(item, asOf) });
  }

  const dimensions: ReadinessDimensionResult[] = READINESS_DIMENSIONS.map((dimension) => {
    const items = weighted.filter((item) => item.dimension === dimension);
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    const rubricMean = weightedMean(items);
    return {
      dimension,
      score: rubricMean === null ? null : toReadinessScale(rubricMean),
      confidence: confidenceFor(totalWeight),
      trend: trendFor(items, asOf),
      evidenceCount: items.length,
      totalWeight: Number(totalWeight.toFixed(4)),
      contributions: contributionsFor(items),
    };
  });

  return {
    ...overallFor(dimensions, weighted, asOf),
    dimensions,
    unmappedEvidenceCount,
    computedAt: asOf.toISOString(),
  };
}

/**
 * The overall score is a weighted mean OF THE DIMENSION SCORES -- never a
 * separate pass over raw evidence. Issue #14 requires it to be derived, so a
 * dimension and the overall number can never disagree about the same history.
 *
 * Each dimension is weighted by its own accumulated evidence weight, so a
 * dimension backed by one hesitant answer cannot swing the headline number as
 * hard as one backed by a dozen strong ones.
 */
function overallFor(
  dimensions: ReadinessDimensionResult[],
  weighted: ReadonlyArray<WeightedEvidence>,
  asOf: Date,
): Pick<ReadinessModel, "overall" | "overallConfidence" | "overallTrend"> {
  const scored = dimensions.filter(
    (entry): entry is ReadinessDimensionResult & { score: number } => entry.score !== null && entry.totalWeight > 0,
  );
  const totalWeight = scored.reduce((sum, entry) => sum + entry.totalWeight, 0);
  const overall = totalWeight <= 0
    ? null
    : Math.round(scored.reduce((sum, entry) => sum + entry.score * entry.totalWeight, 0) / totalWeight);
  return {
    overall,
    overallConfidence: confidenceFor(totalWeight),
    overallTrend: trendFor(weighted, asOf),
  };
}

/**
 * The weakest dimension worth calling a weakness, or null when none
 * qualifies. Only dimensions with `confidence !== null` are eligible -- a
 * dimension with zero evidence behind it is an unknown, not a weakness, and
 * treating it as one would recommend drilling an area Relay has never
 * actually observed (the unrealistic swing issue #14 exists to prevent).
 * Ties are broken by dimension name for determinism.
 *
 * Shared by every consumer that needs "which dimension is the coaching
 * priority right now" -- `practice-recommendation.ts`'s baseline selector
 * and `progress-view-model.ts`'s Progress-view read model both call this
 * rather than keeping their own copy of the rule, so they can never disagree
 * about which dimension is weakest.
 */
export function weakestConfidentDimension(readiness: ReadinessModel): ReadinessDimensionResult | null {
  const confident = readiness.dimensions.filter((entry) => entry.confidence !== null);
  if (confident.length === 0) return null;
  return [...confident].sort(
    (left, right) => (left.score as number) - (right.score as number) || left.dimension.localeCompare(right.dimension),
  )[0];
}
