import type {
  SessionState,
  IterationResult,
  ReducerOutput,
  AgentIterationResult,
  AgentOutput,
  DomainEvent,
  SilenceState,
  SentenceCommittedEvent,
  CollisionEvent,
  TurnEndedEvent,
  SilenceExtendedEvent,
  DiscussionEndedEvent,
} from "./types.js";
import {
  TOKEN_TO_SECONDS,
  SILENCE_BACKOFF_SCHEDULE,
  CUMULATIVE_SILENCE_LIMIT,
  COLLISION_BASE_SECONDS_PER_PERSON,
} from "./constants.js";

const SILENCE_RESET: SilenceState = { consecutiveCount: 0, cumulativeSeconds: 0 };

export function reduceIteration(
  state: SessionState,
  result: IterationResult,
): ReducerOutput {
  if (state.phase === "ended" || state.phase === "idle") {
    return { nextState: state, events: [] };
  }

  // Simplified: no "speaking" phase. Every iteration is a turn_gap poll.
  return reduceTurnGapPhase(state, result);
}

// --- Turn gap phase ---

function reduceTurnGapPhase(
  state: SessionState,
  result: IterationResult,
): ReducerOutput {
  const speakers = result.results.filter(r => r.output.type === "speech");

  if (speakers.length === 0) {
    return handleAllSilent(state);
  }

  if (speakers.length === 1) {
    return handleSingleSpeaker(state, speakers[0]);
  }

  return handleGapCollision(state, speakers);
}

function handleAllSilent(state: SessionState): ReducerOutput {
  const idx = Math.min(
    state.silenceState.consecutiveCount,
    SILENCE_BACKOFF_SCHEDULE.length - 1,
  );
  const interval = SILENCE_BACKOFF_SCHEDULE[idx];
  const newCumulative = state.silenceState.cumulativeSeconds + interval;
  const newTime = state.virtualTime + interval;

  const silenceEvent: SilenceExtendedEvent = {
    kind: "silence_extended",
    timestamp: newTime,
    intervalSeconds: interval,
    cumulativeSeconds: newCumulative,
  };

  const events: DomainEvent[] = [silenceEvent];

  if (newCumulative >= CUMULATIVE_SILENCE_LIMIT) {
    const endEvent: DiscussionEndedEvent = {
      kind: "discussion_ended",
      timestamp: newTime,
      reason: "silence_timeout",
    };
    events.push(endEvent);

    return {
      nextState: {
        ...state,
        virtualTime: newTime,
        phase: "ended",
        silenceState: {
          consecutiveCount: state.silenceState.consecutiveCount + 1,
          cumulativeSeconds: newCumulative,
        },
        events: [...state.events, ...events],
        iterationCount: state.iterationCount + 1,
      },
      events,
    };
  }

  return {
    nextState: {
      ...state,
      virtualTime: newTime,
      silenceState: {
        consecutiveCount: state.silenceState.consecutiveCount + 1,
        cumulativeSeconds: newCumulative,
      },
      events: [...state.events, silenceEvent],
      iterationCount: state.iterationCount + 1,
    },
    events: [silenceEvent],
  };
}

/**
 * Single speaker: commit their full text and end the turn immediately.
 * No "speaking" phase — the model says everything in one call.
 */
function handleSingleSpeaker(
  state: SessionState,
  speaker: AgentIterationResult,
): ReducerOutput {
  const o = speaker.output as Extract<AgentOutput, { type: "speech" }>;
  const duration = o.tokenCount * TOKEN_TO_SECONDS;
  const newTime = state.virtualTime + duration;

  const sentenceEvent: SentenceCommittedEvent = {
    kind: "sentence_committed",
    timestamp: newTime,
    speakerId: speaker.agentId,
    sentence: o.text,
    tokenCount: o.tokenCount,
    durationSeconds: duration,
    turnSentenceIndex: 0,
  };

  const turnEndEvent: TurnEndedEvent = {
    kind: "turn_ended",
    timestamp: newTime,
    speakerId: speaker.agentId,
    totalSentences: 1,
    totalDuration: duration,
  };

  return {
    nextState: {
      ...state,
      virtualTime: newTime,
      phase: "turn_gap",
      currentTurn: null,
      silenceState: SILENCE_RESET,
      events: [...state.events, sentenceEvent, turnEndEvent],
      iterationCount: state.iterationCount + 1,
    },
    events: [sentenceEvent, turnEndEvent],
  };
}

function handleGapCollision(
  state: SessionState,
  speakers: readonly AgentIterationResult[],
): ReducerOutput {
  const utterances = speakers.map(r => {
    const o = r.output as Extract<AgentOutput, { type: "speech" }>;
    return { agentId: r.agentId, text: o.text, tokenCount: o.tokenCount, insistence: o.insistence };
  });

  const collisionDuration = utterances.length * COLLISION_BASE_SECONDS_PER_PERSON;
  const newTime = state.virtualTime + collisionDuration;

  const collisionEvent: CollisionEvent = {
    kind: "collision",
    timestamp: newTime,
    during: "gap",
    utterances,
  };

  return {
    nextState: {
      ...state,
      virtualTime: newTime,
      phase: "turn_gap",
      currentTurn: null,
      silenceState: SILENCE_RESET,
      events: [...state.events, collisionEvent],
      iterationCount: state.iterationCount + 1,
    },
    events: [collisionEvent],
  };
}
