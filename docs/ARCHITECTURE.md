# Architecture

## Purpose

This document defines the implementation architecture for AI Roundtable.

- `docs/PRD.md` defines product behavior and user-facing rules.
- `docs/ARCHITECTURE.md` defines how the system must be structured in code.

If product behavior and implementation details conflict, product behavior in `docs/PRD.md` takes precedence. This document must then be updated to match.

## Scope

This document covers the non-UI core of the system:

- discussion state and rules
- iteration execution
- history projection
- prompt construction
- model gateway abstraction
- response normalization
- testing boundaries

This document does not yet define:

- concrete provider adapters
- visual design
- persistence
- export or analytics features

## Required Technology Choices

Only the minimum necessary technology decisions are fixed at this stage.

- Primary language: TypeScript
- Core implementation style: the non-UI core must be implemented as framework-agnostic TypeScript modules
- Product runtime target: browser-based application runtime
- Backend requirement: no backend is required by the current architecture
- Model integration boundary: all model calls must go through the `ModelGateway` interface

This document does not mandate a specific build tool, test runner, formatter, linter, or UI framework.

## Design Principles

The implementation must preserve the core intent of the PRD:

- One loop. The system runs as a single repeated iteration cycle.
- Sentence as atomic unit. One model call produces at most one sentence.
- Event log as source of truth. Rendered transcript text is derived, not primary state.
- Pure state transitions. Discussion rules must be implemented as pure domain logic.
- First-person history projection. Each agent sees a perspective-specific transcript.
- Provider isolation. Provider-specific protocol differences must not leak into domain logic.

## Core Invariants

The following invariants are mandatory:

1. Each iteration is committed atomically. Partial results must not mutate discussion state.
2. Domain state transitions are decided only by the domain reducer.
3. The current speaker, if any, is represented explicitly in state.
4. Continuation mode must use a frozen history snapshot from the moment the current speaker started speaking.
5. Collision, silence, and turn-gap are outcomes of the same loop, not separate mechanisms.
6. History shown to agents is always generated from canonical state and events.
7. Provider or gateway code must not decide collision, end-of-turn, silence backoff, or other business rules.

## Module Overview

### 1. Domain

The `domain` module owns the business model of a discussion.

Responsibilities:

- define `SessionState`, `CurrentTurn`, `DomainEvent`, and iteration result types
- define valid phase transitions
- advance virtual time
- apply silence backoff
- decide uninterrupted speech, collision, end-of-turn, and discussion end
- enforce invariants

Must not:

- perform network requests
- build prompts
- know provider names or API formats
- render transcript strings for models or UI

### 2. Engine

The `engine` module orchestrates one iteration of the loop.

Responsibilities:

- read current `SessionState`
- determine which agents need continuation or reaction mode
- request projected history for each agent
- build model call inputs
- execute all model calls concurrently
- normalize all responses
- commit the entire iteration through the domain reducer
- expose iteration-level debug information

Must not:

- contain business rules that belong in the domain reducer
- mutate state incrementally as individual model responses arrive

### 3. History Projector

The `history` module converts canonical state and events into perspective-specific transcript text.

Responsibilities:

- render completed speech
- render in-progress speech annotations
- render collision blocks
- render silence annotations
- replace the current agent's own name with first-person wording where required

Must not:

- store discussion state
- decide state transitions
- depend on provider-specific request formats

### 4. Prompting

The `prompting` module converts projected history into gateway-ready call inputs.

Responsibilities:

- provide the shared system prompt
- build reaction-mode inputs
- build continuation-mode inputs
- inject speaker self-awareness status text
- define stop sequences and token limits per calling mode

Must not:

- decide whether a response counts as silence or end-of-turn
- make network requests

### 5. Model Gateway

The `model-gateway` module is the only abstraction the engine uses to call models.

Responsibilities:

- accept provider-neutral call input
- return raw generated text plus minimal metadata
- support cancellation

Must not:

- contain discussion business rules
- render history
- know how to update discussion state

At this stage, a dummy implementation is sufficient.

### 6. Normalization

The `normalization` module translates raw model outputs into domain-usable results.

Responsibilities:

- trim and sanitize returned text
- classify `[silence]`
- detect empty continuation output
- preserve raw output for debug use

Must not:

- advance time
- decide collision or turn ownership

## Dependency Rules

Dependencies must flow in one direction:

```text
domain <- history <- prompting
domain <- normalization
engine -> domain
engine -> history
engine -> prompting
engine -> model-gateway
engine -> normalization
```

Interpretation:

- `domain` is the core and should remain the most stable module.
- `engine` may depend on all runtime-facing modules because it is the orchestrator.
- `prompting` depends on `history`: it receives projected transcript text from the history module and assembles it into gateway-ready call inputs. This is the intended data flow: `history` renders perspective-specific text, `prompting` wraps it into message structures.
- `history`, `normalization`, and `model-gateway` must not depend on each other unless explicitly required by their contracts.

