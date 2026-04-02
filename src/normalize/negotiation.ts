import type { InsistenceLevel, NegotiationResult } from "../types.js";
import { extractJSON } from "./json-extract.js";

const VALID_INSISTENCE = new Set<string>(["low", "mid", "high"]);

export function normalizeNegotiation(raw: string): NegotiationResult {
  // 1. Attempt JSON extraction
  const json = extractJSON(raw);
  let thought: string | null = null;

  if (json) {
    // 2. Extract thought regardless of insistence validity
    thought = typeof json.thought === "string" ? json.thought : null;

    // 3. Validate insistence
    if (VALID_INSISTENCE.has(json.insistence as string)) {
      return { insistence: json.insistence as InsistenceLevel, thought };
    }
    // Fall through to keyword fallback (thought preserved)
  }

  // 4. Keyword fallback on raw text
  const text = raw.toLowerCase();
  if (text.includes("high") || text.includes("坚持")) {
    return { insistence: "high", thought };
  }
  if (text.includes("mid") || text.includes("犹豫") || text.includes("中")) {
    return { insistence: "mid", thought };
  }
  if (text.includes("low") || text.includes("让步") || text.includes("让")) {
    return { insistence: "low", thought };
  }

  // 5. Default: low
  return { insistence: "low", thought };
}
