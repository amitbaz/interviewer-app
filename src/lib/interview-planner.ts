import type {
  BlueprintQuestion,
  Competency,
  Difficulty,
  EvidenceItem,
  InterviewBlueprint,
  PlannedQuestion,
  ProfileDraft,
  QuestionCategory,
} from "@/lib/types";

const difficulties: Difficulty[] = ["foundational", "intermediate", "senior", "advanced"];
const categories: QuestionCategory[] = ["introduction", "experience", "technical", "architecture", "behavioral"];
const plannerTimestamp = "1970-01-01T00:00:00.000Z";
const defaultMaxFollowUps = 3;
const defaultMaxQuestions = 8;

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

function staleness(competency: Competency, referenceTime: number): number {
  if (!competency.lastPracticedAt) return 1;
  const timestamp = Date.parse(competency.lastPracticedAt);
  if (Number.isNaN(timestamp)) return 1;
  return Math.max(0, Math.min(1, (referenceTime - timestamp) / (365 * 24 * 60 * 60 * 1000)));
}

function priority(competency: Competency, referenceTime: number): number {
  return competency.relevance * 0.45
    + weakness(competency) * 0.25
    + uncertainty(competency) * 0.2
    + staleness(competency, referenceTime) * 0.1;
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
  referenceTime: number,
): Competency | null {
  const eligible = competencies.filter((competency) => competency.id !== previousCompetencyId);
  const categoryMatches = eligible.filter((competency) => matchesCategory(competency, category));
  const candidates = categoryMatches.length ? categoryMatches : eligible;

  return [...candidates].sort((left, right) => priority(right, referenceTime) - priority(left, referenceTime) || left.id.localeCompare(right.id))[0] ?? null;
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

function categorySignals(category: QuestionCategory): string[] {
  if (category === "introduction") return ["role summary", "recent ownership"];
  if (category === "experience") return ["role", "decision", "impact"];
  if (category === "technical") return ["decision", "trade-off", "constraint"];
  if (category === "architecture") return ["requirements", "constraints", "approach"];
  return ["collaboration", "decision", "impact"];
}

function categoryMissingSignalPrompts(category: QuestionCategory, subject: string): string[] {
  if (category === "introduction") return [`Name the recent engineering area you owned in ${subject}.`];
  if (category === "experience") return ["Name the measurable outcome or impact."];
  if (category === "technical") return ["What option did you reject and why?"];
  if (category === "architecture") return ["Which requirement or constraint changed the design?"];
  return ["Who did you need alignment from and how did you get it?"];
}

function blueprintObjective(category: QuestionCategory, competencyName: string | null, item: EvidenceItem | null): string {
  const subject = item?.projectOrEmployer ?? competencyName ?? "recent engineering work";
  if (category === "introduction") return "Establish recent engineering ownership.";
  if (category === "experience") return `Probe ownership and impact in ${subject}.`;
  if (category === "technical") return `Probe the core technical decision behind ${subject}.`;
  if (category === "architecture") return `Probe system design choices around ${subject}.`;
  return `Probe collaboration and delivery around ${subject}.`;
}

function blueprintPrompt(question: PlannedQuestion, item: EvidenceItem | null): string {
  const subject = item?.projectOrEmployer ?? question.competencyName ?? "your recent engineering work";
  if (question.category === "introduction") {
    return "Give me a concise introduction to yourself and the frontend work you have owned recently.";
  }
  if (question.category === "experience") {
    return `Tell me about ${subject}. What was your role, what decision did you own, and what changed because of it?`;
  }
  if (question.category === "technical") {
    const decision = item?.decision ?? "technical decision";
    return `Walk me through the ${decision} on ${subject}. What trade-offs did you consider?`;
  }
  if (question.category === "architecture") {
    return `How did you shape the approach for ${subject}? Start with the requirements and constraints you clarified.`;
  }
  return `How did you align the team around ${subject}? What disagreement or delivery challenge did you handle?`;
}

function evidenceForCategory(category: QuestionCategory, evidence: EvidenceItem[]): EvidenceItem | null {
  if (!evidence.length || category === "introduction") return null;
  if (category === "experience" || category === "technical") return evidence[0] ?? null;
  return evidence[1] ?? evidence[0] ?? null;
}

function normalizeFollowUpLimit(value: number): number {
  return Math.max(0, Math.min(defaultMaxFollowUps, Math.trunc(value)));
}

function defaultBlueprintQuestion(
  planned: PlannedQuestion,
  item: EvidenceItem | null,
): BlueprintQuestion {
  const evidenceIds = item ? [item.id] : [];
  const competencyName = planned.competencyName;
  const prompt = blueprintPrompt(planned, item);
  return {
    ...planned,
    prompt,
    objective: blueprintObjective(planned.category, competencyName, item),
    evidenceIds,
    expectedSignals: categorySignals(planned.category),
    missingSignalPrompts: categoryMissingSignalPrompts(planned.category, item?.projectOrEmployer ?? competencyName ?? "that work"),
    followUpLimit: planned.category === "introduction" || planned.category === "behavioral" ? 0 : 1,
    sourceConfidence: item?.confidence ?? null,
  };
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

/** Builds the legacy five-question backbone using evidence priority relative to the injected current time. */
export function buildInterviewPlan(
  competencies: Competency[],
  seniority: string,
  now: Date = new Date(),
): PlannedQuestion[] {
  let previousCompetencyId: string | null = null;
  const referenceTime = Number.isNaN(now.getTime()) ? Date.now() : now.getTime();

  return categories.map((category, index) => {
    const competency = category === "introduction"
      ? null
      : selectCompetency(competencies, category, previousCompetencyId, referenceTime);
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

/** Ensures an AI-generated blueprint uses the exact backbone and only owned evidence ids. */
export function validateInterviewBlueprint(
  blueprint: InterviewBlueprint,
  evidence: EvidenceItem[],
): InterviewBlueprint {
  if (blueprint.questions.length !== categories.length) {
    throw new Error("Interview blueprint must contain the exact five-question backbone.");
  }
  if (blueprint.maxFollowUps > defaultMaxFollowUps) {
    throw new Error("Interview blueprint exceeds the follow-up limit.");
  }
  if (blueprint.maxQuestions > defaultMaxQuestions) {
    throw new Error("Interview blueprint exceeds the total-question limit.");
  }

  const knownEvidenceIds = new Set(evidence.map((item) => item.id));
  let totalFollowUpBudget = 0;
  for (const [index, question] of blueprint.questions.entries()) {
    if (question.sequence !== index + 1 || question.category !== categories[index] || question.isFollowUp) {
      throw new Error("Interview blueprint must preserve the exact five-question backbone.");
    }
    if (!question.objective.trim()) throw new Error("Interview blueprint questions need an objective.");
    if (!question.prompt.trim()) throw new Error("Interview blueprint questions need prompt text.");
    if (!question.expectedSignals.length) throw new Error("Interview blueprint questions need expected signals.");
    if (!question.missingSignalPrompts.length) throw new Error("Interview blueprint questions need missing-signal prompts.");
    if (normalizeFollowUpLimit(question.followUpLimit) !== question.followUpLimit) {
      throw new Error("Interview blueprint follow-up limits must stay between 0 and 3.");
    }
    totalFollowUpBudget += question.followUpLimit;
    for (const evidenceId of question.evidenceIds) {
      if (!knownEvidenceIds.has(evidenceId)) {
        throw new Error(`Interview blueprint references unknown evidence ids: ${evidenceId}.`);
      }
    }
  }
  if (totalFollowUpBudget > blueprint.maxFollowUps || blueprint.questions.length + totalFollowUpBudget > blueprint.maxQuestions) {
    throw new Error("Interview blueprint exceeds the total follow-up budget.");
  }

  return blueprint;
}

/**
 * Builds a deterministic fallback blueprint when the model response is absent
 * or invalid. The resulting plan remains evidence-backed where possible and is
 * explicitly marked as limited grounding.
 */
export function buildFallbackInterviewBlueprint(
  profile: ProfileDraft,
  competencies: Competency[],
  evidence: EvidenceItem[],
  now: Date = new Date(),
  fallbackReason = "Gemini returned invalid blueprint JSON after one repair attempt.",
): InterviewBlueprint {
  const plan = buildInterviewPlan(competencies, profile.seniority ?? "Intermediate", now);
  return {
    status: "limited-grounding",
    fallbackReason,
    maxFollowUps: defaultMaxFollowUps,
    maxQuestions: defaultMaxQuestions,
    createdAt: now.toISOString(),
    questions: plan.map((question) => defaultBlueprintQuestion(question, evidenceForCategory(question.category, evidence))),
  };
}

/** Adds one persisted follow-up while preserving the total eight-question cap. */
export function appendFollowUp(plan: PlannedQuestion[], followUp: PlannedQuestion): PlannedQuestion[] {
  if (plan.length >= defaultMaxQuestions) return plan;

  return [...plan, {
    ...followUp,
    sequence: plan.length + 1,
    isFollowUp: true,
  }];
}
