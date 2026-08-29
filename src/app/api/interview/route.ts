import { NextResponse } from "next/server";
import { completeSession as summarizeSession, evaluateHandsOn, handsOnCheckpoint, handsOnExercise, initialQuestion, nextTurn } from "@/lib/coach";
import { buildInterviewPlan } from "@/lib/interview-planner";
import { completeSession, createHandsOnSession, createSessionWithPlan, getSession, listRecentSessions, recordAnswerAndEvaluation, saveHandsOnCheckpoint } from "@/lib/repositories/interviews";
import { getProfile } from "@/lib/repositories/profile";
import { requireUser } from "@/lib/supabase/server";
import type { InterviewSession, Message, Profile } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    return NextResponse.json({ sessions: await listRecentSessions(supabase, user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

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
        return NextResponse.json({ session: withHandsOnOpening(session) });
      }
      const plan = buildInterviewPlan(profile.competencies, profile.seniority ?? "Intermediate");
      const firstQuestion = plan[0];
      const plannedQuestions = plan.map((question, index) => index === 0
        ? { ...question, prompt: initialQuestion(profile, firstQuestion, profile.source) }
        : question);
      const session = await createSessionWithPlan(supabase, user.id, plannedQuestions);
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

      const turn = await nextTurn(profile, question, profile.source, visibleConversation(session), answer);
      const updated = await recordAnswerAndEvaluation(supabase, user.id, question.id, answer, turn.evaluation);
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
      const updated = await saveHandsOnCheckpoint(supabase, user.id, session.id, code, note);
      const prompt = await handsOnCheckpoint(profile, updated, code, note);
      return NextResponse.json({ session: withHandsOnCheckpoint(updated, prompt) });
    }
    if (body.action === "complete") {
      if (session.kind === "conversation" && session.questions.some((question) => !question.answer)) {
        return NextResponse.json({ error: "Answer the planned questions before completing this interview." }, { status: 400 });
      }
      if (session.kind === "hands-on" && !session.checkpoints.length) {
        return NextResponse.json({ error: "Save a coding checkpoint before completing this interview." }, { status: 400 });
      }
      const result = session.kind === "hands-on" ? evaluateHandsOn(session) : summarizeSession(session);
      const completed = await completeSession(supabase, user.id, session.id, result);
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
  const visibleQuestionIds = new Set(session.questions.filter((question) => question.answer).map((question) => question.id));
  const nextQuestion = session.questions.find((question) => !question.answer);
  if (nextQuestion) visibleQuestionIds.add(nextQuestion.id);
  return {
    ...session,
    messages: session.messages.filter((message) => visibleQuestionIds.has(message.id.split(":")[0])),
  };
}

function withHandsOnOpening(session: InterviewSession): InterviewSession {
  const message: Message = {
    id: `${session.id}:opening`,
    role: "interviewer",
    content: "Start by reading the brief, then tell me which requirements you would clarify before you begin implementing.",
    createdAt: session.createdAt,
  };
  return { ...session, messages: [...session.messages, message] };
}

function withHandsOnCheckpoint(session: InterviewSession, prompt: string): InterviewSession {
  const checkpoint = session.checkpoints.at(-1);
  if (!checkpoint) return session;
  const messages: Message[] = [
    ...session.messages,
    { id: `${checkpoint.id}:candidate`, role: "candidate", content: `Checkpoint: ${checkpoint.note}`, createdAt: checkpoint.createdAt },
    { id: `${checkpoint.id}:interviewer`, role: "interviewer", content: prompt, createdAt: new Date().toISOString() },
  ];
  return { ...session, messages };
}

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  if (error instanceof Error && "code" in error && error.code === "NO_OWNED_ROW") {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }
  return NextResponse.json({ error: "Could not complete your interview request." }, { status: 500 });
}
