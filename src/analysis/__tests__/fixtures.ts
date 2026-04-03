// Programmatic fixture builders for testing the run summarizer and classifier.
// Every event follows the documented schema in docs/LOGGING.md (schema_version: 1).

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const SCHEMA_VERSION = 1;
const BASE_TIME = new Date("2026-01-01T00:00:00.000Z").getTime();

function ts(offsetMs: number): string {
  return new Date(BASE_TIME + offsetMs).toISOString();
}

function line(event: string, offsetMs: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ts: ts(offsetMs),
    event,
    schema_version: SCHEMA_VERSION,
    run_id: RUN_ID,
    ...extra,
  });
}

let callSeq = 0;
function callId(): string {
  return `call-${String(++callSeq).padStart(4, "0")}`;
}

export function resetCallSeq(): void {
  callSeq = 0;
}

// ── Building Blocks ─────────────────────────────────────────────────────────

function runStarted(offsetMs = 0): string {
  return line("run_started", offsetMs, { config_path: "/test/config.json" });
}

function sessionConfig(offsetMs = 1): string {
  return line("session_config", offsetMs, {
    configPath: "/test/config.json",
    config: {
      topic: "Test topic",
      agents: [
        { name: "Alice", provider: "openai", model: "gpt-4" },
        { name: "Bob", provider: "anthropic", model: "claude-3" },
        { name: "Carol", provider: "google", model: "gemini-pro" },
      ],
      silenceTimeout: 60,
      maxDuration: 300,
    },
  });
}

function turnStart(turn: number, offsetMs: number): string {
  return line("turn_start", offsetMs, { turn, virtualTime: turn * 5 });
}

/** Generate a full API call lifecycle (started + finished + normalize) for one agent in one turn. */
function apiCallCycle(opts: {
  turn: number;
  agent: string;
  mode: string;
  offsetMs: number;
  durationMs?: number;
  fallbackPath?: string;
  truncationSuspected?: boolean;
  finishReason?: string;
  rawKind?: string;
  thoughtType?: string;
  status?: "success" | "error";
  errorCode?: string;
  errorMessage?: string;
  httpStatus?: number;
}): { lines: string[]; callId: string } {
  const id = callId();
  const dur = opts.durationMs ?? 1000;
  const lines: string[] = [];

  lines.push(
    line("api_call_started", opts.offsetMs, {
      call_id: id,
      turn: opts.turn,
      agent: opts.agent,
      mode: opts.mode,
      attempt: 0,
      provider: "test",
      model: "test-model",
      max_tokens: 150,
      system_prompt_chars: 500,
      user_prompt_chars: 300,
      history_chars: 200,
      directive_chars: 100,
    }),
  );

  const status = opts.status ?? "success";

  const finishedExtra: Record<string, unknown> = {
    call_id: id,
    turn: opts.turn,
    agent: opts.agent,
    mode: opts.mode,
    attempt: 0,
    provider: "test",
    model: "test-model",
    status,
    duration_ms: dur,
  };

  if (status === "success") {
    finishedExtra.finish_reason = opts.finishReason ?? "stop";
    finishedExtra.content_chars = 100;
  } else {
    if (opts.errorCode) finishedExtra.error_code = opts.errorCode;
    if (opts.errorMessage) finishedExtra.error_message = opts.errorMessage;
    if (opts.httpStatus !== undefined) finishedExtra.http_status = opts.httpStatus;
  }

  lines.push(line("api_call_finished", opts.offsetMs + dur, finishedExtra));

  // Normalize result (only for successful calls)
  if (status === "success") {
    lines.push(
      line("normalize_result", opts.offsetMs + dur + 1, {
        call_id: id,
        turn: opts.turn,
        agent: opts.agent,
        mode: opts.mode,
        raw_kind: opts.rawKind ?? "json",
        json_extracted: true,
        fallback_path: opts.fallbackPath ?? "none",
        truncation_suspected: opts.truncationSuspected ?? false,
        thought_type: opts.thoughtType ?? "string",
        payload: { utterance: "test", insistence: "mid", thought: "thinking" },
      }),
    );
  }

  return { lines, callId: id };
}

