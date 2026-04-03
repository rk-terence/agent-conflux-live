---
name: Run Summary
description: Offline run summarizer — reads raw NDJSON logs, produces run-summary.json with deterministic L0/L1 classification.
references: [LOGGING.md]
---

# Quick Start

```bash
# Build first
pnpm build

# Summarize a log file
node dist/analysis/cli.js --input runs/poetry-2min/discussion-xxx.ndjson

# Specify output path
node dist/analysis/cli.js --input runs/my-run/discussion.ndjson --output out/summary.json
```

Default output: `<input-path>.summary.json` (replaces `.ndjson` extension).

Exit code: `0` if L0 passes, `1` if L0 fails.

# Summary Output Schema

`schema_version: 1`

## source

| Field | Type | Description |
|-------|------|-------------|
| log_path | string | Path to the input log file |
| run_id | string? | UUID from the log events |
| log_schema_version | number? | Schema version from the log events |

## run

| Field | Type | Description |
|-------|------|-------------|
| started_at | string? | ISO-8601 timestamp of run_started |
| ended_at | string? | ISO-8601 timestamp of run_finished |
| duration_ms | number? | Wall-clock duration |
| terminal | boolean | Whether run_finished.terminal was true |
| status | string? | Run outcome: completed, fatal_error, manual_stop, abandoned |
| end_reason | string? | Why the run ended |

## session

| Field | Type | Description |
|-------|------|-------------|
| topic | string? | Discussion topic |
| agents | array | Agent info: name, provider, model, thinkingModel |
| config | object | Session config (excluding agents) |

## counts

Total event counts across the run:

- `turns_started`, `turns_completed`
- `speech_turns`, `silence_turns`
- `thought_updates`
- `api_calls_started`, `api_calls_finished`, `api_calls_succeeded`, `api_calls_failed`
- `normalize_results`, `utterance_filter_results`
- `collisions`, `interruptions_attempted`

## api

| Field | Type | Description |
|-------|------|-------------|
| by_mode | object | Per-mode: started, succeeded, failed, total_duration_ms |
| by_agent | object | Per-agent: started, succeeded, failed, total_duration_ms, avg_duration_ms, max_duration_ms |
| errors | array | Error details (capped at 100): call_id, agent, mode, error_code, error_message, http_status |
| finish_reasons | object | Histogram of finish_reason values |
| truncation_suspected_count | number | Normalize results with truncation_suspected |
| fallback_count | number | Normalize results with fallback_path != "none" |

## normalization

| Field | Type | Description |
|-------|------|-------------|
| fallback_path_counts | object | Counts by fallback_path: none, raw_text, keyword, default |
| thought_type_counts | object | Counts by thought_type: string, null, missing, object, other |
| raw_kind_counts | object | Counts by raw_kind: empty, json, plain_text |

## filtering

| Field | Type | Description |
|-------|------|-------------|
| dedup_drop_count | number | Verbatim dedup drops |
| history_hallucination_count | number | History hallucination detections |
| speaker_prefix_stripped_count | number | Speaker prefix removals |
| action_stripped_count | number | Parenthetical action removals |
| silence_by_length_count | number | Silenced due to < 4 chars |
| silence_token_detected_count | number | Silence token matches |
| cleaned_to_null_count | number | Utterances cleaned to null (silenced) |

## mechanics

| Field | Type | Description |
|-------|------|-------------|
| speaker_turns | object | Speech turns per speaker |
| collision_tiers | object | Collision resolutions per tier ("1", "2", "3", "4") |
| tier3_count | number | Tier 3 resolutions |
| tier4_count | number | Tier 4 (random) resolutions |
| interruption_success_count | number | Successful interruptions |
| interruption_failure_count | number | Failed interruptions |

## classification

```json
{
  "l0_infra": { "result": "pass" | "fail", "reasons": [...] },
  "l1_mechanics": { "result": "pass" | "fail" | "not_evaluated", "reasons": [...] }
}
```

## Top-level

| Field | Type | Description |
|-------|------|-------------|
| eligible_for_l2 | boolean | True only when L0 pass AND L1 pass |
| warnings | array | Non-fatal anomalies (see below) |

## Warnings

Context consistency checks that detect potential emitter bugs. These are warnings, not L0 blockers. If any become non-zero in real runs, consider promoting to L0 fail.

| Warning | Meaning |
|---------|---------|
| `retry_context_mismatch_count: N` | N retries (same call_id, different attempt) where turn/agent/mode differs from the initial attempt |
| `normalize_context_mismatch_count: N` | N normalize_result events where turn/agent/mode differs from the originating api_call |
| `filter_context_mismatch_count: N` | N utterance_filter_result events where turn/agent/mode differs from the originating api_call |
| `normalize_on_failed_call_count: N` | N normalize_result events linked to a call_id with no successful api_call_finished |

