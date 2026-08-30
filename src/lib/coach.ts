import "server-only";

import { z } from "zod";
import { applyEvaluation } from "@/lib/competencies";
import { geminiModel, geminiRequestError } from "@/lib/gemini";
import { buildFallbackInterviewBlueprint, validateInterviewBlueprint } from "@/lib/interview-planner";
import { MAX_CV_PDF_BYTES } from "@/lib/upload-limits";
import type {
  BlueprintQuestion,
  Competency,
  EvidenceItem,
  Evaluation,
  FollowUpDraft,
  HandsOnExercise,
  InterviewBlueprint,
  InterviewSession,
  PlannedQuestion,
  Profile,
  ProfileDraft,
  ProfileReadiness,
  ProfileSource,
} from "@/lib/types";

const dimensions = ["correctness", "depth", "clarity", "structure", "practicalExperience", "tradeOffAwareness", "communication", "confidence", "relevance"] as const;
const profileSchema = z.object({
  role: z.string(), seniority: z.string(), summary: z.string(), narrative: z.string(),
  expertise: z.array(z.string()).min(1).max(8), characteristics: z.array(z.string()).min(1).max(6),
  competencies: z.array(z.object({ name: z.string().min(1), relevance: z.number().min(0).max(1) })).min(1),
});
const evaluationSchema = z.object({
  score: z.number().min(0).max(10), competency: z.string().optional(),
  dimensions: z.object(Object.fromEntries(dimensions.map((dimension) => [dimension, z.number().min(0).max(10)]))),
  strengths: z.array(z.string()), needsWork: z.array(z.string()),
  missingPoints: z.array(z.string()).min(1),
  betterStructure: z.array(z.string()).min(1),
  improvedAnswer: z.string().min(1),
});
const turnSchema = z.object({
  question: z.string().min(1),
  shouldFollowUp: z.boolean(),
  evaluation: evaluationSchema,
});
const evidenceSchema = z.object({
  id: z.string().min(1).optional(),
  sourceKind: z.enum(["cv", "cover_letter", "summary"]).nullable().optional(),
  sourceExcerpt: z.string().min(1),
  projectOrEmployer: z.string().nullable().optional(),
  ownership: z.string().nullable().optional(),
  technologies: z.array(z.string().min(1)).default([]),
  decision: z.string().nullable().optional(),
  constraint: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  recency: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});
const evidenceListSchema = z.union([z.array(evidenceSchema), z.object({ evidence: z.array(evidenceSchema) })]);
const workExampleVerbPattern = /\b(led|built|shipped|migrated|designed|owned|improved|implemented|launched|reduced|scaled|developed|created|refactored|rewrote|reworked|optimized|fixed|deployed|maintained|delivered|introduced|coordinated|debugged|automated)\b/i;
const blueprintQuestionDraftSchema = z.object({
  sequence: z.number().int().min(1).max(5),
  category: z.enum(["introduction", "experience", "technical", "architecture", "behavioral"]),
  competencyId: z.string().nullable().optional(),
  competencyName: z.string().nullable().optional(),
  difficulty: z.enum(["foundational", "intermediate", "senior", "advanced"]),
  objective: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).default([]),
  expectedSignals: z.array(z.string().min(1)).min(1),
  missingSignalPrompts: z.array(z.string().min(1)).min(1),
  followUpLimit: z.number().int().min(0).max(3),
  prompt: z.string().min(1),
  sourceConfidence: z.number().min(0).max(1).nullable().optional(),
});
const blueprintDraftSchema = z.object({
  status: z.enum(["grounded", "limited-grounding"]).optional(),
  fallbackReason: z.string().nullable().optional(),
  maxFollowUps: z.number().int().min(0).max(3).default(3),
  maxQuestions: z.number().int().min(5).max(8).default(8),
  questions: z.array(blueprintQuestionDraftSchema).length(5),
});

const handsOnStarter = `import { useEffect, useRef, useState } from "react";

type Product = { id: string; name: string; category: string; };

export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Build the search experience here. Think about asynchronous state,
  // keyboard interaction, and what a screen-reader user should hear.
  return <section><label htmlFor="product-search">Search products</label><input id="product-search" value={query} onChange={(event) => setQuery(event.target.value)} /></section>;
}`;

