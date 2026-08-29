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

export type Evaluation = {
  score: number;
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
};

export type Profile = {
  userId: string;
  role: string | null;
  seniority: string | null;
  summary: string | null;
  narrative: string | null;
  expertise: string[];
  characteristics: string[];
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  role: "interviewer" | "candidate";
  content: string;
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
  createdAt: string;
  updatedAt: string;
};
