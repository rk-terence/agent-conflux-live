import type { InsistenceLevel, ReactionResult } from "../types.js";
import { extractJSON } from "./json-extract.js";
import { cleanUtterance } from "./utterance-clean.js";

const VALID_INSISTENCE = new Set<string>(["low", "mid", "high"]);
const SILENCE_TOKENS = new Set([null, "", "[silence]", "[沉默]"]);

export function normalizeReaction(raw: string, agentNames: string[]): ReactionResult {
  // 1. Empty/whitespace → silence
  if (!raw || raw.trim().length === 0) {
    return { utterance: null, insistence: "mid", thought: null };
  }

  // 2. Attempt JSON extraction
  let utterance: string | null = null;
  let insistence: InsistenceLevel = "mid";
  let thought: string | null = null;
  let fromJSON = false;

  const json = extractJSON(raw);
  if (json && "utterance" in json) {
    fromJSON = true;
    utterance = json.utterance === null || json.utterance === undefined
      ? null
      : String(json.utterance);
    insistence = VALID_INSISTENCE.has(json.insistence as string)
      ? (json.insistence as InsistenceLevel)
      : "mid";
    thought = typeof json.thought === "string" ? json.thought : null;
  } else {
    // Invalid JSON or missing fields → treat raw text as utterance
    utterance = raw.trim();
    insistence = "mid";
    thought = null;
  }

  // 3. Silence detection
  if (SILENCE_TOKENS.has(utterance)) {
    return { utterance: null, insistence, thought };
  }

  // 4. Apply cleanUtterance pipeline
  const cleaned = cleanUtterance(utterance!, agentNames);
  if (cleaned.text === null) {
    if (cleaned.historyHallucination) {
      // History hallucination → silence with no thought update
      return { utterance: null, insistence, thought: null };
    }
    // Other cleaning nullified → silence (thought preserved)
    return { utterance: null, insistence, thought };
  }

  // 5. Return cleaned result
  return { utterance: cleaned.text, insistence, thought };
}
