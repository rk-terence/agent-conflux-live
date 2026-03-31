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

  // max_tokens means the output was truncated — violates sentence atomicity
  if (finishReason === "max_tokens") {
    return {
      agentId,
      output: {
        type: "error",
        message: `Output truncated by max_tokens limit (partial text: "${text.slice(0, 50)}")`,
      },
      raw: callOutput,
    };
  }

  const trimmed = text.trim();

  // Continuation mode
  if (mode === "continuation") {
    if (trimmed === "" || isOnlyStopSequence(trimmed)) {
      return { agentId, output: { type: "end_of_turn" }, raw: callOutput };
    }

    // [silence] in continuation mode is a protocol anomaly — the model
    // echoed the system prompt's silence instruction instead of continuing.
    // Treat as end of turn rather than polluting the transcript.
    if (isSilence(trimmed)) {
      return { agentId, output: { type: "end_of_turn" }, raw: callOutput };
    }

    return {
      agentId,
      output: {
        type: "speech",
        text: trimmed,
        tokenCount: estimateTokenCount(trimmed),
      },
      raw: callOutput,
    };
  }

  // Reaction mode: check for [silence]
  if (isSilence(trimmed)) {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  if (trimmed === "") {
    return { agentId, output: { type: "silence" }, raw: callOutput };
  }

  return {
    agentId,
    output: {
      type: "speech",
      text: trimmed,
      tokenCount: estimateTokenCount(trimmed),
    },
    raw: callOutput,
  };
}

function isSilence(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  return normalized === "[silence]" || normalized === "[沉默]";
}

function isOnlyStopSequence(text: string): boolean {
  return ["。", "！", "？"].includes(text);
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
      // CJK character range (approximate)
      count += 1.5;
    } else if (/\w/.test(char)) {
      count += 0.25;
    } else {
      count += 0.5;
    }
  }
  return Math.max(1, Math.round(count));
}
