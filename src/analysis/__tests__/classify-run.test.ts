import { describe, it, expect, beforeEach } from "vitest";
import { readLogText } from "../read-log.js";
import { summarizeRun } from "../summarize-run.js";
import {
  buildCleanRun,
  buildInfraFailRun,
  buildMechanicsFailRun,
  resetCallSeq,
} from "./fixtures.js";

function summarize(lines: string[]) {
  const text = lines.join("\n");
  const { events, parseErrors } = readLogText(text);
  return summarizeRun("test.ndjson", events, parseErrors);
}

// ── L0 Classification Tests ─────────────────────────────────────────────────

describe("L0 classification", () => {
  beforeEach(() => resetCallSeq());

  it("passes on a clean completed run", () => {
    const s = summarize(buildCleanRun());
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l0_infra.reasons).toEqual([]);
  });

  it("fails: missing run_started", () => {
    const s = summarize(buildInfraFailRun("missing_run_started"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("missing_run_started");
  });

  it("fails: missing run_finished", () => {
    const s = summarize(buildInfraFailRun("missing_run_finished"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("missing_run_finished");
  });

  it("fails: run_finished.terminal !== true", () => {
    const s = summarize(buildInfraFailRun("not_terminal"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("run_finished_not_terminal");
  });

  it("fails: run_finished.status === fatal_error", () => {
    const s = summarize(buildInfraFailRun("fatal_error_status"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("fatal_error_status");
  });

  it("fails: fatal_error event present", () => {
    const s = summarize(buildInfraFailRun("fatal_error_event"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("fatal_error_event");
  });

  it("fails: NDJSON parse error", () => {
    const s = summarize(buildInfraFailRun("parse_error"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("ndjson_parse_failure");
  });

  it("fails: inconsistent run_id", () => {
    const s = summarize(buildInfraFailRun("inconsistent_run_id"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("inconsistent_run_id");
  });

  it("fails: orphan api_call_finished", () => {
    const s = summarize(buildInfraFailRun("orphan_call"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("orphan_api_call_finished");
  });

  it("fails: duplicate call_id", () => {
    const s = summarize(buildInfraFailRun("duplicate_call_id"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("duplicate_call_id");
  });

  it("fails: auth error in api_call_finished", () => {
    const s = summarize(buildInfraFailRun("auth_error"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("provider_auth_error");
  });

  it("fails: invalid model error", () => {
    const s = summarize(buildInfraFailRun("model_error"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("provider_invalid_model");
  });

  it("fails: corrupt event missing required fields", () => {
    const s = summarize(buildInfraFailRun("corrupt_event"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons).toContain("malformed_core_event");
  });

  it("collects multiple L0 reasons", () => {
    // fatal_error_event produces both fatal_error_event and fatal_error_status
    const s = summarize(buildInfraFailRun("fatal_error_event"));
    expect(s.classification.l0_infra.result).toBe("fail");
    expect(s.classification.l0_infra.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

// ── L1 Classification Tests ─────────────────────────────────────────────────

describe("L1 classification", () => {
  beforeEach(() => resetCallSeq());

  it("passes on a clean run", () => {
    const s = summarize(buildCleanRun());
    expect(s.classification.l1_mechanics.result).toBe("pass");
    expect(s.classification.l1_mechanics.reasons).toEqual([]);
  });

  it("not_evaluated when L0 fails", () => {
    const s = summarize(buildInfraFailRun("missing_run_finished"));
    expect(s.classification.l1_mechanics.result).toBe("not_evaluated");
    expect(s.classification.l1_mechanics.reasons).toContain("blocked_by_l0");
  });

  it("fails: fallback_rate > 0.25", () => {
    const s = summarize(buildMechanicsFailRun("high_fallback_rate"));
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("fail");
    expect(s.classification.l1_mechanics.reasons[0]).toContain(
      "high_normalization_fallback_rate",
    );
  });

  it("fails: truncation_rate > 0.25", () => {
    const s = summarize(buildMechanicsFailRun("high_truncation_rate"));
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("fail");
    expect(s.classification.l1_mechanics.reasons[0]).toContain("high_truncation_rate");
  });

  it("fails: tier3+tier4 collision rate > 0.30", () => {
    const s = summarize(buildMechanicsFailRun("high_tier3_4_rate"));
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("fail");
    expect(s.classification.l1_mechanics.reasons[0]).toContain(
      "high_tier3_tier4_collision_rate",
    );
  });

  it("fails: speaker monopoly", () => {
    const s = summarize(buildMechanicsFailRun("speaker_monopoly"));
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("fail");
    expect(s.classification.l1_mechanics.reasons[0]).toContain("speaker_monopoly");
  });

  it("does not fail monopoly when speech_turns < 8", () => {
    // Clean run with only 5 speech turns — even if one speaker dominates,
    // the threshold requires >= 8
    const s = summarize(buildCleanRun({ turns: 5, silenceTurns: 0 }));
    expect(s.counts.speech_turns).toBe(5);
    expect(s.classification.l1_mechanics.result).toBe("pass");
  });

  it("fails: dedup_drop_count >= 3", () => {
    const s = summarize(buildMechanicsFailRun("high_dedup_drops"));
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("fail");
    expect(s.classification.l1_mechanics.reasons[0]).toContain("high_dedup_drop_count");
  });

  it("fails: cleaned_to_null_rate > 0.25", () => {
    const s = summarize(buildMechanicsFailRun("high_cleaned_to_null_rate"));
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("fail");
    expect(s.classification.l1_mechanics.reasons[0]).toContain("high_clean_to_null_rate");
  });

  it("does not fail on runs with failed (auto_lose) interruption attempts", () => {
    // A run with both successful and failed interruptions should pass L1
    // as long as interruption_attempt count matches evaluations-with-representative
    const s = summarize(
      buildCleanRun({
        turns: 10,
        silenceTurns: 2,
        interruptionSuccesses: 1,
        interruptionFailures: 1,
      }),
    );
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("pass");
    // Both successes and failures generated attempt events
    expect(s.counts.interruptions_attempted).toBe(2);
  });

  it("fails: interruption event inconsistency", () => {
    const s = summarize(buildMechanicsFailRun("interruption_inconsistency"));
    expect(s.classification.l0_infra.result).toBe("pass");
    expect(s.classification.l1_mechanics.result).toBe("fail");
    expect(s.classification.l1_mechanics.reasons[0]).toContain(
      "interruption_event_inconsistency",
    );
  });
});

// ── eligible_for_l2 Tests ───────────────────────────────────────────────────

describe("eligible_for_l2", () => {
  beforeEach(() => resetCallSeq());

  it("true when both L0 and L1 pass", () => {
    const s = summarize(buildCleanRun());
    expect(s.eligible_for_l2).toBe(true);
  });

  it("false when L0 fails", () => {
    const s = summarize(buildInfraFailRun("missing_run_finished"));
    expect(s.eligible_for_l2).toBe(false);
  });

  it("false when L1 fails", () => {
    const s = summarize(buildMechanicsFailRun("high_fallback_rate"));
    expect(s.eligible_for_l2).toBe(false);
  });
});
