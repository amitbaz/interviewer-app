/**
 * How much a single piece of evidence counts, before any aggregation.
 *
 * Weight has three independent factors, multiplied:
 *   strength  -- how realistic the conditions were (this file)
 *   decay     -- how long ago it happened (this file)
 *   relevance -- how much the underlying skill matters for the target role
 *
 * All three are pure functions of already-persisted data. Nothing here calls a
 * model, so the same evidence always produces the same weight -- the
 * determinism issue #14 requires.
 */
import type { InterviewMode } from "@/lib/types";

/**
 * Half-life in days: evidence carries half its weight after this long.
 *
 * Tuning knob, not a law. Shorter makes readiness responsive but jumpy across a
 * quiet fortnight; longer makes an old baseline hard to outrun. 60 days was
 * chosen so a few weeks of consistent practice can visibly move a dimension
 * while a single stale session cannot dominate it.
 */
export const RECENCY_HALF_LIFE_DAYS = 60;

/**
 * Evidence fades but is never erased -- issue #14 requires old evidence to
 * "gradually lose influence without being deleted". This floor is what keeps a
 * long, sparse history from silently becoming no history at all.
 */
export const MINIMUM_RECENCY_FACTOR = 0.05;

const REAL_MODE_STRENGTH = 1;
/**
 * A coach-mode answer is teaching, not proof. The gap has to be wide enough
 * that a run of coaching sessions cannot pass for demonstrated ability.
 */
const COACH_MODE_STRENGTH = 0.4;

/** Indexed by rescue count; anything beyond the last entry uses the last entry. */
const ASSISTANCE_FACTORS = [1, 0.6, 0.35] as const;

/** A degraded session ran on the deterministic fallback, so it proves less. */
const DEGRADED_FACTOR = 0.5;

export type EvidenceConditions = {
  mode: InterviewMode;
  degraded: boolean;
  /** How many times the interviewer had to rescue this specific question. */
  assistanceCount: number;
};

export function evidenceStrength(conditions: EvidenceConditions): number {
  const base = conditions.mode === "real" ? REAL_MODE_STRENGTH : COACH_MODE_STRENGTH;
  const index = Math.min(Math.max(0, Math.trunc(conditions.assistanceCount)), ASSISTANCE_FACTORS.length - 1);
  const assistance = ASSISTANCE_FACTORS[index];
  const degraded = conditions.degraded ? DEGRADED_FACTOR : 1;
  return Number((base * assistance * degraded).toFixed(4));
}

/**
 * Exponential decay on the age of the evidence, floored so nothing disappears.
 * `asOf` is injected rather than read from the clock so tests are deterministic.
 */
export function recencyFactor(recordedAt: string, asOf: Date, halfLifeDays = RECENCY_HALF_LIFE_DAYS): number {
  const recorded = new Date(recordedAt).getTime();
  if (Number.isNaN(recorded)) return MINIMUM_RECENCY_FACTOR;
  const ageDays = Math.max(0, (asOf.getTime() - recorded) / 86_400_000);
  const decayed = Math.pow(0.5, ageDays / halfLifeDays);
  return Number(Math.max(MINIMUM_RECENCY_FACTOR, decayed).toFixed(4));
}
