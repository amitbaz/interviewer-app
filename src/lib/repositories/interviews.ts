import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Evaluation,
  HandsOnCheckpoint,
  HandsOnExercise,
  InterviewSession,
  Message,
  PlannedQuestion,
} from "@/lib/types";
import { RepositoryError } from "@/lib/repositories/profile";

type Row = Record<string, unknown>;

const stringValue = (value: unknown): string => typeof value === "string" ? value : "";
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string")
  : [];
const jsonRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

function mapQuestion(row: Row, competencyNames: Map<string, string>): PlannedQuestion {
  const competencyId = typeof row.competency_id === "string" ? row.competency_id : null;
  return {
    id: stringValue(row.id),
    sequence: Number(row.sequence ?? 0),
    category: row.category as PlannedQuestion["category"],
    competencyId,
    competencyName: competencyId ? competencyNames.get(competencyId) ?? null : null,
    difficulty: row.difficulty as PlannedQuestion["difficulty"],
    isFollowUp: Boolean(row.is_follow_up),
    prompt: stringValue(row.prompt),
    answer: typeof row.answer === "string" ? row.answer : null,
    createdAt: stringValue(row.created_at),
  };
}

function mapEvaluation(row: Row, question: PlannedQuestion): Evaluation {
  return {
    score: Number(row.overall_score ?? 0),
    competencyId: question.competencyId,
    competency: question.competencyName ?? "Communication",
    dimensions: jsonRecord(row.dimensions) as Evaluation["dimensions"],
    strengths: stringArray(row.strengths),
    needsWork: stringArray(row.weaknesses),
  };
}

function mapCheckpoint(row: Row): HandsOnCheckpoint {
  return {
    id: stringValue(row.id),
    code: stringValue(row.code),
    note: stringValue(row.note),
    createdAt: stringValue(row.created_at),
  };
}

function transcriptFor(questions: PlannedQuestion[], answerTimes: Map<string, string>): Message[] {
  return questions.flatMap((question) => {
    const interviewer = {
      id: `${question.id}:question`,
      role: "interviewer" as const,
      content: question.prompt,
      createdAt: question.createdAt,
    };
    if (!question.answer) return [interviewer];
    return [interviewer, {
      id: `${question.id}:answer`,
      role: "candidate" as const,
      content: question.answer,
      createdAt: answerTimes.get(question.id) ?? question.createdAt,
    }];
  });
}