function utteranceFilter(opts: {
  callId: string;
  turn: number;
  agent: string;
  offsetMs: number;
  dedupDropped?: boolean;
  historyHallucination?: boolean;
  silenceByLength?: boolean;
  silenceTokenDetected?: boolean;
  speakerPrefixStripped?: boolean;
  actionStripped?: boolean;
  cleanedToNull?: boolean;
}): string {
  return line("utterance_filter_result", opts.offsetMs, {
    call_id: opts.callId,
    turn: opts.turn,
    agent: opts.agent,
    mode: "reaction",
    original_utterance: "hello world",
    cleaned_utterance: opts.cleanedToNull ? null : "hello world",
    history_hallucination: opts.historyHallucination ?? false,
    speaker_prefix_stripped: opts.speakerPrefixStripped ?? false,
    action_stripped: opts.actionStripped ?? false,
    silence_by_length: opts.silenceByLength ?? false,
    silence_token_detected: opts.silenceTokenDetected ?? false,
    dedup_dropped: opts.dedupDropped ?? false,
  });
}

function turnComplete(
  turn: number,
  offsetMs: number,
  type: "speech" | "silence",
  speaker?: string,
): string {
  if (type === "speech") {
    return line("turn_complete", offsetMs, {
      record: {
        type: "speech",
        turn,
        virtualTime: turn * 5,
        speaker: speaker ?? "Alice",
        utterance: "test utterance",
        insistence: "mid",
        collision: null,
        interruption: null,
      },
    });
  }
  return line("turn_complete", offsetMs, {
    record: {
      type: "silence",
      turn,
      virtualTime: turn * 5,
      duration: 1,
      accumulated: 1,
    },
  });
}

function collisionResolved(tier: number, winner: string, offsetMs: number): string {
  return line("collision_resolved", offsetMs, {
    winner,
    winnerInsistence: "high",
    resolutionTier: tier,
    colliders: [{ agent: winner, utterance: "a", insistence: "high" }],
    votes: [],
  });
}

/**
 * Build an interruption_evaluation event.
 * - finalResult: true → auto_win (success, representative set)
 * - finalResult: false, hasRepresentative: true → auto_lose (failure, but someone tried)
 * - finalResult: false, hasRepresentative: false → no_interrupt (nobody wanted to interrupt)
 *
 * The runtime emits interruption_attempt for all evaluations with a representative,
 * regardless of final_result.
 */
function interruptionEvaluation(
  turn: number,
  offsetMs: number,
  finalResult: boolean,
  hasRepresentative = finalResult,
): string {
  return line("interruption_evaluation", offsetMs, {
    turn,
    speaker: "Alice",
    spoken_part_chars: 100,
    unspoken_part_chars: 50,
    listeners: ["Bob"],
    interrupt_requested: hasRepresentative ? ["Bob"] : [],
    urgencies: [{ agent: "Bob", urgency: "high" }],
    representative: hasRepresentative ? "Bob" : null,
    representative_urgency: hasRepresentative ? "high" : null,
    resolution_method: finalResult
      ? "auto_win"
      : hasRepresentative
        ? "auto_lose"
        : "no_interrupt",
    defense_yielded: null,
    final_result: finalResult,
  });
}

function interruptionAttempt(offsetMs: number): string {
  return line("interruption_attempt", offsetMs, {
    speaker: "Alice",
    interrupter: "Bob",
  });
}

function thoughtUpdate(agent: string, offsetMs: number): string {
  return line("thought_update", offsetMs, { agent, thought: "I am thinking" });
}

function sessionEnd(offsetMs: number, reason = "silence_timeout"): string {
  return line("session_end", offsetMs, {
    reason,
    turns: 10,
    virtualTime: 50,
    speechCount: 8,
    thoughtCount: 20,
  });
}

