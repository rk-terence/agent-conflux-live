# Architecture

## Purpose

This document defines the implementation architecture for AI Roundtable. It is the source of truth for system design and module boundaries.

Related docs:
- `docs/PROVIDER.md` — provider integration notes, API gotchas, model behavior observations

## Scope

This document covers the non-UI core of the system:

- discussion state and rules
- iteration execution
- collision negotiation
- history projection
- prompt construction
- model gateway abstraction
- response normalization
- CLI tooling
- testing boundaries

## Required Technology Choices

- Primary language: TypeScript
- Core implementation style: framework-agnostic TypeScript modules
- Product runtime target: browser-based application runtime + Node.js CLI
- Backend requirement: no backend required
- Model integration boundary: all model calls go through the `ModelGateway` interface
- Package manager: pnpm
- Test runner: vitest
- UI framework: React (via Vite)
- CLI runner: tsx

## Design Principles

- **One loop.** The system runs as a single repeated iteration cycle.
- **Full speech per call.** One model call produces the agent's complete speech (no sentence-by-sentence continuation).
- **Event log as source of truth.** Rendered transcript text is derived, not primary state.
- **Pure state transitions.** Discussion rules are implemented as pure domain logic.
- **First-person history projection.** Each agent sees a perspective-specific transcript.
- **Provider isolation.** Provider-specific protocol differences do not leak into domain logic.
- **Negotiation over randomness.** Collision resolution is primarily decided by the agents themselves (pre-declared insistence, negotiation, voting), with random tiebreak only as an ultimate fallback to guarantee convergence.

## Core Invariants

1. Each iteration is committed atomically. Partial results must not mutate discussion state.
2. Domain state transitions are decided only by the domain reducer.
3. There is no "speaking" phase — turns complete in one step (speech + turn_ended).
4. Collision, silence, and turn-gap are outcomes of the same loop, not separate mechanisms.
5. History shown to agents is always generated from canonical state and events.
6. Provider or gateway code must not decide collision, end-of-turn, silence backoff, or other business rules.
7. The last speaker sits out the next iteration, giving others priority.

## Module Overview

### 1. Domain

The `domain` module owns the business model of a discussion.

Responsibilities:

- define `SessionState`, `DomainEvent`, `InsistenceLevel`, and iteration result types
- define valid phase transitions (only `turn_gap` and `ended` in the simplified model)
- advance virtual time
- apply silence backoff
- decide single-speaker, collision, and discussion end
- enforce invariants

`InsistenceLevel` (`"low"` | `"mid"` | `"high"`) is carried on `AgentOutput.speech` and `CollisionUtterance`, enabling pre-declared collision resolution without extra API calls.

Phase model (simplified):

```
idle → turn_gap ↔ turn_gap → ended
        │                      ↑
        └──────────────────────┘
```

- `turn_gap`: default active phase. All agents are polled. Single speaker → commit + turn_ended (stays in turn_gap). Multiple speakers → collision event (stays in turn_gap). All silent → silence backoff.
- `ended`: terminal state.

There is no `speaking` phase. Turns complete atomically.

### 2. Engine

The `engine` module orchestrates one iteration of the loop.

Responsibilities:

- read current `SessionState`
- skip the last speaker (they sit out one round)
- build reaction-mode call inputs for active participants
- execute all model calls concurrently
- retry failed agents individually when at least one succeeded (skip retry on total failure)
- convert persistent errors to silence
- deduplicate verbatim repeats across the entire session
- normalize all responses
- commit the iteration through the domain reducer
- detect gap collisions and trigger negotiation
- replay the negotiation winner's speech through the reducer
- expose iteration-level debug information (including negotiation data)

### 3. Negotiation

The `negotiation` module resolves collisions through a four-tier system that guarantees convergence.

When multiple agents speak simultaneously (gap collision), each agent's pre-declared `insistence` level (`low` / `mid` / `high`) is compared first. This resolves most collisions with zero extra API calls. Remaining ties escalate through negotiation rounds, bystander voting, and ultimately random selection.

Four-tier resolution:

- **Tier 1: Pre-declared insistence** (zero API calls) — compare insistence levels declared during the reaction call. Unique highest wins.
- **Tier 2: Multi-round negotiation** (max 3 rounds) — only tied-highest candidates enter. Each round, agents re-declare a three-level insistence via API call. Unique highest wins. All-low → reset. Otherwise narrow.
- **Tier 3: Bystander voting** (one API call per bystander) — non-colliders vote on who should speak. They see candidate identities but not speech content. Unique highest vote count wins.
- **Tier 4: Random** (deterministic termination) — tiebreak for vote ties or no bystanders.

