import "server-only";

import { z } from "zod";
import { applyEvaluation } from "@/lib/competencies";
import type { Evaluation, HandsOnExercise, InterviewSession, PlannedQuestion, Profile, ProfileDraft, ProfileSource } from "@/lib/types";

const dimensions = ["correctness", "depth", "clarity", "structure", "practicalExperience", "tradeOffAwareness", "communication", "confidence", "relevance"] as const;
const profileSchema = z.object({
  role: z.string(), seniority: z.string(), summary: z.string(), narrative: z.string(),
  expertise: z.array(z.string()).min(1).max(8), characteristics: z.array(z.string()).min(1).max(6),
  competencies: z.array(z.object({ name: z.string().min(1), relevance: z.number().min(0).max(1) })).min(1),
});
const evaluationSchema = z.object({
  score: z.number().min(0).max(10), competency: z.string().optional(),
  dimensions: z.object(Object.fromEntries(dimensions.map((dimension) => [dimension, z.number().min(0).max(10).optional()]))).optional(),
  strengths: z.array(z.string()), needsWork: z.array(z.string()),
});
const turnSchema = z.object({ question: z.string().min(1), evaluation: evaluationSchema });

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
    const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${prompt}\nReturn only valid JSON.` }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.35 } }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const output = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    return output ? schema.parse(JSON.parse(output)) : null;
  } catch { return null; }
}

export async function extractPdfText(file: File): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Add GEMINI_API_KEY to extract text from a PDF.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Keep CV PDFs under 10 MB.");
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Extract the readable text from this CV. Preserve factual details, headings, job titles, dates, technologies, and achievements. Return only the extracted text." }, { inlineData: { mimeType: "application/pdf", data } }] }], generationConfig: { temperature: 0 } }), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("Gemini could not read this PDF. Paste the text instead.");
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
  return sentences.find((sentence) => tokens.some((token) => token.length > 2 && sentence.toLowerCase().includes(token))) ?? sentences[0] ?? text.slice(0, 420);
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
  return { score: Number(score.toFixed(1)), competencyId: planned.competencyId, competency: planned.competencyName ?? "Communication", dimensions: { clarity: Number(Math.min(10, 5 + answer.length / 150).toFixed(1)), tradeOffAwareness: lower.includes("trade-off") ? 7 : 5 }, strengths: ["Grounded the answer in practical experience.", "Communicated a clear point of view."], needsWork: ["Make the trade-off explicit before describing implementation details."] };
}

function normalizedEvaluation(planned: PlannedQuestion, value: z.infer<typeof evaluationSchema>): Evaluation {
  return { score: value.score, competencyId: planned.competencyId, competency: planned.competencyName ?? value.competency ?? "Communication", dimensions: value.dimensions ?? {}, strengths: value.strengths, needsWork: value.needsWork };
}

export function initialQuestion(profile: Pick<ProfileDraft, "role">, planned: PlannedQuestion, source: ProfileSource): string {
  void profile;
  return promptForPlan(planned, source);
}

export async function nextTurn(profile: Pick<ProfileDraft, "role" | "seniority" | "expertise" | "narrative">, planned: PlannedQuestion, source: ProfileSource, session: InterviewSession, answer: string) {
  const transcript = session.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const context = { role: profile.role, seniority: profile.seniority, expertise: profile.expertise, narrative: profile.narrative, cvExcerpt: cvExcerpt(source, planned), plan: { category: planned.category, competency: planned.competencyName, difficulty: planned.difficulty }, transcript, latestAnswer: answer };
  const result = await modelJson(`You are an experienced senior-frontend interviewer. Ask exactly one concise question for the supplied plan. Do not praise, coach, reveal scores, or teach. Privately evaluate the latest answer. Context: ${JSON.stringify(context)}`, turnSchema);
  return result ? { question: result.question, evaluation: normalizedEvaluation(planned, result.evaluation) } : { question: promptForPlan(planned, source), evaluation: evaluationFor(planned, answer) };
}

export function handsOnExercise(profile: Pick<Profile, "role">): HandsOnExercise {
  return { title: "Accessible product search", durationMinutes: 60, briefing: `You are joining a product team building a catalog experience. Implement a production-minded React + TypeScript search component appropriate for a ${profile.role ?? "frontend engineer"}. You may work from the starter and explain decisions as you go.`, requirements: ["Fetch matching products from /api/products?q=… after the user pauses typing.", "Show clear loading, empty, and recoverable error states.", "Prevent stale responses from replacing newer results.", "Make suggestions navigable with the keyboard and understandable to assistive technology.", "Keep component responsibilities and TypeScript models deliberate."], starterCode: handsOnStarter };
}

export async function handsOnCheckpoint(profile: Pick<Profile, "role" | "seniority">, session: InterviewSession, code: string, note: string) {
  const count = Math.max(0, session.checkpoints.length - 1);
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
  const makeEvaluation = (competency: string, score: number, strength: string, needsWork: string): Evaluation => ({ competencyId: null, competency, score, dimensions: {}, strengths: [strength], needsWork: [needsWork] });
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
