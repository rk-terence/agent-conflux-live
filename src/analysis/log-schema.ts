// ── Parsed Event Types ──────────────────────────────────────────────────────
// Discriminated union matching the documented log schema in docs/LOGGING.md.
// All field names use snake_case matching the serialized NDJSON format.

/** Common fields on every event */
interface BaseEvent {
  _line: number;
  ts: string;
  event: string;
  schema_version: number;
  run_id: string;
}

/** Common fields on per-call events */
interface PerCallFields {
  call_id: string;
  turn: number;
  agent: string;
  mode: string;
}

export interface RunStartedEvent extends BaseEvent {
  event: "run_started";
  config_path?: string;
}

export interface SessionConfigEvent extends BaseEvent {
  event: "session_config";
  configPath?: string;
  config?: Record<string, unknown>;
}

export interface TurnStartEvent extends BaseEvent {
  event: "turn_start";
  turn: number;
  virtualTime: number;
}

export interface ApiCallStartedEvent extends BaseEvent, PerCallFields {
  event: "api_call_started";
  attempt: number;
  provider: string;
  model: string;
  max_tokens: number;
  system_prompt?: string;
  user_prompt?: string;
  history?: string;
  directive?: string;
  system_prompt_chars: number;
  user_prompt_chars: number;
  history_chars: number;
  directive_chars: number;
}

export interface ApiCallFinishedEvent extends BaseEvent, PerCallFields {
  event: "api_call_finished";
  attempt: number;
  provider: string;
  model: string;
  status: "success" | "error";
  duration_ms: number;
  http_status?: number;
  finish_reason?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  content_chars?: number;
  content?: string;
  raw_response?: unknown;
  error_code?: string;
  error_message?: string;
}

export interface NormalizeResultEvent extends BaseEvent, PerCallFields {
  event: "normalize_result";
  raw_kind: string;
  json_extracted: boolean;
  fallback_path: string;
  truncation_suspected: boolean;
  thought_type: string;
  payload?: Record<string, unknown>;
}

export interface UtteranceFilterResultEvent extends BaseEvent, PerCallFields {
  event: "utterance_filter_result";
  original_utterance: string;
  cleaned_utterance: string | null;
  history_hallucination: boolean;
  speaker_prefix_stripped: boolean;
  action_stripped: boolean;
  silence_by_length: boolean;
  truncated_by_max_length: boolean;
  silence_token_detected: boolean;
  dedup_dropped: boolean;
}

export interface ReactionResultsEvent extends BaseEvent {
  event: "reaction_results";
  results: Record<string, unknown>;
}

export interface CollisionStartEvent extends BaseEvent {
  event: "collision_start";
  colliders: string[];
}

export interface CollisionRoundEvent extends BaseEvent {
  event: "collision_round";
  turn: number;
  tier: number;
  round: number;
  candidates: string[];
  insistences: Array<{ agent: string; insistence: string }>;
  eliminated: string[];
  winner: string | null;
}

export interface CollisionResolvedEvent extends BaseEvent {
  event: "collision_resolved";
  winner: string;
  winnerInsistence: string;
  resolutionTier: number;
  colliders: unknown[];
  votes: unknown[];
}

export interface InterruptionEvaluationEvent extends BaseEvent {
  event: "interruption_evaluation";
  turn: number;
  speaker: string;
  spoken_part_chars: number;
  unspoken_part_chars: number;
  listeners: string[];
  interrupt_requested: string[];
  urgencies: Array<{ agent: string; urgency: string }>;
  representative: string | null;
  representative_urgency: string | null;
  resolution_method: string;
  defense_yielded: boolean | null;
  final_result: boolean;
}

export interface InterruptionAttemptEvent extends BaseEvent {
  event: "interruption_attempt";
  speaker: string;
  interrupter: string;
}

export interface TurnCompleteEvent extends BaseEvent {
  event: "turn_complete";
  record: {
    type: string;
    turn: number;
    virtualTime: number;
    speaker?: string;
    utterance?: string;
    insistence?: string;
    collision?: unknown;
    interruption?: unknown;
    duration?: number;
    accumulated?: number;
  };
}

export interface ThoughtUpdateEvent extends BaseEvent {
  event: "thought_update";
  agent: string;
  thought: string;
}

export interface SessionEndEvent extends BaseEvent {
  event: "session_end";
  reason: string;
  turns: number;
  virtualTime: number;
  speechCount: number;
  thoughtCount: number;
}

export interface SessionFinalStateEvent extends BaseEvent {
  event: "session_final_state";
  [key: string]: unknown;
}