Key behaviors:

- **@mention awareness**: if an agent was recently @-mentioned (after their last speech), both the reaction turn directive (soft nudge to respond) and the negotiation prompt (stronger reason to insist) include a mention hint
- **Full discussion context**: each agent sees their perspective-specific history in negotiation and voting prompts
- **All rounds and votes logged**: every tier's decisions are recorded both in debug output and in `CollisionResolvedEvent` domain events
- **Guaranteed convergence**: Tier 4 is an unconditional termination point — collisions always resolve
- **`CollisionResolvedEvent`**: emitted by the engine after negotiation, before winner replay. Carries `winnerId`, `tier`, `negotiationRounds` (Tier 2 details), and `votes` (Tier 3 details). This event allows the full collision resolution story to be reconstructed from domain events alone

### 4. History Projector

The `history` module converts canonical events into perspective-specific transcript text, formatted as a markdown list for LLM readability.

This module owns the **projected history** portion of the prompt only. It must not embed current-turn questions, behavior rules, or negotiation directives. Those belong to the prompting layer.

Output format:

- Each event is a markdown list item: `- [timestamp] summary`
- Details within an event use 2-space indented continuation lines
- Quoted speech uses markdown blockquote (`> `) inside list item indentation
- Resolved collisions merge with the winner's speech into a single list item (the next `sentence_committed` is consumed and not rendered separately)