---

# L0 Infra Classification

Binary pass/fail. Checks whether the run infrastructure was operationally valid.

## Fail Reasons

| Code | Trigger |
|------|---------|
| `missing_run_started` | No run_started event in the log |
| `missing_run_finished` | No run_finished event in the log |
| `run_finished_not_terminal` | run_finished.terminal !== true |
| `fatal_error_status` | run_finished.status === "fatal_error" |
| `fatal_error_event` | Any fatal_error event exists |
| `ndjson_parse_failure` | One or more lines failed JSON.parse |
| `inconsistent_run_id` | Multiple distinct run_id values across events |
| `orphan_api_call_finished` | api_call_finished without matching api_call_started (keyed by call_id + attempt) |
| `duplicate_call_id` | Same (call_id, attempt) pair appears in multiple api_call_started events |
| `duplicate_api_call_finished` | Same (call_id, attempt) pair appears in multiple api_call_finished events |
| `provider_auth_error` | Auth/permission/access denied errors from providers (error_code patterns or HTTP 401/403) |
| `provider_invalid_model` | Invalid model errors (error_code patterns or HTTP 404 with "model" in message) |
| `malformed_core_event` | Known event type missing required fields (per-call events require call_id, turn, agent, mode) |
| `orphan_normalize_result` | normalize_result.call_id not found in any api_call_finished |
| `orphan_utterance_filter_result` | utterance_filter_result.call_id not found in any api_call_finished |

## What does NOT cause L0 fail

- Truncated model responses (L1)
- Fallback normalization (L1)
- Bad mechanics (L1)

---

# L1 Mechanics Classification

Binary pass/fail. Only evaluated when L0 passes. If L0 fails, L1 is `not_evaluated` with reason `blocked_by_l0`.

Checks whether the roundtable mechanics were operationally healthy.

## Thresholds

All thresholds are defined in `src/analysis/types.ts` as `THRESHOLDS`:

| Constant | Value | Description |
|----------|-------|-------------|
| L1_FALLBACK_RATE | 0.25 | Max fallback normalization rate |
| L1_TRUNCATION_RATE | 0.25 | Max truncation suspected rate |
| L1_TIER3_4_COLLISION_RATE | 0.30 | Max tier 3+4 collision resolution rate |
| L1_SPEAKER_MONOPOLY_RATIO | 0.60 | Max speech share for any single speaker |
| L1_SPEAKER_MONOPOLY_MIN_TURNS | 8 | Minimum speech turns before monopoly check |
| L1_DEDUP_DROP_COUNT | 3 | Absolute dedup drop threshold |
| L1_CLEANED_TO_NULL_RATE | 0.25 | Max cleaned-to-null rate |

## Fail Reasons

| Code | Trigger |
|------|---------|
| `high_normalization_fallback_rate` | fallback_count / normalize_results > 0.25 |
| `high_truncation_rate` | truncation_suspected / normalize_results > 0.25 |
| `high_tier3_tier4_collision_rate` | (tier3 + tier4) / total_collisions > 0.30 |
| `speaker_monopoly` | One speaker > 60% of speech turns (when >= 8 speech turns) |
| `high_dedup_drop_count` | dedup_drop_count >= 3 |
| `high_clean_to_null_rate` | cleaned_to_null / filter_results > 0.25 |
| `interruption_event_inconsistency` | interruption_attempt count != interruption_evaluation count where a representative was selected |
| `blocked_by_l0` | L0 failed, L1 not evaluated |

---

# Assumptions

1. Targets the documented log schema in `docs/LOGGING.md` (schema_version 1) only.
2. Deterministic: same input always produces same output.
3. No model judgment: all rules are threshold-based.
4. Division-by-zero guarded: rates are 0 when denominator is 0 (no fail triggered).
5. API errors array capped at 100 entries.
6. Lifecycle keyed by `(call_id, attempt)` — retries with the same call_id but different attempt numbers are valid, not duplicates.
7. Per-call events require `call_id`, `turn`, `agent`, `mode`, and `attempt` (for api_call_started/finished). Missing fields → malformed_core_event L0 fail.
8. Downstream events (normalize_result, utterance_filter_result) must link to a completed api_call via call_id. Orphans → L0 fail. Cross-field mismatches → warnings.

# Code Structure

```
src/analysis/
  types.ts              Threshold constants, RunSummary interface, accumulator types
  log-schema.ts         ParsedEvent discriminated union, parseEvent()
  read-log.ts           NDJSON reader
  summarize-run.ts      Single-pass accumulator → RunSummary
  classify-run.ts       L0/L1 rule-based classification
  cli.ts                CLI entrypoint
  __tests__/
    fixtures.ts         Programmatic test fixture builders
    summarize-run.test.ts
    classify-run.test.ts
```
