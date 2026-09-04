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
import { evidenceStrength, recencyFactor } from "@/lib/readiness-weighting";
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

function trendFor(_items: ReadonlyArray<WeightedEvidence>, _asOf: Date): ReadinessTrend {
  return "unresolved";
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