function fallbackProfile(cvText: string, coverLetter: string): ProfileDraft {
  const source = `${cvText} ${coverLetter}`.toLowerCase();
  const expertise = ["React", "TypeScript", "JavaScript", "Frontend architecture", "Accessibility", "Testing"]
    .filter((skill) => source.includes(skill.toLowerCase()) || skill === "React" || skill === "TypeScript").slice(0, 6);
  return {
    role: /senior/i.test(source) ? "Senior Frontend Engineer" : "Frontend Engineer",
    seniority: /senior|lead|staff/i.test(source) ? "Senior" : "Mid-level",
    summary: "Frontend engineer with a product-minded approach to reliable, accessible web experiences.",
    narrative: "A hands-on engineer who combines frontend delivery with thoughtful technical decisions and collaboration.",
    expertise, characteristics: ["Product ownership", "Pragmatic problem solving", "Cross-functional collaboration"],
    competencies: expertise.map((name) => ({ name, relevance: 1 })),
  };
}

async function modelJson<T>(prompt: string, schema: z.ZodType<T>): Promise<T | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const model = geminiModel();
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${prompt}\nReturn only valid JSON.` }] }], generationConfig: { responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const output = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    return output ? schema.parse(JSON.parse(output)) : null;
  } catch { return null; }
}

function normalizeEvidenceItem(value: z.infer<typeof evidenceSchema>, index: number): EvidenceItem {
  return {
    id: normalizeText(value.id) ?? `evidence-${index + 1}`,
    sourceKind: value.sourceKind ?? null,
    sourceExcerpt: value.sourceExcerpt.trim(),
    projectOrEmployer: normalizeText(value.projectOrEmployer),
    ownership: normalizeText(value.ownership),
    technologies: [...new Set(value.technologies.map((technology) => technology.trim()).filter(Boolean))],
    decision: normalizeText(value.decision),
    constraint: normalizeText(value.constraint),
    outcome: normalizeText(value.outcome),
    recency: normalizeText(value.recency),
    confidence: value.confidence,
  };
}

function techMatches(text: string): string[] {
  const technologies = [
    "React",
    "TypeScript",
    "JavaScript",
    "Next.js",
    "Postgres",
    "Node.js",
    "GraphQL",
    "Redux",
    "Supabase",
    "Vercel",
    "AWS",
    "Testing",
    "Accessibility",
  ];
  const lower = text.toLowerCase();
  return technologies.filter((technology) => lower.includes(technology.toLowerCase()));
}

function fallbackEngineeringEvidence(cvText: string, coverLetter: string): EvidenceItem[] {
  const text = `${cvText} ${coverLetter}`.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const verbs = /\b(led|built|shipped|migrated|designed|owned|improved|implemented|launched|reduced|scaled)\b/i;
  const items: EvidenceItem[] = [];
  for (const [index, sentence] of sentences.entries()) {
    if (!verbs.test(sentence)) continue;
    const technologies = techMatches(sentence);
    if (!technologies.length && !/\b(frontend|backend|platform|product|checkout|dashboard|search|api|workflow)\b/i.test(sentence)) continue;
    items.push({
      id: `evidence-${index + 1}`,
      sourceKind: null,
      sourceExcerpt: sentence.slice(0, 320),
      projectOrEmployer: null,
      ownership: /\b(i|we|owned|led|built|shipped|designed|implemented|migrated)\b/i.test(sentence) ? sentence.slice(0, 240) : null,
      technologies,
      decision: null,
      constraint: null,
      outcome: null,
      recency: null,
      confidence: technologies.length ? 0.4 : 0.25,
    });
    if (items.length === 2) break;
  }
  return items;
}

function normalizeBlueprintQuestion(
  value: z.infer<typeof blueprintQuestionDraftSchema>,
  createdAt: string,
): BlueprintQuestion {
  return {
    id: `blueprint-question-${value.sequence}`,
    sequence: value.sequence,
    category: value.category,
    competencyId: normalizeText(value.competencyId),
    competencyName: normalizeText(value.competencyName),
    difficulty: value.difficulty,
    isFollowUp: false,
    prompt: value.prompt.trim(),
    answer: null,
    createdAt,
    objective: value.objective.trim(),
    evidenceIds: value.evidenceIds,
    expectedSignals: value.expectedSignals.map((signal) => signal.trim()),
    missingSignalPrompts: value.missingSignalPrompts.map((prompt) => prompt.trim()),
    followUpLimit: value.followUpLimit,
    sourceConfidence: value.sourceConfidence ?? null,
  };
}

function normalizeBlueprint(
  value: z.infer<typeof blueprintDraftSchema>,
  createdAt: string,
): InterviewBlueprint {
  return {
    status: value.status ?? "grounded",
    fallbackReason: normalizeText(value.fallbackReason),
    maxFollowUps: value.maxFollowUps,
    maxQuestions: value.maxQuestions,
    createdAt,
    questions: value.questions.map((question) => normalizeBlueprintQuestion(question, createdAt)),
  };
}

function fallbackBlueprintCompetencies(
  profile: Pick<ProfileDraft, "seniority" | "expertise" | "competencies">,
): Competency[] {
  const expectedLevel = /staff|principal|lead|advanced/i.test(profile.seniority ?? "")
    ? "advanced"
    : /senior/i.test(profile.seniority ?? "")
      ? "senior"
      : /junior|entry|graduate|foundational/i.test(profile.seniority ?? "")
        ? "foundational"
        : "intermediate";
  const names = profile.competencies.length
    ? profile.competencies.map((competency) => competency.name)
    : profile.expertise;
  return names.map((name, index) => ({
    id: `fallback-competency-${index + 1}`,
    name,
    relevance: profile.competencies[index]?.relevance ?? 1,
    expectedLevel,
    estimatedLevel: null,
    confidence: null,
    lastPracticedAt: null,
    questionCount: 0,
    averageScore: null,
    recentScore: null,
    strengths: [],
    weaknesses: [],
  }));
}

/**
 * Extracts software-engineering evidence items from user-provided source text.
 * Returns only schema-validated facts, preserves nulls for unknown optional
 * fields, and falls back to deterministic sentence extraction on provider
 * failure or malformed JSON.
 */
export async function extractEngineeringEvidence(cvText: string, coverLetter: string): Promise<EvidenceItem[]> {
  const result = await modelJson(
    `You are extracting engineering evidence for an interview coach. Return only valid JSON. Produce an array of evidence objects. Never invent facts. Preserve null for unknown optional fields. Each item must include a sourceExcerpt and may include sourceKind, projectOrEmployer, ownership, technologies, decision, constraint, outcome, recency, confidence, and a stable id if available. Use only facts explicitly supported by the supplied text.\nCV:\n${cvText}\nCover letter:\n${coverLetter}`,
    evidenceListSchema,
  );
  if (!result) return fallbackEngineeringEvidence(cvText, coverLetter);
  const list = Array.isArray(result) ? result : result.evidence;
  return list.map((item, index) => normalizeEvidenceItem(item, index));
}

/**
 * Generates the persisted five-question interview blueprint from the validated
 * profile and extracted evidence. It retries once on malformed or unsupported
 * model output, then falls back to a deterministic limited-grounding plan.
 */
export async function generateInterviewBlueprint(
  profile: Pick<ProfileDraft, "role" | "seniority" | "summary" | "narrative" | "expertise" | "characteristics" | "competencies">,
  evidence: EvidenceItem[],
): Promise<InterviewBlueprint> {
  const createdAt = new Date().toISOString();
  const competencyContext = profile.competencies.map((competency) => ({
    name: competency.name,
    relevance: competency.relevance,
  }));
  const prompt = (repair: boolean) => [
    "You are planning a software-engineering interview blueprint.",
    "Return only valid JSON.",
    "Use the exact five-question backbone in this order: introduction, experience, technical, architecture, behavioral.",
    "Every question must include objective, evidenceIds, expectedSignals, missingSignalPrompts, followUpLimit, prompt, difficulty, and optional competencyId/competencyName/sourceConfidence.",
    "Only reference evidence ids that appear below.",
    "Do not invent projects, technologies, or outcomes.",
    repair ? "The previous response failed validation. Repair it and satisfy every schema field exactly." : "",
    `Profile: ${JSON.stringify(profile)}`,
    `Competencies: ${JSON.stringify(competencyContext)}`,
    `Evidence: ${JSON.stringify(evidence)}`,
  ].filter(Boolean).join("\n");

  for (const repair of [false, true]) {
    const result = await modelJson(prompt(repair), blueprintDraftSchema);
    if (!result) continue;
    try {
      return validateInterviewBlueprint(normalizeBlueprint(result, createdAt), evidence);
    } catch {
      continue;
    }
  }

  return buildFallbackInterviewBlueprint(
    {
      role: profile.role,
      seniority: profile.seniority,
      summary: profile.summary,
      narrative: profile.narrative,
      expertise: profile.expertise,
      characteristics: profile.characteristics,
      competencies: profile.competencies,
    },
    fallbackBlueprintCompetencies(profile),
    evidence,
    new Date(createdAt),
  );
}

function hasConcreteWorkAnchor(item: EvidenceItem): boolean {
  const sourceExcerpt = item.sourceExcerpt.trim();
  const structuredText = [item.ownership, item.decision, item.constraint, item.outcome]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const supportingText = [sourceExcerpt, structuredText].filter(Boolean).join(" ");
  const hasAction = workExampleVerbPattern.test(supportingText) || /\b(responsible for|owned|led|built|designed|implemented|created|refactored|migrated|shipped|deployed|improved|reduced|launched|maintained|developed|debugged|automated)\b/i.test(supportingText);
  const hasConcreteDetail = structuredText.length > 0 || /\b\d+%|\bmetric\b|\boutcome\b|\bimpact\b|\bconstraint\b|\btrade-?off\b/i.test(supportingText);
  return Boolean(sourceExcerpt) && item.technologies.length > 0 && hasAction && hasConcreteDetail;
}

function concreteEvidenceCount(evidence: EvidenceItem[]): number {
  return evidence.filter((item) => {
    const hasSpecifics = item.technologies.length > 0 || Boolean(item.ownership?.trim()) || Boolean(item.outcome?.trim()) || Boolean(item.decision?.trim());
    return hasConcreteWorkAnchor(item) && hasSpecifics;
  }).length;
}

/**
 * Applies the deterministic profile-quality gate for personalized interviews.
 * The gate requires concrete work examples, identifiable technologies, and
 * ownership or outcome signals before the profile can start a grounded session.
 */
export function assessProfileReadiness(evidence: EvidenceItem[]): ProfileReadiness {
  const missing = new Set<string>();
  if (concreteEvidenceCount(evidence) < 2) missing.add("two concrete engineering projects or work examples");
  if (!evidence.some((item) => item.technologies.length > 0)) missing.add("identifiable technologies");
  if (!evidence.some((item) => hasConcreteWorkAnchor(item))) missing.add("responsibilities or outcomes");
  return { ready: missing.size === 0, missing: [...missing] };
}

/** Extracts factual CV text with Gemini, enforcing hosted upload limits and actionable failures. */
export async function extractPdfText(file: File): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Add GEMINI_API_KEY to extract text from a PDF.");
  if (file.size > MAX_CV_PDF_BYTES) throw new Error("Keep CV PDFs under 4 MB so the upload fits Vercel's request limit.");
  const model = geminiModel();
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: "Extract the readable text from this CV. Preserve factual details, headings, job titles, dates, technologies, and achievements. Return only the extracted text." },
          { inlineData: { mimeType: "application/pdf", data } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw await geminiRequestError(response, "the PDF", model);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text || text.length < 80) throw new Error("Not enough readable text was found in that PDF. Paste a summary instead.");
  return text;
}

export async function analyzeProfile(cvText: string, coverLetter: string): Promise<ProfileDraft> {
  const result = await modelJson(
    `You are a career-profile analyst. Extract a concise frontend-engineer profile from this CV and optional cover letter. Never invent facts. Return role, seniority, summary, narrative, expertise, characteristics, and competency names with professional relevance (0 to 1). Do not estimate ability, scores, confidence, or seniority beyond stated evidence.\nCV:\n${cvText}\nCover letter:\n${coverLetter}`,
    profileSchema,
  );
  return result ?? fallbackProfile(cvText, coverLetter);
}

function cvExcerpt(source: ProfileSource, planned: PlannedQuestion): string {
  const text = source.cvText.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const tokens = (planned.competencyName ?? "").toLowerCase().split(/\W+/).filter(Boolean);
  const sentences = text.split(/(?<=[.!?])\s+/);
  const selected = sentences.find((sentence) => tokens.some((token) => token.length > 2 && sentence.toLowerCase().includes(token)))
    ?? sentences[0]
    ?? text;
  return selected.slice(0, 420).trimEnd();
}

function promptForPlan(planned: PlannedQuestion, source: ProfileSource): string {
  const competency = planned.competencyName ?? "your recent work";
  const excerpt = cvExcerpt(source, planned);
  const templates: Record<PlannedQuestion["category"], string> = {
    introduction: "Give me a concise introduction to yourself and the frontend work you have owned recently.",
    experience: excerpt ? `Your CV mentions “${excerpt}”. Tell me about that experience through the lens of ${competency}: what was your role, decision, and impact?` : `Tell me about a meaningful project involving ${competency}. What was your role and impact?`,
    technical: `Walk me through a technical decision involving ${competency}. What trade-offs did you consider?`,
    practical: `Describe how you would apply ${competency} to a realistic delivery constraint.`,
    architecture: `Design an approach involving ${competency}. Start with the requirements you would clarify.`,
    "system-design": `Design a system involving ${competency}. Start with the requirements you would clarify.`,
    behavioral: `Tell me about a collaboration challenge related to ${competency}. How did you make progress?`,
    communication: `Explain a complex ${competency} decision to a non-specialist stakeholder.`,
  };
  return templates[planned.category];
}

function evaluationFor(planned: PlannedQuestion, answer: string): Evaluation {
  const lower = answer.toLowerCase();
  const score = Math.min(9, Math.max(5.5, 5.8 + (lower.includes("trade-off") ? 1 : 0) + (lower.includes("measure") ? 0.7 : 0) + (answer.length > 280 ? 0.6 : 0)));
  const clarity = Number(Math.min(10, 5 + answer.length / 150).toFixed(1));
  const tradeOffAwareness = lower.includes("trade-off") ? 7 : 5;
  const practicalExperience = lower.includes("i ") || lower.includes("we ") ? 7 : 5.5;
  const structure = Number(Math.min(10, clarity + (answer.includes(".") ? 0.4 : 0)).toFixed(1));
  const communication = Number(Math.min(10, clarity + 0.3).toFixed(1));
  const relevance = planned.competencyName ? 8 : 7;
  const confidence = answer.trim().length > 120 ? 7 : 5.5;
  const correctness = Number(Math.min(10, score + 0.2).toFixed(1));
  const depth = Number(Math.min(10, score + (answer.length > 220 ? 0.4 : 0)).toFixed(1));
  return {
    score: Number(score.toFixed(1)),
    questionId: planned.id,
    competencyId: planned.competencyId,
    competency: planned.competencyName ?? "Communication",
    dimensions: {
      correctness,
      depth,
      clarity,
      structure,
      practicalExperience,
      tradeOffAwareness,
      communication,
      confidence,
      relevance,
    },
    strengths: [
      "Grounded the answer in practical experience.",
      "Communicated a clear point of view.",
    ],
    needsWork: [
      "Make the trade-off explicit before describing implementation details.",
    ],
    missingPoints: [
      lower.includes("measure")
        ? "State the baseline or success metric before describing the outcome."
        : "Name the measurable outcome or signal you used to judge the decision.",
    ],
    betterStructure: [
      "Open with the requirement or problem statement before describing the implementation.",
      "Close with the trade-off you accepted and the result you measured.",
    ],
    improvedAnswer: lower.includes("trade-off")
      ? "I would start with the requirement, explain the trade-off I chose, and close with the metric that confirmed the decision worked."
      : "I would start with the requirement, compare the options, explain the trade-off I chose, and close with the metric that confirmed the decision worked.",
  };
}

function normalizedEvaluation(planned: PlannedQuestion, value: z.infer<typeof evaluationSchema>): Evaluation {
  return {
    score: value.score,
    questionId: planned.id,
    competencyId: planned.competencyId,
    competency: planned.competencyName ?? value.competency ?? "Communication",
    dimensions: value.dimensions,
    strengths: value.strengths,
    needsWork: value.needsWork,
    missingPoints: value.missingPoints,
    betterStructure: value.betterStructure,
    improvedAnswer: value.improvedAnswer,
  };
}

export function initialQuestion(profile: Pick<ProfileDraft, "role">, planned: PlannedQuestion, source: ProfileSource): string {
  void profile;
  return promptForPlan(planned, source);
}

function deterministicFollowUp(planned: PlannedQuestion): string {
  const competency = planned.competencyName ?? "that decision";
  return `Make the ${competency} example more concrete: what trade-off did you choose, and how did you measure the outcome?`;
}

function followUpDraft(planned: PlannedQuestion, prompt: string): FollowUpDraft {
  return {
    category: planned.category,
    competencyId: planned.competencyId,
    competencyName: planned.competencyName,
    difficulty: planned.difficulty,
    isFollowUp: true,
    prompt,
  };
}

/** Evaluates the current answer and proposes either one persisted follow-up or the next plan prompt. */
export async function nextTurn(
  profile: Pick<ProfileDraft, "role" | "seniority" | "expertise" | "narrative">,
  answeredQuestion: PlannedQuestion,
  nextPlannedQuestion: PlannedQuestion | null,
  source: ProfileSource,
  session: InterviewSession,
  answer: string,
): Promise<{ evaluation: Evaluation; nextQuestion: string | null; followUp: FollowUpDraft | null }> {
  const transcript = session.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const followUpCount = session.questions.filter((question) => question.isFollowUp).length;
  const { evaluation, question, shouldFollowUp } = await evaluateTurn(
    profile,
    answeredQuestion,
    null,
    answer,
    transcript,
    source,
    nextPlannedQuestion,
    followUpCount,
  );
  if (shouldFollowUp) {
    return {
      evaluation,
      nextQuestion: null,
      followUp: followUpDraft(answeredQuestion, question ?? deterministicFollowUp(answeredQuestion)),
    };
  }
  return {
    evaluation,
    nextQuestion: question,
    followUp: null,
  };
}

export function handsOnExercise(profile: Pick<Profile, "role">): HandsOnExercise {
  return { title: "Accessible product search", durationMinutes: 60, briefing: `You are joining a product team building a catalog experience. Implement a production-minded React + TypeScript search component appropriate for a ${profile.role ?? "frontend engineer"}. You may work from the starter and explain decisions as you go.`, requirements: ["Fetch matching products from /api/products?q=… after the user pauses typing.", "Show clear loading, empty, and recoverable error states.", "Prevent stale responses from replacing newer results.", "Make suggestions navigable with the keyboard and understandable to assistive technology.", "Keep component responsibilities and TypeScript models deliberate."], starterCode: handsOnStarter, interviewerOpening: "Start by reading the brief, then tell me which requirements you would clarify before you begin implementing." };
}

export async function handsOnCheckpoint(profile: Pick<Profile, "role" | "seniority">, session: InterviewSession, code: string, note: string) {
  const count = session.checkpoints.length;
  const transcript = session.messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n");
  const result = await modelJson(`You are a senior frontend interviewer observing a live coding exercise. Do not provide code or solve the exercise. Ask one short, probing interviewer question grounded in the candidate's latest code and note. ${count >= 1 ? "Introduce this new requirement once: the API may return 50,000 results, and keyboard navigation must remain smooth." : "Focus on their current reasoning."}\nProfile: ${JSON.stringify({ role: profile.role, seniority: profile.seniority })}\nRecent transcript:\n${transcript}\nCandidate note: ${note}\nLatest code:\n${code}`, z.object({ question: z.string() }));
  if (result) return result.question;
  if (count === 0) return "Talk me through the request lifecycle. What prevents a slow earlier response from overwriting the newest search?";
  if (count === 1) return "New constraint: results can reach 50,000 items. What would you change so keyboard navigation and rendering stay responsive?";
  return "Before we wrap, what would you test first, and which accessibility behavior would you validate manually?";
}