Example output (yielder's perspective, Tier 1 resolution):

```markdown
- [0.0s] 讨论开始 — 话题：AI意识
- [1.0s] **DeepSeek**：
  > 开场白。
- [2.0s] 你和 Claude 同时开口了，Claude 的发言意愿更强，Claude 先说了
  你想说但没说出来的：
  > 我有不同看法。
  Claude 说：
  > 我要反驳——AI没有主观体验。
```

Resolution summary varies by tier and perspective:

| Tier | Winner | Yielder | Bystander |
|------|--------|---------|-----------|
| 1 | X 发言意愿没你高，你先说了 | X 的发言意愿更强，X 先说了 | X 的发言意愿最强，X 先说了 |
| 2 | 经过协商你获得了发言权 | 经过协商 X 获得了发言权 | 经过协商 X 获得了发言权 |
| 3 | 大家投票让你先说 | 大家投票让 X 先说 | 你投票给了 X，X 先说了 |
| 4 | 僵持不下，最终你先说了 | 僵持不下，最终 X 先说了 | 僵持不下，最终 X 先说了 |

Resolved collision event sequence: `CollisionEvent → CollisionResolvedEvent → SentenceCommittedEvent → TurnEndedEvent`

Responsibilities:

- render completed speech: `- [3.5s] **DeepSeek**：` + blockquoted content
- render resolved collisions: tier-aware summary + indented unsaid/said speech in blockquotes
- render unresolved collisions: summary + participant's unsaid speech in blockquote
- render silence annotations: `- [5.0s] 安静了 1 秒（累计 3 秒）`
- replace the current agent's own name with first-person `你`
- look-ahead to detect resolved vs unresolved collisions (collision followed by `collision_resolved` + `sentence_committed` = resolved; legacy path without `collision_resolved` also supported)
- produce history that is reusable across prompt modes, without mode-specific directives

History projection contract:

- projected history is derived only from canonical events
- projected history is markdown-formatted transcript, not raw event JSON
- projected history may describe what just happened, including collisions
- projected history must not ask the model what to do next
- the boundary is strict: "what has happened so far" belongs here; "what should you do now" belongs to the turn directive

### 5. Prompting

The `prompting` module converts projected history into gateway-ready call inputs. It separates constant text (templates) from runtime variable preparation (builders).

Prompt contract:

- Semantically, every agent call has **three parts**:
  - **System prompt**: stable role + behavioral rules
  - **Projected history**: perspective-specific markdown transcript of prior events
  - **Turn directive**: the instruction for this call, including any mode-specific situational hints
- Transport-wise, the model gateway currently receives **two text channels**:
  - `systemPrompt`
  - `userPromptText`
- `userPromptText` is the serialized combination of:
  - projected history
  - a mode-specific separator or framing block when needed
  - the turn directive
- Optional situational hints do not form a separate architectural part. They belong inside the **turn directive** block.
- The source of truth for exact **system prompt** and **turn directive** wording lives in code templates. Architecture docs define structure and ownership boundaries, not verbatim copies of every prompt variant.

Structure:

- `prompting/templates/reaction.ts` — pure constant template for the reaction system prompt, rules array, and collision notice. Uses `{{slot}}` placeholders. Instructs models to output structured JSON.
- `prompting/templates/negotiation.ts` — pure constant template for the negotiation system prompt, collision description, mention hint, round summaries, and deadlock notice. Instructs models to output JSON insistence level.
- `prompting/templates/voting.ts` — pure constant template for the bystander voting system prompt. Instructs models to output JSON vote.
- `prompting/render.ts` — strict slot renderer: replaces `{{key}}` placeholders, throws on missing variables.
- `prompting/builders/reaction.ts` — prepares variables (agent name, other names, topic, collision context, @mention detection) and renders the reaction prompt via templates.
- `prompting/builders/negotiation.ts` — prepares variables (discussion history, @mention detection, round summaries, deadlock context) and renders the negotiation prompt via templates.
- `prompting/builders/voting.ts` — prepares variables (voter, candidates, discussion history) and renders the voting prompt via templates.
- `prompting/mention-utils.ts` — @mention detection utility shared by reaction and negotiation builders.
- `prompting/constants.ts` — token limits (REACTION_MAX_TOKENS = 250, NEGOTIATION_MAX_TOKENS = 30, VOTING_MAX_TOKENS = 30).
- `prompting/builder.ts` — re-export shim for backwards compatibility.

Responsibilities:

- provide the shared system prompt (rules maintained as an array constant, joined at render time)
- build reaction-mode inputs
- build negotiation-mode inputs (extracted from the negotiation module)
- keep `projected history` and `turn directive` conceptually separate, even when serialized into one `userPromptText` string for transport
- append collision context when consecutive collisions have occurred
- define token limits

Key system prompt rules:

- Reply in structured JSON: `{ "speech": "...", "insistence": "low" | "mid" | "high" }`, `speech: null` for silence
- `insistence` is a pre-declared self-assessment of how much the agent wants to persist if someone else is also speaking
- No action descriptions or parentheticals
- Don't mimic history format (no `**你**：` prefix)
- Multiple simultaneous speakers = nobody heard; don't rush
- `**你**` in history = yourself
- Say your complete thought in one response

Turn directive rules:

- The turn directive is the only prompt part that asks the model to decide or speak now
- Reaction mode turn directive asks for a JSON response (speech + insistence)
- Negotiation mode turn directive asks for a JSON insistence level declaration
- Voting mode turn directive asks for a JSON vote for a candidate
- Collision reminders, @mention reminders, round summaries, and deadlock notes are part of the turn directive, not part of projected history
- Builders may assemble the turn directive from multiple template fragments, but the final prompt contract still treats it as one semantic part

Ownership boundaries:

- `history/*` owns projected history rendering and markdown format
- `prompting/templates/*` owns exact system prompt and turn directive wording
- `prompting/builders/*` owns runtime slot filling and the final composition into gateway-ready fields

### 6. Model Gateway

The `model-gateway` module is the only abstraction the engine uses to call models.

Three implementations:

- `DummyGateway`: fully controllable via a response function, used in unit tests.
- `SmartDummyGateway`: simulates realistic discussion with personality profiles that mirror real API observations (DeepSeek assertive, Gemini polite, Qwen balanced). Returns structured JSON for all modes: reaction (`speech` + `insistence`), negotiation (`insistence`), voting (`vote`). Social pressure increases yield probability in later rounds. Accepts optional `speakChanceOverride` to control activity level.
- `ZenMuxGateway`: real provider adapter using ZenMux aggregation platform (OpenAI-compatible protocol). Returns full model responses (no sentence extraction). Supports per-model thinking configuration (10x max_tokens for thinking models). Error responses are truncated to status code + message.

Preset configurations:

- **Budget**: DeepSeek Chat, Gemini 2.5 Flash (thinking), Qwen3 VL Plus
- **Premium**: DeepSeek V3.2, Gemini 2.5 Pro (thinking), Qwen3 Max

### 7. Normalization

The `normalization` module translates raw model outputs into domain-usable results.

Structured output parsing (reaction mode):

1. `finishReason: "error"` / `"cancelled"` → error (will be retried by engine)
2. Attempt to extract JSON object from the raw text (handles code fences, preamble)
3. If valid JSON with `speech` (string or null) and `insistence` ("low"/"mid"/"high"), use those values
4. Fallback: treat the entire text as speech with default `insistence: "mid"` (backward compatible)
5. If `speech` is null or silence marker → classify as silence
6. Apply speech cleaning pipeline to the `speech` value:
   a. Detect history hallucination (text starting with `- [数字s]` or `[数字s]`) → discard
   b. Strip speaker prefixes (`[你]:`, `[Gemini]:`, `**你**：`, `**Claude**：`) → remove
   c. Strip parenthetical actions (`（等了一秒）`, `(turns to X)`) → remove
   d. Check minimum length (< 4 chars) → discard as silence
7. `finishReason: "max_tokens"` → treat as speech (not error)

Negotiation and voting modes are parsed directly by their respective modules, not by the normalization layer.

### 8. Runner

The `runner` module drives the discussion loop.

Responsibilities:

- call `createSession()` to initialize state
- repeatedly call `runIteration()` until `phase === "ended"` or manually stopped
- expose pause/resume/stop controls
- deliver state changes, events, and debug info via callbacks

### 9. CLI

The `cli` module provides a command-line runner for dev/iteration.

Features:

- Real-time colored terminal output (speech at top level, collisions/negotiations indented)
- Dual log output: `.log` (human-readable) and `.jsonl` (structured)
- Detailed logging of every prompt, response, negotiation round, and event
- Auto-loads `.env` for API keys
- Configurable via flags: `--topic`, `--preset`, `--gateway`, `--duration`
- Event buffering for correct display order (collision → negotiation → speech)

## Failure Handling

Error boundaries:

- **Domain layer**: `AgentOutput` only allows `speech | silence`. No `error` variant. Reducer never receives errors.
- **Engine layer**: catches all gateway rejections. Retries failed agents once **if at least one agent succeeded** (keeps successful responses). When all agents fail simultaneously, no retry is attempted — this likely indicates a provider-wide outage where retrying would be futile. All errors are converted to silence. The engine always returns a result — the discussion proceeds regardless of individual agent failures.
- **Runner layer**: receives engine results directly (no failure variant). Fatal errors (reducer throws) are caught and terminate the discussion.

## Collision Virtual Time

- Gap collision: `人数 × 0.5s` (proportional to number of people involved, not utterance length)
- Normal speech: `tokenCount × 0.06s` (TOKEN_TO_SECONDS)
- Silence backoff: `[1, 2, 4, 8, 16]` seconds, cumulative limit 60s

## Iteration Lifecycle

One iteration executes in the following order:

1. Read current `SessionState`.
2. Identify last speaker — they sit out this round.
3. Build reaction-mode call inputs for remaining participants.
4. Execute all model calls concurrently.
5. Retry any failed agents individually (only if at least one succeeded; skip on total failure).
6. Convert remaining errors to silence.
7. Normalize and deduplicate all responses.
8. Commit through the domain reducer.
9. If gap collision detected → run four-tier negotiation:
   a. Build perspective-specific history for all participants (colliders + bystanders).
   b. Tier 1: compare pre-declared insistence levels (zero API calls).
   c. Tier 2: if tied, run multi-round three-level negotiation (max 3 rounds).
   d. Tier 3: if still tied and bystanders exist, run bystander voting.
   e. Tier 4: random tiebreak as ultimate fallback.
   f. If winner → replay their utterance through the reducer.
10. Return new state, events, and debug info.

## Project Structure

```
src/                          # Framework-agnostic core (pnpm root)
  domain/                     # State types, reducer, session init, constants
  engine/                     # Single-iteration orchestrator
  negotiation/                # Multi-round collision resolution
  history/                    # Perspective-specific transcript projection
  prompting/                  # Prompt templates, builders, renderer
    templates/                # Pure constant templates (reaction, negotiation, voting)
    builders/                 # Variable preparation + rendering (reaction, negotiation, voting)
    render.ts                 # Strict {{slot}} renderer
    constants.ts              # Token limits
  model-gateway/              # Gateway interface, dummy + smart-dummy + ZenMux
  normalization/              # Raw output → AgentOutput classification + cleaning
  runner/                     # Discussion loop driver
  cli/                        # CLI runner with logging

ui/                           # React application (EXPERIMENTAL — known issues, see below)
  src/
    hooks/useDiscussion.ts    # React hook bridging runner ↔ components
    components/               # Setup, discussion, roundtable, list views

docs/
  ARCHITECTURE.md             # This file
  PROVIDER.md                 # Provider integration notes
```

## Development Commands

```bash
# Core tests
pnpm test              # run all tests
pnpm test:watch        # watch mode

# UI development
cd ui && pnpm dev      # start Vite dev server at localhost:5173

# CLI runner
npx tsx src/cli/run.ts --help                        # all options
npx tsx src/cli/run.ts --gateway smart-dummy          # offline testing
npx tsx src/cli/run.ts --duration 120                 # real API (needs .env)
```

