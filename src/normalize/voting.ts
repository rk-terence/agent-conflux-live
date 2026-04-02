import type { VotingResult } from "../types.js";
import { extractJSON } from "./json-extract.js";

export function normalizeVoting(raw: string, candidates: string[]): VotingResult {
  let voteText: string | null = null;
  let thought: string | null = null;

  // 1. Attempt JSON extraction
  const json = extractJSON(raw);
  if (json) {
    voteText = typeof json.vote === "string" ? json.vote : null;
    thought = typeof json.thought === "string" ? json.thought : null;
  } else {
    // 3. Fallback: raw.trim() as vote
    voteText = raw.trim();
  }

  // 4. Match against candidate names
  const vote = voteText !== null && candidates.includes(voteText) ? voteText : null;

  return { vote, thought };
}
