# Architecture

Implementation architecture for AI Roundtable. Source of truth for module boundaries, types, data flow, and algorithms. Conforms to `DESIGN.md`; when in conflict, `DESIGN.md` takes precedence.

---

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js ≥ 20, ESM modules
- **Dependencies**: minimal — LLM provider SDKs, no application framework
- **Test**: Vitest

---

## Project Structure

```
src/
  types.ts                  All shared type definitions
  config.ts                 SessionConfig schema, defaults, validation
  index.ts                  Entry point — create session, run loop, emit results

  core/
    discussion-loop.ts      Main iteration loop (orchestrator)
    collision.ts            4-tier collision resolution
    interruption.ts         Interruption detection, evaluation, negotiation
    dedup.ts                Verbatim deduplication check

  state/
    session.ts              SessionState creation and mutation helpers
    agent-state.ts          Per-agent state updates
    virtual-clock.ts        Virtual time accounting

  prompt/
    prompt-builder.ts       Top-level prompt assembly per mode
    system-prompts.ts       System prompt templates (5 modes)
    turn-directive.ts       Turn directive assembly per mode
    history-projector.ts    Perspective-specific history rendering with tiering
    hints.ts                Situational hint generation
    template.ts             {{key}} strict template engine

  llm/
    client.ts               Unified LLMClient interface
    providers/              Per-provider adapters (OpenAI-compatible, Anthropic, Google)
    retry.ts                Retry wrapper (3 attempts)

  normalize/
    index.ts                Mode-based normalization router
    json-extract.ts         JSON extraction from raw text (with code fence handling)
    utterance-clean.ts      Utterance cleaning pipeline
    reaction.ts             Reaction mode normalization
    negotiation.ts          Negotiation mode normalization
    voting.ts               Voting mode normalization
    judge.ts                Interruption judge mode normalization
    defense.ts              Interruption defense mode normalization

  util/
    token-count.ts          Token counting (configurable, default: character heuristic)
    sentence-split.ts       Sentence boundary splitting for interruption
    name-list.ts            Name list formatting ("A 和 B" / "A、B 和 C")
```

---

## Core Types

### Primitives

```typescript
type InsistenceLevel = "low" | "mid" | "high";
type PromptMode = "reaction" | "negotiation" | "voting" | "judge" | "defense";
type Tier = "recent" | "medium" | "old";
```

### Configuration

```typescript
interface AgentConfig {
  name: string;
  provider: string;       // "openai" | "anthropic" | "google" | etc.
  model: string;          // provider-specific model ID
  endpoint?: string;      // custom API endpoint (for OpenAI-compatible providers)
  apiKey?: string;        // falls back to environment variable if absent
  thinkingModel?: boolean; // if true, max_tokens multiplied by 10 for reasoning overhead
}

interface SessionConfig {
  topic: string;
  agents: AgentConfig[];              // 2+ agents required
  recentTierSize: number;             // default 3  — last N turns at full detail
  mediumTierEnd: number;              // default 8  — turns 4..N at medium detail
  silenceTimeout: number;             // default 60 — seconds, end discussion
  silenceBackoffCap: number;           // default 16 — max seconds per silence interval
  maxDuration: number | null;         // default null — optional virtual-time cap
  interruptionThreshold: number;      // default 80 — tokens, triggers split attempt
  tokenTimeCost: number;              // default 0.1 — seconds per token
  collisionTimeCost: number;          // default 0.5 — seconds per collider
  maxNegotiationRounds: number;       // default 3
  apiRetries: number;                 // default 3
  tokenCounter?: (text: string) => number;  // pluggable; default provided
}
```

### Turn Records (Event Log)

The event log is an ordered array of `TurnRecord`. Turn 0 is always `DiscussionStartedRecord`. Each subsequent loop iteration appends one record.

**Timestamp semantics**: `virtualTime` on every record is the virtual clock value **at the start of the event**, before the event's own time cost is added. The clock advances after the record is appended. This means `[5.0s] 安静了 1 秒` reads as "at t=5.0s, a 1-second silence began" — the next event starts at t=6.0s.

```typescript
type TurnRecord = DiscussionStartedRecord | SilenceRecord | SpeechRecord;

interface DiscussionStartedRecord {
  type: "discussion_started";
  turn: 0;
  virtualTime: 0;
  topic: string;
}

interface SilenceRecord {
  type: "silence";
  turn: number;
  virtualTime: number;    // timestamp when silence begins
  duration: number;       // backoff interval for this round (1, 2, 4, ...)
  accumulated: number;    // total silence in current streak including this round
}

interface SpeechRecord {
  type: "speech";
  turn: number;
  virtualTime: number;    // timestamp when event begins
  speaker: string;
  utterance: string;      // full intended utterance
  insistence: InsistenceLevel;
  collision: CollisionInfo | null;
  interruption: InterruptionInfo | null;
}
```

### Collision Types