function scoreCode(code: string, patterns: RegExp[], baseline: number) { return Number(Math.min(9.5, baseline + patterns.filter((pattern) => pattern.test(code)).length * 0.7).toFixed(1)); }

export function evaluateHandsOn(session: InterviewSession) {
  const checkpoint = session.checkpoints.at(-1);
  const code = checkpoint?.code ?? (typeof session.exercise.starterCode === "string" ? session.exercise.starterCode : "");
  const implementation = scoreCode(code, [/useState/, /useEffect|fetch\(/, /AbortController|signal/, /catch|error/i], 4.4);
  const architecture = scoreCode(code, [/type\s+\w+|interface\s+\w+/, /function\s+\w+|const\s+\w+\s*=\s*\(/, /useRef|useMemo|useCallback/], 4.8);
  const accessibility = scoreCode(code, [/aria-/, /role=/, /onKeyDown/, /aria-activedescendant|aria-selected/], 4.0);
  const testing = scoreCode(code, [/describe\(|it\(|test\(|expect\(/, /userEvent|fireEvent/, /msw|mock/], 3.8);
  const communication = Number(Math.min(9, 5 + Math.min(3, (checkpoint?.note.trim().length ?? 0) / 100) + Math.min(1, session.checkpoints.length * 0.25)).toFixed(1));
  const makeEvaluation = (competency: string, score: number, strength: string, needsWork: string): Evaluation => ({
    competencyId: null,
    competency,
    score,
    dimensions: {},
    strengths: [strength],
    needsWork: [needsWork],
    missingPoints: [`Add one concrete example that shows ${competency.toLowerCase()} in action.`],
    betterStructure: ["Lead with the requirement, then explain the implementation choice and result."],
    improvedAnswer: `I would begin with the requirement, describe the implementation choice for ${competency.toLowerCase()}, and close with the result or trade-off.`,
  });
  const evaluations = [
    makeEvaluation("React architecture", architecture, architecture >= 6 ? "The component structure and types show a deliberate separation of concerns." : "You established a workable component starting point.", "Name state ownership and extraction boundaries explicitly as the feature grows."),
    makeEvaluation("TypeScript", architecture, "The solution keeps the domain model visible in the implementation.", "Use types to make loading, error, and selection states impossible to confuse."),
    makeEvaluation("Accessibility", accessibility, accessibility >= 6 ? "Keyboard and assistive-technology concerns appear in the implementation." : "The labelled input is a useful accessible starting point.", "Cover listbox semantics, focus movement, and announcing result changes before considering the work complete."),
    makeEvaluation("Testing", testing, testing >= 6 ? "The code indicates attention to observable behavior." : "You identified testing as a final validation step.", "Add tests for debounce/cancellation, keyboard selection, and failure states—not only the happy path."),
    makeEvaluation("Communication", communication, "Your checkpoint notes make your implementation reasoning inspectable.", "State the trade-off before implementation details when you narrate the next iteration."),
  ];
  const overallScore = Number((evaluations.reduce((total, item) => total + item.score, 0) / evaluations.length).toFixed(1));
  const weakest = [...evaluations].sort((a, b) => a.score - b.score)[0];
  return { evaluations, overallScore, summary: `Hiring signal: ${overallScore >= 7.5 ? "likely advance" : overallScore >= 6 ? "mixed—probe in a follow-up" : "not yet ready"}. Your implementation signal was ${implementation}/10. The clearest next improvement is ${weakest.competency.toLowerCase()}: ${weakest.needsWork[0]}` };
}

export function completeSession(session: InterviewSession) {
  const scores = session.evaluations.map((evaluation) => evaluation.score);
  const overallScore = scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)) : 0;
  const weakest = [...session.evaluations].sort((a, b) => a.score - b.score)[0];
  return { overallScore, summary: weakest ? `Your answers were strongest when grounded in experience. Focus next on ${weakest.competency.toLowerCase()}: make your structure and trade-offs explicit before discussing implementation.` : "Complete a few questions to receive personalized feedback." };
}

export function updateCompetencies(profile: Profile, evaluations: Evaluation[]): Profile {
  const competencies = [...profile.competencies];
  for (const evaluation of evaluations) {
    const index = competencies.findIndex((item) => item.id === evaluation.competencyId || item.name.toLowerCase() === evaluation.competency.toLowerCase());
    if (index >= 0) competencies[index] = applyEvaluation(competencies[index], evaluation, new Date().toISOString());
  }
  return { ...profile, competencies };
}
