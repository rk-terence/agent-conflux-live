# NDJSON Event Log Schema

Schema version: **1** (`schema_version` field on every event)

## Conventions

- Every event is a single JSON line in the NDJSON file.
- Every event carries: `ts` (ISO-8601), `event` (string), `schema_version` (number), `run_id` (UUID).
- Per-call events also carry: `call_id` (UUID), `turn` (number), `agent` (string), `mode` (PromptMode).
- The log is **append-only**. No event is overwritten or deleted.
- A run log is bounded by `run_started` (first) and `run_finished` (last, `terminal: true`).
- If no `run_finished` exists, the process was killed externally (classify as infra fail).

## Event Ordering (typical run)

```
run_started
session_config
turn_start
  api_call_started        (per agent, parallel)
  api_call_finished       (per agent, parallel)
  normalize_result        (per agent)
  utterance_filter_result (per reacting agent with non-null utterance)
reaction_results
  [collision_start]
    [collision_round]     (tier 1 always; tier 2 per negotiation round; tier 3/4 if reached)
      [api_call_started / api_call_finished / normalize_result for negotiation/voting]
  [collision_resolved]
  [interruption_evaluation]
    [api_call_started / api_call_finished / normalize_result for judge/defense]
  [interruption_attempt]
turn_complete
thought_update            (per agent with non-null thought)
... (repeat per turn) ...
session_end
session_final_state
run_finished
```

## Event Reference

### run_started

First event in the log.

| Field | Type | Description |
|-------|------|-------------|
| config_path | string | Absolute path to the config file |

### session_config

| Field | Type | Description |
|-------|------|-------------|
| configPath | string | Absolute path to the config file |
| config | object | Full session config (API keys redacted) |

### turn_start

| Field | Type | Description |
|-------|------|-------------|
| turn | number | Turn number (starts at 1) |
| virtualTime | number | Virtual time in seconds |

### api_call_started

| Field | Type | Description |
|-------|------|-------------|
| call_id | string | UUID linking started/finished pair |
| turn | number | Current turn |
| agent | string | Agent name |
| mode | PromptMode | reaction, negotiation, voting, judge, defense |
| attempt | number | Retry attempt (0-based) |
| provider | string | Provider name |
| model | string | Model ID |
| max_tokens | number | Max tokens requested |
| system_prompt_chars | number | System prompt length |
| user_prompt_chars | number | User prompt length |
| history_chars | number | History portion of user prompt |
| directive_chars | number | Directive portion of user prompt |

### api_call_finished

| Field | Type | Description |
|-------|------|-------------|
| call_id | string | UUID matching the started event |
| turn | number | Current turn |
| agent | string | Agent name |
| mode | PromptMode | Prompt mode |
| attempt | number | Retry attempt (0-based), matches the started event |
| provider | string | Provider name |
| model | string | Model ID |
| status | "success" \| "error" | Outcome |
| duration_ms | number | Wall-clock milliseconds |
| http_status | number? | HTTP status code |
| finish_reason | string? | e.g. "stop", "length" |
| prompt_tokens | number? | Tokens in prompt |
| completion_tokens | number? | Tokens in completion |
| reasoning_tokens | number? | Reasoning tokens (if available) |
| content_chars | number? | Response content length (success only) |
| content | string? | Raw response content (success only) |
| raw_response | object? | Full provider response object |
| error_code | string? | Structured error code from provider SDK (error only) |
| error_message | string? | Error message (error only) |

### normalize_result

| Field | Type | Description |
|-------|------|-------------|
| call_id | string | UUID of the API call this normalizes |
| turn | number | Current turn |
| agent | string | Agent name |
| mode | PromptMode | Prompt mode |
| raw_kind | "empty" \| "json" \| "plain_text" | What the raw response looked like |
| json_extracted | boolean | Whether JSON was successfully extracted |
| fallback_path | "none" \| "raw_text" \| "keyword" \| "default" | Which fallback was used |
| truncation_suspected | boolean | Raw has `{` but no `}` |
| thought_type | "string" \| "null" \| "missing" \| "object" \| "other" | Type of the raw thought field in JSON |
| payload | object | Normalized result fields (mode-specific) |

Payload fields by mode:
- **reaction**: `utterance`, `insistence`, `thought`
- **negotiation**: `insistence`, `thought`
- **voting**: `vote`, `thought`
- **judge**: `interrupt`, `urgency`, `reason`, `thought`
- **defense**: `yield`, `thought`

### utterance_filter_result

Emitted for every reaction that produced a non-null utterance (before or after cleaning).