```typescript
interface CollisionInfo {
  colliders: ColliderEntry[];       // all agents who tried to speak (including winner)
  winner: string;
  winnerInsistence: InsistenceLevel; // effective insistence at resolution time (may differ from reaction-time insistence after Tier 2 negotiation)
  resolutionTier: 1 | 2 | 3 | 4;
  votes: VoteEntry[];               // populated only for tier 3; empty otherwise
}

interface ColliderEntry {
  agent: string;
  utterance: string;
  insistence: InsistenceLevel;
}

interface VoteEntry {
  voter: string;
  votedFor: string;
}
```

### Interruption Types

```typescript
interface InterruptionInfo {
  interrupter: string;
  urgency: InsistenceLevel;
  reason: string | null;
  spokenPart: string;
  unspokenPart: string;
  success: boolean;
}
```

### Thought Log

Append-only record of all thought updates across the session. Each API call that returns a thought (string or null) produces an entry. This is the persistent log that DESIGN.md requires ("thought is recorded in logs").

```typescript
interface ThoughtEntry {
  turn: number;
  agent: string;
  mode: PromptMode;
  thought: string | null;   // the raw value returned: string = new thought, null = unchanged
}
```

### Agent State

Mutable per-agent state, updated each turn.

```typescript
interface AgentState {
  name: string;
  config: AgentConfig;
  currentThought: string | null;    // inner monologue; null = no thought yet
  consecutiveCollisionLosses: number;
  interruptedCount: number;          // times this agent has been interrupted
  lastSpokeTurn: number | null;      // turn number when last spoke (as delivered speaker)
}
```

### Session State

Top-level mutable state for a running discussion.

```typescript
interface SessionState {
  config: SessionConfig;
  agents: AgentState[];
  log: TurnRecord[];                 // append-only event log
  thoughtLog: ThoughtEntry[];        // append-only thought trace (all API calls)
  currentTurn: number;               // turn being processed (starts at 1)
  virtualTime: number;               // running clock
  silenceBackoffStep: number;        // exponent: interval = min(2**step, cap) — capped at 16s by default per DESIGN.md
  silenceAccumulated: number;        // total silence in current streak (seconds)
  floorHolder: string | null;        // agent with floor priority from successful interruption
  lastSpeaker: string | null;        // last agent who delivered speech
  endReason: string | null;          // null while running
  collisionStreak: number;          // consecutive turns with collision (for collision notice)
  collisionStreakColliders: string[];// agents who collided in all rounds of current streak
  stopRequested: boolean;           // set by requestStop(); checked by shouldEnd()
}
```

### Prompt Types

```typescript
interface PromptSet {
  systemPrompt: string;
  userPrompt: string;     // projectedHistory + "\n\n" + turnDirective (or just turnDirective if history empty)
  maxTokens: number;
}
```

### LLM Types

```typescript
interface ChatRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

interface LLMClient {
  chat(request: ChatRequest): Promise<string>;
}
```

### Normalization Result Types

```typescript
interface ReactionResult {
  utterance: string | null;
  insistence: InsistenceLevel;
  thought: string | null;
}

interface NegotiationResult {
  insistence: InsistenceLevel;
  thought: string | null;
}

interface VotingResult {
  vote: string | null;          // candidate name or null if invalid
  thought: string | null;
}

interface JudgeResult {
  interrupt: boolean;
  urgency: InsistenceLevel;
  reason: string | null;
  thought: string | null;
}

interface DefenseResult {
  yield: boolean;
  thought: string | null;
}
```

---

## Session Lifecycle

### Initialization (`session.ts`)

`createSession(config: SessionConfig): SessionState`

1. Validate config (via `validateConfig`, also exported for standalone use). `validateConfig` is pure — it does not mutate the config. String fields are validated using `.trim()` but the original values are unchanged. Normalization (trimming) only happens in `buildConfig`, which operates on its own copy.
   - ≥ 2 agents, unique names (after trim), required string fields non-empty (after trim)
   - Integer fields (`recentTierSize`, `mediumTierEnd`, `maxNegotiationRounds`, `apiRetries`) must be finite integers
   - `recentTierSize >= 1`
   - `mediumTierEnd >= recentTierSize`
   - `silenceTimeout > 0`, `silenceBackoffCap > 0` (finite)
   - `tokenTimeCost > 0`, `collisionTimeCost > 0` (finite)
   - `interruptionThreshold > 0` (finite)
   - `maxNegotiationRounds >= 1`, `apiRetries >= 0`
2. Create `AgentState` for each agent (all counters at zero, thought null)
3. Append `DiscussionStartedRecord` as turn 0
4. Return `SessionState` with `currentTurn: 1`, `virtualTime: 0`

### State Mutations

All state mutations go through helper functions in `session.ts` and `agent-state.ts`. The discussion loop never mutates state directly — it calls these helpers:

