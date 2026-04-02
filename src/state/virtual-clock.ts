import type { SpeechRecord, SilenceRecord, SessionConfig } from "../types.js";
import { createTokenCounter } from "../util/token-count.js";

/**
 * Compute the time cost of a turn record.
 * Collision time is charged separately by the discussion loop — NOT included here.
 */
export function computeTurnTimeCost(
  record: SpeechRecord | SilenceRecord,
  config: SessionConfig,
): number {
  if (record.type === "silence") {
    return record.duration;
  }

  // Speech: time = tokenCount(deliveredText) * tokenTimeCost
  const tokenCount = createTokenCounter(config.tokenCounter);
  const deliveredText = record.interruption?.success
    ? record.interruption.spokenPart
    : record.utterance;

  return tokenCount(deliveredText) * config.tokenTimeCost;
}