## Core Data Model

The exact type definitions may evolve, but the architecture assumes the following conceptual model.

### SessionState

`SessionState` is the canonical state of one discussion session.

It should include at least:

- session identity
- topic
- participants
- current virtual time
- current phase
- current turn, if one exists
- silence backoff state
- canonical event log
- discussion end status

### CurrentTurn

`CurrentTurn` represents an active speaker's ongoing turn.

It should include at least:

- speaker identity
- virtual start time
- frozen history snapshot from turn start
- sentences spoken so far in this turn
- cumulative speaking duration for the turn
- sentence count

### DomainEvent

`DomainEvent` is an immutable fact emitted by the reducer.

Expected event kinds include:

- discussion started
- sentence committed
- collision occurred
- turn ended
- silence extended
- discussion ended

### IterationResult

`IterationResult` represents the normalized outputs from all agents for one loop iteration.

It should include:

- iteration identity (a monotonically increasing integer, starting at 0)
- one normalized result per agent
- timing and debug metadata

## Iteration Lifecycle

One iteration must execute in the following order:

1. Read the current `SessionState`.
2. Determine each agent's call mode from state.
3. Project transcript history for each agent.
4. Build one provider-neutral model call input per agent.
5. Execute all model calls concurrently.
6. Normalize all raw responses.
7. Commit the entire iteration by calling the domain reducer once.
8. Store the new state and emitted events.

This sequence is mandatory. No state mutation may happen between steps 5 and 7 based on individual early responses.

## Domain Reducer

The domain reducer is the only authority for state transitions.

Conceptually:

```ts
type ReduceIteration = (
  state: SessionState,
  result: IterationResult
) => {
  nextState: SessionState;
  events: DomainEvent[];
};
```

The reducer decides:

- whether a speaking sentence advances the current turn
- whether a continuation response ends a turn
- whether simultaneous speech creates a collision
- whether all-silence triggers backoff
- whether silence duration ends the discussion

The reducer must be pure:

- same input state + same iteration result -> same output
- no network
- no timers
- no random values
- no direct UI updates

## Model Gateway Contract

Provider details are intentionally out of scope for now. The engine should depend only on a dummy-compatible interface like this:

```ts
type CallMode = "reaction" | "continuation";

type ModelCallInput = {
  sessionId: string;
  iterationId: number;
  agentId: string;
  mode: CallMode;
  systemPrompt: string;
  historyText: string;
  assistantPrefill?: string;
  selfStatusText?: string;
  maxTokens: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
};

type ModelCallOutput = {
  agentId: string;
  text: string;
  finishReason:
    | "completed"
    | "stop_sequence"
    | "max_tokens"
    | "cancelled"
    | "error";
  latencyMs?: number;
  rawResponse?: unknown;
};

interface ModelGateway {
  generate(input: ModelCallInput): Promise<ModelCallOutput>;
}
```

This contract is intentionally narrow. It exists so the engine can be developed and tested before any concrete provider integration is designed.

## Failure Handling

Detailed provider policy is deferred, but the architecture must reserve a clear boundary for failures.

For now:

- gateway failures must surface as structured iteration results, not uncaught mutations
- the engine may decide retry or abort policy later
- the domain reducer must not interpret transport-layer errors

Until a concrete failure policy is written, error handling should favor explicit failure over silent fallback.

## Testing Strategy

Testing should be concentrated around stable boundaries.

### Domain Tests

The highest-value tests are reducer tests.

They should verify:

- uninterrupted continuation
- collision during speech
- collision at turn gap
- empty continuation ending a turn
- silence backoff progression
- discussion termination after cumulative silence threshold

### History Tests

History projection tests should verify:

- correct first-person substitution
- correct in-progress annotations
- correct collision rendering from different perspectives

### Engine Tests

Engine tests should verify:

- one iteration calls all agents
- iteration results are committed atomically
- individual early responses do not mutate state
- dummy gateway integration works in both reaction and continuation modes

### Contract Tests

When real providers are added later, they should be tested against the `ModelGateway` contract rather than against domain behavior directly.

## Out of Scope for This Version

The following are explicitly not defined here yet:

- concrete provider adapter shapes
- API key storage details beyond current PRD assumptions
- persistence or session replay storage format
- analytics pipeline
- export pipeline
- UI state management

These can be added later, but they must not violate the module boundaries defined above.

## Implementation Guidance

For the first implementation pass:

- keep the core runtime in TypeScript
- keep `domain` fully framework-agnostic
- start with a dummy `ModelGateway`
- make `engine` depend on pure modules and one side-effect boundary
- treat event log plus session state as the only canonical truth

If a proposed implementation makes it unclear which module owns a rule, the design is too entangled and should be simplified before coding.
