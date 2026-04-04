import type { ParsedEvent, UnknownEvent } from "./log-schema.js";
import type {
  RunSummary,
  ParseError,
  AccumulatorState,
  ApiModeStats,
  ApiAgentStats,
  ApiErrorEntry,
  SizeStats,
  SizeAccumulator,
} from "./types.js";
import { SUMMARY_SCHEMA_VERSION } from "./types.js";
import { classifyRun } from "./classify-run.js";

// ── Auth / Model Error Detection Patterns ───────────────────────────────────

const AUTH_ERROR_CODES = new Set([
  "authentication_error",
  "invalid_api_key",
  "permission_denied",
  "insufficient_quota",
  "access_denied",
  "unauthorized",
]);

const MODEL_ERROR_CODES = new Set(["model_not_found", "invalid_model"]);

const AUTH_HTTP_STATUSES = new Set([401, 403]);

function isAuthError(errorCode?: string, httpStatus?: number, errorMessage?: string): boolean {
  if (errorCode && AUTH_ERROR_CODES.has(errorCode)) return true;
  if (httpStatus !== undefined && AUTH_HTTP_STATUSES.has(httpStatus)) return true;
  if (
    errorMessage &&
    /permission|access denied|unauthorized|auth/i.test(errorMessage)
  )
    return true;
  return false;
}

