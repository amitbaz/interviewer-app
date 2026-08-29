import { NextResponse } from "next/server";
import { completeSession, evaluateHandsOn, handsOnCheckpoint, handsOnExercise, initialQuestion, nextTurn, updateCompetencies } from "@/lib/coach";
import { createSession, getProfile, getSession, recentSessions, saveProfile, saveSession } from "@/lib/db";
import type { InterviewSession } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() { return NextResponse.json({ sessions: recentSessions() }); }

export async function POST(request: Request) {
  const body = await request.json();
  const profile = getProfile();
  if (!profile) return NextResponse.json({ error: "Create your profile first." }, { status: 400 });

  if (body.action === "start") {
    const now = new Date().toISOString();
    const isHandsOn = body.mode === "hands-on";
    const exercise = isHandsOn ? handsOnExercise(profile) : undefined;
    const session = createSession({ kind: isHandsOn ? "hands-on" : "conversation", status: "active", messages: [{ role: "interviewer", content: isHandsOn ? "Start by reading the brief, then tell me which requirements you would clarify before you begin implementing." : initialQuestion(profile), createdAt: now }], evaluations: [], exercise, checkpoints: isHandsOn ? [] : undefined, createdAt: now });
    return NextResponse.json({ session });
  }
  const session = getSession(Number(body.sessionId));
  if (!session) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (session.status === "complete") return NextResponse.json({ error: "This interview is already complete." }, { status: 400 });

  if (body.action === "respond") {
    if (session.kind === "hands-on") return NextResponse.json({ error: "Use a coding checkpoint for a hands-on session." }, { status: 400 });
    const answer = String(body.answer ?? "").trim();
    if (!answer) return NextResponse.json({ error: "Write an answer before sending." }, { status: 400 });
    const timestamp = new Date().toISOString();
    const withAnswer: InterviewSession = { ...session, messages: [...session.messages, { role: "candidate", content: answer, createdAt: timestamp }] };
    const turn = await nextTurn(profile, withAnswer, answer);
    const updated: InterviewSession = { ...withAnswer, messages: [...withAnswer.messages, { role: "interviewer", content: turn.question, createdAt: new Date().toISOString() }], evaluations: [...withAnswer.evaluations, turn.evaluation] };
    return NextResponse.json({ session: saveSession(updated) });
  }
  if (body.action === "checkpoint") {
    if (session.kind !== "hands-on") return NextResponse.json({ error: "Coding checkpoints are available in hands-on interviews." }, { status: 400 });
    const code = String(body.code ?? "");
    const note = String(body.note ?? "").trim();
    if (!code.trim() || !note) return NextResponse.json({ error: "Save your current code and a short think-aloud note." }, { status: 400 });
    const createdAt = new Date().toISOString();
    const checkpoint = { code, note, createdAt };
    const withCheckpoint: InterviewSession = { ...session, checkpoints: [...(session.checkpoints ?? []), checkpoint], messages: [...session.messages, { role: "candidate", content: `Checkpoint: ${note}`, createdAt }] };
    const prompt = await handsOnCheckpoint(profile, withCheckpoint, code, note);
    const updated: InterviewSession = { ...withCheckpoint, messages: [...withCheckpoint.messages, { role: "interviewer", content: prompt, createdAt: new Date().toISOString() }] };
    return NextResponse.json({ session: saveSession(updated) });
  }
  if (body.action === "complete") {
    const result = session.kind === "hands-on" ? evaluateHandsOn(session) : completeSession(session);
    const completed = { ...session, status: "complete" as const, ...result };
    saveProfile(updateCompetencies(profile, completed.evaluations));
    return NextResponse.json({ session: saveSession(completed), profile: getProfile() });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
