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
- retry failed agents individually (keep successful results)
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

The `history` module converts canonical events into perspective-specific transcript text.

Responsibilities:

- render completed speech with timestamps: `[3.5s] [DeepSeek]: 我觉得...`
- render resolved collisions: `[1.7s] 你和 Gemini 同时开口了，Gemini 决定让你先说`
- render unresolved collisions (all yielded): `[1.7s] 你和 Gemini 同时开口了，你想说的是「...」，但声音重叠，没有人听清`
- render silence annotations with timestamps
- replace the current agent's own name with first-person `你`
- look-ahead to detect resolved vs unresolved collisions (collision followed by sentence_committed from a collider = resolved)

### 5. Prompting

The `prompting` module converts projected history into gateway-ready call inputs.

Responsibilities:

- provide the shared system prompt (with line-break-separated rules)
- build reaction-mode inputs (the only mode now)
- append collision context when consecutive collisions have occurred
- define token limits (REACTION_MAX_TOKENS = 300)

Key system prompt rules:

- Only output spoken words, no action descriptions or parentheticals
- Don't mimic history format (no `[你]:` prefix)
- `[silence]` when nothing to say
- Multiple simultaneous speakers = nobody heard; don't rush
- `[你]` in history = yourself
- Say your complete thought in one response

### 6. Model Gateway

The `model-gateway` module is the only abstraction the engine uses to call models.

Four implementations:

- `DummyGateway`: fully controllable via a response function, used in unit tests.
- `SmartDummyGateway`: simulates realistic discussion with personality profiles (speak chance, insist chance per agent). Detects negotiation prompts and responds with personality-driven decisions. Social pressure increases yield probability in later rounds.
- `ZenMuxGateway`: real provider adapter using ZenMux aggregation platform (OpenAI-compatible protocol). Returns full model responses (no sentence extraction). Supports per-model thinking configuration (10x max_tokens for thinking models). Error responses are truncated to status code + message.

Preset configurations:

- **Budget**: DeepSeek Chat, Gemini 2.5 Flash (thinking), Qwen3 VL Plus
- **Premium**: DeepSeek V3.2, Gemini 2.5 Pro (thinking), Qwen3 Max

### 7. Normalization

The `normalization` module translates raw model outputs into domain-usable results.

Cleaning pipeline (in order):

1. Detect history hallucination (text starting with `[数字s]`) → discard
2. Strip speaker prefixes (`[你]:`, `[Gemini]:`) → remove
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
- **Engine layer**: catches all gateway rejections. Retries failed agents once (keeps successful responses). Converts persistent errors to silence. Always returns `{ ok: true }` — the discussion proceeds regardless of individual agent failures.
- **Runner layer**: no longer handles `{ ok: false }` (engine always succeeds). Fatal errors (reducer throws) are caught and terminate the discussion.

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
5. Retry any failed agents individually.
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
  prompting/                  # System prompt, call input builders
  model-gateway/              # Gateway interface, dummy + smart-dummy + ZenMux
  normalization/              # Raw output → AgentOutput classification + cleaning
  runner/                     # Discussion loop driver
  cli/                        # CLI runner with logging

ui/                           # React application (separate pnpm project)
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
pnpm test              # run all 66 tests
pnpm test:watch        # watch mode

# UI development
cd ui && pnpm dev      # start Vite dev server at localhost:5173

# CLI runner
npx tsx src/cli/run.ts --help                        # all options
npx tsx src/cli/run.ts --gateway smart-dummy          # offline testing
npx tsx src/cli/run.ts --duration 120                 # real API (needs .env)
```

## Implementation Status

The core engine is fully implemented and tested (66 tests). The simplified architecture (no continuation mode, no speech collision) is cleaner and produces better discussion dynamics. Collision negotiation successfully resolves multi-agent contention. The CLI runner provides detailed logging for prompt tuning and behavior analysis.

Areas for future work:

- Interruption / speech collision (currently disabled for simplicity)
- Prompt tuning based on log analysis
- Persistence and session replay
- Analytics and export
