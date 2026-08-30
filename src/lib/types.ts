export type QuestionCategory =
  | "introduction"
  | "experience"
  | "technical"
  | "practical"
  | "architecture"
  | "system-design"
  | "behavioral"
  | "communication";

export type Difficulty = "foundational" | "intermediate" | "senior" | "advanced";

export type Competency = {
  id: string;
  name: string;
  relevance: number;
  expectedLevel: Difficulty;
  estimatedLevel: Difficulty | null;
  confidence: "low" | "medium" | "high" | null;
  lastPracticedAt: string | null;
  questionCount: number;
  averageScore: number | null;
  recentScore: number | null;
  strengths: string[];
  weaknesses: string[];
};

/** A source-backed engineering fact that can justify question planning and feedback. */
export type EvidenceItem = {
  id: string;
  sourceKind: "cv" | "cover_letter" | "summary" | null;
  sourceExcerpt: string;
  projectOrEmployer: string | null;
  ownership: string | null;
  technologies: string[];
  decision: string | null;
  constraint: string | null;
  outcome: string | null;
  recency: string | null;
  confidence: number;
};

/** Deterministic profile gate result used to allow or reject grounded interviews. */
export type ProfileReadiness = {
  ready: boolean;
  missing: string[];
};

export type BlueprintStatus = "grounded" | "limited-grounding";

export type PlannedQuestion = {
  id: string;
  sequence: number;
  category: QuestionCategory;
  competencyId: string | null;
  competencyName: string | null;
  difficulty: Difficulty;
  isFollowUp: boolean;
  prompt: string;
  answer: string | null;
  createdAt: string;
  objective?: string;
  evidenceIds?: string[];
  expectedSignals?: string[];
  missingSignalPrompts?: string[];
  rubricCriteria?: string[];
  followUpLimit?: number;
  sourceConfidence?: number | null;
  parentQuestionId?: string | null;
};

/**
 * A persisted interview question contract whose objective, evidence targets,
 * rubric criteria, and evidence targets must remain stable across the session.
 */
export type BlueprintQuestion = PlannedQuestion & {
  objective: string;
  evidenceIds: string[];
  expectedSignals: string[];
  missingSignalPrompts: string[];
  rubricCriteria?: string[];
  followUpLimit: number;
  sourceConfidence: number | null;
};

/** The five-question interview plan generated before the first answer is collected. */
export type InterviewBlueprint = {
  status: BlueprintStatus;
  fallbackReason: string | null;
  maxFollowUps: number;
  maxQuestions: number;
  createdAt: string;
  questions: BlueprintQuestion[];
};

/**
 * Server-generated follow-up content; the follow-up keeps the original rubric
 * contract so later persistence and hydration can preserve the exact objective.
 */
export type FollowUpDraft = {
  category: PlannedQuestion["category"];
  competencyId: string | null;
  competencyName: string | null;
  difficulty: Difficulty;
  isFollowUp: true;
  prompt: string;
  objective: string;
  evidenceIds: string[];
  expectedSignals: string[];
  missingSignalPrompts: string[];
  rubricCriteria: string[];
  followUpLimit: number;
  sourceConfidence: number | null;
  parentQuestionId?: string | null;
};

export type Evaluation = {
  score: number;
  questionId?: string | null;
  competencyId: string | null;
  competency: string;
  dimensions: Partial<Record<
    | "correctness"
    | "depth"
    | "clarity"
    | "structure"
    | "practicalExperience"
    | "tradeOffAwareness"
    | "communication"
    | "confidence"
    | "relevance",
    number
  >>;
  strengths: string[];
  needsWork: string[];
  /** Specific content the candidate omitted and should add next time. */
  missingPoints: string[];
  /** Recommended sequencing changes that make the answer easier to follow. */
  betterStructure: string[];
  /** A concise example of how the answer could be improved without inventing facts. */
  improvedAnswer: string;
  /** Optional grounded-answer metadata persisted for richer coaching history. */
  relevance?: number | null;
  /** Optional exact claims the answer supports. */
  supportedClaims?: string[];
  /** Optional expected rubric signals the answer actually covered. */
  expectedSignalsPresent?: string[];
  /** Optional unsupported or contradictory claims the answer introduced. */
  unsupportedClaims?: string[];
  /** Optional dimension-level justifications for the grounded evaluation. */
  dimensionReasons?: Partial<Record<
    | "correctness"
    | "depth"
    | "clarity"
    | "structure"
    | "practicalExperience"
    | "tradeOffAwareness"
    | "communication"
    | "confidence"
    | "relevance",
    string
  >>;
};

