import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BlueprintQuestion,
  Evaluation,
  FollowUpDraft,
  HandsOnCheckpoint,
  HandsOnExercise,
  InterviewBlueprint,
  InterviewSession,
  Message,
  PlannedQuestion,
} from "@/lib/types";
import { RepositoryError } from "@/lib/repositories/profile";

type Row = Record<string, unknown>;

const backboneCategories: PlannedQuestion["category"][] = [
  "introduction", "experience", "technical", "architecture", "behavioral",
];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const stringValue = (value: unknown): string => typeof value === "string" ? value : "";
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string")
  : [];
const jsonRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

function numericValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluationGroundingRecord(evaluation: Evaluation): Record<string, unknown> {
  return {
    relevance: evaluation.relevance ?? null,
    supported_claims: evaluation.supportedClaims ?? [],
    expected_signals_present: evaluation.expectedSignalsPresent ?? [],
    unsupported_claims: evaluation.unsupportedClaims ?? [],
    dimension_reasons: evaluation.dimensionReasons ?? {},
  };
}

function evaluationGroundingRpcArgs(evaluation: Evaluation): Record<string, unknown> {
  const record = evaluationGroundingRecord(evaluation);
  return {
    p_relevance: record.relevance,
    p_supported_claims: record.supported_claims,
    p_expected_signals_present: record.expected_signals_present,
    p_unsupported_claims: record.unsupported_claims,
    p_dimension_reasons: record.dimension_reasons,
  };
}

function persistableCompetencyId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return uuidPattern.test(trimmed) ? trimmed : null;
}

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

function mapBlueprintQuestion(row: Row, competencyNames: Map<string, string>): BlueprintQuestion | null {
  if (typeof row.objective !== "string" || !row.objective.trim()) return null;
  const question = mapQuestion(row, competencyNames);
  return {
    ...question,
    objective: row.objective.trim(),
    evidenceIds: stringArray(row.evidence_ids),
    expectedSignals: stringArray(row.expected_signals),
    missingSignalPrompts: stringArray(row.missing_signal_prompts),
    followUpLimit: Number(row.follow_up_limit ?? 0),
    sourceConfidence: row.source_confidence === null || row.source_confidence === undefined
      ? null
      : Number(row.source_confidence),
  };
}

function mapEvaluation(row: Row, question: PlannedQuestion): Evaluation {
  const evaluation: Evaluation = {
    score: Number(row.overall_score ?? 0),
    questionId: stringValue(row.question_id) || null,
    competencyId: question.competencyId,
    competency: question.competencyName ?? "Communication",
    dimensions: jsonRecord(row.dimensions) as Evaluation["dimensions"],
    strengths: stringArray(row.strengths),
    needsWork: stringArray(row.weaknesses),
    missingPoints: stringArray(row.missing_points),
    betterStructure: stringArray(row.better_structure),
    improvedAnswer: stringValue(row.improved_answer),
  };
  const relevance = numericValue(row.relevance);
  if (relevance !== null) evaluation.relevance = relevance;
  evaluation.supportedClaims = stringArray(row.supported_claims);
  evaluation.expectedSignalsPresent = stringArray(row.expected_signals_present);
  evaluation.unsupportedClaims = stringArray(row.unsupported_claims);
  evaluation.dimensionReasons = jsonRecord(row.dimension_reasons) as Evaluation["dimensionReasons"];
  return evaluation;
}

