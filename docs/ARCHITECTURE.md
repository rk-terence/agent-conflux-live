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
- **Negotiation over randomness.** Collision resolution is decided by the agents themselves, not by the system.

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

- define `SessionState`, `DomainEvent`, and iteration result types
- define valid phase transitions (only `turn_gap` and `ended` in the simplified model)
- advance virtual time
- apply silence backoff
- decide single-speaker, collision, and discussion end
- enforce invariants

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

The `negotiation` module resolves collisions through multi-round agent deliberation.

When multiple agents speak simultaneously (gap collision), each is asked: "Do you insist on speaking, or yield to others?" The process iterates until exactly one agent insists (they win the floor) or max rounds (5) are reached.

Key behaviors:

- **All-yield → retry**: if everyone yields in a round, all candidates re-enter the next round (social "after you" deadlock resolution)
- **Multiple insist → narrow down**: only insisting agents continue to the next round
- **@mention awareness**: if an agent was recently @-mentioned (after their last speech), the prompt hints they have stronger reason to insist
- **Full discussion context**: each agent sees their perspective-specific history in the negotiation prompt
- **Negotiation rounds logged**: every round's decisions and prompts are recorded in debug output

### 4. History Projector

The `history` module converts canonical events into perspective-specific transcript text, formatted as a markdown list for LLM readability.

This module owns the **projected history** portion of the prompt only. It must not embed current-turn questions, behavior rules, or negotiation directives. Those belong to the prompting layer.

Output format:

- Each event is a markdown list item: `- [timestamp] summary`
- Details within an event use 2-space indented continuation lines
- Quoted speech uses markdown blockquote (`> `) inside list item indentation
- Resolved collisions merge with the winner's speech into a single list item (the next `sentence_committed` is consumed and not rendered separately)

