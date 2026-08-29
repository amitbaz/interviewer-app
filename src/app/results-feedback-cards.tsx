"use client";

import { useState } from "react";
import type { InterviewSession } from "@/lib/types";

const evaluationDimensionLabels = [
  ["correctness", "Correctness"],
  ["depth", "Depth"],
  ["clarity", "Clarity"],
  ["structure", "Structure"],
  ["practicalExperience", "Practical experience"],
  ["tradeOffAwareness", "Trade-off awareness"],
  ["communication", "Communication"],
  ["confidence", "Confidence"],
  ["relevance", "Relevance"],
] as const;

type EvaluationDimensionKey = keyof InterviewSession["evaluations"][number]["dimensions"];

function slugToken(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function evaluationKey(session: InterviewSession, index: number): string {
  const evaluation = session.evaluations[index];
  const scope = evaluation.questionId
    ? `question-${slugToken(evaluation.questionId, `question-${index}`)}`
    : `${slugToken(evaluation.competencyId, "general")}-${slugToken(evaluation.competency, `evaluation-${index}`)}`;
  return `${scope}-${index}`;
}

function startViewTransition(update: () => void) {
  const documentWithTransition = document as Document & { startViewTransition?: (callback: () => void) => void };
  if (documentWithTransition.startViewTransition) {
    documentWithTransition.startViewTransition(update);
    return;
  }
  update();
}

/**
 * Renders per-evaluation interview coaching with accessible disclosure controls and
 * question-linked details when question evidence exists for that evaluation.
 */
export function ResultsFeedbackCards({ session }: { session: InterviewSession }) {
  const answeredQuestions = session.questions.filter((question) => Boolean(question.answer));
  const answeredQuestionsById = new Map(answeredQuestions.map((question) => [question.id, question]));
  const [expandedEvaluationKey, setExpandedEvaluationKey] = useState<string | null>(null);

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {session.evaluations.map((evaluation, index) => {
        const currentKey = evaluationKey(session, index);
        const expanded = expandedEvaluationKey === currentKey;
        const buttonId = `${currentKey}-toggle`;
        const regionId = `${currentKey}-details`;
        const answeredQuestion = evaluation.questionId
          ? answeredQuestionsById.get(evaluation.questionId) ?? null
          : answeredQuestions[index] ?? null;
        const dimensions = evaluationDimensionLabels.filter(([key]) => {
          const value = evaluation.dimensions[key as EvaluationDimensionKey];
          return typeof value === "number" && Number.isFinite(value);
        });

        return (
          <article
            key={currentKey}
            className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5"
            style={{ viewTransitionName: `evaluation-card-${currentKey}` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{evaluation.competency}</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{evaluation.strengths[0] ?? evaluation.needsWork[0] ?? "Open the details to review the full coaching."}</p>
              </div>
              <span className="shrink-0 font-semibold text-[var(--pine)]">{evaluation.score}/10</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4 text-sm">
                {evaluation.strengths[0] && <div><p className="font-semibold text-[#416151]">Good</p><p className="leading-6 text-[var(--ink-muted)]">{evaluation.strengths[0]}</p></div>}
                {evaluation.needsWork[0] && <div><p className="font-semibold text-[#8e5e20]">Try next</p><p className="leading-6 text-[var(--ink-muted)]">{evaluation.needsWork[0]}</p></div>}
              </div>
              <button
                type="button"
                id={buttonId}
                aria-controls={regionId}
                aria-expanded={expanded}
                aria-label={`${evaluation.competency} feedback`}
                onClick={() => startViewTransition(() => setExpandedEvaluationKey((current) => current === currentKey ? null : currentKey))}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--pine)]"
              >
                {expanded ? "Hide details" : "Show details"}
                <span
                  aria-hidden="true"
                  className={`text-base transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-45" : "rotate-0"}`}
                >
                  +
                </span>
              </button>
            </div>
            {expanded && (
              <div
                id={regionId}
                role="region"
                aria-labelledby={buttonId}
                className="mt-5 space-y-5 border-t border-[var(--line)] pt-5 text-sm"
              >
                {answeredQuestion && (
                  <div className="space-y-3">
                    <div>
                      <p className="font-semibold text-[var(--ink-muted)]">Question</p>
                      <p className="mt-1 leading-6">{answeredQuestion.prompt}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--ink-muted)]">Your answer</p>
                      <p className="mt-1 leading-6">{answeredQuestion.answer}</p>
                    </div>
                  </div>
                )}
                {dimensions.length > 0 && (
                  <div>
                    <p className="font-semibold text-[var(--ink-muted)]">Dimensions</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {dimensions.map(([key, label]) => (
                        <div key={key} className="rounded-2xl bg-[#eef3e7] px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#537053]">{label}</p>
                          <p className="mt-1 font-semibold text-[#1d332b]">{evaluation.dimensions[key as EvaluationDimensionKey]}/10</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {evaluation.strengths.length > 0 && (
                  <div>
                    <p className="font-semibold text-[var(--ink-muted)]">Strengths</p>
                    <ul className="mt-3 space-y-2 leading-6 text-[var(--ink-muted)]">
                      {evaluation.strengths.map((strength) => <li key={strength} className="rounded-2xl bg-[#eef3e7] px-3 py-3 text-[#38502e]">{strength}</li>)}
                    </ul>
                  </div>
                )}
                {evaluation.missingPoints.length > 0 && (
                  <div>
                    <p className="font-semibold text-[var(--ink-muted)]">Missing points</p>
                    <ul className="mt-3 space-y-2 leading-6 text-[var(--ink-muted)]">
                      {evaluation.missingPoints.map((point) => <li key={point} className="rounded-2xl bg-[#fff6eb] px-3 py-3 text-[#8e5e20]">{point}</li>)}
                    </ul>
                  </div>
                )}
                {evaluation.betterStructure.length > 0 && (
                  <div>
                    <p className="font-semibold text-[var(--ink-muted)]">Better structure</p>
                    <ul className="mt-3 space-y-2 leading-6 text-[var(--ink-muted)]">
                      {evaluation.betterStructure.map((item) => <li key={item} className="rounded-2xl bg-white px-3 py-3">{item}</li>)}
                    </ul>
                  </div>
                )}
                {evaluation.improvedAnswer && (
                  <div>
                    <p className="font-semibold text-[var(--ink-muted)]">Improved answer</p>
                    <p className="mt-3 rounded-2xl bg-[#f4f1eb] px-4 py-4 leading-6">{evaluation.improvedAnswer}</p>
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
