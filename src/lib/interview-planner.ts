import type {
  Competency,
  Difficulty,
  PlannedQuestion,
  QuestionCategory,
} from "@/lib/types";

const difficulties: Difficulty[] = ["foundational", "intermediate", "senior", "advanced"];
const categories: QuestionCategory[] = ["introduction", "experience", "technical", "architecture", "behavioral"];
const plannerTimestamp = "1970-01-01T00:00:00.000Z";
const stalenessReference = Date.parse("2026-08-29T00:00:00.000Z");

function normalizedSeniority(seniority: string): Difficulty {
  const value = seniority.toLowerCase();
  if (/staff|principal|lead|advanced/.test(value)) return "advanced";
  if (/senior/.test(value)) return "senior";
  if (/junior|entry|graduate|foundational/.test(value)) return "foundational";
  return "intermediate";
}

function boundedDifficulty(index: number): Difficulty {
  return difficulties[Math.max(0, Math.min(difficulties.length - 1, index))];
}

function weakness(competency: Competency): number {
  if (!competency.estimatedLevel) return 0;
  return Math.max(
    0,
    (difficulties.indexOf(competency.expectedLevel) - difficulties.indexOf(competency.estimatedLevel)) /
      (difficulties.length - 1),
  );
}

function uncertainty(competency: Competency): number {
  if (competency.confidence === null) return 1;
  if (competency.confidence === "low") return 0.75;
  if (competency.confidence === "medium") return 0.4;
  return 0;
}

function staleness(competency: Competency): number {
  if (!competency.lastPracticedAt) return 1;
  const timestamp = Date.parse(competency.lastPracticedAt);
  if (Number.isNaN(timestamp)) return 1;
  return Math.max(0, Math.min(1, (stalenessReference - timestamp) / (365 * 24 * 60 * 60 * 1000)));
}

function priority(competency: Competency): number {
  return competency.relevance * 0.45
    + weakness(competency) * 0.25
    + uncertainty(competency) * 0.2
    + staleness(competency) * 0.1;
}

function matchesCategory(competency: Competency, category: QuestionCategory): boolean {
  const name = competency.name.toLowerCase();
  if (category === "architecture") return /architecture|system\s*design/.test(name);
  if (category === "technical") return !/architecture|system\s*design|communication|behavior/.test(name);
  if (category === "behavioral") return /communication|collaboration|leadership|behavior/.test(name);
  return true;
}

function selectCompetency(
  competencies: Competency[],
  category: QuestionCategory,
  previousCompetencyId: string | null,
): Competency | null {
  const eligible = competencies.filter((competency) => competency.id !== previousCompetencyId);
  const categoryMatches = eligible.filter((competency) => matchesCategory(competency, category));
  const candidates = categoryMatches.length ? categoryMatches : eligible;

  return [...candidates].sort((left, right) => priority(right) - priority(left) || left.id.localeCompare(right.id))[0] ?? null;
}

function promptFor(category: QuestionCategory, competency: Competency | null): string {
  const subject = competency?.name ?? "your recent work";
  const templates: Record<QuestionCategory, string> = {
    introduction: "Give me a concise introduction to yourself and the work you have owned recently.",
    experience: `Tell me about a meaningful project involving ${subject}. What was your role and impact?`,
    technical: `Walk me through a technical decision involving ${subject}. What trade-offs did you consider?`,
    practical: `Describe how you would apply ${subject} to a realistic delivery constraint.`,
    architecture: `Design an approach involving ${subject}. Start with the requirements you would clarify.`,
    "system-design": `Design a system involving ${subject}. Start with the requirements you would clarify.`,
    behavioral: `Tell me about a collaboration challenge related to ${subject}. How did you make progress?`,
    communication: `Explain a complex ${subject} decision to a non-specialist stakeholder.`,
  };

  return templates[category];
}

export function chooseDifficulty(competency: Competency, seniority: string): Difficulty {
  if (!competency.estimatedLevel) return normalizedSeniority(seniority);

  const estimatedIndex = difficulties.indexOf(competency.estimatedLevel);
  if (competency.confidence === "low") return boundedDifficulty(estimatedIndex - 1);
  if (competency.confidence === "high" || (competency.averageScore ?? 0) >= 8) {
    return boundedDifficulty(estimatedIndex + 1);
  }
  return competency.estimatedLevel;
}

export function buildInterviewPlan(competencies: Competency[], seniority: string): PlannedQuestion[] {
  let previousCompetencyId: string | null = null;

  return categories.map((category, index) => {
    const competency = category === "introduction"
      ? null
      : selectCompetency(competencies, category, previousCompetencyId);
    previousCompetencyId = competency?.id ?? previousCompetencyId;

    const sequence = index + 1;
    return {
      id: `planned-${sequence}-${competency?.id ?? category}`,
      sequence,
      category,
      competencyId: competency?.id ?? null,
      competencyName: competency?.name ?? null,
      difficulty: competency ? chooseDifficulty(competency, seniority) : normalizedSeniority(seniority),
      isFollowUp: false,
      prompt: promptFor(category, competency),
      answer: null,
      createdAt: plannerTimestamp,
    };
  });
}

export function appendFollowUp(plan: PlannedQuestion[], followUp: PlannedQuestion): PlannedQuestion[] {
  if (plan.length >= 8) return plan;

  return [...plan, {
    ...followUp,
    sequence: plan.length + 1,
    isFollowUp: true,
  }];
}