function sessionFinalState(offsetMs: number): string {
  return line("session_final_state", offsetMs, {
    log: [],
    thoughtLog: [],
    agents: [],
  });
}

function runFinished(
  offsetMs: number,
  status = "completed",
  endReason = "silence_timeout",
  terminal = true,
): string {
  return line("run_finished", offsetMs, { status, end_reason: endReason, terminal });
}

function fatalError(offsetMs: number, error = "Something crashed"): string {
  return line("fatal_error", offsetMs, { error });
}

// ── Clean Run ───────────────────────────────────────────────────────────────

export interface CleanRunOptions {
  turns?: number;
  speechPerTurn?: number; // agents that speak per turn (default: 1)
  silenceTurns?: number; // how many turns are silence (default: 2)
  collisionCount?: number;
  collisionTier?: number;
  interruptionSuccesses?: number;
  interruptionFailures?: number;
}

export function buildCleanRun(opts: CleanRunOptions = {}): string[] {
  resetCallSeq();
  const turns = opts.turns ?? 10;
  const silenceTurns = opts.silenceTurns ?? 2;
  const collisions = opts.collisionCount ?? 1;
  const collisionTier = opts.collisionTier ?? 1;
  const intSuccesses = opts.interruptionSuccesses ?? 0;
  const intFailures = opts.interruptionFailures ?? 0;

  const agents = ["Alice", "Bob", "Carol"];
  const lines: string[] = [];
  let ms = 0;

  lines.push(runStarted(ms));
  ms += 10;
  lines.push(sessionConfig(ms));
  ms += 10;

  let speechTurnIdx = 0;
  for (let t = 1; t <= turns; t++) {
    lines.push(turnStart(t, ms));
    ms += 10;

    // Each agent gets a reaction API call
    for (const agent of agents) {
      const cycle = apiCallCycle({ turn: t, agent, mode: "reaction", offsetMs: ms });
      lines.push(...cycle.lines);
      ms += 1100;
      lines.push(utteranceFilter({ callId: cycle.callId, turn: t, agent, offsetMs: ms }));
      ms += 10;
    }

    // Collision resolved on some turns
    if (t <= collisions) {
      lines.push(line("collision_start", ms, { colliders: ["Alice", "Bob"] }));
      ms += 10;
      lines.push(collisionResolved(collisionTier, "Alice", ms));
      ms += 10;
    }

    // Interruption events
    if (t <= intSuccesses) {
      // Successful interruption: evaluation with representative + attempt event
      lines.push(interruptionEvaluation(t, ms, true));
      ms += 10;
      lines.push(interruptionAttempt(ms));
      ms += 10;
    } else if (t <= intSuccesses + intFailures) {
      // Failed interruption (auto_lose): representative was selected but lost.
      // Runtime still emits interruption_attempt for these.
      lines.push(interruptionEvaluation(t, ms, false, true));
      ms += 10;
      lines.push(interruptionAttempt(ms));
      ms += 10;
    }

    // Turn complete
    const isSilence = t > turns - silenceTurns;
    if (isSilence) {
      lines.push(turnComplete(t, ms, "silence"));
    } else {
      const speaker = agents[speechTurnIdx % agents.length];
      lines.push(turnComplete(t, ms, "speech", speaker));
      speechTurnIdx++;
    }
    ms += 10;

    // Thought updates
    lines.push(thoughtUpdate(agents[t % agents.length], ms));
    ms += 10;
  }

  lines.push(sessionEnd(ms));
  ms += 10;
  lines.push(sessionFinalState(ms));
  ms += 10;
  lines.push(runFinished(ms));

  return lines;
}

// ── Retry Run ───────────────────────────────────────────────────────────────

/**
 * Build a valid run where one API call retries (same call_id, different attempt).
 * This must NOT trigger duplicate_call_id L0 fail.
 */
