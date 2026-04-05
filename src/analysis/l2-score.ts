import { asRecord, extractL2Evidence } from "./l2-evidence.js";
import { buildL2Prompt } from "./l2-prompt.js";
import type { ParsedEvent } from "./log-schema.js";
import type {
  L2BlockedResult,
  L2CandidateQuote,
  L2EvidenceRef,
  L2Result,
  L2RubricName,
  L2RubricScore,
  L2ScoredResult,
  RunSummary,
} from "./types.js";
import { L2_RUBRIC_WEIGHTS } from "./types.js";

const RUBRIC_ORDER = Object.keys(L2_RUBRIC_WEIGHTS) as L2RubricName[];

export type L2ChatFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

interface ParsedL2Response {
  dominant_observation: unknown;
  mechanics_contamination_note: unknown;
  candidate_quotes: unknown;
  rubrics: unknown;
}

interface ValidatedL2Response {
  dominant_observation: string;
  mechanics_contamination_note: string;
  candidate_quotes: L2CandidateQuote[];
  rubrics: L2RubricScore[];
}

function isRubricName(value: unknown): value is L2RubricName {
  return typeof value === "string" && RUBRIC_ORDER.includes(value as L2RubricName);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function extractJsonString(content: string): string {
  const trimmed = content.trim();
  const candidates = [trimmed];

  const fencedMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    if (match[1]) candidates.push(match[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("L2 scorer response did not contain valid JSON");
}

function validateEvidenceRef(
  value: unknown,
  label: string,
  errors: string[],
): L2EvidenceRef | null {
  const obj = asRecord(value);
  if (!obj) {
    errors.push(`${label} must be an object`);
    return null;
  }

  const turn = obj.turn;
  const speaker = obj.speaker;
  const text = obj.text;

  if (typeof turn !== "number" || !Number.isFinite(turn)) {
    errors.push(`${label}.turn must be a number`);
  }
  if (typeof speaker !== "string" || speaker.trim() === "") {
    errors.push(`${label}.speaker must be a non-empty string`);
  }
  if (typeof text !== "string" || text.trim() === "") {
    errors.push(`${label}.text must be a non-empty string`);
  }

  if (
    typeof turn !== "number" ||
    !Number.isFinite(turn) ||
    typeof speaker !== "string" ||
    speaker.trim() === "" ||
    typeof text !== "string" ||
    text.trim() === ""
  ) {
    return null;
  }

  return { turn, speaker: speaker.trim(), text: text.trim() };
}

export function validateL2Response(
  parsed: unknown,
): { valid: true; result: ValidatedL2Response } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  const obj = asRecord(parsed);

  if (!obj) {
    return { valid: false, errors: ["top-level response must be an object"] };
  }

  const dominantObservation = obj.dominant_observation;
  const contaminationNote = obj.mechanics_contamination_note;

  if (
    typeof dominantObservation !== "string" ||
    dominantObservation.trim() === ""
  ) {
    errors.push("dominant_observation must be a non-empty string");
  }
  if (
    typeof contaminationNote !== "string" ||
    contaminationNote.trim() === ""
  ) {
    errors.push("mechanics_contamination_note must be a non-empty string");
  }

  const candidateQuotes: L2CandidateQuote[] = [];
  if (!Array.isArray(obj.candidate_quotes)) {
    errors.push("candidate_quotes must be an array");
  } else {
    if (obj.candidate_quotes.length > 3) {
      errors.push("candidate_quotes must contain at most 3 items");
    }
    obj.candidate_quotes.forEach((item, index) => {
      const validated = validateEvidenceRef(item, `candidate_quotes[${index}]`, errors);
      if (validated) candidateQuotes.push(validated);
    });
  }

  const rubrics: L2RubricScore[] = [];
  const seenRubrics = new Set<L2RubricName>();

  if (!Array.isArray(obj.rubrics)) {
    errors.push("rubrics must be an array");
  } else {
    for (const [index, item] of obj.rubrics.entries()) {
      const rubricObj = asRecord(item);
      if (!rubricObj) {
        errors.push(`rubrics[${index}] must be an object`);
        continue;
      }

      const rubric = rubricObj.rubric;
      const score = rubricObj.score;
      const why = rubricObj.why;
      const failureMode = rubricObj.failure_mode;

      if (!isRubricName(rubric)) {
        errors.push(`rubrics[${index}].rubric must be one of ${RUBRIC_ORDER.join(", ")}`);
      } else if (seenRubrics.has(rubric)) {
        errors.push(`rubrics[${index}].rubric duplicated: ${rubric}`);
      } else {
        seenRubrics.add(rubric);
      }

      if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 5) {
        errors.push(`rubrics[${index}].score must be an integer between 0 and 5`);
      }
      if (typeof why !== "string" || why.trim() === "") {
        errors.push(`rubrics[${index}].why must be a non-empty string`);
      }
      if (!(typeof failureMode === "string" || failureMode === null)) {
        errors.push(`rubrics[${index}].failure_mode must be a string or null`);
      }

      const evidence: L2EvidenceRef[] = [];
      if (!Array.isArray(rubricObj.evidence)) {
        errors.push(`rubrics[${index}].evidence must be an array`);
      } else {
        if (rubricObj.evidence.length < 1 || rubricObj.evidence.length > 3) {
          errors.push(`rubrics[${index}].evidence must contain 1 to 3 items`);
        }
        rubricObj.evidence.forEach((entry, evidenceIndex) => {
          const validated = validateEvidenceRef(
            entry,
            `rubrics[${index}].evidence[${evidenceIndex}]`,
            errors,
          );
          if (validated) evidence.push(validated);
        });
      }

      if (
        isRubricName(rubric) &&
        typeof score === "number" &&
        Number.isInteger(score) &&
        score >= 0 &&
        score <= 5 &&
        typeof why === "string" &&
        why.trim() !== "" &&
        (typeof failureMode === "string" || failureMode === null) &&
        evidence.length >= 1 &&
        evidence.length <= 3
      ) {
        rubrics.push({
          rubric,
          score,
          why: why.trim(),
          evidence,
          failure_mode: failureMode,
        });
      }
    }
  }

  for (const rubric of RUBRIC_ORDER) {
    if (!seenRubrics.has(rubric)) {
      errors.push(`missing rubric: ${rubric}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors: unique(errors) };
  }

  const dominantObservationText = dominantObservation as string;
  const contaminationNoteText = contaminationNote as string;
  const sortedRubrics = RUBRIC_ORDER.map(
    (rubric) => rubrics.find((entry) => entry.rubric === rubric)!,
  );

  return {
    valid: true,
    result: {
      dominant_observation: dominantObservationText.trim(),
      mechanics_contamination_note: contaminationNoteText.trim(),
      candidate_quotes: candidateQuotes,
      rubrics: sortedRubrics,
    },
  };
}

export function computeWeightedTotal(rubrics: L2RubricScore[]): number {
  const byName = new Map(rubrics.map((rubric) => [rubric.rubric, rubric]));
  let total = 0;

  for (const rubricName of RUBRIC_ORDER) {
    const rubric = byName.get(rubricName);
    if (!rubric) {
      throw new Error(`Cannot compute weighted total: missing rubric ${rubricName}`);
    }
    total += (rubric.score / 5) * L2_RUBRIC_WEIGHTS[rubricName];
  }

  return Math.round(total);
}

function buildBlockedResult(summary: RunSummary): L2BlockedResult {
  const reasons = unique([
    ...summary.classification.l0_infra.reasons,
    ...summary.classification.l1_mechanics.reasons,
  ]);

  return {
    status: "blocked",
    reasons: reasons.length > 0 ? reasons : ["not_eligible_for_l2"],
    scorer_model: null,
    scored_at: new Date().toISOString(),
  };
}

export async function scoreL2(
  events: ParsedEvent[],
  summary: RunSummary,
  chatFn: L2ChatFn,
  scorerModel: string,
  maxAttempts = 2,
): Promise<L2Result> {
  if (!summary.eligible_for_l2) {
    return buildBlockedResult(summary);
  }

  const evidence = extractL2Evidence(events, summary);
  const { systemPrompt, userPrompt } = buildL2Prompt(evidence);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const rawResponse = await chatFn(systemPrompt, userPrompt);
      const parsed = JSON.parse(extractJsonString(rawResponse)) as ParsedL2Response;
      const validated = validateL2Response(parsed);

      if (!validated.valid) {
        throw new Error(`Invalid L2 scorer response: ${validated.errors.join("; ")}`);
      }

      return {
        status: "scored",
        rubrics: validated.result.rubrics,
        weighted_total_100: computeWeightedTotal(validated.result.rubrics),
        dominant_observation: validated.result.dominant_observation,
        candidate_quotes: validated.result.candidate_quotes,
        mechanics_contamination_note: validated.result.mechanics_contamination_note,
        human_decision_required: true,
        scorer_model: scorerModel,
        scored_at: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError!;
}
