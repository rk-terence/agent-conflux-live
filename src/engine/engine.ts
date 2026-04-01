import type { SessionState, DomainEvent, AgentIterationResult, IterationResult } from "../domain/types.js";
import { reduceIteration } from "../domain/reducer.js";
import { projectHistory } from "../history/projector.js";
import { buildReactionInput } from "../prompting/builder.js";
import type { CollisionContext } from "../prompting/builder.js";
import type { ModelGateway, ModelCallInput, ModelCallOutput } from "../model-gateway/types.js";
import { normalizeOutput } from "../normalization/normalize.js";
import type { NormalizedResult } from "../normalization/normalize.js";
import { negotiateCollision } from "../negotiation/negotiation.js";
import type { NegotiationOutcome, CollisionCandidate } from "../negotiation/negotiation.js";

// --- Public types ---

export type IterationDebugInfo = {
  readonly iterationId: number;
  readonly callInputs: readonly ModelCallInput[];
  readonly rawOutputs: readonly ModelCallOutput[];
  readonly normalizedResults: readonly NormalizedResult[];
  readonly wallClockMs: number;
  /** Present when a collision triggered negotiation */
  readonly negotiation?: NegotiationOutcome;
};

export type EngineIterationResult = {
  readonly nextState: SessionState;
  readonly events: readonly DomainEvent[];
  readonly debug: IterationDebugInfo;
};

export class EngineFatalError extends Error {
  readonly debug: IterationDebugInfo | null;
  constructor(message: string, debug: IterationDebugInfo | null) {
    super(message);
    this.name = "EngineFatalError";
    this.debug = debug;
  }
}

// --- Engine ---

export async function runIteration(
  state: SessionState,
  gateway: ModelGateway,
  abortSignal?: AbortSignal,
): Promise<EngineIterationResult> {
  if (state.phase === "ended" || state.phase === "idle") {
    throw new EngineFatalError(`Cannot run iteration in phase "${state.phase}".`, null);
  }

  const startMs = Date.now();
  const iterationId = state.iterationCount;
  const allNames = state.participants.map(p => p.name);

  // Who spoke last? They sit out this round to give others a chance.
  // If nobody else wants to speak, the silence system handles it.
  const lastSpeakerId = findLastSpeaker(state);

  // Build reaction-mode calls for participants (skip last speaker)
  const activeParticipants = state.participants.filter(p => p.agentId !== lastSpeakerId);
  const callInputs = activeParticipants.map(p =>
    buildAgentCall(state, p.agentId, p.name, allNames, iterationId, abortSignal),
  );

  // Execute all model calls concurrently
  let rawOutputs: ModelCallOutput[] = await Promise.all(
    callInputs.map(input =>
      gateway.generate(input).catch((err: unknown): ModelCallOutput => ({
        agentId: input.agentId,
        text: err instanceof Error ? err.message : String(err),
        finishReason: "error",
      })),
    ),
  );

  // Normalize all responses
  let normalizedResults = rawOutputs.map((output, i) =>
    normalizeOutput(output, callInputs[i].mode),
  );

  // Add the skipped speaker as silence so the reducer sees all participants
  if (lastSpeakerId) {
    normalizedResults = [
      ...normalizedResults,
      {
        agentId: lastSpeakerId,
        output: { type: "silence" as const },
        raw: { agentId: lastSpeakerId, text: "", finishReason: "completed" as const },
      },
    ];
  }

  // Retry failed agents individually (keep successful results).
  // Skip retry when ALL agents failed — likely a provider-wide outage.
  const errorAgentIds = normalizedResults
    .filter(r => r.output.type === "error")
    .map(r => r.agentId);

  if (errorAgentIds.length > 0 && errorAgentIds.length < callInputs.length) {
    const retryInputs = callInputs.filter(ci => errorAgentIds.includes(ci.agentId));
    const retryOutputs = await Promise.all(
      retryInputs.map(input =>
        gateway.generate(input).catch((err: unknown): ModelCallOutput => ({
          agentId: input.agentId,
          text: err instanceof Error ? err.message : String(err),
          finishReason: "error",
        })),
      ),
    );

    const retryNormalized = retryOutputs.map((output, i) =>
      normalizeOutput(output, retryInputs[i].mode),
    );

    const retryMap = new Map(retryNormalized.map(r => [r.agentId, r]));
    const retryOutputMap = new Map(retryOutputs.map(o => [o.agentId, o]));
    normalizedResults = normalizedResults.map(r =>
      retryMap.has(r.agentId) ? retryMap.get(r.agentId)! : r,
    );
    rawOutputs = rawOutputs.map(o =>
      retryOutputMap.has(o.agentId) ? retryOutputMap.get(o.agentId)! : o,
    );
  }

  const buildDebug = (): IterationDebugInfo => ({
    iterationId,
    callInputs,
    rawOutputs,
    normalizedResults,
    wallClockMs: Date.now() - startMs,
  });

  // Convert persistent errors to silence so the iteration can proceed
  normalizedResults = normalizedResults.map(r =>
    r.output.type === "error"
      ? { ...r, output: { type: "silence" as const } }
      : r,
  );

  // Deduplicate — if a model repeats something it already said, treat as silence
  const deduped = normalizedResults.map(r => {
    if (r.output.type !== "speech") return r;
    const text = (r.output as { text: string }).text;
    if (isRepeat(text, r.agentId, state)) {
      return { ...r, output: { type: "silence" as const } };
    }
    return r;
  });

  // Commit through the domain reducer
  const agentResults: AgentIterationResult[] = deduped.map(r => ({
    agentId: r.agentId,
    output: r.output as AgentIterationResult["output"],
  }));

  const iterationResult: IterationResult = {
    iterationId,
    results: agentResults,
  };

  let nextState: SessionState;
  let events: readonly DomainEvent[];
  try {
    const reduced = reduceIteration(state, iterationResult);
    nextState = reduced.nextState;
    events = reduced.events;
  } catch (err: unknown) {
    throw new EngineFatalError(
      `Reducer error: ${err instanceof Error ? err.message : String(err)}`,
      buildDebug(),
    );
  }

  // If a gap collision occurred, run negotiation to resolve who speaks
  const gapCollision = events.find(e => e.kind === "collision" && e.during === "gap");
  let negotiation: NegotiationOutcome | undefined;

  if (gapCollision && gapCollision.kind === "collision") {
    const nameMap = new Map(state.participants.map(p => [p.agentId, p.name]));
    const candidates: CollisionCandidate[] = gapCollision.utterances.map(u => ({
      agentId: u.agentId,
      agentName: nameMap.get(u.agentId) ?? u.agentId,
      utterance: u.text,
    }));

    // Build perspective-specific history for each candidate
    const perspectiveHistories = new Map<string, string>();
    for (const c of candidates) {
      perspectiveHistories.set(
        c.agentId,
        projectHistory({
          events: nextState.events,
          currentTurn: null,
          perspectiveAgentId: c.agentId,
          participants: state.participants,
        }),
      );
    }

    negotiation = await negotiateCollision(
      candidates,
      allNames,
      state.topic,
      perspectiveHistories,
      gateway,
      state.sessionId,
      iterationId,
      abortSignal,
    );

    // If negotiation produced a winner, replay their utterance through the reducer
    if (negotiation.winnerId) {
      const winnerUtterance = gapCollision.utterances.find(
        u => u.agentId === negotiation!.winnerId,
      );
      if (winnerUtterance) {
        const replayResults: AgentIterationResult[] = state.participants.map(p => ({
          agentId: p.agentId,
          output: p.agentId === negotiation!.winnerId
            ? { type: "speech" as const, text: winnerUtterance.text, tokenCount: winnerUtterance.tokenCount }
            : { type: "silence" as const },
        }));

        const replayIteration: IterationResult = {
          iterationId: iterationId + 1,
          results: replayResults,
        };

        try {
          const replayReduced = reduceIteration(nextState, replayIteration);
          nextState = replayReduced.nextState;
          events = [...events, ...replayReduced.events];
        } catch (err: unknown) {
          throw new EngineFatalError(
            `Reducer error (post-negotiation): ${err instanceof Error ? err.message : String(err)}`,
            buildDebug(),
          );
        }
      }
    }
  }

  return {
    nextState,
    events,
    debug: { ...buildDebug(), negotiation },
  };
}

