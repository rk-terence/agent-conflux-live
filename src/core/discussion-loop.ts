import { randomUUID } from "node:crypto";
import type {
  SessionState,
  LLMClient,
  SessionObserver,
  AgentState,
  ReactionResult,
  ReactionResultWithMeta,
  InsistenceLevel,
  CollisionInfo,
  SpeechRecord,
  SilenceRecord,
  PromptMode,
} from "../types.js";
import type { LogContext } from "../log-context.js";
import { buildReactionPrompt } from "../prompt/prompt-builder.js";
import { normalizeReaction } from "../normalize/reaction.js";
import { withRetry, RetryExhaustedError } from "../llm/retry.js";
import { isDuplicate } from "./dedup.js";
import { resolveCollision } from "./collision.js";
import { evaluateInterruption } from "./interruption.js";
import { createTokenCounter } from "../util/token-count.js";
import {
  appendTurnRecord,
  advanceVirtualTime,
  resetSilenceStreak,
  recordThought,
  updateCollisionStreak,
  resetCollisionStreak,
  setFloorHolder,
  setLastSpeaker,
  clearLastSpeaker,
} from "../state/session.js";
import {
  resetCollisionLosses,
  recordCollisionLoss,
  recordInterrupted,
  setLastSpoke,
} from "../state/agent-state.js";

interface Speaker {
  agent: AgentState;
  name: string;
  utterance: string;
  insistence: InsistenceLevel;
}

export async function runDiscussion(
  session: SessionState,
  clients: Map<string, LLMClient>,
  observer?: SessionObserver,
  logCtx?: LogContext,
): Promise<void> {
  try {
    while (true) {
      // 0. Check end conditions
      const endReason = shouldEnd(session);
      if (endReason) {
        session.endReason = endReason;
        observer?.onSessionEnd?.(endReason, session);
        return;
      }

      await runOneTurn(session, clients, observer, logCtx);
    }
  } catch (err) {
    session.endReason = "fatal_error";
    observer?.onSessionEnd?.("fatal_error", session);
    throw err;
  }
}