export function mapSession(
  row: Row,
  questionRows: Row[],
  evaluationRows: Row[],
  checkpointRows: Row[],
  competencyNames: Map<string, string>,
): InterviewSession {
  const questions = [...questionRows]
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    .map((question) => mapQuestion(question, competencyNames));
  const answerTimes = new Map(questionRows.map((question) => [
    stringValue(question.id),
    typeof question.answered_at === "string" ? question.answered_at : stringValue(question.created_at),
  ]));
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const evaluations = evaluationRows.map((evaluation) => {
    const question = questionsById.get(stringValue(evaluation.question_id));
    return mapEvaluation(evaluation, question ?? {
      id: "", sequence: 0, category: "communication", competencyId: null, competencyName: null,
      difficulty: "foundational", isFollowUp: false, prompt: "", answer: null, createdAt: "",
    });
  });
  const checkpoints = [...checkpointRows]
    .sort((left, right) => stringValue(left.created_at).localeCompare(stringValue(right.created_at)))
    .map(mapCheckpoint);

  return {
    id: stringValue(row.id),
    userId: stringValue(row.user_id),
    kind: row.kind === "hands-on" ? "hands-on" : "conversation",
    status: row.status === "complete" ? "complete" : "active",
    startedAt: stringValue(row.started_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    exercise: jsonRecord(row.exercise),
    resultSummary: jsonRecord(row.result_summary),
    overallScore: row.overall_score === null || row.overall_score === undefined ? null : Number(row.overall_score),
    questions,
    checkpoints,
    evaluations,
    messages: transcriptFor(questions, answerTimes),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

async function competencyNamesFor(supabase: SupabaseClient, userId: string, questions: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(questions.map((question) => question.competency_id).filter((id): id is string => typeof id === "string"))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("competencies").select("id, name").eq("user_id", userId).in("id", ids);
  if (error) throw new RepositoryError("Could not load session competencies.", error.code);
  return new Map(((data ?? []) as Row[]).map((competency) => [stringValue(competency.id), stringValue(competency.name)]));
}

async function hydrateSession(supabase: SupabaseClient, userId: string, row: Row): Promise<InterviewSession> {
  const [{ data: questions, error: questionsError }, { data: evaluations, error: evaluationsError }, { data: checkpoints, error: checkpointsError }] = await Promise.all([
    supabase.from("interview_questions").select("*").eq("user_id", userId).eq("session_id", row.id).order("sequence"),
    supabase.from("question_evaluations").select("*").eq("user_id", userId),
    supabase.from("hands_on_checkpoints").select("*").eq("user_id", userId).eq("session_id", row.id).order("created_at"),
  ]);
  if (questionsError || evaluationsError || checkpointsError) {
    throw new RepositoryError("Could not load the interview session.", questionsError?.code ?? evaluationsError?.code ?? checkpointsError?.code);
  }
  const questionRows = (questions ?? []) as Row[];
  const questionIds = new Set(questionRows.map((question) => stringValue(question.id)));
  const relevantEvaluations = ((evaluations ?? []) as Row[])
    .filter((evaluation) => questionIds.has(stringValue(evaluation.question_id)));
  return mapSession(row, questionRows, relevantEvaluations, (checkpoints ?? []) as Row[], await competencyNamesFor(supabase, userId, questionRows));
}

export async function getSession(supabase: SupabaseClient, userId: string, sessionId: string): Promise<InterviewSession | null> {
  const { data, error } = await supabase
    .from("interview_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new RepositoryError("Could not load the interview session.", error.code);
  return data ? hydrateSession(supabase, userId, data as Row) : null;
}

export async function listRecentSessions(supabase: SupabaseClient, userId: string): Promise<InterviewSession[]> {
  const { data, error } = await supabase
    .from("interview_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new RepositoryError("Could not load recent interviews.", error.code);
  return Promise.all(((data ?? []) as Row[]).map((session) => hydrateSession(supabase, userId, session)));
}

export async function createSessionWithPlan(
  supabase: SupabaseClient,
  userId: string,
  plan: PlannedQuestion[],
): Promise<InterviewSession> {
  const { data: session, error: sessionError } = await supabase
    .from("interview_sessions")
    .insert({ user_id: userId, kind: "conversation", status: "active" })
    .select("*")
    .single();
  if (sessionError || !session) throw new RepositoryError("Could not start the interview.", sessionError?.code);

  const rows = plan.map((question) => ({
    user_id: userId,
    session_id: (session as Row).id,
    sequence: question.sequence,
    category: question.category,
    competency_id: question.competencyId,
    difficulty: question.difficulty,
    is_follow_up: question.isFollowUp,
    prompt: question.prompt,
    asked_at: new Date().toISOString(),
  }));
  const { error: questionError } = await supabase.from("interview_questions").insert(rows);
  if (questionError) throw new RepositoryError("Could not save the interview plan.", questionError.code);
  return hydrateSession(supabase, userId, session as Row);
}

export async function createHandsOnSession(
  supabase: SupabaseClient,
  userId: string,
  exercise: HandsOnExercise,
): Promise<InterviewSession> {
  const { data, error } = await supabase
    .from("interview_sessions")
    .insert({ user_id: userId, kind: "hands-on", status: "active", exercise })
    .select("*")
    .single();
  if (error || !data) throw new RepositoryError("Could not start the hands-on interview.", error?.code);
  return hydrateSession(supabase, userId, data as Row);
}

export async function recordAnswerAndEvaluation(
  supabase: SupabaseClient,
  userId: string,
  questionId: string,
  answer: string,
  evaluation: Evaluation,
): Promise<InterviewSession> {
  const { data, error } = await supabase.rpc("record_interview_evidence", {
    p_question_id: questionId,
    p_answer: answer,
    p_score: evaluation.score,
    p_dimensions: evaluation.dimensions,
    p_strengths: evaluation.strengths,
    p_needs_work: evaluation.needsWork,
  });
  if (error || !data) throw new RepositoryError("Could not record your interview answer.", error?.code ?? "NO_OWNED_ROW");
  const result = Array.isArray(data) ? data[0] as Row | undefined : data as Row;
  const sessionId = result && stringValue(result.session_id);
  if (!sessionId) throw new RepositoryError("Could not find the updated interview session.", "NO_OWNED_ROW");
  const session = await getSession(supabase, userId, sessionId);
  if (!session) throw new RepositoryError("Could not reload the updated interview session.", "NO_OWNED_ROW");
  return session;
}

export async function saveHandsOnCheckpoint(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  code: string,
  note: string,
): Promise<InterviewSession> {
  const session = await getSession(supabase, userId, sessionId);
  if (!session || session.kind !== "hands-on" || session.status !== "active") {
    throw new RepositoryError("The active hands-on interview was not found.", "NO_OWNED_ROW");
  }
  const { error } = await supabase.from("hands_on_checkpoints").insert({ user_id: userId, session_id: sessionId, code, note });
  if (error) throw new RepositoryError("Could not save your hands-on checkpoint.", error.code);
  const refreshed = await getSession(supabase, userId, sessionId);
  if (!refreshed) throw new RepositoryError("Could not reload your hands-on interview.", "NO_OWNED_ROW");
  return refreshed;
}

export async function completeSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  result: { overallScore: number; summary: string },
): Promise<InterviewSession> {
  const { data, error } = await supabase
    .from("interview_sessions")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      overall_score: result.overallScore,
      result_summary: { summary: result.summary },
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select("*")
    .maybeSingle();
  if (error || !data) throw new RepositoryError("Could not complete the interview.", error?.code ?? "NO_OWNED_ROW");
  return hydrateSession(supabase, userId, data as Row);
}