function mapSessionEvaluation(row: Row, competencyNames: Map<string, string>): Evaluation {
  const competencyId = typeof row.competency_id === "string" ? row.competency_id : null;
  const evaluation: Evaluation = {
    score: Number(row.overall_score ?? 0),
    questionId: null,
    competencyId,
    competency: competencyId
      ? competencyNames.get(competencyId) ?? stringValue(row.competency_name)
      : stringValue(row.competency_name) || "Communication",
    dimensions: jsonRecord(row.dimensions) as Evaluation["dimensions"],
    strengths: stringArray(row.strengths),
    needsWork: stringArray(row.weaknesses),
    missingPoints: stringArray(row.missing_points),
    betterStructure: stringArray(row.better_structure),
    improvedAnswer: stringValue(row.improved_answer),
  };
  const relevance = numericValue(row.relevance);
  if (relevance !== null) evaluation.relevance = relevance;
  evaluation.supportedClaims = stringArray(row.supported_claims);
  evaluation.expectedSignalsPresent = stringArray(row.expected_signals_present);
  evaluation.unsupportedClaims = stringArray(row.unsupported_claims);
  evaluation.dimensionReasons = jsonRecord(row.dimension_reasons) as Evaluation["dimensionReasons"];
  return evaluation;
}

function mapCheckpoint(row: Row): HandsOnCheckpoint {
  return {
    id: stringValue(row.id),
    code: stringValue(row.code),
    note: stringValue(row.note),
    interviewerPrompt: stringValue(row.interviewer_prompt),
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

function handsOnTranscript(row: Row, checkpoints: HandsOnCheckpoint[]): Message[] {
  const exercise = jsonRecord(row.exercise);
  const opening = typeof exercise.interviewerOpening === "string" ? exercise.interviewerOpening : "";
  const messages: Message[] = opening ? [{
    id: `${stringValue(row.id)}:opening`,
    role: "interviewer",
    content: opening,
    createdAt: stringValue(row.created_at),
  }] : [];
  for (const checkpoint of checkpoints) {
    messages.push({
      id: `${checkpoint.id}:candidate`,
      role: "candidate",
      content: `Checkpoint: ${checkpoint.note}`,
      createdAt: checkpoint.createdAt,
    });
    if (checkpoint.interviewerPrompt) {
      messages.push({
        id: `${checkpoint.id}:interviewer`,
        role: "interviewer",
        content: checkpoint.interviewerPrompt,
        createdAt: checkpoint.createdAt,
      });
    }
  }
  return messages;
}

export function mapSession(
  row: Row,
  questionRows: Row[],
  evaluationRows: Row[],
  checkpointRows: Row[],
  competencyNames: Map<string, string>,
  sessionEvaluationRows: Row[] = [],
): InterviewSession {
  const questions = [...questionRows]
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    .map((question) => mapQuestion(question, competencyNames));
  const blueprintQuestions = [...questionRows]
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    .map((question) => mapBlueprintQuestion(question, competencyNames))
    .filter((question): question is BlueprintQuestion => question !== null);
  const answerTimes = new Map(questionRows.map((question) => [
    stringValue(question.id),
    typeof question.answered_at === "string" ? question.answered_at : stringValue(question.created_at),
  ]));
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const questionEvaluations = [...evaluationRows]
    .sort((left, right) => {
      const leftQuestion = questionsById.get(stringValue(left.question_id));
      const rightQuestion = questionsById.get(stringValue(right.question_id));
      return (leftQuestion?.sequence ?? Number.MAX_SAFE_INTEGER)
        - (rightQuestion?.sequence ?? Number.MAX_SAFE_INTEGER);
    })
    .map((evaluation) => {
    const question = questionsById.get(stringValue(evaluation.question_id));
    return mapEvaluation(evaluation, question ?? {
      id: "", sequence: 0, category: "communication", competencyId: null, competencyName: null,
      difficulty: "foundational", isFollowUp: false, prompt: "", answer: null, createdAt: "",
    });
    });
  const checkpoints = [...checkpointRows]
    .sort((left, right) => stringValue(left.created_at).localeCompare(stringValue(right.created_at)))
    .map(mapCheckpoint);
  const evaluations = [
    ...questionEvaluations,
    ...sessionEvaluationRows.map((evaluation) => mapSessionEvaluation(evaluation, competencyNames)),
  ];
  const kind = row.kind === "hands-on" ? "hands-on" : "conversation";
  const blueprintMaxFollowUps = row.blueprint_max_follow_ups === null || row.blueprint_max_follow_ups === undefined
    ? 3
    : Number(row.blueprint_max_follow_ups);
  const blueprintMaxQuestions = row.blueprint_max_questions === null || row.blueprint_max_questions === undefined
    ? 8
    : Number(row.blueprint_max_questions);
  const blueprint = kind === "conversation" && (
    typeof row.blueprint_status === "string"
    || typeof row.blueprint_fallback_reason === "string"
    || blueprintQuestions.length > 0
  )
    ? {
      status: row.blueprint_status === "limited-grounding" ? "limited-grounding" : "grounded",
      fallbackReason: typeof row.blueprint_fallback_reason === "string" ? row.blueprint_fallback_reason : null,
      maxFollowUps: Number.isFinite(blueprintMaxFollowUps) ? blueprintMaxFollowUps : 3,
      maxQuestions: Number.isFinite(blueprintMaxQuestions) ? blueprintMaxQuestions : 8,
      createdAt: stringValue(row.created_at),
      questions: blueprintQuestions,
    } satisfies InterviewBlueprint
    : null;

  return {
    id: stringValue(row.id),
    userId: stringValue(row.user_id),
    kind,
    status: row.status === "complete" ? "complete" : "active",
    startedAt: stringValue(row.started_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    exercise: jsonRecord(row.exercise),
    resultSummary: jsonRecord(row.result_summary),
    overallScore: row.overall_score === null || row.overall_score === undefined ? null : Number(row.overall_score),
    questions,
    blueprint,
    checkpoints,
    evaluations,
    messages: kind === "hands-on" ? handsOnTranscript(row, checkpoints) : transcriptFor(questions, answerTimes),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

async function competencyNamesFor(
  supabase: SupabaseClient,
  userId: string,
  questions: Row[],
  sessionEvaluations: Row[],
): Promise<Map<string, string>> {
  const ids = [...new Set([
    ...questions.map((question) => question.competency_id),
    ...sessionEvaluations.map((evaluation) => evaluation.competency_id),
  ].filter((id): id is string => typeof id === "string"))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("competencies").select("id, name").eq("user_id", userId).in("id", ids);
  if (error) throw new RepositoryError("Could not load session competencies.", error.code);
  return new Map(((data ?? []) as Row[]).map((competency) => [stringValue(competency.id), stringValue(competency.name)]));
}

async function hydrateSession(supabase: SupabaseClient, userId: string, row: Row): Promise<InterviewSession> {
  const [
    { data: questions, error: questionsError },
    { data: checkpoints, error: checkpointsError },
    { data: sessionEvaluations, error: sessionEvaluationsError },
  ] = await Promise.all([
    supabase.from("interview_questions").select("*").eq("user_id", userId).eq("session_id", row.id).order("sequence"),
    supabase.from("hands_on_checkpoints").select("*").eq("user_id", userId).eq("session_id", row.id).order("created_at"),
    supabase.from("session_evaluations").select("*").eq("user_id", userId).eq("session_id", row.id).order("created_at"),
  ]);
  if (questionsError || checkpointsError || sessionEvaluationsError) {
    throw new RepositoryError(
      "Could not load the interview session.",
      questionsError?.code ?? checkpointsError?.code ?? sessionEvaluationsError?.code,
    );
  }
  const questionRows = (questions ?? []) as Row[];
  const sessionEvaluationRows = (sessionEvaluations ?? []) as Row[];
  const questionIds = questionRows.map((question) => stringValue(question.id)).filter(Boolean);
  const { data: evaluations, error: evaluationsError } = questionIds.length
    ? await supabase.from("question_evaluations").select("*").eq("user_id", userId).in("question_id", questionIds)
    : { data: [], error: null };
  if (evaluationsError) throw new RepositoryError("Could not load the interview session.", evaluationsError.code);
  return mapSession(
    row,
    questionRows,
    (evaluations ?? []) as Row[],
    (checkpoints ?? []) as Row[],
    await competencyNamesFor(supabase, userId, questionRows, sessionEvaluationRows),
    sessionEvaluationRows,
  );
}

export function assertConversationPlan(plan: PlannedQuestion[]): void {
  const isBackbone = plan.length === backboneCategories.length
    && plan.every((question, index) => question.sequence === index + 1
      && question.category === backboneCategories[index]
      && !question.isFollowUp);
  if (!isBackbone) throw new RepositoryError("A conversation must use the exact five-question backbone.", "INVALID_PLAN");
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
  assertConversationPlan(plan);
  const { data, error } = await supabase.rpc("create_conversation_session_with_plan", {
    p_plan: plan.map((question) => ({
      sequence: question.sequence,
      category: question.category,
      competency_id: persistableCompetencyId(question.competencyId),
      difficulty: question.difficulty,
      is_follow_up: question.isFollowUp,
      prompt: question.prompt,
    })),
  });
  if (error || !data) throw new RepositoryError("Could not start the interview.", error?.code ?? "NO_OWNED_ROW");
  const result = Array.isArray(data) ? data[0] as Row | undefined : data as Row;
  const sessionId = result && stringValue(result.session_id);
  if (!sessionId) throw new RepositoryError("Could not find the created interview session.", "NO_OWNED_ROW");
  const session = await getSession(supabase, userId, sessionId);
  if (!session) throw new RepositoryError("Could not reload the created interview session.", "NO_OWNED_ROW");
  return session;
}

/**
 * Persists the full five-question blueprint before the interview starts so
 * later turns can reuse the exact objective and evidence targets.
 */
export async function createSessionWithBlueprint(
  supabase: SupabaseClient,
  userId: string,
  blueprint: InterviewBlueprint,
): Promise<InterviewSession> {
  assertConversationPlan(blueprint.questions);
  const { data, error } = await supabase.rpc("create_conversation_session_with_blueprint", {
    p_blueprint: {
      status: blueprint.status,
      fallback_reason: blueprint.fallbackReason,
      max_follow_ups: blueprint.maxFollowUps,
      max_questions: blueprint.maxQuestions,
      questions: blueprint.questions.map((question) => ({
        sequence: question.sequence,
        category: question.category,
        competency_id: persistableCompetencyId(question.competencyId),
        difficulty: question.difficulty,
        prompt: question.prompt,
        objective: question.objective,
        evidence_ids: question.evidenceIds,
        expected_signals: question.expectedSignals,
        missing_signal_prompts: question.missingSignalPrompts,
        follow_up_limit: question.followUpLimit,
        source_confidence: question.sourceConfidence,
      })),
    },
  });
  if (error || !data) throw new RepositoryError("Could not start the interview.", error?.code ?? "NO_OWNED_ROW");
  const result = Array.isArray(data) ? data[0] as Row | undefined : data as Row;
  const sessionId = result && stringValue(result.session_id);
  if (!sessionId) throw new RepositoryError("Could not find the created interview session.", "NO_OWNED_ROW");
  const session = await getSession(supabase, userId, sessionId);
  if (!session) throw new RepositoryError("Could not reload the created interview session.", "NO_OWNED_ROW");
  return session;
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
    p_missing_points: evaluation.missingPoints,
    p_better_structure: evaluation.betterStructure,
    p_improved_answer: evaluation.improvedAnswer,
    ...evaluationGroundingRpcArgs(evaluation),
  });
  if (error || !data) throw new RepositoryError("Could not record your interview answer.", error?.code ?? "NO_OWNED_ROW");
  const result = Array.isArray(data) ? data[0] as Row | undefined : data as Row;
  const sessionId = result && stringValue(result.session_id);
  if (!sessionId) throw new RepositoryError("Could not find the updated interview session.", "NO_OWNED_ROW");
  const session = await getSession(supabase, userId, sessionId);
  if (!session) throw new RepositoryError("Could not reload the updated interview session.", "NO_OWNED_ROW");
  return session;
}

export type ConversationTurnPersistence = {
  nextQuestionId: string | null;
  nextPrompt: string | null;
  followUp: FollowUpDraft | null;
};

/** Atomically records answer evidence and persists the exact next interviewer question. */
export async function recordConversationTurn(
  supabase: SupabaseClient,
  userId: string,
  questionId: string,
  answer: string,
  evaluation: Evaluation,
  next: ConversationTurnPersistence,
): Promise<InterviewSession> {
  const { data, error } = await supabase.rpc("record_conversation_turn", {
    p_question_id: questionId,
    p_answer: answer,
    p_score: evaluation.score,
    p_dimensions: evaluation.dimensions,
    p_strengths: evaluation.strengths,
    p_needs_work: evaluation.needsWork,
    p_missing_points: evaluation.missingPoints,
    p_better_structure: evaluation.betterStructure,
    p_improved_answer: evaluation.improvedAnswer,
    ...evaluationGroundingRpcArgs(evaluation),
    p_next_question_id: next.nextQuestionId,
    p_next_prompt: next.nextPrompt,
    p_follow_up: next.followUp,
  });
  if (error || !data) throw new RepositoryError("Could not record your interview turn.", error?.code ?? "NO_OWNED_ROW");
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
  interviewerPrompt: string,
): Promise<InterviewSession> {
  const session = await getSession(supabase, userId, sessionId);
  if (!session || session.kind !== "hands-on" || session.status !== "active") {
    throw new RepositoryError("The active hands-on interview was not found.", "NO_OWNED_ROW");
  }
  const { error } = await supabase.from("hands_on_checkpoints").insert({
    user_id: userId,
    session_id: sessionId,
    code,
    note,
    interviewer_prompt: interviewerPrompt,
  });
  if (error) throw new RepositoryError("Could not save your hands-on checkpoint.", error.code);
  const refreshed = await getSession(supabase, userId, sessionId);
  if (!refreshed) throw new RepositoryError("Could not reload your hands-on interview.", "NO_OWNED_ROW");
  return refreshed;
}

/** Atomically persists hands-on evaluations, competency evidence, and session completion. */
export async function completeHandsOnSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  result: { overallScore: number; summary: string; evaluations: Evaluation[] },
): Promise<InterviewSession> {
  const { data, error } = await supabase.rpc("complete_hands_on_session", {
    p_session_id: sessionId,
    p_overall_score: result.overallScore,
    p_summary: result.summary,
      p_evaluations: result.evaluations.map((evaluation) => ({
        competency_id: evaluation.competencyId,
        competency: evaluation.competency,
        score: evaluation.score,
        dimensions: evaluation.dimensions,
        strengths: evaluation.strengths,
        needs_work: evaluation.needsWork,
        missing_points: evaluation.missingPoints,
        better_structure: evaluation.betterStructure,
        improved_answer: evaluation.improvedAnswer,
        ...evaluationGroundingRecord(evaluation),
      })),
  });
  if (error || !data) throw new RepositoryError("Could not complete the hands-on interview.", error?.code ?? "NO_OWNED_ROW");
  const rpcRow = Array.isArray(data) ? data[0] as Row | undefined : data as Row;
  const completedSessionId = rpcRow && stringValue(rpcRow.session_id);
  if (!completedSessionId) throw new RepositoryError("Could not find the completed hands-on interview.", "NO_OWNED_ROW");
  const session = await getSession(supabase, userId, completedSessionId);
  if (!session) throw new RepositoryError("Could not reload the completed hands-on interview.", "NO_OWNED_ROW");
  return session;
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