async function runOneTurn(
  session: SessionState,
  clients: Map<string, LLMClient>,
  observer?: SessionObserver,
  logCtx?: LogContext,
): Promise<void> {
  observer?.onTurnStart?.(session.currentTurn, session.virtualTime);

  // 1. Determine eligible agents (last speaker sits out)
  const eligible = session.agents.filter((a) => a.name !== session.lastSpeaker);
  clearLastSpeaker(session);

  // 2. Poll all eligible agents (reaction mode, parallel)
  const agentNames = session.agents.map((a) => a.name);
  const reactions = new Map<string, ReactionResult>();

  // Track per-agent call IDs and normalization metadata for filter logging
  const callIds = new Map<string, string>();
  const normMetas = new Map<string, ReactionResultWithMeta>();

  const reactionResults = await Promise.all(
    eligible.map(async (agent) => {
      const prompt = buildReactionPrompt(agent, session);
      const client = clients.get(agent.name)!;
      const callId = randomUUID();
      callIds.set(agent.name, callId);

      // Attach _meta for API hook logging
      const request = {
        ...prompt,
        _meta: {
          callId,
          turn: session.currentTurn,
          agent: agent.name,
          mode: "reaction" as PromptMode,
          attempt: 0,
          provider: agent.config.provider,
          history: prompt.history,
          directive: prompt.directive,
          historyChars: prompt.historyChars,
          directiveChars: prompt.directiveChars,
        },
      };

      let result: ReactionResultWithMeta;
      try {
        const raw = await withRetry(
          () => client.chat(request),
          session.config.apiRetries,
          (attempt) => { request._meta!.attempt = attempt; },
        );
        result = normalizeReaction(raw, agentNames);
      } catch (err) {
        if (err instanceof RetryExhaustedError) {
          result = {
            utterance: null, insistence: "mid", thought: null,
            _normMeta: { rawKind: "empty", jsonExtracted: false, fallbackPath: "default", truncationSuspected: false, thoughtType: "missing" },
            _cleanMeta: null,
          };
        } else {
          throw err;
        }
      }

      normMetas.set(agent.name, result);

      // Emit normalize_result
      observer?.onNormalizeResult?.({
        callId,
        turn: session.currentTurn,
        agent: agent.name,
        mode: "reaction",
        rawKind: result._normMeta.rawKind,
        jsonExtracted: result._normMeta.jsonExtracted,
        fallbackPath: result._normMeta.fallbackPath,
        truncationSuspected: result._normMeta.truncationSuspected,
        thoughtType: result._normMeta.thoughtType,
        payload: { utterance: result.utterance, insistence: result.insistence, thought: result.thought },
      });

      return { agent, result: result as ReactionResult };
    }),
  );

  for (const { agent, result } of reactionResults) {
    reactions.set(agent.name, result);
  }

  // 3. Verbatim dedup — with observability
  for (const [name, result] of reactions) {
    const callId = callIds.get(name) ?? "";
    const meta = normMetas.get(name);

    if (result.utterance !== null) {
      const dup = isDuplicate(result.utterance, session.log);

      // Emit utterance_filter_result for every agent that had a non-null utterance
      observer?.onUtteranceFilterResult?.({
        callId,
        turn: session.currentTurn,
        agent: name,
        mode: "reaction",
        originalUtterance: meta?._cleanMeta?.originalUtterance ?? result.utterance,
        cleanedUtterance: dup ? null : result.utterance,
        historyHallucination: false,
        speakerPrefixStripped: meta?._cleanMeta?.speakerPrefixStripped ?? false,
        actionStripped: meta?._cleanMeta?.actionStripped ?? false,
        silenceByLength: false,
        truncatedByMaxLength: meta?._cleanMeta?.truncatedByMaxLength ?? false,
        silenceTokenDetected: meta?._cleanMeta?.silenceTokenDetected ?? false,
        dedupDropped: dup,
      });

      if (dup) {
        result.utterance = null;
      }
    } else if (meta?._cleanMeta) {
      // Utterance was cleaned to null — emit filter result showing why
      observer?.onUtteranceFilterResult?.({
        callId,
        turn: session.currentTurn,
        agent: name,
        mode: "reaction",
        originalUtterance: meta._cleanMeta.originalUtterance ?? "",
        cleanedUtterance: null,
        historyHallucination: meta._cleanMeta.historyHallucination,
        speakerPrefixStripped: meta._cleanMeta.speakerPrefixStripped,
        actionStripped: meta._cleanMeta.actionStripped,
        silenceByLength: meta._cleanMeta.silenceByLength,
        truncatedByMaxLength: meta._cleanMeta.truncatedByMaxLength,
        silenceTokenDetected: meta._cleanMeta.silenceTokenDetected,
        dedupDropped: false,
      });
    }
  }

  // 4. Record thoughts for ALL polled agents
  for (const { agent, result } of reactionResults) {
    recordThought(session, session.currentTurn, agent.name, "reaction", result.thought, observer);
  }

  observer?.onReactionResults?.(reactions);

  // 5. Collect speakers
  let speakers: Speaker[] = [];
  for (const { agent, result } of reactionResults) {
    if (result.utterance !== null) {
      speakers.push({
        agent,
        name: agent.name,
        utterance: result.utterance,
        insistence: result.insistence,
      });
    }
  }

  // 6. Floor holder logic
  if (session.floorHolder !== null) {
    const floorAgent = speakers.find((s) => s.name === session.floorHolder);
    setFloorHolder(session, null);
    if (floorAgent) {
      speakers = [floorAgent];
    } else {
      speakers = [];
    }
  }

  // 7. Branch on speaker count
  if (speakers.length === 0) {
    handleSilence(session, observer);
  } else if (speakers.length === 1) {
    await handleSpeech(session, clients, speakers[0], null, observer, undefined, logCtx);
  } else {
    await handleCollision(session, clients, speakers, observer, logCtx);
  }

  // 8. Advance turn counter
  session.currentTurn++;
}

