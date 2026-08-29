export type Competency = {
  name: string;
  score: number;
  focus: string;
};

export type Profile = {
  role: string;
  seniority: string;
  summary: string;
  narrative: string;
  expertise: string[];
  characteristics: string[];
  competencies: Competency[];
  cvText: string;
  coverLetter: string;
};

export type Message = {
  role: "interviewer" | "candidate";
  content: string;
  createdAt: string;
};

export type Evaluation = {
  score: number;
  strengths: string[];
  needsWork: string[];
  competency: string;
};

export type HandsOnExercise = {
  title: string;
  durationMinutes: number;
  briefing: string;
  requirements: string[];
  starterCode: string;
};

export type CodeCheckpoint = {
  code: string;
  note: string;
  createdAt: string;
};

export type InterviewSession = {
  id: number;
  kind?: "conversation" | "hands-on";
  status: "active" | "complete";
  messages: Message[];
  evaluations: Evaluation[];
  exercise?: HandsOnExercise;
  checkpoints?: CodeCheckpoint[];
  summary?: string;
  overallScore?: number;
  createdAt: string;
};
