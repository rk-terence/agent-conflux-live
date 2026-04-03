import type { VotingResultWithMeta } from "../types.js";
import type { NormalizeMeta } from "../log-types.js";
import { extractJSON } from "./json-extract.js";

export function normalizeVoting(raw: string, candidates: string[]): VotingResultWithMeta {
  let voteText: string | null = null;
  let thought: string | null = null;
  let jsonExtracted = false;
  let rawKind: NormalizeMeta["rawKind"] = "plain_text";
  let fallbackPath: NormalizeMeta["fallbackPath"] = "none";
  const truncationSuspected = !extractJSON(raw) && raw.includes("{") && !raw.includes("}");

  // 1. Attempt JSON extraction
  const json = extractJSON(raw);
  if (json) {
    jsonExtracted = true;
    rawKind = "json";
    voteText = typeof json.vote === "string" ? json.vote : null;
    thought = typeof json.thought === "string" ? json.thought : null;
  } else {
    // 3. Fallback: raw.trim() as vote
    voteText = raw.trim();
    fallbackPath = "raw_text";
  }

  const thoughtType: NormalizeMeta["thoughtType"] = thought === null
    ? (json && "thought" in json ? "null" : "missing")
    : "string";

  // 4. Match against candidate names
  const vote = voteText !== null && candidates.includes(voteText) ? voteText : null;

  return {
    vote, thought,
    _normMeta: { rawKind, jsonExtracted, fallbackPath, truncationSuspected, thoughtType },
  };
}
