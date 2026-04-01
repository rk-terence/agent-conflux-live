import type { ModelCallOutput, CallMode } from "../model-gateway/types.js";
import type { AgentOutput, InsistenceLevel } from "../domain/types.js";

export type NormalizedError = {
  readonly type: "error";
  readonly message: string;
};

export type NormalizedOutput = AgentOutput | NormalizedError;

export type NormalizedResult = {
  readonly agentId: string;
  readonly output: NormalizedOutput;
  readonly raw: ModelCallOutput;
};

export function normalizeOutput(
  callOutput: ModelCallOutput,
  mode: CallMode,
): NormalizedResult {
  const { agentId, text, finishReason } = callOutput;

  if (finishReason === "error" || finishReason === "cancelled") {
    return {
      agentId,
      output: {
        type: "error",
        message: finishReason === "error"
          ? `Model call failed: ${text || "unknown error"}`
          : "Model call was cancelled",
      },
      raw: callOutput,
    };
  }

  // max_tokens truncation — still treat as speech with whatever we got,
  // since models now produce full responses without sentence boundaries
  const trimmed = text.trim();

  if (trimmed === "") {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  if (mode === "reaction") {
    return normalizeReaction(agentId, trimmed, callOutput);
  }

  // negotiation and voting modes are parsed by their respective modules,
  // not by the normalization layer — return the raw text as-is for them
  return {
    agentId,
    output: { type: "silence" },
    raw: callOutput,
  };
}

// ---------------------------------------------------------------------------
// Reaction normalization
// ---------------------------------------------------------------------------

function normalizeReaction(
  agentId: string,
  trimmed: string,
  callOutput: ModelCallOutput,
): NormalizedResult {
  const parsed = parseStructuredReaction(trimmed);

  // Null speech or silence marker → silence
  if (parsed.speech === null) {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  const speechTrimmed = parsed.speech.trim();
  if (speechTrimmed === "" || isSilence(speechTrimmed)) {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  // Clean: strip fabricated history, speaker prefixes, parenthetical actions
  const cleaned = cleanSpeechText(speechTrimmed);
  if (cleaned === "" || isSilence(cleaned)) {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  return {
    agentId,
    output: {
      type: "speech",
      text: cleaned,
      tokenCount: estimateTokenCount(cleaned),
      insistence: parsed.insistence,
    },
    raw: callOutput,
  };
}

// ---------------------------------------------------------------------------
// Structured output parsing
// ---------------------------------------------------------------------------

export type ParsedReactionOutput = {
  readonly speech: string | null;
  readonly insistence: InsistenceLevel;
};

/**
 * Parse structured JSON reaction output from the model.
 * Falls back to treating the entire text as speech with default "mid" insistence
 * when the model ignores the structured output instruction.
 */
export function parseStructuredReaction(rawText: string): ParsedReactionOutput {
  const json = extractJson(rawText);
  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    const speech = obj.speech === null ? null
      : (typeof obj.speech === "string" ? obj.speech : null);
    const insistence = isInsistenceLevel(obj.insistence) ? obj.insistence : "mid";

    // If the model set speech to a non-null, non-string value, treat as fallback
    if (obj.speech !== null && typeof obj.speech !== "string") {
      return { speech: rawText, insistence: "mid" };
    }

    return { speech, insistence };
  }

  // Fallback: check for old-style [silence] marker
  if (isSilence(rawText)) {
    return { speech: null, insistence: "low" };
  }

  // Fallback: treat entire text as speech with default insistence
  return { speech: rawText, insistence: "mid" };
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract a JSON object from raw LLM text.
 * Handles common wrapping patterns: markdown code fences, preamble text.
 */
export function extractJson(text: string): unknown | null {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;

  // Find outermost { ... }
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

export function isInsistenceLevel(value: unknown): value is InsistenceLevel {
  return value === "low" || value === "mid" || value === "high";
}

// ---------------------------------------------------------------------------
// Speech classification helpers (unchanged from previous implementation)
// ---------------------------------------------------------------------------

function isSilence(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  return normalized === "[silence]" || normalized === "[沉默]";
}

/** Minimum character count for a valid speech utterance.
 *  Fragments like "嗯，" or just a name are not meaningful contributions. */
const MIN_SPEECH_LENGTH = 4;

/**
 * Apply all speech cleaning steps in order.
 * If the output looks like fabricated history rather than actual speech,
 * return empty string so it gets classified as silence.
 */
function cleanSpeechText(text: string): string {
  // Detect history hallucination: model outputs text that mimics the
  // timestamped history format, e.g. "- [2.5s] **Gemini**：" or "[2.5s] ..."
  if (/^-?\s*\[\d+\.\d+s\]/.test(text)) return "";

  let cleaned = stripParentheticals(stripSpeakerPrefix(text));

  // Discard fragments that are too short to be meaningful speech
  if (cleaned.length < MIN_SPEECH_LENGTH) return "";

  return cleaned;
}

/**
 * Strip speaker prefixes that models sometimes echo from history projection.
 */
function stripSpeakerPrefix(text: string): string {
  return text
    .replace(/^\[[\w\u4e00-\u9fff][\w\u4e00-\u9fff.\- ]*\][：:]\s*/u, "")
    .replace(/^\*\*[\w\u4e00-\u9fff][\w\u4e00-\u9fff.\- ]*\*\*[：:]\s*/u, "")
    .trim();
}

/**
 * Strip parenthetical stage directions / action descriptions from model output.
 */
function stripParentheticals(text: string): string {
  return text
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
}

/**
 * Rough token estimate for Chinese text.
 * Most Chinese characters map to 1-2 tokens in typical tokenizers.
 * We use a simple heuristic: ~1.5 tokens per CJK character,
 * ~0.25 tokens per ASCII word character.
 */
export function estimateTokenCount(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code > 0x2e80) {
      count += 1.5;
    } else if (/\w/.test(char)) {
      count += 0.25;
    } else {
      count += 0.5;
    }
  }
  return Math.max(1, Math.round(count));
}
