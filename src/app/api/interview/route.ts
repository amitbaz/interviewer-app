import { NextResponse } from "next/server";
import { completeSession as summarizeSession, EVALUATION_DIMENSIONS, evaluateHandsOn, generateInterviewBlueprint, handsOnCheckpoint, handsOnExercise, nextTurn, openingTurn } from "@/lib/coach";
import { canExplicitlyCompleteConversation } from "@/lib/conversation-completion";
import { IMPLEMENTED_ROUNDS } from "@/lib/interview-rounds";
import { completeLinkedPracticePlanBestEffort } from "@/lib/practice-service";
import { calculateProgress } from "@/lib/progress";
import {
  completeHandsOnSession,
  completeSession,
  createHandsOnSession,
  createSessionWithBlueprint,
  getSession,
  listRecentSessions,
  questionIdForTarget,
  recordConversationTurn,
  revealFirstQuestion,
  saveHandsOnCheckpoint,
} from "@/lib/repositories/interviews";
import { getOpportunity } from "@/lib/repositories/opportunities";
import { getProfile } from "@/lib/repositories/profile";
import { requireUser } from "@/lib/supabase/server";
import type { Evaluation, FollowUpDraft, InterviewMode, InterviewSession, PlannedQuestion, Profile, RoundId } from "@/lib/types";

export const runtime = "nodejs";

