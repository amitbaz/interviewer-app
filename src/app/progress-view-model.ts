import type { ReadinessDimensionResult, ReadinessModel } from "@/lib/types";

export type ReadinessViewModel = {
  hasEvidence: boolean;
  readiness: number | null;
  weakest: ReadinessDimensionResult | null;
};

/**
 * The weakest dimension worth showing as a coaching focus, or null when none
 * qualifies. Only dimensions with `confidence !== null` are eligible -- a
 * dimension with zero evidence behind it is an unknown, not a weakness (see
 * the same rule in `src/lib/practice-recommendation.ts`'s
 * `weakestConfidentDimension`).
 */
function weakestConfidentDimension(model: ReadinessModel): ReadinessDimensionResult | null {
  const confident = model.dimensions.filter((entry) => entry.confidence !== null);
  if (confident.length === 0) return null;
  return [...confident].sort(
    (left, right) => (left.score as number) - (right.score as number) || left.dimension.localeCompare(right.dimension),
  )[0];
}

/**
 * Selects the server-calculated readiness fields that drive the UI. The
 * page deliberately consumes the model as-is instead of rebuilding
 * readiness or practice focus from profile competency aggregates.
 */
export function readinessViewModel(model: ReadinessModel | null): ReadinessViewModel {
  return {
    hasEvidence: model !== null && model.overall !== null,
    readiness: model?.overall ?? null,
    weakest: model ? weakestConfidentDimension(model) : null,
  };
}