function isModelError(errorCode?: string, httpStatus?: number, errorMessage?: string): boolean {
  if (errorCode && MODEL_ERROR_CODES.has(errorCode)) return true;
  if (httpStatus === 404 && errorMessage && /model/i.test(errorMessage)) return true;
  return false;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MAX_ERRORS = 100;

function inc(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

function ensureMode(
  byMode: Record<string, ApiModeStats>,
  mode: string,
): ApiModeStats {
  if (!byMode[mode]) {
    byMode[mode] = { started: 0, succeeded: 0, failed: 0, total_duration_ms: 0 };
  }
  return byMode[mode];
}

function newSizeAcc(): SizeAccumulator {
  return { min: Infinity, max: -Infinity, sum: 0, count: 0 };
}

function pushSize(acc: SizeAccumulator, value: number): void {
  if (value < acc.min) acc.min = value;
  if (value > acc.max) acc.max = value;
  acc.sum += value;
  acc.count++;
}

function finalizeSizeStats(acc: SizeAccumulator): SizeStats | null {
  if (acc.count === 0) return null;
  return { min: acc.min, max: acc.max, avg: Math.round(acc.sum / acc.count), count: acc.count };
}

function ensureAgent(
  byAgent: Record<string, ApiAgentStats>,
  agent: string,
): ApiAgentStats {
  if (!byAgent[agent]) {
    byAgent[agent] = {
      started: 0,
      succeeded: 0,
      failed: 0,
      total_duration_ms: 0,
      avg_duration_ms: 0,
      max_duration_ms: 0,
    };
  }
  return byAgent[agent];
}

// ── Main Summarizer ─────────────────────────────────────────────────────────

export function summarizeRun(
  logPath: string,
  events: ParsedEvent[],
  parseErrors: ParseError[],
): RunSummary {
  // Initialize summary
  const summary: RunSummary = {
    schema_version: SUMMARY_SCHEMA_VERSION,
    source: {
      log_path: logPath,
      run_id: null,
      log_schema_version: null,
    },
    run: {
      started_at: null,
      ended_at: null,
      duration_ms: null,
      terminal: false,
      status: null,
      end_reason: null,
    },
    session: {
      topic: null,
      agents: [],
      config: {},
    },
    counts: {
      turns_started: 0,
      turns_completed: 0,
      speech_turns: 0,
      silence_turns: 0,
      thought_updates: 0,
      api_calls_started: 0,
      api_calls_finished: 0,
      api_calls_succeeded: 0,
      api_calls_failed: 0,
      normalize_results: 0,
      utterance_filter_results: 0,
      collisions: 0,
      interruptions_attempted: 0,
    },
    api: {
      by_mode: {},
      by_agent: {},
      errors: [],
      finish_reasons: {},
      truncation_suspected_count: 0,
      fallback_count: 0,
    },
    normalization: {
      fallback_path_counts: {},
      thought_type_counts: {},
      raw_kind_counts: {},
    },
    filtering: {
      dedup_drop_count: 0,
      history_hallucination_count: 0,
      speaker_prefix_stripped_count: 0,
      action_stripped_count: 0,
      silence_by_length_count: 0,
      truncated_by_max_length_count: 0,
      silence_token_detected_count: 0,
      cleaned_to_null_count: 0,
      pipeline_filter_count: 0,
      pipeline_cleaned_to_null_count: 0,
    },
    mechanics: {
      speaker_turns: {},
      collision_tiers: {},
      tier3_count: 0,
      tier4_count: 0,
      interruption_success_count: 0,
      interruption_failure_count: 0,
    },
    sizes: {
      prompt_history_chars: null,
      prompt_user_chars: null,
      response_content_chars: null,
      thought_chars: null,
      utterance_cleaned_chars: null,
    },
    classification: {
      l0_infra: { result: "pass", reasons: [] },
      l1_mechanics: { result: "not_evaluated", reasons: [] },
    },
    eligible_for_l2: false,
    warnings: [],
  };

  // Initialize accumulator
  const acc: AccumulatorState = {
    runIds: new Set(),
    schemaVersion: null,
    hasRunStarted: false,
    hasRunFinished: false,
    runFinishedTerminal: false,
    runFinishedStatus: null,
    hasFatalError: false,
    fatalErrors: [],
    apiCallsStartedKeys: new Set(),
    apiCallsFinishedKeys: new Set(),
    apiCallsFinishedCallIds: new Set(),
    apiCallsSucceededCallIds: new Set(),
    duplicateCallKeys: [],
    duplicateFinishedKeys: [],
    orphanFinished: [],
    orphanNormalizeResults: [],
    orphanFilterResults: [],
    callIdContext: new Map(),
    retryContextMismatchCount: 0,
    normalizeContextMismatchCount: 0,
    filterContextMismatchCount: 0,
    normalizeOnFailedCallCount: 0,
    authErrors: [],
    modelErrors: [],
    corruptEvents: [],
    agentDurations: new Map(),
    cleanedToNullCount: 0,
    interruptionEvalSuccessCount: 0,
    interruptionEvalFailureCount: 0,
    interruptionEvalWithRepresentativeCount: 0,
    historyCharsAcc: newSizeAcc(),
    userPromptCharsAcc: newSizeAcc(),
    contentCharsAcc: newSizeAcc(),
    thoughtCharsAcc: newSizeAcc(),
    cleanedUtteranceCharsAcc: newSizeAcc(),
  };

  // ── Single-pass accumulation ──────────────────────────────────────────────

  for (const ev of events) {
    // Track run_id consistency
    if (ev.run_id) {
      acc.runIds.add(ev.run_id);
    }

    // Track schema version from first event that has it
    if (acc.schemaVersion === null && ev.schema_version) {
      acc.schemaVersion = ev.schema_version;
    }

    // Handle corrupt known events
    if ("_unknown" in ev && (ev as UnknownEvent)._corruption) {
      const unk = ev as UnknownEvent;
      acc.corruptEvents.push({
        line: unk._line,
        event: unk.event,
        missing: unk._corruption!.missing,
      });
      continue;
    }

    // Skip truly unknown events (forward compat)
    if ("_unknown" in ev) continue;

    switch (ev.event) {
      case "run_started": {
        acc.hasRunStarted = true;
        summary.run.started_at = ev.ts;
        if (!summary.source.run_id && ev.run_id) {
          summary.source.run_id = ev.run_id;
        }
        if (acc.schemaVersion !== null) {
          summary.source.log_schema_version = acc.schemaVersion;
        }
        break;
      }

      case "session_config": {
        const cfg = ev.config as Record<string, unknown> | undefined;
        if (cfg) {
          summary.session.topic = typeof cfg.topic === "string" ? cfg.topic : null;
          if (Array.isArray(cfg.agents)) {
            summary.session.agents = (cfg.agents as Record<string, unknown>[]).map((a) => ({
              name: String(a.name ?? ""),
              provider: String(a.provider ?? ""),
              model: String(a.model ?? ""),
              ...(a.thinkingModel ? { thinkingModel: true } : {}),
            }));
          }
          // Store full config minus agents (to avoid duplication)
          const { agents: _agents, ...rest } = cfg;
          summary.session.config = rest;
        }
        break;
      }

      case "turn_start": {
        summary.counts.turns_started++;
        break;
      }

      case "api_call_started": {
        summary.counts.api_calls_started++;
        const lifecycleKey = `${ev.call_id}:${ev.attempt}`;

        // Duplicate detection — keyed by (call_id, attempt) for retry safety
        if (acc.apiCallsStartedKeys.has(lifecycleKey)) {
          acc.duplicateCallKeys.push(lifecycleKey);
        }
        acc.apiCallsStartedKeys.add(lifecycleKey);

        // Store/verify call_id context for cross-field consistency
        const existing = acc.callIdContext.get(ev.call_id);
        if (!existing) {
          acc.callIdContext.set(ev.call_id, {
            turn: ev.turn,
            agent: ev.agent,
            mode: ev.mode,
          });
        } else if (
          existing.turn !== ev.turn ||
          existing.agent !== ev.agent ||
          existing.mode !== ev.mode
        ) {
          acc.retryContextMismatchCount++;
        }

        // Per-mode
        const modeStats = ensureMode(summary.api.by_mode, ev.mode);
        modeStats.started++;

        // Per-agent
        const agentStats = ensureAgent(summary.api.by_agent, ev.agent);
        agentStats.started++;

        // Size tracking: prompt input sizes
        if (typeof ev.history_chars === "number") {
          pushSize(acc.historyCharsAcc, ev.history_chars);
        }
        if (typeof ev.user_prompt_chars === "number") {
          pushSize(acc.userPromptCharsAcc, ev.user_prompt_chars);
        }
        break;
      }

      case "api_call_finished": {
        summary.counts.api_calls_finished++;
        const lifecycleKey = `${ev.call_id}:${ev.attempt}`;

        // Orphan detection — keyed by (call_id, attempt) for retry safety
        if (!acc.apiCallsStartedKeys.has(lifecycleKey)) {
          acc.orphanFinished.push(lifecycleKey);
        }

        // Duplicate finished detection
        if (acc.apiCallsFinishedKeys.has(lifecycleKey)) {
          acc.duplicateFinishedKeys.push(lifecycleKey);
        }
        acc.apiCallsFinishedKeys.add(lifecycleKey);
        acc.apiCallsFinishedCallIds.add(ev.call_id);

        const duration = typeof ev.duration_ms === "number" ? ev.duration_ms : 0;

        // Per-mode
        const modeStats = ensureMode(summary.api.by_mode, ev.mode);

        // Per-agent
        const agentStats = ensureAgent(summary.api.by_agent, ev.agent);

        if (ev.status === "success") {
          summary.counts.api_calls_succeeded++;
          acc.apiCallsSucceededCallIds.add(ev.call_id);
          modeStats.succeeded++;
          agentStats.succeeded++;

          // Finish reason
          if (ev.finish_reason) {
            inc(summary.api.finish_reasons, ev.finish_reason);
          }

          // Size tracking: response size
          if (typeof ev.content_chars === "number") {
            pushSize(acc.contentCharsAcc, ev.content_chars);
          }
        } else {
          // status === "error"
          summary.counts.api_calls_failed++;
          modeStats.failed++;
          agentStats.failed++;

          // Record error details
          if (summary.api.errors.length < MAX_ERRORS) {
            const entry: ApiErrorEntry = {
              call_id: ev.call_id,
              agent: ev.agent,
              mode: ev.mode,
            };
            if (ev.error_code) entry.error_code = ev.error_code;
            if (ev.error_message) entry.error_message = ev.error_message;
            if (ev.http_status !== undefined) entry.http_status = ev.http_status;
            summary.api.errors.push(entry);
          }

          // Detect auth errors (L0 signal)
          if (isAuthError(ev.error_code, ev.http_status, ev.error_message)) {
            acc.authErrors.push({
              call_id: ev.call_id,
              detail: ev.error_message ?? ev.error_code ?? `http_${ev.http_status}`,
            });
          }

          // Detect model errors (L0 signal)
          if (isModelError(ev.error_code, ev.http_status, ev.error_message)) {
            acc.modelErrors.push({
              call_id: ev.call_id,
              detail: ev.error_message ?? ev.error_code ?? `http_${ev.http_status}`,
            });
          }
        }

        // Duration tracking
        modeStats.total_duration_ms += duration;
        agentStats.total_duration_ms += duration;

        if (!acc.agentDurations.has(ev.agent)) {
          acc.agentDurations.set(ev.agent, []);
        }
        acc.agentDurations.get(ev.agent)!.push(duration);
        break;
      }

      case "normalize_result": {
        summary.counts.normalize_results++;

        // Lifecycle validation: call_id must link to a completed API call
        if (!acc.apiCallsFinishedCallIds.has(ev.call_id)) {
          acc.orphanNormalizeResults.push(ev.call_id);
        } else {
          // Cross-field consistency: turn/agent/mode should match the originating call
          const ctx = acc.callIdContext.get(ev.call_id);
          if (ctx && (ctx.turn !== ev.turn || ctx.agent !== ev.agent || ctx.mode !== ev.mode)) {
            acc.normalizeContextMismatchCount++;
          }
          // normalize_result should only link to a call that succeeded
          if (!acc.apiCallsSucceededCallIds.has(ev.call_id)) {
            acc.normalizeOnFailedCallCount++;
          }
        }

        inc(summary.normalization.fallback_path_counts, ev.fallback_path);
        inc(summary.normalization.raw_kind_counts, ev.raw_kind);
        inc(summary.normalization.thought_type_counts, ev.thought_type);

        if (ev.truncation_suspected) {
          summary.api.truncation_suspected_count++;
        }

        if (ev.fallback_path !== "none") {
          summary.api.fallback_count++;
        }
        break;
      }

      case "utterance_filter_result": {
        summary.counts.utterance_filter_results++;

        // Lifecycle validation: call_id must link to a completed API call
        if (!acc.apiCallsFinishedCallIds.has(ev.call_id)) {
          acc.orphanFilterResults.push(ev.call_id);
        } else {
          // Cross-field consistency: turn/agent/mode should match, and mode must be reaction
          const ctx = acc.callIdContext.get(ev.call_id);
          if (ctx && (ctx.turn !== ev.turn || ctx.agent !== ev.agent || ctx.mode !== ev.mode)) {
            acc.filterContextMismatchCount++;
          }
        }

        if (ev.dedup_dropped) summary.filtering.dedup_drop_count++;
        if (ev.history_hallucination) summary.filtering.history_hallucination_count++;
        if (ev.speaker_prefix_stripped) summary.filtering.speaker_prefix_stripped_count++;
        if (ev.action_stripped) summary.filtering.action_stripped_count++;
        if (ev.silence_by_length) summary.filtering.silence_by_length_count++;
        if (ev.truncated_by_max_length) summary.filtering.truncated_by_max_length_count++;
        if (ev.silence_token_detected) summary.filtering.silence_token_detected_count++;
        const isPipelineFilter = !ev.silence_token_detected && !ev.dedup_dropped;
        if (isPipelineFilter) summary.filtering.pipeline_filter_count++;
        if (ev.cleaned_utterance === null) {
          summary.filtering.cleaned_to_null_count++;
          acc.cleanedToNullCount++;
          if (isPipelineFilter) {
            summary.filtering.pipeline_cleaned_to_null_count++;
          }
        } else if (typeof ev.cleaned_utterance === "string") {
          pushSize(acc.cleanedUtteranceCharsAcc, ev.cleaned_utterance.length);
        }
        break;
      }

      case "reaction_results": {
        // Informational only; individual agent results tracked via normalize/filter
        break;
      }

      case "collision_start": {
        summary.counts.collisions++;
        break;
      }

      case "collision_round": {
        // Individual rounds tracked for detail, tier counts come from collision_resolved
        break;
      }

      case "collision_resolved": {
        const tier = String(ev.resolutionTier);
        inc(summary.mechanics.collision_tiers, tier);
        if (ev.resolutionTier === 3) summary.mechanics.tier3_count++;
        if (ev.resolutionTier === 4) summary.mechanics.tier4_count++;
        break;
      }

      case "interruption_evaluation": {
        if (ev.final_result) {
          summary.mechanics.interruption_success_count++;
          acc.interruptionEvalSuccessCount++;
        } else {
          summary.mechanics.interruption_failure_count++;
          acc.interruptionEvalFailureCount++;
        }
        // Track evaluations where someone actually tried to interrupt
        // (representative was selected). This matches when interruption_attempt
        // events should be emitted by the runtime.
        if (ev.representative !== null && ev.representative !== undefined) {
          acc.interruptionEvalWithRepresentativeCount++;
        }
        break;
      }

      case "interruption_attempt": {
        summary.counts.interruptions_attempted++;
        break;
      }

      case "turn_complete": {
        summary.counts.turns_completed++;
        const rec = ev.record;
        if (rec.type === "speech") {
          summary.counts.speech_turns++;
          if (rec.speaker) {
            inc(summary.mechanics.speaker_turns, rec.speaker);
          }
        } else if (rec.type === "silence") {
          summary.counts.silence_turns++;
        }
        break;
      }

      case "thought_update": {
        summary.counts.thought_updates++;
        if (typeof ev.thought === "string") {
          pushSize(acc.thoughtCharsAcc, ev.thought.length);
        }
        break;
      }

      case "session_end": {
        summary.run.end_reason = ev.reason;
        break;
      }

      case "session_final_state": {
        // Stored for reference; no aggregation needed
        break;
      }

      case "run_finished": {
        acc.hasRunFinished = true;
        acc.runFinishedTerminal = ev.terminal === true;
        acc.runFinishedStatus = ev.status;
        summary.run.ended_at = ev.ts;
        summary.run.terminal = ev.terminal === true;
        summary.run.status = ev.status;
        if (ev.end_reason !== undefined) {
          summary.run.end_reason = ev.end_reason;
        }
        break;
      }

      case "fatal_error": {
        acc.hasFatalError = true;
        acc.fatalErrors.push(ev.error);
        break;
      }

      case "sigint_received": {
        // Informational only
        break;
      }
    }
  }

  // ── Post-pass computations ────────────────────────────────────────────────

  // Set source fields from accumulated run_ids
  if (summary.source.run_id === null && acc.runIds.size > 0) {
    summary.source.run_id = acc.runIds.values().next().value ?? null;
  }
  if (summary.source.log_schema_version === null && acc.schemaVersion !== null) {
    summary.source.log_schema_version = acc.schemaVersion;
  }

  // Compute wall-clock duration
  if (summary.run.started_at && summary.run.ended_at) {
    const startMs = new Date(summary.run.started_at).getTime();
    const endMs = new Date(summary.run.ended_at).getTime();
    if (!isNaN(startMs) && !isNaN(endMs)) {
      summary.run.duration_ms = endMs - startMs;
    }
  }

  // Compute avg/max duration per agent
  for (const [agent, durations] of acc.agentDurations) {
    const agentStats = summary.api.by_agent[agent];
    if (agentStats && durations.length > 0) {
      agentStats.avg_duration_ms = Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length,
      );
      agentStats.max_duration_ms = Math.max(...durations);
    }
  }

  // Compute size stats
  summary.sizes = {
    prompt_history_chars: finalizeSizeStats(acc.historyCharsAcc),
    prompt_user_chars: finalizeSizeStats(acc.userPromptCharsAcc),
    response_content_chars: finalizeSizeStats(acc.contentCharsAcc),
    thought_chars: finalizeSizeStats(acc.thoughtCharsAcc),
    utterance_cleaned_chars: finalizeSizeStats(acc.cleanedUtteranceCharsAcc),
  };

  // ── Context consistency warnings ───────────────────────────────────────────

  if (acc.retryContextMismatchCount > 0) {
    summary.warnings.push(
      `retry_context_mismatch_count: ${acc.retryContextMismatchCount} retries where turn/agent/mode differs from initial attempt`,
    );
  }
  if (acc.normalizeContextMismatchCount > 0) {
    summary.warnings.push(
      `normalize_context_mismatch_count: ${acc.normalizeContextMismatchCount} normalize_result events where turn/agent/mode differs from originating call`,
    );
  }
  if (acc.filterContextMismatchCount > 0) {
    summary.warnings.push(
      `filter_context_mismatch_count: ${acc.filterContextMismatchCount} utterance_filter_result events where turn/agent/mode differs from originating call`,
    );
  }
  if (acc.normalizeOnFailedCallCount > 0) {
    summary.warnings.push(
      `normalize_on_failed_call_count: ${acc.normalizeOnFailedCallCount} normalize_result events linked to a call_id with no successful finish`,
    );
  }

  // ── Classification ────────────────────────────────────────────────────────

  classifyRun(summary, acc, parseErrors);

  return summary;
}