export function buildRetryRun(): string[] {
  resetCallSeq();
  let ms = 0;
  const result: string[] = [];

  result.push(runStarted(ms));
  ms += 10;
  result.push(sessionConfig(ms));
  ms += 10;
  result.push(turnStart(1, ms));
  ms += 10;

  // Simulate: call_id "retry-call-001", attempt 0 fails, attempt 1 succeeds
  const retryCallId = "retry-call-001";
  const base = {
    call_id: retryCallId,
    turn: 1,
    agent: "Alice",
    mode: "reaction",
    provider: "test",
    model: "test-model",
  };

  // Attempt 0: started + finished (error)
  result.push(line("api_call_started", ms, {
    ...base, attempt: 0,
    max_tokens: 150, system_prompt_chars: 500, user_prompt_chars: 300,
    history_chars: 200, directive_chars: 100,
  }));
  ms += 500;
  result.push(line("api_call_finished", ms, {
    ...base, attempt: 0, status: "error", duration_ms: 500,
    error_code: "rate_limit_exceeded", error_message: "Rate limited",
  }));
  ms += 10;

  // Attempt 1: started + finished (success)
  result.push(line("api_call_started", ms, {
    ...base, attempt: 1,
    max_tokens: 150, system_prompt_chars: 500, user_prompt_chars: 300,
    history_chars: 200, directive_chars: 100,
  }));
  ms += 1000;
  result.push(line("api_call_finished", ms, {
    ...base, attempt: 1, status: "success", duration_ms: 1000,
    finish_reason: "stop", content_chars: 50,
  }));
  ms += 10;

  // normalize_result links to the call_id
  result.push(line("normalize_result", ms, {
    ...base,
    raw_kind: "json", json_extracted: true, fallback_path: "none",
    truncation_suspected: false, thought_type: "string",
    payload: { utterance: "hello", insistence: "mid", thought: "thinking" },
  }));
  ms += 10;

  result.push(utteranceFilter({ callId: retryCallId, turn: 1, agent: "Alice", offsetMs: ms }));
  ms += 10;
  result.push(turnComplete(1, ms, "speech", "Alice"));
  ms += 10;
  result.push(sessionEnd(ms));
  ms += 10;
  result.push(sessionFinalState(ms));
  ms += 10;
  result.push(runFinished(ms));

  return result;
}

// ── Infra-Fail Runs ─────────────────────────────────────────────────────────

export type InfraFailType =
  | "missing_run_started"
  | "missing_run_finished"
  | "not_terminal"
  | "fatal_error_status"
  | "fatal_error_event"
  | "parse_error"
  | "inconsistent_run_id"
  | "orphan_call"
  | "duplicate_call_id"
  | "auth_error"
  | "model_error"
  | "corrupt_event"
  | "orphan_normalize"
  | "orphan_filter"
  | "duplicate_finished";

