import { readFileSync } from "node:fs";
import { parseEvent } from "./log-schema.js";
import type { ParsedEvent } from "./log-schema.js";
import type { ParseError } from "./types.js";

export interface ReadLogResult {
  events: ParsedEvent[];
  parseErrors: ParseError[];
}

/**
 * Read an NDJSON log file and parse each line into a typed event.
 * Returns both successfully parsed events and any parse errors.
 */
export function readLogLines(filePath: string): ReadLogResult {
  const text = readFileSync(filePath, "utf-8");
  return readLogText(text);
}

/**
 * Parse NDJSON text (for testing without file I/O).
 */
export function readLogText(text: string): ReadLogResult {
  const lines = text.split("\n");
  const events: ParsedEvent[] = [];
  const parseErrors: ParseError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "") continue;

    const lineNum = i + 1;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      parseErrors.push({
        line: lineNum,
        raw: raw.slice(0, 200),
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const { event } = parseEvent(lineNum, obj);
    events.push(event);
  }

  return { events, parseErrors };
}
