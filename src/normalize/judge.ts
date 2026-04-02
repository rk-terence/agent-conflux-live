import type { InsistenceLevel, JudgeResult } from "../types.js";
import { extractJSON } from "./json-extract.js";

const VALID_INSISTENCE = new Set<string>(["low", "mid", "high"]);

export function normalizeJudge(raw: string): JudgeResult {
  const json = extractJSON(raw);
  if (!json) {
    return { interrupt: false, urgency: "low", reason: null, thought: null };
  }

  const thought = typeof json.thought === "string" ? json.thought : null;
  const interrupt = typeof json.interrupt === "boolean" ? json.interrupt : false;
  const urgency = VALID_INSISTENCE.has(json.urgency as string)
    ? (json.urgency as InsistenceLevel)
    : "low";
  const reason = typeof json.reason === "string" ? json.reason : null;

  return { interrupt, urgency, reason, thought };
}
