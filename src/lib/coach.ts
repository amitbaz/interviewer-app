import "server-only";

import { z } from "zod";
import type { Evaluation, HandsOnExercise, InterviewSession, Profile } from "@/lib/types";

const profileSchema = z.object({
  role: z.string(), seniority: z.string(), summary: z.string(), narrative: z.string(),
  expertise: z.array(z.string()).min(3).max(8),
  characteristics: z.array(z.string()).min(2).max(6),
  competencies: z.array(z.object({ name: z.string(), score: z.number().min(0).max(100), focus: z.string() })).min(4),
});
const turnSchema = z.object({
  question: z.string(),
  evaluation: z.object({ score: z.number().min(0).max(10), strengths: z.array(z.string()), needsWork: z.array(z.string()), competency: z.string() }),
});

const competencies = [
  { name: "React architecture", score: 68, focus: "State ownership and component boundaries" },
  { name: "TypeScript", score: 70, focus: "Expressing reliable domain models" },
  { name: "System design", score: 61, focus: "Starting with requirements and trade-offs" },
  { name: "Performance", score: 64, focus: "Measure before optimizing" },
  { name: "Communication", score: 66, focus: "Concise, structured explanations" },
];

const handsOnStarter = `import { useEffect, useRef, useState } from "react";

type Product = {
  id: string;
  name: string;
  category: string;
};

export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the search experience here. Think about asynchronous state,
  // keyboard interaction, and what a screen-reader user should hear.
  return (
    <section>
      <label htmlFor="product-search">Search products</label>
      <input
        id="product-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </section>
  );
}`;

export function handsOnExercise(profile: Profile): HandsOnExercise {
  return {
    title: "Accessible product search",
    durationMinutes: 60,
    briefing: `You are joining a product team building a catalog experience. Implement a production-minded React + TypeScript search component appropriate for a ${profile.role}. You may work from the starter and explain decisions as you go.`,
    requirements: [
      "Fetch matching products from /api/products?q=… after the user pauses typing.",
      "Show clear loading, empty, and recoverable error states.",
      "Prevent stale responses from replacing newer results.",
      "Make suggestions navigable with the keyboard and understandable to assistive technology.",
      "Keep component responsibilities and TypeScript models deliberate.",
    ],
    starterCode: handsOnStarter,
  };
}

function fallbackProfile(cvText: string, coverLetter: string): Profile {
  const source = `${cvText} ${coverLetter}`.toLowerCase();
  const expertise = ["React", "TypeScript", "JavaScript", "Frontend architecture", "Accessibility", "Testing"].filter(
    (skill) => source.includes(skill.toLowerCase()) || skill === "React" || skill === "TypeScript",
  );
  return {
    role: /senior/i.test(source) ? "Senior Frontend Engineer" : "Frontend Engineer",
    seniority: /senior|lead|staff/i.test(source) ? "Senior" : "Mid-level",
    summary: "Frontend engineer with a product-minded approach to reliable, accessible web experiences.",
    narrative: "A hands-on engineer who combines frontend delivery with thoughtful technical decisions and collaboration.",
    expertise: expertise.slice(0, 6), characteristics: ["Product ownership", "Pragmatic problem solving", "Cross-functional collaboration"],
    competencies, cvText, coverLetter,
  };
}

async function modelJson<T>(prompt: string, schema: z.ZodType<T>): Promise<T | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${prompt}\nReturn only valid JSON.` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.35 },
      }),
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
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: "Extract the readable text from this CV. Preserve factual details, headings, job titles, dates, technologies, and achievements. Return only the extracted text." },
        { inlineData: { mimeType: "application/pdf", data } },
      ] }],
      generationConfig: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("Gemini could not read this PDF. Paste the text instead.");
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text || text.length < 80) throw new Error("Not enough readable text was found in that PDF. Paste a summary instead.");
  return text;
}

export async function analyzeProfile(cvText: string, coverLetter: string): Promise<Profile> {
  const result = await modelJson(
    `You are a career-profile analyst. Extract a concise frontend-engineer profile from this CV and optional cover letter. Never invent facts. Return role, seniority, summary, narrative, expertise, characteristics, and five conservative competency estimates.\nCV:\n${cvText}\nCover letter:\n${coverLetter}`,
    profileSchema,
  );
  return { ...(result ?? fallbackProfile(cvText, coverLetter)), cvText, coverLetter };
}

const questions = [
  "Give me a concise introduction to yourself and the frontend work you have owned recently.",
  "Tell me about an architectural decision you made that had a meaningful impact. What trade-offs did you consider?",
  "How do you decide whether state belongs locally, globally, or on the server in a React application?",
  "Design the frontend architecture for a real-time analytics dashboard. Start with the requirements you would clarify.",
  "Tell me about a technical disagreement. How did you make progress while keeping the relationship productive?",
];

function fallbackTurn(session: InterviewSession, answer: string) {
  const index = session.messages.filter((message) => message.role === "candidate").length;
  const lower = answer.toLowerCase();
  const score = Math.min(9, Math.max(5.5, 5.8 + (lower.includes("trade-off") ? 1 : 0) + (lower.includes("measure") ? 0.7 : 0) + (answer.length > 280 ? 0.6 : 0)));
  const competency = index < 2 ? "Communication" : index === 2 ? "React architecture" : "System design";
  return {
    question: questions[Math.min(index + 1, questions.length - 1)],
    evaluation: { score: Number(score.toFixed(1)), competency, strengths: ["Grounded the answer in practical experience.", "Communicated a clear point of view."], needsWork: ["Make the trade-off explicit before describing implementation details."] } satisfies Evaluation,
  };
}

export async function nextTurn(profile: Profile, session: InterviewSession, answer: string) {
  const transcript = session.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const result = await modelJson(
    `You are an experienced senior-frontend interviewer. Ask exactly one concise follow-up or next question. Do not praise, coach, reveal scores, or teach. Challenge a detail in the candidate's answer when possible. Privately evaluate the latest answer.\nProfile: ${JSON.stringify({ role: profile.role, seniority: profile.seniority, expertise: profile.expertise })}\nTranscript:\n${transcript}\nLatest answer:\n${answer}`,
    turnSchema,
  );
  return result ?? fallbackTurn(session, answer);
}