export function buildInfraFailRun(failure: InfraFailType): string[] {
  resetCallSeq();
  let ms = 0;

  switch (failure) {
    case "missing_run_started": {
      const lines: string[] = [];
      lines.push(sessionConfig(ms));
      ms += 10;
      lines.push(turnStart(1, ms));
      ms += 100;
      lines.push(runFinished(ms));
      return lines;
    }

    case "missing_run_finished": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push(sessionConfig(ms));
      ms += 10;
      lines.push(turnStart(1, ms));
      // No run_finished
      return lines;
    }

    case "not_terminal": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push(runFinished(ms, "completed", "silence_timeout", false));
      return lines;
    }

    case "fatal_error_status": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push(runFinished(ms, "fatal_error", "crash", true));
      return lines;
    }

    case "fatal_error_event": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push(fatalError(ms));
      ms += 10;
      lines.push(runFinished(ms, "fatal_error", "crash", true));
      return lines;
    }

    case "parse_error": {
      // Include a line that is not valid JSON
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push("this is not valid JSON {{{");
      lines.push(runFinished(ms));
      return lines;
    }

    case "inconsistent_run_id": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      // Inject an event with a different run_id
      lines.push(
        JSON.stringify({
          ts: ts(ms),
          event: "turn_start",
          schema_version: SCHEMA_VERSION,
          run_id: "99999999-9999-9999-9999-999999999999",
          turn: 1,
          virtualTime: 0,
        }),
      );
      ms += 10;
      lines.push(runFinished(ms));
      return lines;
    }

    case "orphan_call": {
      // api_call_finished without matching api_call_started
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push(
        line("api_call_finished", ms, {
          call_id: "orphan-call-001",
          turn: 1,
          agent: "Alice",
          mode: "reaction",
          attempt: 0,
          provider: "test",
          model: "test-model",
          status: "success",
          duration_ms: 500,
          finish_reason: "stop",
        }),
      );
      ms += 10;
      lines.push(runFinished(ms));
      return lines;
    }

    case "duplicate_call_id": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      const dupId = "dup-call-001";
      lines.push(
        line("api_call_started", ms, {
          call_id: dupId,
          turn: 1,
          agent: "Alice",
          mode: "reaction",
          attempt: 0,
          provider: "test",
          model: "test-model",
          max_tokens: 150,
          system_prompt_chars: 500,
          user_prompt_chars: 300,
          history_chars: 200,
          directive_chars: 100,
        }),
      );
      ms += 10;
      // Same call_id again
      lines.push(
        line("api_call_started", ms, {
          call_id: dupId,
          turn: 1,
          agent: "Alice",
          mode: "reaction",
          attempt: 0,
          provider: "test",
          model: "test-model",
          max_tokens: 150,
          system_prompt_chars: 500,
          user_prompt_chars: 300,
          history_chars: 200,
          directive_chars: 100,
        }),
      );
      ms += 10;
      lines.push(
        line("api_call_finished", ms, {
          call_id: dupId,
          turn: 1,
          agent: "Alice",
          mode: "reaction",
          attempt: 0,
          provider: "test",
          model: "test-model",
          status: "success",
          duration_ms: 500,
          finish_reason: "stop",
        }),
      );
      ms += 10;
      lines.push(runFinished(ms));
      return lines;
    }

    case "auth_error": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      const authCycle = apiCallCycle({
        turn: 1,
        agent: "Alice",
        mode: "reaction",
        offsetMs: ms,
        status: "error",
        errorCode: "authentication_error",
        errorMessage: "Invalid API key",
        httpStatus: 401,
      });
      lines.push(...authCycle.lines);
      ms += 1100;
      lines.push(runFinished(ms));
      return lines;
    }

    case "model_error": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      const modelCycle = apiCallCycle({
        turn: 1,
        agent: "Alice",
        mode: "reaction",
        offsetMs: ms,
        status: "error",
        errorCode: "model_not_found",
        errorMessage: "Model not found",
        httpStatus: 404,
      });
      lines.push(...modelCycle.lines);
      ms += 1100;
      lines.push(runFinished(ms));
      return lines;
    }

    case "corrupt_event": {
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      // api_call_finished missing required "status" field
      lines.push(
        JSON.stringify({
          ts: ts(ms),
          event: "api_call_finished",
          schema_version: SCHEMA_VERSION,
          run_id: RUN_ID,
          call_id: "corrupt-001",
          turn: 1,
          agent: "Alice",
          mode: "reaction",
          // missing: status
        }),
      );
      ms += 10;
      lines.push(runFinished(ms));
      return lines;
    }

    case "orphan_normalize": {
      // normalize_result with call_id that has no api_call_finished
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push(
        line("normalize_result", ms, {
          call_id: "orphan-norm-001",
          turn: 1,
          agent: "Alice",
          mode: "reaction",
          raw_kind: "json",
          json_extracted: true,
          fallback_path: "none",
          truncation_suspected: false,
          thought_type: "string",
          payload: {},
        }),
      );
      ms += 10;
      lines.push(runFinished(ms));
      return lines;
    }

    case "orphan_filter": {
      // utterance_filter_result with call_id that has no api_call_finished
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      lines.push(
        line("utterance_filter_result", ms, {
          call_id: "orphan-filter-001",
          turn: 1,
          agent: "Alice",
          mode: "reaction",
          original_utterance: "hello",
          cleaned_utterance: "hello",
          history_hallucination: false,
          speaker_prefix_stripped: false,
          action_stripped: false,
          silence_by_length: false,
          silence_token_detected: false,
          dedup_dropped: false,
        }),
      );
      ms += 10;
      lines.push(runFinished(ms));
      return lines;
    }

    case "duplicate_finished": {
      // Same (call_id, attempt) appears twice in api_call_finished
      const lines: string[] = [];
      lines.push(runStarted(ms));
      ms += 10;
      const dupBase = {
        call_id: "dup-fin-001",
        turn: 1,
        agent: "Alice",
        mode: "reaction",
        attempt: 0,
        provider: "test",
        model: "test-model",
      };
      lines.push(line("api_call_started", ms, {
        ...dupBase,
        max_tokens: 150, system_prompt_chars: 500, user_prompt_chars: 300,
        history_chars: 200, directive_chars: 100,
      }));
      ms += 500;
      lines.push(line("api_call_finished", ms, {
        ...dupBase, status: "success", duration_ms: 500, finish_reason: "stop",
      }));
      ms += 10;
      // Duplicate finished event
      lines.push(line("api_call_finished", ms, {
        ...dupBase, status: "success", duration_ms: 500, finish_reason: "stop",
      }));
      ms += 10;
      lines.push(runFinished(ms));
      return lines;
    }
  }
}

