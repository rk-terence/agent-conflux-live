import type { InsistenceLevel, PromptMode } from "./types.js";

export const SCHEMA_VERSION = 1;

// ── Normalization metadata (returned by normalizers alongside payload) ──

export interface NormalizeMeta {
  rawKind: "empty" | "json" | "plain_text";
  jsonExtracted: boolean;
  fallbackPath: "none" | "raw_text" | "keyword" | "default";
  truncationSuspected: boolean;
  thoughtType: "string" | "null" | "missing";
}

// ── Observer payload types ──

export interface NormalizeResultInfo {
  callId: string;
  agent: string;
  mode: PromptMode;
  rawKind: NormalizeMeta["rawKind"];
  jsonExtracted: boolean;
  fallbackPath: NormalizeMeta["fallbackPath"];
  truncationSuspected: boolean;
  thoughtType: NormalizeMeta["thoughtType"];
  payload: Record<string, unknown>;
}

export interface UtteranceFilterInfo {
  callId: string;
  agent: string;
  originalUtterance: string;
  cleanedUtterance: string | null;
  historyHallucination: boolean;
  speakerPrefixStripped: boolean;
  actionStripped: boolean;
  silenceByLength: boolean;
  silenceTokenDetected: boolean;
  dedupDropped: boolean;
}

export interface CollisionRoundInfo {
  turn: number;
  tier: 1 | 2 | 3 | 4;
  round: number;
  candidates: string[];
  insistences: { agent: string; insistence: InsistenceLevel }[];
  eliminated: string[];
  winner: string | null;
}

export interface InterruptionEvalInfo {
  turn: number;
  speaker: string;
  spokenPartChars: number;
  unspokenPartChars: number;
  listeners: string[];
  interruptRequested: string[];
  urgencies: { agent: string; urgency: InsistenceLevel }[];
  representative: string | null;
  representativeUrgency: InsistenceLevel | null;
  resolutionMethod: "auto_win" | "auto_lose" | "defense" | "no_interrupt" | "no_split";
  defenseYielded: boolean | null;
  finalResult: boolean;
}