/** A fully grounded interview evaluation with answer-relevance and claim evidence. */
export type GroundedEvaluation = Evaluation & {
  relevance: number;
  supportedClaims: string[];
  expectedSignalsPresent: string[];
  unsupportedClaims: string[];
  dimensionReasons: Record<
    | "correctness"
    | "depth"
    | "clarity"
    | "structure"
    | "practicalExperience"
    | "tradeOffAwareness"
    | "communication"
    | "confidence"
    | "relevance",
    string
  >;
};

export type CompetencyScope = {
  name: string;
  relevance: number;
};

export type ProfileDraft = {
  role: string | null;
  seniority: string | null;
  summary: string | null;
  narrative: string | null;
  expertise: string[];
  characteristics: string[];
  competencies: CompetencyScope[];
};

export type ProfileSource = {
  cvText: string;
  coverLetter: string;
  cvFileName?: string | null;
  coverLetterFileName?: string | null;
};

export type Profile = {
  userId: string;
  role: string | null;
  seniority: string | null;
  summary: string | null;
  narrative: string | null;
  expertise: string[];
  characteristics: string[];
  competencies: Competency[];
  /** Persisted source-backed evidence. Legacy rows may hydrate without it. */
  evidence?: EvidenceItem[];
  /** Latest deterministic readiness decision. Legacy rows may hydrate without it. */
  readiness?: ProfileReadiness;
  source: ProfileSource;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  role: "interviewer" | "candidate";
  content: string;
  createdAt: string;
};

export type HandsOnExercise = {
  title: string;
  durationMinutes: number;
  briefing: string;
  requirements: string[];
  starterCode: string;
  interviewerOpening: string;
};

export type HandsOnCheckpoint = {
  id: string;
  code: string;
  note: string;
  interviewerPrompt: string;
  createdAt: string;
};

export type InterviewSession = {
  id: string;
  userId: string;
  kind: "conversation" | "hands-on";
  status: "active" | "complete";
  startedAt: string;
  completedAt: string | null;
  exercise: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  overallScore: number | null;
  questions: PlannedQuestion[];
  /** The persisted planning contract for grounded sessions; legacy rows may omit it. */
  blueprint?: InterviewBlueprint | null;
  checkpoints: HandsOnCheckpoint[];
  evaluations: Evaluation[];
  messages: Message[];
  createdAt: string;
  updatedAt: string;
};

/** Deterministic progress signals derived from completed coaching evidence. */
export type ProgressSnapshot = {
  readiness: number | null;
  latestScore: number | null;
  trend: "improving" | "stable" | "declining" | "baseline" | null;
  recentScores: number[];
  strongest: Competency | null;
  weakest: Competency | null;
  recurringWeaknesses: string[];
};

/**
 * The full job lifecycle, from a saved/shortlisted role through its outcome.
 * `opportunities` is the single canonical record for both roles a user is
 * only considering and roles they have actually applied to or interviewed
 * for; there is no separate "applications" entity.
 */
export type OpportunityStatus =
  | "considering"
  | "applied"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "closed";

/** The kinds of facts recorded in an opportunity's append-only history. */
export type OpportunityEventType =
  | "created"
  | "status_changed"
  | "interview_scheduled"
  | "interview_completed"
  | "note"
  | "source_updated";

