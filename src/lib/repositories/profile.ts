import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Competency,
  CompetencyScope,
  Difficulty,
  Profile,
  ProfileDraft,
  ProfileSource,
} from "@/lib/types";

type Row = Record<string, unknown>;

export class RepositoryError extends Error {
  constructor(message: string, public readonly code = "REPOSITORY_ERROR") {
    super(message);
    this.name = "RepositoryError";
  }
}

const baselineCompetencies = [
  "React architecture",
  "TypeScript",
  "System design",
  "Performance",
  "Accessibility",
  "Testing",
  "Communication",
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function expectedLevel(seniority: string | null): Difficulty {
  const value = (seniority ?? "").toLowerCase();
  if (/staff|principal|lead|advanced/.test(value)) return "advanced";
  if (/senior/.test(value)) return "senior";
  if (/junior|entry|graduate|foundational/.test(value)) return "foundational";
  return "intermediate";
}

function mapCompetency(row: Row): Competency {
  const confidence = row.confidence;
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    relevance: Number(row.relevance ?? 0),
    expectedLevel: row.expected_level as Difficulty,
    estimatedLevel: (row.estimated_level as Difficulty | null) ?? null,
    confidence: confidence === "low" || confidence === "medium" || confidence === "high"
      ? confidence
      : typeof confidence === "number" || typeof confidence === "string"
        ? Number(confidence) < 0.4 ? "low" : Number(confidence) < 0.75 ? "medium" : "high"
        : null,
    lastPracticedAt: typeof row.last_practiced_at === "string" ? row.last_practiced_at : null,
    questionCount: Number(row.question_count ?? 0),
    averageScore: row.average_score === null || row.average_score === undefined ? null : Number(row.average_score),
    recentScore: row.recent_score === null || row.recent_score === undefined ? null : Number(row.recent_score),
    strengths: stringArray(row.strengths),
    weaknesses: stringArray(row.weaknesses),
  };
}

function mapSource(rows: Row[]): ProfileSource {
  const cv = rows.find((row) => row.kind === "cv");
  const coverLetter = rows.find((row) => row.kind === "cover_letter");
  return {
    cvText: stringValue(cv?.content),
    coverLetter: stringValue(coverLetter?.content),
    cvFileName: typeof cv?.file_name === "string" ? cv.file_name : null,
    coverLetterFileName: typeof coverLetter?.file_name === "string" ? coverLetter.file_name : null,
  };
}

function mapProfile(row: Row, competencies: Competency[], source: ProfileSource): Profile {
  return {
    userId: stringValue(row.user_id),
    role: typeof row.role === "string" ? row.role : null,
    seniority: typeof row.seniority === "string" ? row.seniority : null,
    summary: typeof row.summary === "string" ? row.summary : null,
    narrative: typeof row.narrative === "string" ? row.narrative : null,
    expertise: stringArray(row.expertise),
    characteristics: stringArray(row.characteristics),
    competencies,
    source,
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function relatedExpertise(name: string, expertise: string[]): boolean {
  const values = expertise.map((item) => item.toLowerCase());
  if (name === "React architecture") return values.some((item) => /react|frontend|front-end|ui/.test(item));
  if (name === "TypeScript") return values.some((item) => /typescript|\bts\b/.test(item));
  if (name === "System design") return values.some((item) => /system|architecture|distributed|backend|platform/.test(item));
  return false;
}

/** Creates scope only; it deliberately never creates an assessment score. */
export function competencyScopeFor(expertise: string[]): CompetencyScope[] {
  const scopes = new Map<string, CompetencyScope>();
  for (const name of expertise.map((item) => item.trim()).filter(Boolean)) {
    scopes.set(name.toLowerCase(), { name, relevance: 1 });
  }
  for (const name of baselineCompetencies) {
    const key = name.toLowerCase();
    if (!scopes.has(key)) {
      scopes.set(key, { name, relevance: relatedExpertise(name, expertise) ? 0.9 : 0.7 });
    }
  }
  return [...scopes.values()];
}

export function profileScopeRows(userId: string, profile: ProfileDraft) {
  return competencyScopeFor(profile.expertise).map((competency) => ({
    user_id: userId,
    name: competency.name,
    relevance: competency.relevance,
    expected_level: expectedLevel(profile.seniority),
    updated_at: new Date().toISOString(),
  }));
}

export async function getProfile(supabase: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data: profile, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new RepositoryError("Could not load your profile.", error.code);
  if (!profile) return null;

  const [documentsResult, competenciesResult] = await Promise.all([
    supabase.from("source_documents").select("*").eq("user_id", userId),
    supabase.from("competencies").select("*").eq("user_id", userId).order("name"),
  ]);
  if (documentsResult.error) throw new RepositoryError("Could not load your source documents.", documentsResult.error.code);
  if (competenciesResult.error) throw new RepositoryError("Could not load your competencies.", competenciesResult.error.code);

  return mapProfile(
    profile as Row,
    ((competenciesResult.data ?? []) as Row[]).map(mapCompetency),
    mapSource((documentsResult.data ?? []) as Row[]),
  );
}

export async function saveProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: ProfileDraft,
  source: ProfileSource,
): Promise<Profile> {
  const { data: savedProfile, error: profileError } = await supabase
    .from("profiles")
    .upsert({
      user_id: userId,
      role: profile.role,
      seniority: profile.seniority,
      summary: profile.summary,
      narrative: profile.narrative,
      expertise: profile.expertise,
      characteristics: profile.characteristics,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("*")
    .single();
  if (profileError || !savedProfile) throw new RepositoryError("Could not save your profile.", profileError?.code);

  const { error: deleteError } = await supabase.from("source_documents").delete().eq("user_id", userId);
  if (deleteError) throw new RepositoryError("Could not replace your source documents.", deleteError.code);

  const sourceRows = [
    { kind: "cv", content: source.cvText, file_name: source.cvFileName ?? null },
    { kind: "cover_letter", content: source.coverLetter, file_name: source.coverLetterFileName ?? null },
  ].filter((document) => document.content.trim().length > 0)
    .map((document) => ({ ...document, user_id: userId }));
  if (sourceRows.length) {
    const { error: sourceError } = await supabase.from("source_documents").insert(sourceRows);
    if (sourceError) throw new RepositoryError("Could not save your source documents.", sourceError.code);
  }

  const competencyRows = profileScopeRows(userId, profile);
  if (competencyRows.length) {
    const { error: competencyError } = await supabase
      .from("competencies")
      .upsert(competencyRows, { onConflict: "user_id,normalized_name" });
    if (competencyError) throw new RepositoryError("Could not save your competency scope.", competencyError.code);
  }

  const saved = await getProfile(supabase, userId);
  if (!saved) throw new RepositoryError("Your saved profile could not be reloaded.", "NO_OWNED_ROW");
  return saved;
}

export { mapCompetency };
