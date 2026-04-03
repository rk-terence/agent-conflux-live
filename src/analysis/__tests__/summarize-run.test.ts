import { describe, it, expect, beforeEach } from "vitest";
import { readLogText } from "../read-log.js";
import { summarizeRun } from "../summarize-run.js";
import { buildCleanRun, buildRetryRun, buildInfraFailRun, resetCallSeq } from "./fixtures.js";

function summarize(lines: string[]) {
  const text = lines.join("\n");
  const { events, parseErrors } = readLogText(text);
  return summarizeRun("test.ndjson", events, parseErrors);
}

describe("summarizeRun", () => {
  beforeEach(() => resetCallSeq());

  it("correctly counts all event types in a clean run", () => {
    const s = summarize(buildCleanRun({ turns: 10, silenceTurns: 2 }));

    expect(s.counts.turns_started).toBe(10);
    expect(s.counts.turns_completed).toBe(10);
    expect(s.counts.speech_turns).toBe(8);
    expect(s.counts.silence_turns).toBe(2);
    expect(s.counts.thought_updates).toBe(10);
    // 3 agents × 10 turns = 30 API calls
    expect(s.counts.api_calls_started).toBe(30);
    expect(s.counts.api_calls_finished).toBe(30);
    expect(s.counts.api_calls_succeeded).toBe(30);
    expect(s.counts.api_calls_failed).toBe(0);
    expect(s.counts.normalize_results).toBe(30);
    expect(s.counts.utterance_filter_results).toBe(30);
  });

  it("extracts session config (topic, agents)", () => {
    const s = summarize(buildCleanRun());

    expect(s.session.topic).toBe("Test topic");
    expect(s.session.agents).toHaveLength(3);
    expect(s.session.agents[0].name).toBe("Alice");
    expect(s.session.agents[1].provider).toBe("anthropic");
    expect(s.session.agents[2].model).toBe("gemini-pro");
  });

  it("computes per-agent API breakdowns", () => {
    const s = summarize(buildCleanRun({ turns: 3, silenceTurns: 0 }));

    // Each of 3 agents gets 3 turns of reaction calls
    expect(s.api.by_agent["Alice"].started).toBe(3);
    expect(s.api.by_agent["Alice"].succeeded).toBe(3);
    expect(s.api.by_agent["Bob"].started).toBe(3);
    expect(s.api.by_agent["Carol"].started).toBe(3);
  });

  it("computes per-mode API breakdowns", () => {
    const s = summarize(buildCleanRun({ turns: 3, silenceTurns: 0 }));

    expect(s.api.by_mode["reaction"].started).toBe(9);
    expect(s.api.by_mode["reaction"].succeeded).toBe(9);
  });

  it("computes avg and max duration per agent", () => {
    const s = summarize(buildCleanRun({ turns: 3, silenceTurns: 0 }));

    // All durations are 1000ms from fixtures
    expect(s.api.by_agent["Alice"].avg_duration_ms).toBe(1000);
    expect(s.api.by_agent["Alice"].max_duration_ms).toBe(1000);
  });

  it("counts normalization fallback paths correctly", () => {
    const s = summarize(buildCleanRun({ turns: 3, silenceTurns: 0 }));

    // All fallback_path: "none" in clean run
    expect(s.normalization.fallback_path_counts["none"]).toBe(9);
    expect(s.api.fallback_count).toBe(0);
  });

  it("counts filtering flags correctly", () => {
    const s = summarize(buildCleanRun({ turns: 3, silenceTurns: 0 }));

    // Clean run has no filter flags
    expect(s.filtering.dedup_drop_count).toBe(0);
    expect(s.filtering.history_hallucination_count).toBe(0);
    expect(s.filtering.cleaned_to_null_count).toBe(0);
  });

  it("tracks speaker turns for mechanics", () => {
    const s = summarize(buildCleanRun({ turns: 6, silenceTurns: 0 }));

    // 6 speech turns rotated: Alice, Bob, Carol, Alice, Bob, Carol
    expect(s.mechanics.speaker_turns["Alice"]).toBe(2);
    expect(s.mechanics.speaker_turns["Bob"]).toBe(2);
    expect(s.mechanics.speaker_turns["Carol"]).toBe(2);
  });

  it("tracks collisions by tier", () => {
    const s = summarize(buildCleanRun({ turns: 5, silenceTurns: 0, collisionCount: 3, collisionTier: 2 }));

    expect(s.counts.collisions).toBe(3);
    expect(s.mechanics.collision_tiers["2"]).toBe(3);
    expect(s.mechanics.tier3_count).toBe(0);
    expect(s.mechanics.tier4_count).toBe(0);
  });

  it("tracks interruption successes and failures", () => {
    const s = summarize(
      buildCleanRun({
        turns: 5,
        silenceTurns: 0,
        interruptionSuccesses: 2,
        interruptionFailures: 1,
      }),
    );

    expect(s.mechanics.interruption_success_count).toBe(2);
    expect(s.mechanics.interruption_failure_count).toBe(1);
    // Both successes and failures (auto_lose) emit interruption_attempt
    expect(s.counts.interruptions_attempted).toBe(3);
  });

  it("computes run duration from timestamps", () => {
    const s = summarize(buildCleanRun());

    expect(s.run.started_at).toBeTruthy();
    expect(s.run.ended_at).toBeTruthy();
    expect(s.run.duration_ms).toBeGreaterThan(0);
  });

  it("records run status and end reason", () => {
    const s = summarize(buildCleanRun());

    expect(s.run.terminal).toBe(true);
    expect(s.run.status).toBe("completed");
    expect(s.run.end_reason).toBe("silence_timeout");
  });

  it("handles empty log (zero events)", () => {
    const s = summarize([]);

    expect(s.counts.turns_started).toBe(0);
    expect(s.run.started_at).toBeNull();
    expect(s.classification.l0_infra.result).toBe("fail");
  });

  it("handles log with only run_started (no run_finished)", () => {
    const lines = buildInfraFailRun("missing_run_finished");
    const s = summarize(lines);

    expect(s.run.started_at).toBeTruthy();
    expect(s.run.ended_at).toBeNull();
    expect(s.run.terminal).toBe(false);
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("missing_run_finished");
  });

  it("sets eligible_for_l2 correctly on clean run", () => {
    const s = summarize(buildCleanRun());

    expect(s.eligible_for_l2).toBe(true);
  });

  it("sets source fields correctly", () => {
    const s = summarize(buildCleanRun());

    expect(s.source.log_path).toBe("test.ndjson");
    expect(s.source.run_id).toBeTruthy();
    expect(s.source.log_schema_version).toBe(1);
    expect(s.schema_version).toBe(1);
  });

  it("produces no warnings on clean run", () => {
    const s = summarize(buildCleanRun());
    expect(s.warnings).toEqual([]);
  });

  it("produces no warnings on valid retry run", () => {
    const s = summarize(buildRetryRun());
    expect(s.warnings).toEqual([]);
  });

  it("emits retry_context_mismatch warning when retry changes agent", () => {
    resetCallSeq();
    // Manually build a log where same call_id has different agents across attempts
    const RUN_ID = "00000000-0000-0000-0000-000000000001";
    const base = { schema_version: 1, run_id: RUN_ID };
    const lines = [
      JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", event: "run_started", ...base, config_path: "/test" }),
      JSON.stringify({ ts: "2026-01-01T00:00:00.010Z", event: "api_call_started", ...base,
        call_id: "ctx-test", turn: 1, agent: "Alice", mode: "reaction", attempt: 0,
        provider: "test", model: "m", max_tokens: 100, system_prompt_chars: 100,
        user_prompt_chars: 100, history_chars: 50, directive_chars: 50 }),
      JSON.stringify({ ts: "2026-01-01T00:00:00.020Z", event: "api_call_started", ...base,
        call_id: "ctx-test", turn: 1, agent: "Bob", mode: "reaction", attempt: 1,
        provider: "test", model: "m", max_tokens: 100, system_prompt_chars: 100,
        user_prompt_chars: 100, history_chars: 50, directive_chars: 50 }),
      JSON.stringify({ ts: "2026-01-01T00:00:00.030Z", event: "api_call_finished", ...base,
        call_id: "ctx-test", turn: 1, agent: "Bob", mode: "reaction", attempt: 1,
        status: "success", duration_ms: 500, finish_reason: "stop" }),
      JSON.stringify({ ts: "2026-01-01T00:00:00.100Z", event: "run_finished", ...base,
        status: "completed", end_reason: "silence_timeout", terminal: true }),
    ];
    const s = summarize(lines);
    expect(s.warnings.length).toBe(1);
    expect(s.warnings[0]).toContain("retry_context_mismatch");
  });
});