/** Lists only interview sessions owned by the authenticated caller. */
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const profile = await getProfile(supabase, user.id);
    const sessions = await listRecentSessions(supabase, user.id);
    const completedSessions = sessions.filter((session) => session.status === "complete");
    return NextResponse.json({
      sessions,
      progress: calculateProgress(profile?.competencies ?? [], completedSessions),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Runs authenticated start, turn, checkpoint, and completion interview actions. */
export async function POST(request: Request) {
  let supabase;
  let user;
  try {
    ({ supabase, user } = await requireUser());
  } catch (error) {
    return errorResponse(error);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("INVALID_BODY");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "A valid interview request is required." }, { status: 400 });
  }

  try {
    const profile = await getProfile(supabase, user.id);
    if (!profile) return NextResponse.json({ error: "Create your profile first." }, { status: 400 });

    if (body.action === "start") {
      if (body.mode === "hands-on") {
        const session = await createHandsOnSession(supabase, user.id, handsOnExercise(profile));
        return NextResponse.json({ session });
      }

      const roundId = (typeof body.roundId === "string" ? body.roundId : "tech-lead") as RoundId;
      if (!IMPLEMENTED_ROUNDS.includes(roundId)) {
        return NextResponse.json({ error: "That interview round is not available yet." }, { status: 400 });
      }
      const mode: InterviewMode = body.mode === "coach" ? "coach" : "real";
      const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : null;
      const opportunity = opportunityId ? await getOpportunity(supabase, user.id, opportunityId) : null;

      const blueprint = await generateInterviewBlueprint(profile, profile.evidence ?? [], { roundId, opportunity });
      // `createSessionWithBlueprint` deliberately does not take `opportunityId`
      // (Ruling A) -- only `linkSessionCareerContext` ever writes it.
      const session = await createSessionWithBlueprint(supabase, user.id, blueprint, { roundId, mode });

      // `blueprint: session.blueprint!`, NOT the pre-persistence `blueprint`
      // above: `session.blueprint.targets` carry the row ids `openingTurn`'s
      // resulting `targetId` must persist as, so later turns (which reload
      // the session and reconstruct targets from those same row ids) can
      // still match it. The original `blueprint.targets` use transient
      // `gap-0`/`competency-0` ids that never round-trip through the
      // database, which would otherwise break coverage tracking from the
      // second turn onward.
      const opening = await openingTurn({
        profile,
        session,
        blueprint: session.blueprint!,
        evidence: profile.evidence ?? [],
        opportunity,
      });
      const revealed = await revealFirstQuestion(supabase, user.id, session, opening);
      return NextResponse.json({ session: visibleConversation(revealed) });
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const session = sessionId ? await getSession(supabase, user.id, sessionId) : null;
    if (!session) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (session.status === "complete") return NextResponse.json({ error: "This interview is already complete." }, { status: 400 });

    if (body.action === "respond") {
      if (session.kind === "hands-on") return NextResponse.json({ error: "Use a coding checkpoint for a hands-on session." }, { status: 400 });
      const answer = typeof body.answer === "string" ? body.answer.trim() : "";
      if (!answer) return NextResponse.json({ error: "Write an answer before sending." }, { status: 400 });
      const question = session.questions.find((item) => !item.answer);
      if (!question) return finishConversation(supabase, user.id, profile, session);

      const hydratedQuestion = hydratePlannedQuestion(session, question);
      const turn = await nextTurn({
        profile,
        session: visibleConversation(session),
        answeredQuestion: hydratedQuestion,
        answer,
        blueprint: session.blueprint!,
        evidence: profile.evidence ?? [],
        opportunity: session.opportunityId ? await getOpportunity(supabase, user.id, session.opportunityId) : null,
      });

      // A same-target continuation onto a row that was just genuinely
      // answered can't be written as `nextQuestionId` back onto that row --
      // see `followUpDraftForContinuation`'s doc comment -- so it goes
      // through the follow-up branch instead. A non-answer turn never sets
      // the row's `answer` column (`record_interview_evidence` is skipped
      // entirely), so a same-target rescue after a non-answer keeps using
      // the direct `nextQuestionId` update on that same, still-unanswered
      // row -- exactly as before this fix, and required: routing it through
      // the follow-up branch too would spend this target's one-hop budget
      // (below) on a turn that never needed it, and the RPC unconditionally
      // refuses a follow-up whose parent is itself already a follow-up row.
      const isSameTargetContinuation = turn.targetId === question.id && !turn.nonAnswer;

      const updated = await recordConversationTurn(
        supabase,
        user.id,
        question.id,
        answer,
        turn.evaluation ?? emptyEvaluationFor(hydratedQuestion),
        {
          nextQuestionId: !isSameTargetContinuation && turn.targetId
            ? questionIdForTarget(session, turn.targetId)
            : null,
          nextPrompt: turn.prompt,
          followUp: isSameTargetContinuation ? followUpDraftForContinuation(hydratedQuestion, turn.prompt) : null,
          askedIntent: turn.intent,
          // Accumulates onto the row's own persisted history, not just this
          // turn's grant: a non-answer continuation re-asks the SAME row
          // (see above), so a rescue budget check like `rescuesSpentInSession`
          // (which sums `question.assistance.length`) would silently lose
          // every earlier rescue on that row if this replaced instead.
          assistance: [...question.assistance, ...(turn.assistance ? [turn.assistance] : [])],
          nonAnswer: turn.nonAnswer,
          degraded: turn.degraded,
        },
      );
      if (!updated.questions.some((item) => !item.answer)) {
        return finishConversation(supabase, user.id, profile, updated);
      }
      return NextResponse.json({ session: visibleConversation(updated) });
    }
    if (body.action === "checkpoint") {
      if (session.kind !== "hands-on") return NextResponse.json({ error: "Coding checkpoints are available in hands-on interviews." }, { status: 400 });
      const code = typeof body.code === "string" ? body.code : "";
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!code.trim() || !note) return NextResponse.json({ error: "Save your current code and a short think-aloud note." }, { status: 400 });
      const prompt = await handsOnCheckpoint(profile, session, code, note);
      const updated = await saveHandsOnCheckpoint(supabase, user.id, session.id, code, note, prompt);
      return NextResponse.json({ session: updated });
    }
    if (body.action === "complete") {
      if (session.kind === "conversation" && !canExplicitlyCompleteConversation(session)) {
        return NextResponse.json({ error: incompleteConversationMessage(session) }, { status: 400 });
      }
      if (session.kind === "hands-on" && !session.checkpoints.length) {
        return NextResponse.json({ error: "Save a coding checkpoint before completing this interview." }, { status: 400 });
      }
      const result = session.kind === "hands-on" ? evaluateHandsOn(session) : summarizeSession(session);
      const completed = session.kind === "hands-on"
        ? await completeHandsOnSession(supabase, user.id, session.id, result as ReturnType<typeof evaluateHandsOn>)
        : await completeSession(supabase, user.id, session.id, result);
      // The session and its evidence are already saved; plan bookkeeping runs
      // afterwards and can only add a warning, never fail this response.
      const { warning } = await completeLinkedPracticePlanBestEffort(supabase, user.id, completed);
      return NextResponse.json({
        session: completed.kind === "conversation" ? visibleConversation(completed) : completed,
        profile: await getProfile(supabase, user.id),
        // Always present, `null` when there is nothing to warn about: clients
        // read this as a nullable field, never as an optional key.
        practicePlanWarning: warning,
      });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

async function finishConversation(
  supabase: Parameters<typeof completeSession>[0],
  userId: string,
  profile: Profile,
  session: InterviewSession,
) {
  const completed = await completeSession(supabase, userId, session.id, summarizeSession(session));
  const { warning } = await completeLinkedPracticePlanBestEffort(supabase, userId, completed);
  const refreshedProfile = await getProfile(supabase, userId);
  return NextResponse.json({
    session: visibleConversation(completed),
    profile: refreshedProfile ?? profile,
    practicePlanWarning: warning,
  });
}

/**
 * Why an explicit Complete was refused. Planned practice and generic
 * conversations have different completion rules (see
 * `canExplicitlyCompleteConversation`), so they need different guidance: a
 * planned session must answer every persisted question, including a
 * follow-up, while a generic one needs five answers.
 */
function incompleteConversationMessage(session: InterviewSession): string {
  return session.practicePlanId
    ? "Answer every question in this practice before completing it."
    : "Answer at least five questions before completing this interview.";
}

function visibleConversation(session: InterviewSession): InterviewSession {
  if (!session.questions) return session;
  const visibleQuestionIds = new Set(session.questions.filter((question) => question.answer).map((question) => question.id));
  const nextQuestion = session.questions.find((question) => !question.answer);
  if (nextQuestion) visibleQuestionIds.add(nextQuestion.id);
  return {
    ...session,
    messages: session.messages.filter((message) => visibleQuestionIds.has(message.id.split(":")[0])),
  };
}

/**
 * Placeholder evaluation values for a non-answer turn. The RPC skips evidence
 * recording when `p_non_answer` is true, so these are never persisted; they
 * exist only to satisfy the RPC's non-null parameters (spec §11.3).
 */
function emptyEvaluationFor(question: PlannedQuestion): Evaluation {
  return {
    questionId: question.id,
    competencyId: question.competencyId,
    competency: question.competencyName ?? "Communication",
    score: 0,
    relevance: 0,
    dimensions: Object.fromEntries(EVALUATION_DIMENSIONS.map((key) => [key, 0])) as Evaluation["dimensions"],
    strengths: [],
    needsWork: [],
    missingPoints: ["Not attempted."],
    betterStructure: ["Not attempted."],
    improvedAnswer: "Not attempted.",
    supportedClaims: [],
    expectedSignalsPresent: [],
    unsupportedClaims: [],
    dimensionReasons: Object.fromEntries(
      EVALUATION_DIMENSIONS.map((key) => [key, "Not attempted."]),
    ) as Evaluation["dimensionReasons"],
  } as Evaluation;
}

function hydratePlannedQuestion(
  session: InterviewSession,
  question: InterviewSession["questions"][number],
): InterviewSession["questions"][number] {
  return session.blueprint?.questions.find((item) => item.id === question.id) ?? question;
}

/**
 * Builds the follow-up row payload for a same-target continuation on a row
 * that was just genuinely answered (probe, challenge, hypothetical, or a
 * non-park rescue after a real answer) -- the director asking the candidate
 * to keep deepening the target they just answered.
 *
 * This can never be persisted as `nextQuestionId` onto the just-answered row:
 * `record_conversation_turn`'s next-question branch is guarded by
 * `answer is null`, and the evidence-recording step earlier in the same RPC
 * call already set that row's answer. Routing it through the RPC's
 * follow-up-row branch instead lands the continuation on a brand-new row, so
 * the guard never applies. `deriveCoverageState` still attributes the new
 * row back to the original target because it matches on the value inside
 * `askedIntent.targetId`, not on which physical row carries it.
 *
 * Takes the just-answered `PlannedQuestion` itself, not its `CoverageTarget`:
 * both carry the same objective/evidence/signal data (both are read off the
 * same persisted row), but the question is always available -- unlike
 * `session.blueprint.targets`, which a legacy conversation session predating
 * coverage targets may not carry.
 */
function followUpDraftForContinuation(question: PlannedQuestion, prompt: string): FollowUpDraft {
  return {
    category: question.category,
    competencyId: question.competencyId,
    competencyName: question.competencyName,
    difficulty: question.difficulty,
    isFollowUp: true,
    prompt,
    objective: question.objective ?? "",
    evidenceIds: question.evidenceIds ?? [],
    expectedSignals: question.expectedSignals ?? [],
    missingSignalPrompts: [],
    rubricCriteria: question.rubricCriteria ?? [],
    followUpLimit: 1,
    sourceConfidence: null,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof Error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    console.error("[api/interview] request failed", {
      name: error.name,
      message: error.message,
      code,
    });
  } else {
    console.error("[api/interview] request failed", error);
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  if (error instanceof Error && "code" in error && error.code === "NO_OWNED_ROW") {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }
  return NextResponse.json({ error: "Could not complete your interview request." }, { status: 500 });
}