export function initialQuestion(profile: Profile) {
  return `To begin, give me a concise introduction to yourself and the kind of ${profile.role.toLowerCase()} work you have owned recently.`;
}

export async function handsOnCheckpoint(profile: Profile, session: InterviewSession, code: string, note: string) {
  const count = Math.max(0, (session.checkpoints?.length ?? 1) - 1);
  const transcript = session.messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n");
  const result = await modelJson(
    `You are a senior frontend interviewer observing a live coding exercise. Do not provide code or solve the exercise. Ask one short, probing interviewer question grounded in the candidate's latest code and note. ${count >= 1 ? "Introduce this new requirement once: the API may return 50,000 results, and keyboard navigation must remain smooth." : "Focus on their current reasoning."}\nProfile: ${JSON.stringify({ role: profile.role, seniority: profile.seniority })}\nRecent transcript:\n${transcript}\nCandidate note: ${note}\nLatest code:\n${code}`,
    z.object({ question: z.string() }),
  );
  if (result) return result.question;
  if (count === 0) return "Talk me through the request lifecycle. What prevents a slow earlier response from overwriting the newest search?";
  if (count === 1) return "New constraint: results can reach 50,000 items. What would you change so keyboard navigation and rendering stay responsive?";
  return "Before we wrap, what would you test first, and which accessibility behavior would you validate manually?";
}

function scoreCode(code: string, patterns: RegExp[], baseline: number) {
  return Number(Math.min(9.5, baseline + patterns.filter((pattern) => pattern.test(code)).length * 0.7).toFixed(1));
}

export function evaluateHandsOn(session: InterviewSession) {
  const checkpoint = session.checkpoints?.at(-1);
  const code = checkpoint?.code ?? session.exercise?.starterCode ?? "";
  const implementation = scoreCode(code, [/useState/, /useEffect|fetch\(/, /AbortController|signal/, /catch|error/i], 4.4);
  const architecture = scoreCode(code, [/type\s+\w+|interface\s+\w+/, /function\s+\w+|const\s+\w+\s*=\s*\(/, /useRef|useMemo|useCallback/], 4.8);
  const accessibility = scoreCode(code, [/aria-/, /role=/, /onKeyDown/, /aria-activedescendant|aria-selected/], 4.0);
  const testing = scoreCode(code, [/describe\(|it\(|test\(|expect\(/, /userEvent|fireEvent/, /msw|mock/], 3.8);
  const communication = Number(Math.min(9, 5 + Math.min(3, (checkpoint?.note.trim().length ?? 0) / 100) + Math.min(1, (session.checkpoints?.length ?? 0) * 0.25)).toFixed(1));
  const evaluations: Evaluation[] = [
    { competency: "React architecture", score: architecture, strengths: [architecture >= 6 ? "The component structure and types show a deliberate separation of concerns." : "You established a workable component starting point."], needsWork: ["Name state ownership and extraction boundaries explicitly as the feature grows."] },
    { competency: "TypeScript", score: architecture, strengths: ["The solution keeps the domain model visible in the implementation."], needsWork: ["Use types to make loading, error, and selection states impossible to confuse."] },
    { competency: "Accessibility", score: accessibility, strengths: [accessibility >= 6 ? "Keyboard and assistive-technology concerns appear in the implementation." : "The labelled input is a useful accessible starting point."], needsWork: ["Cover listbox semantics, focus movement, and announcing result changes before considering the work complete."] },
    { competency: "Testing", score: testing, strengths: [testing >= 6 ? "The code indicates attention to observable behavior." : "You identified testing as a final validation step."], needsWork: ["Add tests for debounce/cancellation, keyboard selection, and failure states—not only the happy path."] },
    { competency: "Communication", score: communication, strengths: ["Your checkpoint notes make your implementation reasoning inspectable."], needsWork: ["State the trade-off before implementation details when you narrate the next iteration."] },
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
    const index = competencies.findIndex((item) => item.name.toLowerCase() === evaluation.competency.toLowerCase());
    const sessionScore = evaluation.score * 10;
    if (index >= 0) {
      const current = competencies[index];
      competencies[index] = { ...current, score: Math.round(current.score * 0.78 + sessionScore * 0.22) };
    } else {
      competencies.push({ name: evaluation.competency, score: Math.round(sessionScore * 0.82), focus: evaluation.needsWork[0] ?? "Build repeatable interview evidence." });
    }
  }
  return { ...profile, competencies };
}
