import { NextResponse } from "next/server";
import { completeSession as summarizeSession, evaluateHandsOn, generateInterviewBlueprint, handsOnCheckpoint, handsOnExercise, initialQuestion, nextTurn } from "@/lib/coach";
import { calculateProgress } from "@/lib/progress";
import {
  completeHandsOnSession,
  completeSession,
  createHandsOnSession,
  createSessionWithBlueprint,
  getSession,
  listRecentSessions,
  recordConversationTurn,
  saveHandsOnCheckpoint,
} from "@/lib/repositories/interviews";
import { getProfile } from "@/lib/repositories/profile";
import { requireUser } from "@/lib/supabase/server";
import type { InterviewSession, Profile } from "@/lib/types";

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
      if (!profile.readiness?.ready) {
        return NextResponse.json({
          error: `Add ${profile.readiness?.missing.join(", ") ?? "more evidence"} before starting a personalized interview.`,
          readiness: profile.readiness,
        }, { status: 400 });
      }
      const blueprint = await generateInterviewBlueprint(profile, profile.evidence ?? []);
      const session = await createSessionWithBlueprint(supabase, user.id, blueprint);
      if (session.questions[0]) {
        const firstQuestion = hydratePlannedQuestion(session, session.questions[0]);
        const openingPrompt = initialQuestion(profile, firstQuestion, profile.source);
        session.questions[0] = openingPrompt
          ? {
            ...firstQuestion,
            prompt: openingPrompt,
          }
          : firstQuestion;
      }
      return NextResponse.json({ session: visibleConversation(session) });
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

      const questionIndex = session.questions.findIndex((item) => item.id === question.id);
      const nextPlannedQuestion = session.questions.slice(questionIndex + 1).find((item) => !item.answer) ?? null;
      const hydratedQuestion = hydratePlannedQuestion(session, question);
      const hydratedNextQuestion = nextPlannedQuestion ? hydratePlannedQuestion(session, nextPlannedQuestion) : null;
      const turn = await nextTurn(
        profile,
        hydratedQuestion,
        hydratedNextQuestion,
        profile.source,
        visibleConversation(session),
        answer,
        session.blueprint ?? null,
      );
      const updated = await recordConversationTurn(
        supabase,
        user.id,
        question.id,
        answer,
        turn.evaluation,
        {
          nextQuestionId: turn.followUp ? null : nextPlannedQuestion?.id ?? null,
          nextPrompt: turn.nextQuestion,
          followUp: turn.followUp,
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
      if (session.kind === "conversation" && session.questions.filter((question) => question.answer).length < 5) {
        return NextResponse.json({ error: "Answer at least five questions before completing this interview." }, { status: 400 });
      }
      if (session.kind === "hands-on" && !session.checkpoints.length) {
        return NextResponse.json({ error: "Save a coding checkpoint before completing this interview." }, { status: 400 });
      }
      const result = session.kind === "hands-on" ? evaluateHandsOn(session) : summarizeSession(session);
      const completed = session.kind === "hands-on"
        ? await completeHandsOnSession(supabase, user.id, session.id, result as ReturnType<typeof evaluateHandsOn>)
        : await completeSession(supabase, user.id, session.id, result);
      return NextResponse.json({
        session: completed.kind === "conversation" ? visibleConversation(completed) : completed,
        profile: await getProfile(supabase, user.id),
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
  const refreshedProfile = await getProfile(supabase, userId);
  return NextResponse.json({ session: visibleConversation(completed), profile: refreshedProfile ?? profile });
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

function hydratePlannedQuestion(
  session: InterviewSession,
  question: InterviewSession["questions"][number],
): InterviewSession["questions"][number] {
  return session.blueprint?.questions.find((item) => item.id === question.id) ?? question;
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
