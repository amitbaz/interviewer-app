import type { CoverageTarget, Evaluation, Intent, PlannedQuestion, TargetState, TargetStatus } from "@/lib/types";

/** Session-level intents carry no target; question-level intents all do. */
export function targetIdOf(intent: Intent): string | null {
  return "targetId" in intent ? intent.targetId : null;
}

export function rescuesSpentInSession(questions: PlannedQuestion[]): number {
  return questions.reduce((total, question) => total + question.assistance.length, 0);
}

function statusFor(
  target: CoverageTarget,
  intents: Intent[],
  answeredEvaluations: Evaluation[],
): TargetStatus {
  if (intents.length === 0) return "unasked";

  const signalsPresent = new Set(
    answeredEvaluations.flatMap((item) => item.expectedSignalsPresent ?? []),
  );
  const covered = target.expectedSignals.length > 0
    && target.expectedSignals.every((signal) => signalsPresent.has(signal));
  if (covered) return "satisfied";

  const last = intents[intents.length - 1];
  if (last.kind === "rescue" && last.style === "park") return "parked";
  return "open";
}

/**
 * Rebuilds the director's view of the session from persisted rows. Recomputed
 * every turn rather than stored, so it cannot drift from the questions and
 * evaluations it describes (spec §9.2).
 *
 * A non-answer turn contributes an intent and a spent turn but never evidence,
 * so it can never satisfy a target (spec §3.4): its evaluation, if any, is
 * excluded from the signals-present set below.
 */
export function deriveCoverageState(
  targets: CoverageTarget[],
  questions: PlannedQuestion[],
  evaluations: Evaluation[],
): TargetState[] {
  return targets.map((target) => {
    const forTarget = questions.filter(
      (question) => question.askedIntent && targetIdOf(question.askedIntent) === target.id,
    );
    const intents = forTarget.map((question) => question.askedIntent as Intent);
    const scored = forTarget.filter((question) => !question.nonAnswer);
    const scoredIds = new Set(scored.map((question) => question.id));
    const relevantEvaluations = evaluations.filter(
      (item) => item.questionId != null && scoredIds.has(item.questionId),
    );

    return {
      target,
      status: statusFor(target, intents, relevantEvaluations),
      turnsSpent: forTarget.length,
      rescuesSpent: forTarget.reduce((total, question) => total + question.assistance.length, 0),
      askedIntents: intents,
    };
  });
}