| Field | Type | Description |
|-------|------|-------------|
| call_id | string | UUID of the reaction API call |
| turn | number | Current turn |
| agent | string | Agent name |
| mode | "reaction" | Always "reaction" |
| original_utterance | string | Utterance before cleaning |
| cleaned_utterance | string? | Utterance after cleaning (null if silenced) |
| history_hallucination | boolean | Cleaned as history hallucination |
| speaker_prefix_stripped | boolean | Speaker prefix was removed |
| action_stripped | boolean | Parenthetical actions were removed |
| silence_by_length | boolean | Silenced due to < 4 chars after cleaning |
| silence_token_detected | boolean | Matched a silence token |
| dedup_dropped | boolean | Dropped as verbatim duplicate |

### reaction_results

| Field | Type | Description |
|-------|------|-------------|
| results | object | Map of agent name → ReactionResult |

### collision_start

| Field | Type | Description |
|-------|------|-------------|
| colliders | string[] | Agent names involved in collision |

### collision_round

One event per resolution step.

| Field | Type | Description |
|-------|------|-------------|
| turn | number | Current turn |
| tier | 1 \| 2 \| 3 \| 4 | Resolution tier |
| round | number | Round within the tier (1-based) |
| candidates | string[] | Agent names in this round |
| insistences | array | `{ agent, insistence }` for each candidate |
| eliminated | string[] | Agents eliminated this round |
| winner | string? | Winner if resolved this round (null otherwise) |

### collision_resolved

| Field | Type | Description |
|-------|------|-------------|
| winner | string | Winning agent |
| winnerInsistence | InsistenceLevel | Winner's final insistence |
| resolutionTier | 1 \| 2 \| 3 \| 4 | Which tier resolved |
| colliders | array | All colliding parties |
| votes | array | Tier 3 vote records |

### interruption_evaluation

| Field | Type | Description |
|-------|------|-------------|
| turn | number | Current turn |
| speaker | string | Speaker being interrupted |
| spoken_part_chars | number | Characters of spoken portion |
| unspoken_part_chars | number | Characters of unspoken portion |
| listeners | string[] | All listeners considered |
| interrupt_requested | string[] | Listeners who requested interruption |
| urgencies | array | `{ agent, urgency }` for all listeners |
| representative | string? | Chosen representative interrupter |
| representative_urgency | InsistenceLevel? | Representative's urgency |
| resolution_method | string | "auto_win", "auto_lose", "defense", "no_interrupt", "no_split" |
| defense_yielded | boolean? | Whether speaker yielded (defense only) |
| final_result | boolean | Whether interruption succeeded |

### interruption_attempt

| Field | Type | Description |
|-------|------|-------------|
| speaker | string | Speaker being interrupted |
| interrupter | string | Interrupting agent |

### turn_complete

| Field | Type | Description |
|-------|------|-------------|
| record | TurnRecord | The committed turn record (silence or speech) |

### thought_update

| Field | Type | Description |
|-------|------|-------------|
| agent | string | Agent name |
| thought | string | Current thought text |

### session_end

| Field | Type | Description |
|-------|------|-------------|
| reason | string | End reason (silence_timeout, duration_limit, manual_stop, fatal_error) |
| turns | number | Total turns |
| virtualTime | number | Final virtual time |
| speechCount | number | Number of speech records |
| thoughtCount | number | Number of thought entries |

### session_final_state

Full session state dump for post-hoc analysis.

### run_finished

**Terminal marker.** Last event in the log.

| Field | Type | Description |
|-------|------|-------------|
| status | "completed" \| "fatal_error" \| "manual_stop" \| "abandoned" | Run outcome |
| end_reason | string? | Reason string |
| terminal | true | Always true |

### sigint_received

Emitted when SIGINT is caught. No additional fields.

### fatal_error

| Field | Type | Description |
|-------|------|-------------|
| error | string | Error message |
| stack | string? | Stack trace |

## Correlating Events

- **Run**: All events share the same `run_id`.
- **API call lifecycle**: `call_id` links `api_call_started` → `api_call_finished` → `normalize_result` → `utterance_filter_result`.
- **Turn grouping**: Events between consecutive `turn_start` events belong to the same turn.
- **Collision detail**: `collision_round` events between `collision_start` and `collision_resolved` show the round-by-round process.

## L0/L1 Classification Inputs

From the log alone, an offline job can determine:

- **L0 (infra)**: Did the run start and finish? Check for `run_started` + `run_finished`. Check `status` field. Count API errors via `api_call_finished` with `status: "error"`.
- **L1 (mechanics)**: Were responses properly normalized? Check `normalize_result` for `fallback_path !== "none"` or `truncation_suspected`. Were utterances cleaned? Check `utterance_filter_result`. How were collisions resolved? Check `collision_round` events. Were interruptions handled correctly? Check `interruption_evaluation`.
- **L2 (content)**: Raw payloads in `normalize_result` and committed records in `turn_complete` provide scoring inputs.
