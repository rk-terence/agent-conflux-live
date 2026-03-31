import type {
  SessionState,
  IterationResult,
  ReducerOutput,
  AgentIterationResult,
  AgentOutput,
  DomainEvent,
  CurrentTurn,
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
} from "./constants.js";

const SILENCE_RESET: SilenceState = { consecutiveCount: 0, cumulativeSeconds: 0 };

export function reduceIteration(
  state: SessionState,
  result: IterationResult,
): ReducerOutput {
  if (state.phase === "ended" || state.phase === "idle") {
    return { nextState: state, events: [] };
  }

  if (state.phase === "speaking") {
    return reduceSpeakingPhase(state, result);
  }

  return reduceTurnGapPhase(state, result);
}

// --- Speaking phase ---

function reduceSpeakingPhase(
  state: SessionState,
  result: IterationResult,
): ReducerOutput {
  const turn = state.currentTurn!;
  const speakerResult = result.results.find(r => r.agentId === turn.speakerId);
  const listenerResults = result.results.filter(r => r.agentId !== turn.speakerId);

  if (!speakerResult) {
    throw new Error(
      `Speaker ${turn.speakerId} is missing from iteration results.`,
    );
  }

  const speakerOutput = speakerResult.output;
  const speakingListeners = listenerResults.filter(r => r.output.type === "speech");

  if (speakerOutput.type === "silence") {
    throw new Error(
      `Speaker ${turn.speakerId} returned [silence] in continuation mode. ` +
      `This is a protocol error — continuation mode only produces speech or end_of_turn.`,
    );
  }

  if (speakerOutput.type === "end_of_turn") {
    return handleEndOfTurn(state, turn);
  }

  // Speaker produced speech
  const { text, tokenCount } = speakerOutput;
  const duration = tokenCount * TOKEN_TO_SECONDS;
  const newTime = state.virtualTime + duration;

  const sentenceEvent: SentenceCommittedEvent = {
    kind: "sentence_committed",
    timestamp: newTime,
    speakerId: turn.speakerId,
    sentence: text,
    tokenCount,
    durationSeconds: duration,
    turnSentenceIndex: turn.sentenceCount,
  };

  if (speakingListeners.length === 0) {
    // Uninterrupted continuation
    const updatedTurn: CurrentTurn = {
      ...turn,
      sentences: [...turn.sentences, text],
      sentenceTokenCounts: [...turn.sentenceTokenCounts, tokenCount],
      speakingDuration: turn.speakingDuration + duration,
      sentenceCount: turn.sentenceCount + 1,
    };

    return {
      nextState: {
        ...state,
        virtualTime: newTime,
        currentTurn: updatedTurn,
        silenceState: SILENCE_RESET,
        events: [...state.events, sentenceEvent],
        iterationCount: state.iterationCount + 1,
      },
      events: [sentenceEvent],
    };
  }

  // Collision during speech
  const collisionEvent: CollisionEvent = {
    kind: "collision",
    timestamp: newTime,
    during: "speech",
    utterances: [
      { agentId: turn.speakerId, text, tokenCount },
      ...speakingListeners.map(r => {
        const o = r.output as Extract<AgentOutput, { type: "speech" }>;
        return { agentId: r.agentId, text: o.text, tokenCount: o.tokenCount };
      }),
    ],
  };

  return {
    nextState: {
      ...state,
      virtualTime: newTime,
      phase: "turn_gap",
      currentTurn: null,
      silenceState: SILENCE_RESET,
      events: [...state.events, sentenceEvent, collisionEvent],
      iterationCount: state.iterationCount + 1,
    },
    events: [sentenceEvent, collisionEvent],
  };
}

function handleEndOfTurn(
  state: SessionState,
  turn: CurrentTurn,
): ReducerOutput {
  // Listener responses from this iteration are discarded:
  // they were generated while seeing "someone is speaking" context,
  // not a true turn gap. The next iteration will re-poll everyone.
  const turnEndEvent: TurnEndedEvent = {
    kind: "turn_ended",
    timestamp: state.virtualTime,
    speakerId: turn.speakerId,
    totalSentences: turn.sentenceCount,
    totalDuration: turn.speakingDuration,
  };

  return {
    nextState: {
      ...state,
      phase: "turn_gap",
      currentTurn: null,
      silenceState: SILENCE_RESET,
      events: [...state.events, turnEndEvent],
      iterationCount: state.iterationCount + 1,
    },
    events: [turnEndEvent],
  };
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

  const newTurn: CurrentTurn = {
    speakerId: speaker.agentId,
    startTime: state.virtualTime,
    frozenHistorySnapshot: state.events, // snapshot BEFORE the speaker's first sentence
    sentences: [o.text],
    sentenceTokenCounts: [o.tokenCount],
    speakingDuration: duration,
    sentenceCount: 1,
  };

  return {
    nextState: {
      ...state,
      virtualTime: newTime,
      phase: "speaking",
      currentTurn: newTurn,
      silenceState: SILENCE_RESET,
      events: [...state.events, sentenceEvent],
      iterationCount: state.iterationCount + 1,
    },
    events: [sentenceEvent],
  };
}

function handleGapCollision(
  state: SessionState,
  speakers: readonly AgentIterationResult[],
): ReducerOutput {
  const utterances = speakers.map(r => {
    const o = r.output as Extract<AgentOutput, { type: "speech" }>;
    return { agentId: r.agentId, text: o.text, tokenCount: o.tokenCount };
  });

  const maxTokens = Math.max(...utterances.map(u => u.tokenCount));
  const newTime = state.virtualTime + maxTokens * TOKEN_TO_SECONDS;

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
