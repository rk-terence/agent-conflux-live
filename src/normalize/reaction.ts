import type { InsistenceLevel, ReactionResultWithMeta } from "../types.js";
import type { NormalizeMeta } from "../log-types.js";
import { extractJSON, classifyThoughtType } from "./json-extract.js";
import { cleanUtterance } from "./utterance-clean.js";

const VALID_INSISTENCE = new Set<string>(["low", "mid", "high"]);
const SILENCE_TOKENS = new Set([null, "", "[silence]", "[沉默]"]);

export function normalizeReaction(raw: string, agentNames: string[]): ReactionResultWithMeta {
  // 1. Empty/whitespace → silence
  if (!raw || raw.trim().length === 0) {
    return {
      utterance: null, insistence: "mid", thought: null,
      _normMeta: { rawKind: "empty", jsonExtracted: false, fallbackPath: "none", truncationSuspected: false, thoughtType: "missing" },
      _cleanMeta: null,
    };
  }

  // 2. Attempt JSON extraction
  let utterance: string | null = null;
  let insistence: InsistenceLevel = "mid";
  let thought: string | null = null;
  let jsonExtracted = false;
  let rawKind: NormalizeMeta["rawKind"] = "plain_text";
  let fallbackPath: NormalizeMeta["fallbackPath"] = "none";

  // Check truncation: raw contains { but extractJSON failed to find valid JSON
  const json = extractJSON(raw);
  const truncationSuspected = json === null && raw.includes("{") && !raw.includes("}");

  if (json && "utterance" in json) {
    jsonExtracted = true;
    rawKind = "json";
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
    fallbackPath = "raw_text";
  }

  const thoughtType: NormalizeMeta["thoughtType"] = classifyThoughtType(json, thought);

  // 3. Silence detection
  let silenceTokenDetected = false;
  if (SILENCE_TOKENS.has(utterance)) {
    silenceTokenDetected = true;
    return {
      utterance: null, insistence, thought,
      _normMeta: { rawKind, jsonExtracted, fallbackPath, truncationSuspected, thoughtType },
      _cleanMeta: { historyHallucination: false, speakerPrefixStripped: false, actionStripped: false, silenceByLength: false, truncatedByMaxLength: false, silenceTokenDetected, originalUtterance: utterance },
    };
  }

  // 4. Apply cleanUtterance pipeline
  const cleaned = cleanUtterance(utterance!, agentNames);
  const cleanMeta = {
    historyHallucination: cleaned.historyHallucination,
    speakerPrefixStripped: cleaned.speakerPrefixStripped,
    actionStripped: cleaned.actionStripped,
    silenceByLength: cleaned.silenceByLength,
    truncatedByMaxLength: cleaned.truncatedByMaxLength,
    silenceTokenDetected: false,
    originalUtterance: utterance!,
  };

  if (cleaned.text === null) {
    if (cleaned.historyHallucination) {
      // History hallucination → silence with no thought update
      return {
        utterance: null, insistence, thought: null,
        _normMeta: { rawKind, jsonExtracted, fallbackPath, truncationSuspected, thoughtType },
        _cleanMeta: cleanMeta,
      };
    }
    // Other cleaning nullified → silence (thought preserved)
    return {
      utterance: null, insistence, thought,
      _normMeta: { rawKind, jsonExtracted, fallbackPath, truncationSuspected, thoughtType },
      _cleanMeta: cleanMeta,
    };
  }

  // 5. Return cleaned result
  return {
    utterance: cleaned.text, insistence, thought,
    _normMeta: { rawKind, jsonExtracted, fallbackPath, truncationSuspected, thoughtType },
    _cleanMeta: cleanMeta,
  };
}
