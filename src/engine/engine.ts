import type { SessionState, DomainEvent, AgentIterationResult, IterationResult } from "../domain/types.js";
import { reduceIteration } from "../domain/reducer.js";
import { projectHistory } from "../history/projector.js";
import { buildReactionInput, buildContinuationInput } from "../prompting/builder.js";
import type { CollisionContext } from "../prompting/builder.js";
import type { ModelGateway, ModelCallInput, ModelCallOutput } from "../model-gateway/types.js";
import { normalizeOutput } from "../normalization/normalize.js";
import type { NormalizedResult } from "../normalization/normalize.js";

// --- Public types ---

export type IterationDebugInfo = {
  readonly iterationId: number;
  readonly callInputs: readonly ModelCallInput[];
  readonly rawOutputs: readonly ModelCallOutput[];
  readonly normalizedResults: readonly NormalizedResult[];
  readonly wallClockMs: number;
};

export type EngineIterationSuccess = {
  readonly ok: true;
  readonly nextState: SessionState;
  readonly events: readonly DomainEvent[];
  readonly debug: IterationDebugInfo;
};

export type EngineIterationFailure = {
  readonly ok: false;
  readonly errors: readonly EngineAgentError[];
  readonly debug: IterationDebugInfo;
};

export type EngineAgentError = {
  readonly agentId: string;
  readonly message: string;
};

export type EngineIterationResult = EngineIterationSuccess | EngineIterationFailure;

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

  // Step 2-4: Determine mode, project history, build call inputs
  const callInputs = state.participants.map(p => {
    if (state.phase === "speaking" && state.currentTurn!.speakerId === p.agentId) {
      return buildSpeakerCall(state, p.agentId, p.name, allNames, iterationId, abortSignal);
    }
    return buildListenerCall(state, p.agentId, p.name, allNames, iterationId, abortSignal);
  });

  // Step 5: Execute all model calls concurrently
  // Catch per-call rejections so we get complete debug info and structured errors.
  const rawOutputs: ModelCallOutput[] = await Promise.all(
    callInputs.map(input =>
      gateway.generate(input).catch((err: unknown): ModelCallOutput => ({
        agentId: input.agentId,
        text: err instanceof Error ? err.message : String(err),
        finishReason: "error",
      })),
    ),
  );

  // Step 6: Normalize all responses
  const normalizedResults = rawOutputs.map((output, i) =>
    normalizeOutput(output, callInputs[i].mode),
  );

  const buildDebug = (): IterationDebugInfo => ({
    iterationId,
    callInputs,
    rawOutputs,
    normalizedResults,
    wallClockMs: Date.now() - startMs,
  });

  // Engine's responsibility: errors must not reach the reducer
  const errorResults = normalizedResults.filter(r => r.output.type === "error");
  if (errorResults.length > 0) {
    return {
      ok: false,
      errors: errorResults.map(r => ({
        agentId: r.agentId,
        message: (r.output as { type: "error"; message: string }).message,
      })),
      debug: buildDebug(),
    };
  }

  // Step 7: Commit through the domain reducer
  const agentResults: AgentIterationResult[] = normalizedResults.map(r => ({
    agentId: r.agentId,
    output: r.output as AgentIterationResult["output"], // safe: errors filtered above
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

  return {
    ok: true,
    nextState,
    events,
    debug: buildDebug(),
  };
}

// --- Internal helpers ---

function buildSpeakerCall(
  state: SessionState,
  agentId: string,
  agentName: string,
  allNames: string[],
  iterationId: number,
  abortSignal?: AbortSignal,
): ModelCallInput {
  const turn = state.currentTurn!;

  // Use frozen history snapshot for continuation mode (architecture invariant 4)
  const frozenHistoryText = projectHistory({
    events: turn.frozenHistorySnapshot,
    currentTurn: null, // no in-progress speech in frozen snapshot
    perspectiveAgentId: agentId,
    participants: state.participants,
  });

  // Assistant prefill: all sentences spoken so far in this turn
  const assistantPrefill = turn.sentences.join("");

  return buildContinuationInput({
    sessionId: state.sessionId,
    iterationId,
    agentId,
    agentName,
    allNames,
    topic: state.topic,
    frozenHistoryText,
    assistantPrefill,
    speakingDurationSeconds: turn.speakingDuration,
    sentenceCount: turn.sentenceCount,
    abortSignal,
  });
}

function buildListenerCall(
  state: SessionState,
  agentId: string,
  agentName: string,
  allNames: string[],
  iterationId: number,
  abortSignal?: AbortSignal,
): ModelCallInput {
  // Full current history including in-progress speech
  const historyText = projectHistory({
    events: state.events,
    currentTurn: state.currentTurn,
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

  // Count consecutive collisions from the end of the event list
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

  // "Frequent colliders" = those who spoke in every collision of the streak
  const frequentColliders = [...colliderCounts.entries()]
    .filter(([id, count]) => id !== agentId && count >= streak)
    .map(([id]) => nameMap.get(id) ?? id);

  const otherNames = [...colliderCounts.keys()]
    .filter(id => id !== agentId)
    .map(id => nameMap.get(id) ?? id);

  return { streak, otherNames, frequentColliders };
}