// ── Mechanics-Fail Runs ─────────────────────────────────────────────────────

export type MechanicsFailType =
  | "high_fallback_rate"
  | "high_truncation_rate"
  | "high_tier3_4_rate"
  | "speaker_monopoly"
  | "high_dedup_drops"
  | "high_cleaned_to_null_rate"
  | "interruption_inconsistency";

export function buildMechanicsFailRun(failure: MechanicsFailType): string[] {
  resetCallSeq();
  let ms = 0;
  const lines: string[] = [];

  lines.push(runStarted(ms));
  ms += 10;
  lines.push(sessionConfig(ms));
  ms += 10;

  switch (failure) {
    case "high_fallback_rate": {
      // 4 out of 4 normalize results use fallback (100% > 25%)
      for (let t = 1; t <= 4; t++) {
        lines.push(turnStart(t, ms));
        ms += 10;
        const cycle = apiCallCycle({
          turn: t,
          agent: "Alice",
          mode: "reaction",
          offsetMs: ms,
          fallbackPath: "raw_text",
        });
        lines.push(...cycle.lines);
        ms += 1100;
        lines.push(utteranceFilter({ callId: cycle.callId, turn: t, agent: "Alice", offsetMs: ms }));
        ms += 10;
        lines.push(turnComplete(t, ms, "speech", "Alice"));
        ms += 10;
      }
      break;
    }

    case "high_truncation_rate": {
      // 4 out of 4 normalize results have truncation (100% > 25%)
      for (let t = 1; t <= 4; t++) {
        lines.push(turnStart(t, ms));
        ms += 10;
        const cycle = apiCallCycle({
          turn: t,
          agent: "Alice",
          mode: "reaction",
          offsetMs: ms,
          truncationSuspected: true,
        });
        lines.push(...cycle.lines);
        ms += 1100;
        lines.push(utteranceFilter({ callId: cycle.callId, turn: t, agent: "Alice", offsetMs: ms }));
        ms += 10;
        lines.push(turnComplete(t, ms, "speech", "Alice"));
        ms += 10;
      }
      break;
    }

    case "high_tier3_4_rate": {
      // 3 tier-4 collisions out of 4 total (75% > 30%)
      for (let t = 1; t <= 4; t++) {
        lines.push(turnStart(t, ms));
        ms += 10;
        const cycle = apiCallCycle({ turn: t, agent: "Alice", mode: "reaction", offsetMs: ms });
        lines.push(...cycle.lines);
        ms += 1100;
        lines.push(utteranceFilter({ callId: cycle.callId, turn: t, agent: "Alice", offsetMs: ms }));
        ms += 10;

        lines.push(line("collision_start", ms, { colliders: ["Alice", "Bob"] }));
        ms += 10;
        const tier = t <= 3 ? 4 : 1; // 3 are tier 4, 1 is tier 1
        lines.push(collisionResolved(tier, "Alice", ms));
        ms += 10;
        lines.push(turnComplete(t, ms, "speech", "Alice"));
        ms += 10;
      }
      break;
    }

    case "speaker_monopoly": {
      // Alice speaks 8 out of 10 turns (80% > 60%), with ≥8 speech turns
      for (let t = 1; t <= 10; t++) {
        lines.push(turnStart(t, ms));
        ms += 10;
        const cycle = apiCallCycle({ turn: t, agent: "Alice", mode: "reaction", offsetMs: ms });
        lines.push(...cycle.lines);
        ms += 1100;
        lines.push(utteranceFilter({ callId: cycle.callId, turn: t, agent: "Alice", offsetMs: ms }));
        ms += 10;

        const speaker = t <= 8 ? "Alice" : "Bob";
        lines.push(turnComplete(t, ms, "speech", speaker));
        ms += 10;
      }
      break;
    }

    case "high_dedup_drops": {
      // 3 dedup drops (>= threshold of 3)
      for (let t = 1; t <= 4; t++) {
        lines.push(turnStart(t, ms));
        ms += 10;
        const cycle = apiCallCycle({ turn: t, agent: "Alice", mode: "reaction", offsetMs: ms });
        lines.push(...cycle.lines);
        ms += 1100;
        lines.push(
          utteranceFilter({
            callId: cycle.callId,
            turn: t,
            agent: "Alice",
            offsetMs: ms,
            dedupDropped: t <= 3, // first 3 are dedup-dropped
          }),
        );
        ms += 10;
        lines.push(turnComplete(t, ms, "speech", "Alice"));
        ms += 10;
      }
      break;
    }

    case "high_cleaned_to_null_rate": {
      // 3 out of 4 cleaned to null (75% > 25%)
      for (let t = 1; t <= 4; t++) {
        lines.push(turnStart(t, ms));
        ms += 10;
        const cycle = apiCallCycle({ turn: t, agent: "Alice", mode: "reaction", offsetMs: ms });
        lines.push(...cycle.lines);
        ms += 1100;
        lines.push(
          utteranceFilter({
            callId: cycle.callId,
            turn: t,
            agent: "Alice",
            offsetMs: ms,
            cleanedToNull: t <= 3,
          }),
        );
        ms += 10;
        lines.push(turnComplete(t, ms, t <= 3 ? "silence" : "speech", "Alice"));
        ms += 10;
      }
      break;
    }

    case "interruption_inconsistency": {
      // 1 evaluation with representative but 0 interruption_attempt events
      lines.push(turnStart(1, ms));
      ms += 10;
      const cycle = apiCallCycle({ turn: 1, agent: "Alice", mode: "reaction", offsetMs: ms });
      lines.push(...cycle.lines);
      ms += 1100;
      lines.push(utteranceFilter({ callId: cycle.callId, turn: 1, agent: "Alice", offsetMs: ms }));
      ms += 10;
      lines.push(interruptionEvaluation(1, ms, true));
      ms += 10;
      // Missing: interruptionAttempt (should have been emitted since representative exists)
      lines.push(turnComplete(1, ms, "speech", "Alice"));
      ms += 10;
      break;
    }
  }

  lines.push(sessionEnd(ms));
  ms += 10;
  lines.push(sessionFinalState(ms));
  ms += 10;
  lines.push(runFinished(ms));

  return lines;
}