export type Opportunity = {
  id: string;
  userId: string;
  company: string;
  role: string;
  status: OpportunityStatus;
  location: string | null;
  remote: boolean | null;
  jobUrl: string | null;
  jobDescription: string | null;
  /** Human-readable source such as an employer or ATS name. */
  sourceLabel: string | null;
  /** Stable integration namespace, e.g. "manual", "job-hunter", "tracker-import". */
  sourceSystem: string | null;
  /** Stable source-owned identity used to prevent duplicate imports of the same listing. */
  sourceExternalId: string | null;
  /** 0-100 fit score when available. */
  matchScore: number | null;
  strengths: string[];
  gaps: string[];
  notes: string | null;
  appliedAt: string | null;
  nextInterviewAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One append-only fact in an opportunity's lifecycle history. Never mutated after creation. */
export type OpportunityEvent = {
  id: string;
  userId: string;
  opportunityId: string;
  eventType: OpportunityEventType;
  fromStatus: OpportunityStatus | null;
  toStatus: OpportunityStatus | null;
  occurredAt: string;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

/**
 * Every opportunity is created in `considering` status via `create_opportunity`;
 * status is deliberately not settable here so the summary row and its history
 * cannot disagree at birth. Use `transitionOpportunity` to move it onward.
 */
export type CreateOpportunityInput = {
  company: string;
  role: string;
  location?: string | null;
  remote?: boolean | null;
  jobUrl?: string | null;
  jobDescription?: string | null;
  sourceLabel?: string | null;
  sourceSystem?: string | null;
  sourceExternalId?: string | null;
  matchScore?: number | null;
  strengths?: string[];
  gaps?: string[];
  notes?: string | null;
};

/**
 * Ordinary descriptive-field updates. Deliberately excludes `status`,
 * `appliedAt`, and `nextInterviewAt` — those lifecycle fields only change
 * together with their history, through `transitionOpportunity` and
 * `scheduleOpportunityInterview`.
 */
export type UpdateOpportunityDetailsInput = {
  company?: string;
  role?: string;
  location?: string | null;
  remote?: boolean | null;
  jobUrl?: string | null;
  jobDescription?: string | null;
  sourceLabel?: string | null;
  sourceSystem?: string | null;
  sourceExternalId?: string | null;
  matchScore?: number | null;
  strengths?: string[];
  gaps?: string[];
  notes?: string | null;
};

/**
 * A career story is a real, reusable professional experience the user can
 * tell in an interview -- not a coach inference. `completeness` describes
 * whether enough factual fields exist to use the story, not how well the
 * user delivers it, and Release 1 never computes it automatically.
 */
export type CareerStoryReviewState = "draft" | "confirmed" | "retired";

export type CareerStory = {
  id: string;
  userId: string;
  title: string;
  situation: string | null;
  responsibility: string | null;
  problem: string | null;
  actions: string | null;
  alternatives: string | null;
  tradeoffs: string | null;
  ownership: string | null;
  outcome: string | null;
  lessons: string | null;
  tags: string[];
  /** 0-1; caller-provided or the database default, never computed by Release 1. */
  completeness: number;
  reviewState: CareerStoryReviewState;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Typed provenance link from a career story to the durable evidence that
 * backs it. Exactly one source is set, enforced in the database with
 * `check (num_nonnulls(profile_evidence_id, interview_question_id) = 1)`.
 */
export type CareerStoryEvidence = {
  id: string;
  userId: string;
  careerStoryId: string;
  profileEvidenceId: string | null;
  interviewQuestionId: string | null;
  note: string | null;
  createdAt: string;
};

/**
 * A discriminated union so callers cannot supply two source IDs when
 * attaching career story evidence. See `storyEvidenceColumns` in
 * `src/lib/repositories/stories.ts` for the one place this is converted to
 * nullable database columns.
 */
export type CareerStoryEvidenceSource =
  | { kind: "profile_evidence"; profileEvidenceId: string }
  | { kind: "interview_question"; interviewQuestionId: string };

export type CreateCareerStoryInput = {
  title: string;
  situation?: string | null;
  responsibility?: string | null;
  problem?: string | null;
  actions?: string | null;
  alternatives?: string | null;
  tradeoffs?: string | null;
  ownership?: string | null;
  outcome?: string | null;
  lessons?: string | null;
  tags?: string[];
  /** Omit to use the database default of 0. Release 1 never computes this automatically. */
  completeness?: number;
  reviewState?: CareerStoryReviewState;
};

export type UpdateCareerStoryInput = {
  title?: string;
  situation?: string | null;
  responsibility?: string | null;
  problem?: string | null;
  actions?: string | null;
  alternatives?: string | null;
  tradeoffs?: string | null;
  ownership?: string | null;
  outcome?: string | null;
  lessons?: string | null;
  tags?: string[];
  completeness?: number;
  reviewState?: CareerStoryReviewState;
  confirmedAt?: string | null;
};
