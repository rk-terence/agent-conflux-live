# Architecture

## Purpose

This document defines the implementation architecture for AI Roundtable. It is the source of truth for system design and module boundaries.

Related docs:
- `docs/PROMPTING.md` — complete prompting specification (prompt structure, history format, templates, normalization)
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
- **Starvation awareness**: if an agent has lost ≥ 2 consecutive collisions without speaking, both the reaction and negotiation prompts include a starvation hint informing the agent of the situation. The hint does not override the agent's choice — it only provides information so the agent can decide whether to adjust insistence
- **API retry in negotiation**: Tier 2 and Tier 3 API calls use a retry mechanism (max 2 retries with linear backoff) to handle transient provider failures. Cancellations are not retried. Exhausted retries fall back to the existing conservative default (`"low"` for insistence, invalid vote for voting)
- **Full discussion context**: each agent sees their perspective-specific history in negotiation and voting prompts
- **All rounds and votes logged**: every tier's decisions are recorded both in debug output and in `CollisionResolvedEvent` domain events
- **Guaranteed convergence**: Tier 4 is an unconditional termination point — collisions always resolve
- **`CollisionResolvedEvent`**: emitted by the engine after negotiation, before winner replay. Carries `winnerId`, `tier`, `negotiationRounds` (Tier 2 details), and `votes` (Tier 3 details). This event allows the full collision resolution story to be reconstructed from domain events alone

### 4. History Projector

> **Format specification**: `docs/PROMPTING.md` → "Projected History Format" section defines the exact rendering format, all event types, perspective variations, and tier-specific wording.

The `history` module converts canonical events into perspective-specific transcript text, formatted as a markdown list for LLM readability.

This module owns the **projected history** portion of the prompt only. It must not embed current-turn questions, behavior rules, or negotiation directives. Those belong to the prompting layer.

Implementation:

- Processes events sequentially with lookahead to detect resolved collisions (`collision → collision_resolved → sentence_committed` merged into a single list item; legacy path without `collision_resolved` also supported)
- Resolved collision event sequence: `CollisionEvent → CollisionResolvedEvent → SentenceCommittedEvent → TurnEndedEvent`
- Replaces the current agent's own name with first-person `你`
- Produces history reusable across prompt modes, without mode-specific directives

History projection contract:

- projected history is derived only from canonical events
- projected history is markdown-formatted transcript, not raw event JSON
- projected history may describe what just happened, including collisions
- projected history must not ask the model what to do next
- the boundary is strict: "what has happened so far" belongs here; "what should you do now" belongs to the turn directive

### 5. Prompting

> **Specification**: `docs/PROMPTING.md` — the authoritative reference for prompt structure, history projection format, all templates, hints, and normalization rules. This section covers implementation details.

The `prompting` module converts projected history into gateway-ready call inputs. It separates constant text (templates) from runtime variable preparation (builders).

Every agent call has three semantic parts: **system prompt** (role + rules), **projected history** (perspective-specific transcript), and **turn directive** (current instruction + hints). The boundary is strict: "what has happened" belongs to history; "what to do now" belongs to the turn directive.

Three prompt modes: **reaction** (speech decision), **negotiation** (insistence declaration), **voting** (bystander vote).

Structure:

- `prompting/templates/` — pure constant templates with `{{slot}}` placeholders for each mode
- `prompting/builders/` — runtime variable preparation and prompt assembly for each mode
- `prompting/render.ts` — strict slot renderer: replaces `{{key}}` placeholders via `/\{\{(\w+)\}\}/g`, throws on missing variables
- `prompting/compose.ts` — `composeUserPrompt()` joins projected history + `\n\n` + turn directive; if history is empty, returns turn directive only
- `prompting/mention-utils.ts` — `wasMentionedAfterLastSpeech()` detects `@AgentName` in projected history via string position comparison: finds last `@{name}` occurrence and compares against last `**你**：` or `你说：` position
- `prompting/constants.ts` — token limits (reaction: 250, negotiation: 30, voting: 30)
- `prompting/builder.ts` — re-export shim for backwards compatibility

Reaction builder (`builders/reaction.ts`):

- `ReactionParams` carries: sessionId, iterationId, agentId, agentName, allNames, topic, projectedHistory, collisionContext (streak + frequent colliders), consecutiveCollisionLosses, abortSignal
- `buildSystemPrompt()` renders the system template with agent name, other names (filtered), topic, and rules array (each prefixed with `- `)
- `buildTurnDirective()` assembles parts in order: mention hint → starvation hint → `---\n请用 JSON 格式回复。` → collision notice (if streak > 0)
- `buildReactionInput()` orchestrates: calls `wasMentionedAfterLastSpeech()` for mention hint, checks `consecutiveCollisionLosses >= 2` for starvation hint, composes final `ModelCallInput`

Negotiation builder (`builders/negotiation.ts`):

- `buildTurnDirective()` assembles parts in order: collision description (who collided + agent's utterance) → mention hint → starvation hint → previous round summaries (insistence labels: low→"让步", mid→"犹豫", high→"坚持", self→"你") → deadlock context → question
- `buildNegotiationInput()` accepts `consecutiveCollisionLosses` parameter threaded from engine via `starvationCounts` map

Voting builder (`builders/voting.ts`):

- Minimal: renders system template with voter name and topic, turn directive lists candidate names

Engine integration:

- `buildAgentCall()` in `engine.ts` computes both `collisionContext` (via `buildCollisionContext()`, walks recent collision streak) and `consecutiveCollisionLosses` (via `countConsecutiveCollisionLosses()`, walks events backward to last win/speech)
- Before calling `negotiateCollision()`, engine builds a `starvationCounts: Map<string, number>` for all collision candidates, passed through to `runNegotiationRound()` → `buildNegotiationInput()`

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

> **Rules specification**: `docs/PROMPTING.md` → "Response Normalization Rules" section defines what constitutes silence, how JSON is extracted, and the speech cleaning rules.

The `normalization` module translates raw model outputs into domain-usable results.

Implementation notes:

- `normalizeOutput()` dispatches by `CallMode`: reaction mode goes through `normalizeReaction()`, negotiation/voting modes are parsed directly by their respective modules
- `extractJson()` handles markdown code fences and locates the outermost `{ ... }` for JSON.parse
- `cleanSpeechText()` applies the cleaning pipeline (hallucination detection → prefix stripping → parenthetical removal → minimum length check)
- `finishReason: "error"` / `"cancelled"` → `type: "error"` (engine will retry then convert to silence)
- `finishReason: "max_tokens"` → treat as speech (not error)

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
- **Negotiation layer**: Tier 2 and Tier 3 API calls use `generateWithRetry` (max 2 retries, linear backoff). Exhausted retries produce error output that falls through to conservative parsing defaults.
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
  ARCHITECTURE.md             # This file — system design and implementation
  PROMPTING.md                # Prompt spec — wording, history format, normalization rules
  PROVIDER.md                 # Provider integration notes
  ROADMAP.md                  # Planned work and priorities
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

