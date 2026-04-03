import type { InsistenceLevel, JudgeResultWithMeta } from "../types.js";
import type { NormalizeMeta } from "../log-types.js";
import { extractJSON } from "./json-extract.js";

const VALID_INSISTENCE = new Set<string>(["low", "mid", "high"]);

export function normalizeJudge(raw: string): JudgeResultWithMeta {
  const json = extractJSON(raw);
  const truncationSuspected = json === null && raw.includes("{") && !raw.includes("}");

  if (!json) {
    return {
      interrupt: false, urgency: "low", reason: null, thought: null,
      _normMeta: { rawKind: "plain_text", jsonExtracted: false, fallbackPath: "default", truncationSuspected, thoughtType: "missing" },
    };
  }

  const thought = typeof json.thought === "string" ? json.thought : null;
  const interrupt = typeof json.interrupt === "boolean" ? json.interrupt : false;
  const urgency = VALID_INSISTENCE.has(json.urgency as string)
    ? (json.urgency as InsistenceLevel)
    : "low";
  const reason = typeof json.reason === "string" ? json.reason : null;

  const thoughtType: NormalizeMeta["thoughtType"] = thought === null
    ? ("thought" in json ? "null" : "missing")
    : "string";

  return {
    interrupt, urgency, reason, thought,
    _normMeta: { rawKind: "json", jsonExtracted: true, fallbackPath: "none", truncationSuspected, thoughtType },
  };
}
