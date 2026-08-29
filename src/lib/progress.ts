import type { Competency, InterviewSession, ProgressSnapshot } from "@/lib/types";

const RECENT_SESSION_WEIGHTS = [0.5, 0.3, 0.2] as const;
const READINESS_WEIGHTS = {
  competencyAverage: 0.45,
  confidence: 0.15,
  recentSessionPerformance: 0.4,
} as const;
const TREND_DELTA_BOUNDARY = 0.75;

function clampScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(Math.max(0, Math.min(10, value)).toFixed(1));
}

function confidenceWeight(confidence: Competency["confidence"]): number {
  if (confidence === "high") return 1;
  if (confidence === "medium") return 0.6;
  if (confidence === "low") return 0.25;
  return 0;
}

function sessionTimestamp(session: InterviewSession): number {
  const value = session.completedAt ?? session.updatedAt;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function weightedAverage(values: number[], weights: readonly number[]): number | null {
  const cappedWeights = weights.slice(0, values.length);
  const totalWeight = cappedWeights.reduce((sum, weight) => sum + weight, 0);
  if (values.length === 0 || totalWeight === 0) return null;

  const weightedSum = values.reduce((sum, value, index) => sum + value * cappedWeights[index], 0);
  return weightedSum / totalWeight;
}

function evidenceCompetencies(competencies: Competency[]): Competency[] {
  return competencies.filter((competency) => clampScore(competency.averageScore) !== null);
}

function compareCompetencies(left: Competency, right: Competency, direction: "asc" | "desc"): number {
  const leftScore = clampScore(left.averageScore) ?? 0;
  const rightScore = clampScore(right.averageScore) ?? 0;
  const scoreDelta = direction === "desc" ? rightScore - leftScore : leftScore - rightScore;
  if (scoreDelta !== 0) return scoreDelta;

  const relevanceDelta = direction === "desc"
    ? right.relevance - left.relevance
    : left.relevance - right.relevance;
  if (relevanceDelta !== 0) return relevanceDelta;

  return left.id.localeCompare(right.id);
}

function competencySnapshot(competencies: Competency[], direction: "asc" | "desc"): Competency | null {
  const candidate = [...evidenceCompetencies(competencies)].sort((left, right) => compareCompetencies(left, right, direction))[0];
  if (!candidate) return null;

  return {
    ...candidate,
    averageScore: clampScore(candidate.averageScore),
    recentScore: clampScore(candidate.recentScore),
    strengths: [...candidate.strengths],
    weaknesses: [...candidate.weaknesses],
  };
}

function recurringWeaknesses(sessions: InterviewSession[]): string[] {
  const seen = new Set<string>();
  const weaknesses: string[] = [];

  for (const session of sessions) {
    for (const evaluation of session.evaluations) {
      for (const item of evaluation.needsWork) {
        const normalized = item.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        weaknesses.push(normalized);
      }
    }
  }

  return weaknesses;
}

function readinessScore(competencies: Competency[], recentScores: number[]): number | null {
  const withEvidence = evidenceCompetencies(competencies);
  if (withEvidence.length === 0) return null;

  const totalRelevance = withEvidence.reduce((sum, competency) => sum + Math.max(0, competency.relevance), 0);
  if (totalRelevance === 0) return null;

  const competencyAverage = withEvidence.reduce((sum, competency) => {
    return sum + (clampScore(competency.averageScore) ?? 0) * Math.max(0, competency.relevance);
  }, 0) / totalRelevance;

  const confidenceAverage = withEvidence.reduce((sum, competency) => {
    return sum + confidenceWeight(competency.confidence) * Math.max(0, competency.relevance);
  }, 0) / totalRelevance;

  const recentAverage = weightedAverage(recentScores.slice(0, RECENT_SESSION_WEIGHTS.length), RECENT_SESSION_WEIGHTS) ?? competencyAverage;

  const normalized = (competencyAverage / 10) * READINESS_WEIGHTS.competencyAverage
    + confidenceAverage * READINESS_WEIGHTS.confidence
    + (recentAverage / 10) * READINESS_WEIGHTS.recentSessionPerformance;

  return Math.round(normalized * 100);
}

function trendFor(recentScores: number[]): ProgressSnapshot["trend"] {
  if (recentScores.length === 0) return null;
  if (recentScores.length === 1) return "baseline";

  const delta = recentScores[0] - recentScores[1];
  if (delta >= TREND_DELTA_BOUNDARY) return "improving";
  if (delta <= -TREND_DELTA_BOUNDARY) return "declining";
  return "stable";
}

/**
 * Calculates a deterministic coaching progress snapshot from persisted competency evidence
 * and completed sessions without mutating either input collection.
 *
 * Readiness is a 0-100 coaching signal composed of:
 * - 45% relevance-weighted competency average
 * - 15% relevance-weighted confidence
 * - 40% recent completed-session performance using 0.5 / 0.3 / 0.2 recency weights
 *
 * Trend compares the two most recent completed-session scores and uses a +/-0.75 boundary
 * to distinguish improving or declining from stable movement.
 */
export function calculateProgress(
  competencies: Competency[],
  sessions: InterviewSession[],
): ProgressSnapshot {
  const completedSessions = [...sessions]
    .filter((session) => session.status === "complete")
    .sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left));

  const recentScores = completedSessions
    .map((session) => clampScore(session.overallScore))
    .filter((score): score is number => score !== null);

  return {
    readiness: readinessScore(competencies, recentScores),
    latestScore: recentScores[0] ?? null,
    trend: trendFor(recentScores),
    recentScores,
    strongest: competencySnapshot(competencies, "desc"),
    weakest: competencySnapshot(competencies, "asc"),
    recurringWeaknesses: recurringWeaknesses(completedSessions),
  };
}
