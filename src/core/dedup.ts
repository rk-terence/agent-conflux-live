import type { TurnRecord } from "../types.js";

/**
 * Check if an utterance is a verbatim duplicate of any previous utterance in the session.
 * Compares against all delivered speaker utterances and collision losers' intended text.
 */
export function isDuplicate(utterance: string, log: TurnRecord[]): boolean {
  const trimmed = utterance.trim();

  for (const record of log) {
    if (record.type !== "speech") continue;

    // Check delivered speaker's full utterance
    if (record.utterance.trim() === trimmed) return true;

    // Check collision losers' intended utterances
    if (record.collision) {
      for (const collider of record.collision.colliders) {
        if (collider.utterance.trim() === trimmed) return true;
      }
    }
  }

  return false;
}
