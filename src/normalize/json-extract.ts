import type { NormalizeMeta } from "../log-types.js";

/**
 * Classify the thought field shape from the raw JSON for logging.
 * Distinguishes string, null, missing, object, and other (e.g. number, boolean, array).
 */
export function classifyThoughtType(
  json: Record<string, unknown> | null,
  normalizedThought: string | null,
): NormalizeMeta["thoughtType"] {
  if (normalizedThought !== null) return "string";
  if (!json || !("thought" in json)) return "missing";
  const raw = json.thought;
  if (raw === null || raw === undefined) return "null";
  if (typeof raw === "string") return "string"; // empty string normalized to null
  if (typeof raw === "object" && !Array.isArray(raw)) return "object";
  return "other";
}

/**
 * Extract JSON object from raw LLM response text.
 * Handles markdown code fences and embedded JSON.
 */
export function extractJSON(raw: string): Record<string, unknown> | null {
  let text = raw.trim();

  // Strip markdown code fence
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Find first { and last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonStr = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