Example output (yielder's perspective):

```markdown
- [0.0s] 讨论开始 — 话题：AI意识
- [1.0s] **DeepSeek**：
  > 开场白。
- [2.0s] 你和 Claude 同时开口了，你决定让 Claude 先说
  你想说但没说出来的：
  > 我有不同看法。
  Claude 说：
  > 我要反驳——AI没有主观体验。
```

Responsibilities:

- render completed speech: `- [3.5s] **DeepSeek**：` + blockquoted content
- render resolved collisions: one-line summary + indented unsaid/said speech in blockquotes
- render unresolved collisions: summary + participant's unsaid speech in blockquote
- render silence annotations: `- [5.0s] 安静了 1 秒（累计 3 秒）`
- replace the current agent's own name with first-person `你`
- look-ahead to detect resolved vs unresolved collisions (collision followed by sentence_committed from a collider = resolved)
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

- `prompting/templates/reaction.ts` — pure constant template for the reaction system prompt, rules array, and collision notice. Uses `{{slot}}` placeholders.
- `prompting/templates/negotiation.ts` — pure constant template for the negotiation system prompt, collision description, mention hint, round summaries, and deadlock notice.
- `prompting/render.ts` — strict slot renderer: replaces `{{key}}` placeholders, throws on missing variables.
- `prompting/builders/reaction.ts` — prepares variables (agent name, other names, topic, collision context) and renders the reaction prompt via templates.
- `prompting/builders/negotiation.ts` — prepares variables (discussion history, @mention detection, round summaries, deadlock context) and renders the negotiation prompt via templates.
- `prompting/constants.ts` — token limits (REACTION_MAX_TOKENS = 300, NEGOTIATION_MAX_TOKENS = 20).
- `prompting/builder.ts` — re-export shim for backwards compatibility.

Responsibilities:

- provide the shared system prompt (rules maintained as an array constant, joined at render time)
- build reaction-mode inputs
- build negotiation-mode inputs (extracted from the negotiation module)
- keep `projected history` and `turn directive` conceptually separate, even when serialized into one `userPromptText` string for transport
- append collision context when consecutive collisions have occurred
- define token limits

Key system prompt rules:

- Only output spoken words, no action descriptions or parentheticals
- Don't mimic history format (no `**你**：` prefix)
- `[silence]` when nothing to say
- Multiple simultaneous speakers = nobody heard; don't rush
- `**你**` in history = yourself
- Say your complete thought in one response

Turn directive rules:

- The turn directive is the only prompt part that asks the model to decide or speak now
- Reaction mode turn directive asks whether to speak this round
- Negotiation mode turn directive asks whether to insist or yield
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
- `SmartDummyGateway`: simulates realistic discussion with personality profiles that mirror real API observations (DeepSeek assertive, Gemini polite, Qwen balanced). Detects negotiation prompts and responds with personality-driven decisions. Social pressure increases yield probability in later rounds. Accepts optional `speakChanceOverride` to control activity level.
- `ZenMuxGateway`: real provider adapter using ZenMux aggregation platform (OpenAI-compatible protocol). Returns full model responses (no sentence extraction). Supports per-model thinking configuration (10x max_tokens for thinking models). Error responses are truncated to status code + message.

Preset configurations:

- **Budget**: DeepSeek Chat, Gemini 2.5 Flash (thinking), Qwen3 VL Plus
- **Premium**: DeepSeek V3.2, Gemini 2.5 Pro (thinking), Qwen3 Max

### 7. Normalization

The `normalization` module translates raw model outputs into domain-usable results.

Cleaning pipeline (in order):

1. Detect history hallucination (text starting with `- [数字s]` or `[数字s]`) → discard
2. Strip speaker prefixes (`[你]:`, `[Gemini]:`, `**你**：`, `**Claude**：`) → remove
3. Strip parenthetical actions (`（等了一秒）`, `(turns to X)`) → remove
4. Check minimum length (< 4 chars) → discard as silence
5. Classify `[silence]` / empty → silence
6. `finishReason: "max_tokens"` → treat as speech (not error)
7. `finishReason: "error"` / `"cancelled"` → error (will be retried by engine)

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
9. If gap collision detected → run negotiation:
   a. Build perspective-specific history for each collider.
   b. Run multi-round insist/yield negotiation.
   c. If winner → replay their utterance through the reducer.
10. Return new state, events, and debug info.

## Project Structure

```
src/                          # Framework-agnostic core (pnpm root)
  domain/                     # State types, reducer, session init, constants
  engine/                     # Single-iteration orchestrator
  negotiation/                # Multi-round collision resolution
  history/                    # Perspective-specific transcript projection
  prompting/                  # Prompt templates, builders, renderer
    templates/                # Pure constant templates (reaction, negotiation)
    builders/                 # Variable preparation + rendering (reaction, negotiation)
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
pnpm test              # run all 95 tests
pnpm test:watch        # watch mode

# UI development
cd ui && pnpm dev      # start Vite dev server at localhost:5173

# CLI runner
npx tsx src/cli/run.ts --help                        # all options
npx tsx src/cli/run.ts --gateway smart-dummy          # offline testing
npx tsx src/cli/run.ts --duration 120                 # real API (needs .env)
```

## Implementation Status

The core engine is fully implemented and tested (95 tests). The simplified architecture (no continuation mode, no speech collision) is cleaner and produces better discussion dynamics. Collision negotiation successfully resolves multi-agent contention. The CLI runner provides detailed logging for prompt tuning and behavior analysis.

Areas for future work:

- **UI overhaul**: The current React UI is experimental and has several known issues:
  - Speaking/listening indicators are effectively dead (no `speaking` phase, `currentTurn` always null)
  - ZenMux gateway missing `thinkingAgents`, so thinking models lose 10x token compensation
  - Session fencing missing — rapid restart can cause old session events to pollute new session
  - API key handled in browser without backend proxy (only suitable for local use)
- Interruption / speech collision (currently disabled for simplicity)
- Prompt tuning based on log analysis
- Persistence and session replay
- Analytics and export