- `appendTurnRecord(session, record)` — push to log, advance virtualTime by `computeTurnTimeCost(record)` (turn counter is owned by the loop, not this function)
- `advanceVirtualTime(session, seconds)` — add to virtualTime
- `resetSilenceStreak(session)` — reset silenceBackoffStep and silenceAccumulated to 0
- `recordThought(session, turn, agent, mode, thought, observer?)` — append to `thoughtLog`, call `updateThought(agent, thought)`, and call `observer?.onThoughtUpdate(agent, thought)` if thought is non-null
- `requestStop(session)` — set `session.stopRequested = true`; the loop ends cleanly after the current turn
- `updateThought(agent, thought)` — if string, replace; if null, keep
- `recordCollisionLoss(agent)` — increment consecutiveCollisionLosses
- `resetCollisionLosses(agent)` — set to 0
- `updateCollisionStreak(session, colliderNames: string[])` — increment `collisionStreak`; if streak was 0 (first collision), **seed** `collisionStreakColliders` with `colliderNames`; otherwise **intersect** with `colliderNames`
- `resetCollisionStreak(session)` — set `collisionStreak` to 0, clear `collisionStreakColliders`
- `recordInterrupted(agent)` — increment interruptedCount
- `setLastSpoke(agent, turn)` — update lastSpokeTurn
- `setFloorHolder(session, name | null)` — set or clear floor priority
- `setLastSpeaker(session, name)` — set last speaker (called in `handleSpeech`)
- `clearLastSpeaker(session)` — set lastSpeaker to null (called at the start of each turn after reading it, so the skip lasts exactly one round)

### Virtual Time Advancement (`virtual-clock.ts`)

`computeTurnTimeCost(record: SpeechRecord | SilenceRecord, config: SessionConfig): number`

Rules from DESIGN.md:
- **Silence**: the backoff interval itself (`record.duration`)
- **Speech** (with or without collision): `tokenCount(deliveredText) * tokenTimeCost`
- **Interrupted speech (success)**: speech time uses `tokenCount(spokenPart)`, not full utterance
- **Interrupted speech (fail)**: speech time uses full utterance
- **Interruption evaluation**: zero cost
- **Collision time**: charged separately by the discussion loop in `handleCollision` before calling `handleSpeech` — NOT included in `computeTurnTimeCost` to avoid double-counting

`deliveredText` is determined by:
```
if record.interruption?.success → record.interruption.spokenPart
else → record.utterance
```

---

## Discussion Loop

### Main Loop (`discussion-loop.ts`)

`runDiscussion(session: SessionState, clients: Map<string, LLMClient>, observer?: SessionObserver): Promise<void>`

The loop runs iterations until an end condition is met. The optional `observer` receives callbacks at key points for real-time output (see Observer section). Fatal errors call `observer.onSessionEnd` before stopping.

**One iteration** (pseudocode):

```
function runOneTurn(session, clients):

  // 0. Check end conditions
  if shouldEnd(session) → set endReason, return

  // 1. Determine eligible agents for reaction polling
  //    lastSpeaker is consumed here and cleared — the skip lasts exactly one round
  eligible = session.agents
    .filter(a => a.name !== session.lastSpeaker)   // last speaker sits out
  clearLastSpeaker(session)

  // 2. Poll all eligible agents (reaction mode, parallel)
  reactions: Map<string, ReactionResult> = await pollReactions(eligible, session, clients)

  // 3. Apply verbatim dedup
  for each (agent, result) in reactions:
    if result.utterance !== null AND isDuplicate(result.utterance, session.log):
      result.utterance = null

  // 4. Record thoughts for ALL polled agents (even if utterance discarded)
  for each (agent, result) in reactions:
    recordThought(session, session.currentTurn, agent.name, "reaction", result.thought)

  // 5. Collect speakers (utterance !== null)
  speakers = reactions entries where utterance !== null

  // 6. Floor holder logic
  if session.floorHolder !== null:
    floorAgent = speakers.find(s => s.name === session.floorHolder)
    setFloorHolder(session, null)
    if floorAgent exists:
      speakers = [floorAgent]        // only floor holder's speech counts
    else:
      speakers = []                  // floor holder was silent → silence round

  // 7. Branch on speaker count
  if speakers.length === 0:
    handleSilence(session)
  else if speakers.length === 1:
    await handleSpeech(session, clients, speakers[0], null)
  else:
    await handleCollision(session, clients, speakers)

  // 8. Advance turn counter
  session.currentTurn++
```

### Silence Handling

```
function handleSilence(session):
  resetCollisionStreak(session)        // silence breaks collision streak
  duration = min(2 ** session.silenceBackoffStep, config.silenceBackoffCap)   // capped at 16s by default
  session.silenceAccumulated += duration
  record = SilenceRecord { duration, accumulated: session.silenceAccumulated, ... }
  appendTurnRecord(session, record)
  session.silenceBackoffStep++
```

### Speech Handling

