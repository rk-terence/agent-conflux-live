import type { InsistenceLevel, NegotiationResultWithMeta } from "../types.js";
import type { NormalizeMeta } from "../log-types.js";
import { extractJSON } from "./json-extract.js";

const VALID_INSISTENCE = new Set<string>(["low", "mid", "high"]);

export function normalizeNegotiation(raw: string): NegotiationResultWithMeta {
  // 1. Attempt JSON extraction
  const json = extractJSON(raw);
  let thought: string | null = null;
  const truncationSuspected = json === null && raw.includes("{") && !raw.includes("}");

  if (json) {
    // 2. Extract thought regardless of insistence validity
    thought = typeof json.thought === "string" ? json.thought : null;
    const thoughtType: NormalizeMeta["thoughtType"] = thought === null
      ? (json && "thought" in json ? "null" : "missing")
      : "string";

    // 3. Validate insistence
    if (VALID_INSISTENCE.has(json.insistence as string)) {
      return {
        insistence: json.insistence as InsistenceLevel, thought,
        _normMeta: { rawKind: "json", jsonExtracted: true, fallbackPath: "none", truncationSuspected, thoughtType },
      };
    }
    // Fall through to keyword fallback (thought preserved)
  }

  const thoughtType: NormalizeMeta["thoughtType"] = thought === null ? "missing" : "string";

  // 4. Keyword fallback on raw text
  const text = raw.toLowerCase();
  if (text.includes("high") || text.includes("坚持")) {
    return {
      insistence: "high", thought,
      _normMeta: { rawKind: json ? "json" : "plain_text", jsonExtracted: !!json, fallbackPath: "keyword", truncationSuspected, thoughtType },
    };
  }
  if (text.includes("mid") || text.includes("犹豫") || text.includes("中")) {
    return {
      insistence: "mid", thought,
      _normMeta: { rawKind: json ? "json" : "plain_text", jsonExtracted: !!json, fallbackPath: "keyword", truncationSuspected, thoughtType },
    };
  }
  if (text.includes("low") || text.includes("让步") || text.includes("让")) {
    return {
      insistence: "low", thought,
      _normMeta: { rawKind: json ? "json" : "plain_text", jsonExtracted: !!json, fallbackPath: "keyword", truncationSuspected, thoughtType },
    };
  }

  // 5. Default: low
  return {
    insistence: "low", thought,
    _normMeta: { rawKind: json ? "json" : "plain_text", jsonExtracted: !!json, fallbackPath: "default", truncationSuspected, thoughtType },
  };
}