export interface RunFinishedEvent extends BaseEvent {
  event: "run_finished";
  status: string;
  end_reason?: string;
  terminal: boolean;
}

export interface SigintReceivedEvent extends BaseEvent {
  event: "sigint_received";
}

export interface FatalErrorEvent extends BaseEvent {
  event: "fatal_error";
  error: string;
  stack?: string;
}

export interface UnknownEvent extends BaseEvent {
  event: string;
  _unknown: true;
  _corruption?: { missing: string[] };
}

// ── Union Type ──────────────────────────────────────────────────────────────

export type ParsedEvent =
  | RunStartedEvent
  | SessionConfigEvent
  | TurnStartEvent
  | ApiCallStartedEvent
  | ApiCallFinishedEvent
  | NormalizeResultEvent
  | UtteranceFilterResultEvent
  | ReactionResultsEvent
  | CollisionStartEvent
  | CollisionRoundEvent
  | CollisionResolvedEvent
  | InterruptionEvaluationEvent
  | InterruptionAttemptEvent
  | TurnCompleteEvent
  | ThoughtUpdateEvent
  | SessionEndEvent
  | SessionFinalStateEvent
  | RunFinishedEvent
  | SigintReceivedEvent
  | FatalErrorEvent
  | UnknownEvent;

// ── Known Event Names ───────────────────────────────────────────────────────

const KNOWN_EVENTS = new Set([
  "run_started",
  "session_config",
  "turn_start",
  "api_call_started",
  "api_call_finished",
  "normalize_result",
  "utterance_filter_result",
  "reaction_results",
  "collision_start",
  "collision_round",
  "collision_resolved",
  "interruption_evaluation",
  "interruption_attempt",
  "turn_complete",
  "thought_update",
  "session_end",
  "session_final_state",
  "run_finished",
  "sigint_received",
  "fatal_error",
]);

// ── Required Fields per Event Type ──────────────────────────────────────────

const REQUIRED_FIELDS: Record<string, string[]> = {
  run_started: [],
  session_config: [],
  turn_start: ["turn"],
  api_call_started: ["call_id", "turn", "agent", "mode", "attempt"],
  api_call_finished: ["call_id", "turn", "agent", "mode", "status", "attempt"],
  normalize_result: ["call_id", "turn", "agent", "mode", "fallback_path"],
  utterance_filter_result: ["call_id", "turn", "agent", "mode"],
  reaction_results: ["results"],
  collision_start: ["colliders"],
  collision_round: ["tier"],
  collision_resolved: ["winner", "resolutionTier"],
  interruption_evaluation: ["final_result"],
  interruption_attempt: ["speaker", "interrupter"],
  turn_complete: ["record"],
  thought_update: ["agent", "thought"],
  session_end: ["reason"],
  session_final_state: [],
  run_finished: ["status", "terminal"],
  sigint_received: [],
  fatal_error: ["error"],
};

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw JSON object into a typed ParsedEvent.
 * Returns UnknownEvent with corruption details if the event is severely malformed.
 */
export function parseEvent(
  line: number,
  obj: Record<string, unknown>,
): { event: ParsedEvent; corruption?: { missing: string[] } } {
  const eventName = typeof obj.event === "string" ? obj.event : "";
  const ts = typeof obj.ts === "string" ? obj.ts : "";
  const schemaVersion = typeof obj.schema_version === "number" ? obj.schema_version : 0;
  const runId = typeof obj.run_id === "string" ? obj.run_id : "";

  // Unknown event type — pass through without corruption flag
  if (!KNOWN_EVENTS.has(eventName)) {
    return {
      event: {
        _line: line,
        ts,
        event: eventName || "_missing_event_name",
        schema_version: schemaVersion,
        run_id: runId,
        _unknown: true as const,
      },
    };
  }

  // Check required fields for known events
  const requiredFields = REQUIRED_FIELDS[eventName] ?? [];
  const missingFields = requiredFields.filter((f) => obj[f] === undefined || obj[f] === null);

  if (missingFields.length > 0) {
    return {
      event: {
        _line: line,
        ts,
        event: eventName,
        schema_version: schemaVersion,
        run_id: runId,
        _unknown: true as const,
        _corruption: { missing: missingFields },
      },
      corruption: { missing: missingFields },
    };
  }

  // Pass through as typed event — we cast from the raw object
  const base = {
    _line: line,
    ts,
    event: eventName,
    schema_version: schemaVersion,
    run_id: runId,
  };

  // Merge all original fields with our typed base
  return { event: { ...obj, ...base } as ParsedEvent };
}
