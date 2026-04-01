import type { ModelCallOutput, CallMode } from "../model-gateway/types.js";
import type { AgentOutput } from "../domain/types.js";

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
  _mode: CallMode,
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

  if (isSilence(trimmed)) {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  if (trimmed === "") {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  // Clean: strip fabricated history, speaker prefixes, parenthetical actions
  const cleaned = cleanSpeechText(trimmed);
  if (cleaned === "" || isSilence(cleaned)) {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  return {
    agentId,
    output: {
      type: "speech",
      text: cleaned,
      tokenCount: estimateTokenCount(cleaned),
    },
    raw: callOutput,
  };
}

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
 *
 * Models may mimic the history format in their output.
 * The prefix is not actual speech — strip it so only the spoken words remain.
 * Matches patterns like:
 * - Old format: "[你]: ", "[Gemini]: ", "[GPT-4o]:"
 * - Current format: "**你**：", "**GPT-4o**：", "**Gemini 2.5 Pro**："
 *
 * Agent names may contain word chars, CJK, hyphens, dots, and spaces (e.g. "GPT-4o",
 * "Claude-3.5", "Gemini 2.5 Pro"), so the character class must be broad enough.
 */
function stripSpeakerPrefix(text: string): string {
  return text
    .replace(/^\[[\w\u4e00-\u9fff][\w\u4e00-\u9fff.\- ]*\][：:]\s*/u, "")
    .replace(/^\*\*[\w\u4e00-\u9fff][\w\u4e00-\u9fff.\- ]*\*\*[：:]\s*/u, "")
    .trim();
}

/**
 * Strip parenthetical stage directions / action descriptions from model output.
 *
 * Why this exists:
 * Some models (notably DeepSeek) respond with bracketed "actions" like
 * "（等了一秒，确认安静后）" or "（转向 Qwen）" in addition to actual speech.
 * These violate the roundtable protocol in two ways:
 *   1. The system explicitly tells models to output only spoken words, no
 *      action descriptions or narration. Parentheticals bypass this instruction.
 *   2. Actions like "等了3秒" imply temporal capabilities (waiting, pausing)
 *      that don't exist in our system — virtual time is managed by the engine,
 *      not by models. Letting these through would create false impressions
 *      in other agents' history projections.
 *
 * By stripping at the normalization layer (before the reducer), we ensure:
 *   - Domain events never contain non-speech content
 *   - Other agents' projected history stays clean
 *   - Pure-parenthetical outputs are correctly classified as silence
 *     rather than generating empty speech events
 *
 * Matches both full-width （…） and half-width (…) parentheses.
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