function handleSilence(session: SessionState, observer?: SessionObserver): void {
  resetCollisionStreak(session);

  const duration = Math.min(
    Math.pow(2, session.silenceBackoffStep),
    session.config.silenceBackoffCap,
  );
  session.silenceAccumulated += duration;

  const record: SilenceRecord = {
    type: "silence",
    turn: session.currentTurn,
    virtualTime: session.virtualTime,
    duration,
    accumulated: session.silenceAccumulated,
  };
  appendTurnRecord(session, record);
  session.silenceBackoffStep++;

  observer?.onTurnComplete?.(record);
}

async function handleSpeech(
  session: SessionState,
  clients: Map<string, LLMClient>,
  speaker: Speaker,
  collisionInfo: CollisionInfo | null,
  observer?: SessionObserver,
  overrideTimestamp?: number,
  logCtx?: LogContext,
): Promise<void> {
  resetSilenceStreak(session);
  resetCollisionLosses(speaker.agent);
  if (collisionInfo === null) {
    resetCollisionStreak(session);
  }

  // Effective insistence for interruption auto-resolution
  const effectiveInsistence = collisionInfo?.winnerInsistence ?? speaker.insistence;

  // Check interruption
  const tokenCount = createTokenCounter(session.config.tokenCounter);
  let interruption = null;
  if (tokenCount(speaker.utterance) > session.config.interruptionThreshold) {
    interruption = await evaluateInterruption(
      session,
      clients,
      { agent: speaker.agent, name: speaker.name, utterance: speaker.utterance },
      effectiveInsistence,
      observer,
      logCtx,
    );
  }

  const record: SpeechRecord = {
    type: "speech",
    turn: session.currentTurn,
    virtualTime: overrideTimestamp ?? session.virtualTime,
    speaker: speaker.name,
    utterance: speaker.utterance,
    insistence: speaker.insistence,
    collision: collisionInfo,
    interruption,
  };
  appendTurnRecord(session, record);
  setLastSpeaker(session, speaker.name);
  setLastSpoke(speaker.agent, session.currentTurn);

  if (interruption) {
    observer?.onInterruptionAttempt?.(speaker.name, interruption.interrupter);
    if (interruption.success) {
      setFloorHolder(session, interruption.interrupter);
      recordInterrupted(speaker.agent);
    }
  }

  observer?.onTurnComplete?.(record);
}

async function handleCollision(
  session: SessionState,
  clients: Map<string, LLMClient>,
  speakers: Speaker[],
  observer?: SessionObserver,
  logCtx?: LogContext,
): Promise<void> {
  observer?.onCollisionStart?.(speakers.map((s) => s.name));

  // Snapshot timestamp before collision time advances
  const turnTimestamp = session.virtualTime;

  // Snapshot original reaction insistence before negotiation mutates speakers
  const originalInsistence = new Map(speakers.map((s) => [s.name, s.insistence]));

  const collisionInfo = await resolveCollision(session, clients, speakers, observer, logCtx);
  const winner = speakers.find((s) => s.name === collisionInfo.winner)!;

  // Restore original reaction insistence so SpeechRecord captures the pre-negotiation value
  winner.insistence = originalInsistence.get(winner.name)!;

  observer?.onCollisionResolved?.(collisionInfo);

  // Update losers
  for (const loser of speakers) {
    if (loser.name !== winner.name) {
      recordCollisionLoss(loser.agent);
    }
  }

  // Update collision streak
  updateCollisionStreak(session, speakers.map((s) => s.name));

  // Advance virtual time for collision itself
  advanceVirtualTime(session, speakers.length * session.config.collisionTimeCost);

  await handleSpeech(session, clients, winner, collisionInfo, observer, turnTimestamp, logCtx);
}

function shouldEnd(session: SessionState): string | null {
  if (session.stopRequested) {
    return "manual_stop";
  }
  if (session.silenceAccumulated > session.config.silenceTimeout) {
    return "silence_timeout";
  }
  if (
    session.config.maxDuration !== null &&
    session.virtualTime > session.config.maxDuration
  ) {
    return "duration_limit";
  }
  return null;
}
