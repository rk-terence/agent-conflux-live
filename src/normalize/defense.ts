import type { DefenseResult } from "../types.js";
import { extractJSON } from "./json-extract.js";

export function normalizeDefense(raw: string): DefenseResult {
  const json = extractJSON(raw);
  if (!json) {
    return { yield: true, thought: null };
  }

  const thought = typeof json.thought === "string" ? json.thought : null;
  // Note: "yield" is a reserved word in JS but works as property access
  const yieldValue = typeof json.yield === "boolean" ? json.yield : true;

  return { yield: yieldValue, thought };
}