// --- Internal helpers ---

function buildAgentCall(
  state: SessionState,
  agentId: string,
  agentName: string,
  allNames: string[],
  iterationId: number,
  abortSignal?: AbortSignal,
): ModelCallInput {
  const historyText = projectHistory({
    events: state.events,
    currentTurn: null,
    perspectiveAgentId: agentId,
    participants: state.participants,
  });

  const collisionContext = buildCollisionContext(state, agentId);

  return buildReactionInput({
    sessionId: state.sessionId,
    iterationId,
    agentId,
    agentName,
    allNames,
    topic: state.topic,
    historyText,
    collisionContext,
    abortSignal,
  });
}

function buildCollisionContext(
  state: SessionState,
  agentId: string,
): CollisionContext | undefined {
  const events = state.events;

  let streak = 0;
  const colliderCounts = new Map<string, number>();

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "collision") break;
    streak++;
    for (const u of e.utterances) {
      colliderCounts.set(u.agentId, (colliderCounts.get(u.agentId) ?? 0) + 1);
    }
  }

  if (streak === 0) return undefined;

  const nameMap = new Map(state.participants.map(p => [p.agentId, p.name]));

  const frequentColliders = [...colliderCounts.entries()]
    .filter(([id, count]) => id !== agentId && count >= streak)
    .map(([id]) => nameMap.get(id) ?? id);

  const otherNames = [...colliderCounts.keys()]
    .filter(id => id !== agentId)
    .map(id => nameMap.get(id) ?? id);

  return { streak, otherNames, frequentColliders };
}

/**
 * Find the agent who spoke most recently (last turn_ended).
 * They sit out the next round to give others a chance.
 * Returns null if nobody has spoken yet.
 */
function findLastSpeaker(state: SessionState): string | null {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.kind === "turn_ended") return e.speakerId;
  }
  return null;
}

/**
 * Check whether a speech output is a verbatim repeat of something
 * this agent has said before — across ALL turns.
 */
function isRepeat(text: string, agentId: string, state: SessionState): boolean {
  for (const e of state.events) {
    if (e.kind === "sentence_committed" && e.speakerId === agentId && e.sentence === text) {
      return true;
    }
    if (e.kind === "collision") {
      for (const u of e.utterances) {
        if (u.agentId === agentId && u.text === text) return true;
      }
    }
  }

  return false;
}
