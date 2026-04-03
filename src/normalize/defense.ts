import type { DefenseResultWithMeta } from "../types.js";
import type { NormalizeMeta } from "../log-types.js";
import { extractJSON, classifyThoughtType } from "./json-extract.js";

export function normalizeDefense(raw: string): DefenseResultWithMeta {
  const json = extractJSON(raw);
  const truncationSuspected = json === null && raw.includes("{") && !raw.includes("}");

  if (!json) {
    return {
      yield: true, thought: null,
      _normMeta: { rawKind: "plain_text", jsonExtracted: false, fallbackPath: "default", truncationSuspected, thoughtType: "missing" },
    };
  }

  const thought = typeof json.thought === "string" ? json.thought : null;
  // Note: "yield" is a reserved word in JS but works as property access
  const yieldValue = typeof json.yield === "boolean" ? json.yield : true;

  const thoughtType = classifyThoughtType(json, thought);

  return {
    yield: yieldValue, thought,
    _normMeta: { rawKind: "json", jsonExtracted: true, fallbackPath: "none", truncationSuspected, thoughtType },
  };
}
