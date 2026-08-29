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

export type ProfileReadiness = {
  ready: boolean;
  missing: string[];
};

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
};

/** Server-generated follow-up content; sequence and identifiers are assigned transactionally. */
export type FollowUpDraft = Pick<
  PlannedQuestion,
  "category" | "competencyId" | "competencyName" | "difficulty" | "isFollowUp" | "prompt"
>;

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
  evidence?: EvidenceItem[];
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
