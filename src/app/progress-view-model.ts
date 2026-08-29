import type { Competency, ProgressSnapshot } from "@/lib/types";

export type ProgressViewModel = {
  hasEvidence: boolean;
  readiness: number | null;
  weakest: Competency | null;
};

/**
 * Selects the server-calculated progress fields that drive readiness UI.
 * The page deliberately consumes the snapshot as-is instead of rebuilding
 * readiness or practice focus from profile competency aggregates.
 */
export function progressViewModel(progress: ProgressSnapshot | null): ProgressViewModel {
  return {
    hasEvidence: progress !== null && progress.readiness !== null,
    readiness: progress?.readiness ?? null,
    weakest: progress?.weakest ?? null,
  };
}