```
function handleSpeech(session, clients, speaker, collisionInfo, overrideTimestamp?):
  // overrideTimestamp is passed by handleCollision to preserve the pre-collision timestamp
  resetSilenceStreak(session)
  resetCollisionLosses(speaker.agent)
  if collisionInfo === null:
    resetCollisionStreak(session)      // only reset on non-collision speech

  // Determine effective insistence for interruption auto-resolution:
  // - Solo speech: use reaction insistence
  // - Collision winner: use collisionInfo.winnerInsistence (may differ after Tier 2)
  effectiveInsistence = collisionInfo?.winnerInsistence ?? speaker.insistence

  // Check interruption
  interruption = null
  if tokenCount(speaker.utterance) > config.interruptionThreshold:
    interruption = await evaluateInterruption(session, clients, speaker, effectiveInsistence)

  record = SpeechRecord {
    speaker: speaker.name,
    utterance: speaker.utterance,
    insistence: speaker.insistence,
    collision: collisionInfo,
    interruption,
    virtualTime: overrideTimestamp ?? session.virtualTime,
    ...
  }
  appendTurnRecord(session, record)
  setLastSpeaker(session, speaker.name)
  setLastSpoke(speaker.agent, session.currentTurn)

  if interruption?.success:
    setFloorHolder(session, interruption.interrupter)
    recordInterrupted(speaker.agent)
```

### Collision Handling

```
function handleCollision(session, clients, speakers):
  // Snapshot the turn timestamp before any time advances — the SpeechRecord
  // should record the moment the collision began, not the post-collision time
  turnTimestamp = session.virtualTime

  // Snapshot original reaction insistence before negotiation mutates speakers
  originalInsistence = Map(speakers → [name, insistence])

  collisionInfo = await resolveCollision(session, clients, speakers)
  winner = speakers.find(s => s.name === collisionInfo.winner)

  // Restore original reaction insistence so SpeechRecord captures the pre-negotiation value
  winner.insistence = originalInsistence.get(winner.name)

  // Update losers
  for each loser in speakers where name !== winner.name:
    recordCollisionLoss(loser.agent)

  // Update collision streak
  updateCollisionStreak(session, speakers.map(s => s.name))

  // Advance virtual time for collision itself (speech time is charged separately in appendTurnRecord)
  advanceVirtualTime(session, speakers.length * config.collisionTimeCost)

  await handleSpeech(session, clients, winner, collisionInfo, turnTimestamp)
```

### End Conditions

`shouldEnd(session): string | null` — returns reason or null.

Checked at the **start** of each iteration:

1. `session.stopRequested === true` → `"manual_stop"`
2. `session.silenceAccumulated > config.silenceTimeout` → `"silence_timeout"`
3. `config.maxDuration !== null AND session.virtualTime > config.maxDuration` → `"duration_limit"`

Fatal errors during the loop set `endReason` to `"fatal_error"`.

### Verbatim Deduplication (`dedup.ts`)

`isDuplicate(utterance: string, log: TurnRecord[]): boolean`

