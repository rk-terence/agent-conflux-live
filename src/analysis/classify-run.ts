import type { RunSummary, AccumulatorState, ParseError } from "./types.js";
import { THRESHOLDS } from "./types.js";

// ── L0 Infra Classification ────────────────────────────────────────────────

export function classifyL0(
  summary: RunSummary,
  acc: AccumulatorState,
  parseErrors: ParseError[],
): void {
  const reasons: string[] = [];

  // 1. Missing bookends
  if (!acc.hasRunStarted) {
    reasons.push("missing_run_started");
  }
  if (!acc.hasRunFinished) {
    reasons.push("missing_run_finished");
  }

  // 2. Terminal marker invalid
  if (acc.hasRunFinished && !acc.runFinishedTerminal) {
    reasons.push("run_finished_not_terminal");
  }

  // 3. Fatal status
  if (acc.runFinishedStatus === "fatal_error") {
    reasons.push("fatal_error_status");
  }

  // 4. Fatal error event
  if (acc.hasFatalError) {
    reasons.push("fatal_error_event");
  }

  // 5. NDJSON parse errors
  if (parseErrors.length > 0) {
    reasons.push(`ndjson_parse_failure`);
  }

  // 6. Inconsistent run_id
  if (acc.runIds.size > 1) {
    reasons.push("inconsistent_run_id");
  }

  // 7. Orphan api_call_finished
  if (acc.orphanFinished.length > 0) {
    reasons.push("orphan_api_call_finished");
  }

  // 8. Duplicate api_call_started (call_id, attempt) — retry-safe keying
  if (acc.duplicateCallKeys.length > 0) {
    reasons.push("duplicate_call_id");
  }

  // 8b. Duplicate api_call_finished (call_id, attempt)
  if (acc.duplicateFinishedKeys.length > 0) {
    reasons.push("duplicate_api_call_finished");
  }

  // 9. Auth/permission errors
  if (acc.authErrors.length > 0) {
    reasons.push("provider_auth_error");
  }

  // 10. Invalid model errors
  if (acc.modelErrors.length > 0) {
    reasons.push("provider_invalid_model");
  }

  // 11. Corrupt events
  if (acc.corruptEvents.length > 0) {
    reasons.push("malformed_core_event");
  }

  // 12. Orphan normalize_result (call_id not in any api_call_finished)
  if (acc.orphanNormalizeResults.length > 0) {
    reasons.push("orphan_normalize_result");
  }

  // 13. Orphan utterance_filter_result (call_id not in any api_call_finished)
  if (acc.orphanFilterResults.length > 0) {
    reasons.push("orphan_utterance_filter_result");
  }

  summary.classification.l0_infra = {
    result: reasons.length > 0 ? "fail" : "pass",
    reasons,
  };
}

// ── L1 Mechanics Classification ─────────────────────────────────────────────

export function classifyL1(
  summary: RunSummary,
  acc: AccumulatorState,
): void {
  // Gate on L0
  if (summary.classification.l0_infra.result === "fail") {
    summary.classification.l1_mechanics = {
      result: "not_evaluated",
      reasons: ["blocked_by_l0"],
    };
    return;
  }

  const reasons: string[] = [];

  // 1. Normalization fallback rate
  const normCount = summary.counts.normalize_results;
  if (normCount > 0) {
    const fallbackRate = summary.api.fallback_count / normCount;
    if (fallbackRate > THRESHOLDS.L1_FALLBACK_RATE) {
      reasons.push(
        `high_normalization_fallback_rate: ${fallbackRate.toFixed(2)} > ${THRESHOLDS.L1_FALLBACK_RATE}`,
      );
    }
  }

  // 2. Truncation rate
  if (normCount > 0) {
    const truncRate = summary.api.truncation_suspected_count / normCount;
    if (truncRate > THRESHOLDS.L1_TRUNCATION_RATE) {
      reasons.push(
        `high_truncation_rate: ${truncRate.toFixed(2)} > ${THRESHOLDS.L1_TRUNCATION_RATE}`,
      );
    }
  }

  // 3. Tier 3+4 collision rate
  const totalCollisions = Object.values(summary.mechanics.collision_tiers).reduce(
    (a, b) => a + b,
    0,
  );
  if (totalCollisions > 0) {
    const tier34Rate =
      (summary.mechanics.tier3_count + summary.mechanics.tier4_count) / totalCollisions;
    if (tier34Rate > THRESHOLDS.L1_TIER3_4_COLLISION_RATE) {
      reasons.push(
        `high_tier3_tier4_collision_rate: ${tier34Rate.toFixed(2)} > ${THRESHOLDS.L1_TIER3_4_COLLISION_RATE}`,
      );
    }
  }

  // 4. Speaker monopoly
  const speechTurns = summary.counts.speech_turns;
  if (speechTurns >= THRESHOLDS.L1_SPEAKER_MONOPOLY_MIN_TURNS) {
    for (const [speaker, count] of Object.entries(summary.mechanics.speaker_turns)) {
      const share = count / speechTurns;
      if (share > THRESHOLDS.L1_SPEAKER_MONOPOLY_RATIO) {
        reasons.push(
          `speaker_monopoly: ${speaker} has ${(share * 100).toFixed(0)}% of speech turns`,
        );
      }
    }
  }

  // 5. Dedup drop count
  if (summary.filtering.dedup_drop_count >= THRESHOLDS.L1_DEDUP_DROP_COUNT) {
    reasons.push(
      `high_dedup_drop_count: ${summary.filtering.dedup_drop_count} >= ${THRESHOLDS.L1_DEDUP_DROP_COUNT}`,
    );
  }

  // 6. Cleaned-to-null rate (pipeline filtering only, excludes silence tokens and dedup)
  const pipelineFilterCount = summary.filtering.pipeline_filter_count;
  if (pipelineFilterCount > 0) {
    const cleanedNullRate = summary.filtering.pipeline_cleaned_to_null_count / pipelineFilterCount;
    if (cleanedNullRate > THRESHOLDS.L1_CLEANED_TO_NULL_RATE) {
      reasons.push(
        `high_clean_to_null_rate: ${cleanedNullRate.toFixed(2)} > ${THRESHOLDS.L1_CLEANED_TO_NULL_RATE}`,
      );
    }
  }

  // 7. Interruption event inconsistency
  // interruption_attempt is emitted for every evaluation where a representative
  // was selected (both success and failure). The counts should match.
  const evalsWithRep = acc.interruptionEvalWithRepresentativeCount;
  const attempts = summary.counts.interruptions_attempted;
  if (evalsWithRep !== attempts) {
    reasons.push(
      `interruption_event_inconsistency: ${attempts} attempts vs ${evalsWithRep} evaluations with representative`,
    );
  }

  summary.classification.l1_mechanics = {
    result: reasons.length > 0 ? "fail" : "pass",
    reasons,
  };
}

// ── Combined Classifier ─────────────────────────────────────────────────────

export function classifyRun(
  summary: RunSummary,
  acc: AccumulatorState,
  parseErrors: ParseError[],
): void {
  classifyL0(summary, acc, parseErrors);
  classifyL1(summary, acc);
  summary.eligible_for_l2 =
    summary.classification.l0_infra.result === "pass" &&
    summary.classification.l1_mechanics.result === "pass";
}