Compares `utterance.trim()` against all previous utterances:
- Every `SpeechRecord.utterance` (the delivered speaker's full text)
- Every `ColliderEntry.utterance` in collision records (losers' intended text)

Exact string match after trimming. Returns true if any match found.

### Collision Streak Tracking

The session tracks consecutive collision turns for the collision notice hint:
- `collisionStreak`: increments each turn a collision occurs; resets to 0 on non-collision turns (silence or solo speech)
- `collisionStreakColliders`: agents who appeared in EVERY collision in the current streak. On the first collision in a new streak, seeded with the current collider names. On subsequent collisions, intersected with the current collider names. This means only agents who collided in every single round of the streak are included.

---

## Collision Resolution (`collision.ts`)

`resolveCollision(session, clients, speakers): Promise<CollisionInfo>`

Input: array of `{ agent, utterance, insistence }` from reaction results (2+ entries).

### Tier 1 — Insistence Comparison (zero calls)

1. Group speakers by insistence: high > mid > low
2. If exactly one speaker at the highest level → that speaker wins
3. Otherwise → proceed to Tier 2 with tied-highest candidates

### Tier 2 — Negotiation (max 3 rounds)

Candidates = tied-highest from Tier 1. Runs up to `config.maxNegotiationRounds` rounds.

**Each round**:
1. Build negotiation prompts for all candidates (includes round history)
2. Call LLM in parallel for all candidates
3. Normalize responses → `NegotiationResult` per candidate
4. Update thoughts
5. Compare insistence levels:
   - Exactly one at highest level → wins immediately
   - All declare `low` → reset all back to candidate pool (no elimination), continue
   - Otherwise → eliminate candidates at the lowest level; remaining continue

If no winner after max rounds → proceed to Tier 3.

### Tier 3 — Bystander Voting

Voters = all agents NOT in the collision (including the last speaker who sat out of reaction).

If no voters available (all agents are colliders) → skip to Tier 4.

1. Build voting prompts for all voters, candidates = remaining Tier 2 candidates
2. Call LLM in parallel
3. Normalize responses → `VotingResult` per voter
4. Update thoughts
5. Tally valid votes (votes matching a candidate name)
6. Candidate with most votes wins. On tie or zero valid votes → Tier 4.

### Tier 4 — Random

Select uniformly at random from remaining candidates. Guarantees convergence.

### Return Value

```typescript
CollisionInfo {
  colliders: [all original speakers with their utterances and insistence],
  winner: winnerName,
  winnerInsistence: insistence at resolution time,  // Tier 1: reaction insistence; Tier 2: final negotiation insistence; Tier 3/4: last known insistence
  resolutionTier: tier that resolved it (1–4),
  votes: [voter records] // only for tier 3, empty otherwise
}
```

---

## Interruption (`interruption.ts`)

### Sentence Splitting (`util/sentence-split.ts`)

`splitUtterance(text: string, threshold: number, tokenCount: fn): { spokenPart: string, unspokenPart: string } | null`

1. Find all sentence boundary positions. A boundary is immediately after one of: `。`, `！`, `？`, `!`, `?`, `.` (when followed by space or end of string, to avoid splitting decimals)
2. Walk boundaries from start; find the **last** boundary where `tokenCount(text[0..boundary]) <= threshold`
3. If no valid boundary found → return `null` (no split possible)
4. Return `{ spokenPart: text[0..boundary], unspokenPart: text[boundary..end] }`

### Evaluation Flow

`evaluateInterruption(session, clients, speaker, effectiveInsistence: InsistenceLevel): Promise<InterruptionInfo | null>`

1. Attempt split: `splitUtterance(speaker.utterance, config.interruptionThreshold, tokenCount)`
2. If split is null → return null (no interruption possible)
3. Determine listeners: all agents except the speaker (including last-speaker who sat out reaction — they still participate in interruption judging per DESIGN.md)
4. Build interruption judge prompts for all listeners (spoken part only)
5. Call LLM in parallel
6. Normalize responses → `JudgeResult` per listener
7. Update thoughts for all listeners
8. Filter for `interrupt: true`; if none → return null
9. Select representative: highest urgency among interrupters; ties broken randomly

### Negotiation

**Phase 1 — Auto-resolution** (zero additional calls):

Speaker's effective insistence is passed in by the caller: reaction-time insistence for solo speech, or `CollisionInfo.winnerInsistence` for collision winners (which reflects the final Tier 2 negotiation insistence if applicable). Compare:
- Representative urgency > effective insistence → success
- Representative urgency < effective insistence → fail
- Equal → Phase 2

Insistence ordering: `low < mid < high`.

**Phase 2 — Speaker defense** (one call):

1. Build defense prompt for speaker (includes spokenPart, unspokenPart, interrupter name, reason)
2. Call LLM
3. Normalize → `DefenseResult`
4. Update speaker's thought
5. `yield: true` → success; `yield: false` → fail

### Return Value

```typescript
InterruptionInfo {
  interrupter: representative name,
  urgency: representative's urgency,
  reason: representative's reason,
  spokenPart,
  unspokenPart,
  success: boolean
}
```

---

## Prompt Assembly (`prompt/`)

### Overview

Every API call produces a `PromptSet { systemPrompt, userPrompt, maxTokens }`.

- `systemPrompt` → system message
- `userPrompt` → user message = projectedHistory + `"\n\n"` + turnDirective (history omitted if empty)
- `maxTokens` → per mode (reaction: 150, negotiation: 50, voting: 50, judge: 50, defense: 50). If `agent.config.thinkingModel` is true, the provider adapter multiplies the value by 10 to compensate for reasoning token overhead.

### Prompt Builder (`prompt-builder.ts`)

One public function per mode. Each composes: system prompt + projected history + turn directive.

```typescript
function buildReactionPrompt(agent: AgentState, session: SessionState): PromptSet
function buildNegotiationPrompt(agent: AgentState, session: SessionState, ctx: NegotiationContext): PromptSet
function buildVotingPrompt(agent: AgentState, session: SessionState, candidates: string[]): PromptSet
function buildJudgePrompt(agent: AgentState, session: SessionState, ctx: JudgeContext): PromptSet
function buildDefensePrompt(agent: AgentState, session: SessionState, ctx: DefenseContext): PromptSet
```

Context types:

```typescript
interface NegotiationContext {
  colliders: { name: string; utterance: string }[];
  thisAgentUtterance: string;
  previousRounds: { round: number; decisions: { agent: string; insistence: InsistenceLevel }[] }[];
}

interface JudgeContext {
  speakerName: string;
  spokenPart: string;
}

interface DefenseContext {
  spokenPart: string;
  unspokenPart: string;
  interrupterName: string;
  reason: string | null;
}
```

### System Prompts (`system-prompts.ts`)

Five template functions, one per mode. Templates are exactly as specified in DESIGN.md. Each takes the necessary variables and returns a rendered string via the template engine.

Template variables:
- **Reaction**: `agentName`, `otherNames`, `topic`, `rules` (rules are hardcoded, joined with newlines, each prefixed `- `)
- **Negotiation**: `agentName`, `topic`
- **Voting**: `agentName`, `topic`
- **Judge**: `agentName`, `topic`, `speakerName`
- **Defense**: `agentName`, `topic`, `interrupterName`

### History Projection (`history-projector.ts`)

`projectHistory(session: SessionState, viewer: string): string`

Renders the event log as a perspective-specific markdown transcript.

**Algorithm**:

1. Iterate `session.log` from oldest to newest
2. For each `TurnRecord`, determine its tier:
   - `discussion_started` → always rendered (tier irrelevant)
   - Others: `age = session.currentTurn - record.turn`. Recent: age ≤ `recentTierSize`. Medium: age ≤ `mediumTierEnd`. Old: age > `mediumTierEnd`.
3. Call the appropriate render function for the record type, tier, and viewer perspective
4. Concatenate all rendered lines with `"\n"` separator

**Render functions** — each returns a string (one or more markdown lines):

```typescript
function renderDiscussionStarted(record: DiscussionStartedRecord): string
function renderSilence(record: SilenceRecord, tier: Tier): string
function renderSpeech(record: SpeechRecord, viewer: string, tier: Tier): string
```

**Perspective rules**:

Name substitution throughout rendering:
- Speaker label position (before `：` or in `说：`, `说了一半：`): use `**你**` when viewer is that agent, else `**{name}**`
- Narrative text (descriptions, explanations): use `你` when viewer is that agent (no bold), else plain name
- Self-reference detection: based on exact string match of agent name

**Tier-specific rendering**:

Each record type renders differently at each tier. Below specifies the differences from the full (recent) format defined in DESIGN.md.

| Record type | Recent | Medium | Old |
|---|---|---|---|
| Speech (no collision, no interruption) | Full | Same | Same |
| Speech + collision (no interruption) | Full (yielder sees unsaid text) | Same but **omit** yielder's unsaid block | `- [{time}] 多人同时开口，{winner} 先说了` + speech |
| Speech + interruption (success, no collision) | Full (speaker sees unspoken part) | Same but **omit** speaker's unspoken block | `- [{time}] {speaker} 被 {interrupter} 打断了` + spoken part |
| Speech + interruption (fail, no collision) | Full (attempt shown) | Same | `- [{time}] {interrupter} 试图打断 {speaker} 未果` + full speech |
| Speech + collision + interruption (success) | Collision block (as above) with winner's speech replaced by interrupted version (spoken part only for non-speakers; speaker sees unspoken part) | Same but **omit** both yielder's unsaid block and speaker's unspoken block | `- [{time}] 多人同时开口，{winner} 先说了，随后被 {interrupter} 打断` + spoken part |
| Speech + collision + interruption (fail) | Collision block with full speech + failed attempt note | Same but **omit** yielder's unsaid block | `- [{time}] 多人同时开口，{winner} 先说了，{interrupter} 试图打断未果` + full speech |
| Silence | `安静了 N 秒（累计 M 秒）` | Same | `（安静了一阵）` |

### Turn Directive Assembly (`turn-directive.ts`)

One function per mode. Assembles the directive string following the exact order specified in DESIGN.md.

```typescript
function buildReactionDirective(agent: AgentState, session: SessionState): string
function buildNegotiationDirective(agent: AgentState, session: SessionState, ctx: NegotiationContext): string
function buildVotingDirective(agent: AgentState, session: SessionState, candidates: string[]): string
function buildJudgeDirective(agent: AgentState, session: SessionState, ctx: JudgeContext): string
function buildDefenseDirective(agent: AgentState, session: SessionState, ctx: DefenseContext): string
```

**Inner monologue line** (common to all modes):
- If `agent.currentThought !== null` → prepend `你目前的内心状态：{currentThought}\n`
- First round (no prior thought) → omit this line

**Defense directive — null reason handling**:

The DESIGN.md defense directive template includes `{{interrupterName}} 想打断你，理由是：「{{reason}}」`. Since `reason` can normalize to `null` (judge gave no reason), the defense directive builder must handle this **before** template rendering:
- If `reason !== null` → render with reason line: `{interrupterName} 想打断你，理由是：「{reason}」`
- If `reason === null` → render without reason: `{interrupterName} 想打断你。`

This is the only directive that requires conditional construction. The template engine itself remains strict (string-only variables); the conditional is handled in `buildDefenseDirective`.

### Situational Hints (`hints.ts`)

```typescript
function getMentionHint(agent: AgentState, session: SessionState, mode: "reaction" | "negotiation"): string | null
function getStarvationHint(agent: AgentState, mode: "reaction" | "negotiation"): string | null
function getInterruptionPressureHint(agent: AgentState): string | null
function getCollisionNotice(session: SessionState): string | null
```

**@Mention detection** (`getMentionHint`):

Scan the **delivered text visible to this agent** in the event log after the agent's `lastSpokeTurn` for the pattern `@{agentName}`. This intentionally operates on the raw event log (with visibility filtering), not on the tier-compressed projected history — a mention should trigger the hint even if the mentioning turn has since been compressed into old tier. The hint answers "has anyone addressed me since I last spoke?", which is independent of transcript detail level. Visible text means:
- `SpeechRecord.utterance` for normal speech or failed interruptions
- `InterruptionInfo.spokenPart` for successful interruptions (the unspoken part is private to the speaker and must NOT be scanned for other agents)
- `ColliderEntry.utterance` only if the viewer is that collider (losers' intended text is private)

Uses regex: `@{exactName}(?=\W|$)` where `exactName` is the agent's configured name. The word boundary ensures `@AgentName` does not match `@AgentName2`. Natural language mentions without `@` are not detected.

**Starvation hint**: triggered when `agent.consecutiveCollisionLosses >= 2`.

**Interruption pressure hint**: triggered when `agent.interruptedCount >= 1`.

**Collision notice**: triggered when `session.collisionStreak > 0`. Format includes `collisionStreakColliders` for the "每次都在抢话" clause.

### Template Engine (`template.ts`)

`renderTemplate(template: string, vars: Record<string, string>): string`

- Replaces all `{{key}}` occurrences with the corresponding value from `vars`
- Throws `TemplateError` if any placeholder has no matching key (strict — no defaults)
- Throws `TemplateError` if any key in `vars` is not found in the template (unused variable detection — optional, can be relaxed)

---

## Response Normalization (`normalize/`)

### JSON Extraction (`json-extract.ts`)

`extractJSON(raw: string): object | null`

1. Trim whitespace
2. If wrapped in markdown code fence (`` ```json ... ``` `` or `` ``` ... ``` ``), extract inner content
3. Find first `{` and last `}`, extract substring
4. Attempt `JSON.parse`
5. Return parsed object or null on failure

### Utterance Cleaning (`utterance-clean.ts`)

`cleanUtterance(text: string, agentNames: string[]): string | null`

Pipeline (applied in order; if any step produces null, return null):

1. **History hallucination check**: if text matches `/^-?\s*\[[\d.]+s\]/` → return null
2. **Strip speaker prefix**: remove leading patterns:
   - `[{name}]：` / `[{name}]:`
   - `{name}:` / `{name}：`
   - `**{name}**：` / `**{name}**:`
   - `{name} 说：` / `**{name}** 说：`
   - `**{name}** 说了一半：`
   - (Check against all agent names and `你`)
2b. **Re-check history hallucination** after prefix stripping (catches `**DeepSeek**：[2.5s] 说：...`)
3. **Strip parenthetical actions**: remove `（...）` and `(...)` patterns
4. **Trim** whitespace
5. **Minimum length**: if result length < 4 characters → return null

### Per-Mode Normalization

Each normalizer function takes the raw LLM response string and returns the mode-specific result type.

#### Reaction (`reaction.ts`)

`normalizeReaction(raw: string, agentNames: string[], previousUtterances: string[]): ReactionResult`

Follows DESIGN.md normalization rules exactly:

1. Empty/whitespace text → `{ utterance: null, insistence: "mid", thought: null }`
2. Attempt JSON extraction:
   - Success with `utterance` + `insistence` fields → use extracted values, extract `thought` (string → use; null/absent → null)
   - `insistence` not a valid `InsistenceLevel` → default `"mid"`
   - Failure or missing fields → `utterance = raw text`, `insistence = "mid"`, `thought = null`
3. Silence detection: `utterance` is `null`, `""`, `"[silence]"`, `"[沉默]"` → silence (thought preserved from step 2)
4. Apply `cleanUtterance` pipeline on utterance:
   - History hallucination detected (starts with `- [Ns]` or `[Ns]`) → silence **with `thought: null`** (no thought update, per DESIGN.md)
   - Other cleaning results in null → silence (thought preserved from step 2)
5. Final thought: if utterance survived cleaning, thought from step 2 is used as-is

#### Negotiation (`negotiation.ts`)

`normalizeNegotiation(raw: string): NegotiationResult`

1. Attempt JSON extraction → take `insistence`, `thought`
2. If JSON parsed successfully, extract `thought` (string → use; null/absent → null) and keep it regardless of insistence validity
3. Validate `insistence` is a valid `InsistenceLevel`; if not → fall through to keyword fallback (thought is preserved from step 2)
4. Keyword fallback on raw text: scan for "high"/"坚持", "mid"/"犹豫"/"中", "low"/"让步"/"让"
5. Default insistence: `"low"`; default thought: `null` (only if JSON extraction failed entirely)

#### Voting (`voting.ts`)

`normalizeVoting(raw: string, candidates: string[]): VotingResult`

1. Attempt JSON extraction → take `vote` (string), `thought`
2. `thought`: string → use; null/absent/non-string/unparseable → `null`
3. Fallback: `raw.trim()` as vote (thought defaults to `null`)
4. Match vote against candidate names (exact match); unrecognized → `vote: null`

#### Interruption Judge (`judge.ts`)

`normalizeJudge(raw: string): JudgeResult`

1. Attempt JSON extraction → take `interrupt`, `urgency`, `reason`, `thought`
2. `thought`: string → use; null/absent/non-string/unparseable → `null`
3. `interrupt` not boolean → `false`
4. `urgency` not valid InsistenceLevel → `"low"`
5. `reason` not string → `null`

#### Interruption Defense (`defense.ts`)

`normalizeDefense(raw: string): DefenseResult`

1. Attempt JSON extraction → take `yield`, `thought`
2. `thought`: string → use; null/absent/non-string/unparseable → `null`
3. `yield` not boolean → `true` (conservative: yield)

#### API Failure Fallback

All modes: after exhausting `config.apiRetries` retries:
- Reaction → `{ utterance: null, insistence: "mid", thought: null }` (silence)
- Negotiation → `{ insistence: "low", thought: null }` (yield)
- Voting → `{ vote: null, thought: null }` (discarded)
- Judge → `{ interrupt: false, urgency: "low", reason: null, thought: null }`
- Defense → `{ yield: true, thought: null }` (yield)

---

## LLM Client (`llm/`)

### Interface (`client.ts`)

```typescript
interface LLMClient {
  chat(request: ChatRequest): Promise<string>;
}

interface ChatRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}
```

Returns the raw text content of the model's response.

### Provider Abstraction (`providers/`)

Each provider adapter implements `LLMClient` and handles API-specific details:

- **OpenAI-compatible** (`openai.ts`): works with OpenAI, DeepSeek, Qwen, and any OpenAI-compatible endpoint. Uses chat completions API with `{ role: "system", content }` and `{ role: "user", content }`.
- **Anthropic** (`anthropic.ts`): uses Messages API with `system` parameter and `{ role: "user", content }`.
- **Google** (`google.ts`): uses Gemini API with `systemInstruction` and user content.

A factory function creates the appropriate client:

`createClient(config: AgentConfig): LLMClient`

### Retry Wrapper (`retry.ts`)

`withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T>`

Retries on network errors, rate limits (with backoff), API errors, and request cancellations (e.g., aborted connections, timeouts). After exhausting retries, throws `RetryExhaustedError`. The caller (discussion loop) catches this and applies mode-specific fallback.

---

## Token Counting (`util/token-count.ts`)

`createTokenCounter(custom?: (text: string) => number): (text: string) => number`

Default implementation: character-based heuristic suitable for Chinese-dominant text.

```
defaultTokenCount(text) = Math.ceil(text.length * 0.6)
```

This approximates the average tokenization ratio for Chinese text across common models. The function is pluggable via `SessionConfig.tokenCounter` for applications that need exact counting.

---

## Name List Formatting (`util/name-list.ts`)

`formatNameList(names: string[]): string`

- 1 name: `"A"`
- 2 names: `"A 和 B"`
- 3+ names: `"A、B 和 C"` (last joined with `和`, others with `、`)

---

## Observer Interface

For real-time output and logging, the discussion loop accepts an optional observer:

```typescript
interface SessionObserver {
  onTurnStart?(turn: number, virtualTime: number): void;
  onReactionResults?(results: Map<string, ReactionResult>): void;
  onCollisionStart?(colliders: string[]): void;
  onCollisionResolved?(info: CollisionInfo): void;
  onInterruptionAttempt?(speaker: string, interrupter: string): void;
  onTurnComplete?(record: TurnRecord): void;
  onThoughtUpdate?(agent: string, thought: string): void;
  onSessionEnd?(reason: string, session: SessionState): void;
}
```

All callbacks are optional. The loop calls them at the corresponding points. Implementations may write to console, file, WebSocket, etc.

---

## Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `topic` | string | (required) | Discussion topic |
| `agents` | AgentConfig[] | (required) | 2+ agents |
| `recentTierSize` | number | 3 | Turns in recent tier |
| `mediumTierEnd` | number | 8 | Last turn in medium tier |
| `silenceTimeout` | number | 60 | Seconds of accumulated silence to end discussion |
| `silenceBackoffCap` | number | 16 | Max seconds per silence interval (DESIGN.md: 1, 2, 4, 8, 16) |
| `maxDuration` | number \| null | null | Virtual time limit (seconds) |
| `interruptionThreshold` | number | 80 | Token count to trigger interruption split |
| `tokenTimeCost` | number | 0.1 | Seconds per token for speech |
| `collisionTimeCost` | number | 0.5 | Seconds per collider for collision |
| `maxNegotiationRounds` | number | 3 | Max rounds in Tier 2 collision |
| `apiRetries` | number | 3 | Retry attempts per API call |
| `tokenCounter` | function \| undefined | char heuristic | Custom token counting function |

---

## Error Handling

### Layer Strategy

| Layer | Error | Response |
|-------|-------|----------|
| LLM call | Network / rate limit / API error | Retry up to `apiRetries` times with exponential backoff |
| LLM call | All retries exhausted | Mode-specific fallback (see Normalization) |
| Normalization | Unparseable response | Mode-specific default (see Normalization) |
| Template | Missing variable | Throw `TemplateError` — programming error, must be fixed |
| Session | Invalid config | Throw on `createSession` — fail fast |
| Discussion loop | Unrecoverable error | Set `endReason = "fatal_error"`, call observer, stop loop |

### Invariants

- The event log is append-only; records are never modified or deleted
- Agent thought is always updated even when the agent's action is discarded (collision loser, floor holder override)
- Virtual time is monotonically non-decreasing
- Turn numbers are sequential (0, 1, 2, ...)
- `floorHolder` is consumed and cleared during the floor holder logic step (step 6 of `runOneTurn`), before branching on speaker count
