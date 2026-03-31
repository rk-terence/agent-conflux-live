import type {
  SessionId,
  Participant,
  SessionState,
  DiscussionStartedEvent,
  DiscussionEndedEvent,
  ReducerOutput,
} from "./types.js";

export function createSession(params: {
  sessionId: SessionId;
  topic: string;
  participants: readonly Participant[];
}): ReducerOutput {
  const startEvent: DiscussionStartedEvent = {
    kind: "discussion_started",
    timestamp: 0,
    topic: params.topic,
    participants: params.participants,
  };

  const initialState: SessionState = {
    sessionId: params.sessionId,
    topic: params.topic,
    participants: params.participants,
    virtualTime: 0,
    phase: "turn_gap",
    currentTurn: null,
    silenceState: { consecutiveCount: 0, cumulativeSeconds: 0 },
    events: [startEvent],
    iterationCount: 0,
  };

  return { nextState: initialState, events: [startEvent] };
}

export function endDiscussion(
  state: SessionState,
  reason: DiscussionEndedEvent["reason"],
): ReducerOutput {
  if (state.phase === "ended") {
    return { nextState: state, events: [] };
  }

  const endEvent: DiscussionEndedEvent = {
    kind: "discussion_ended",
    timestamp: state.virtualTime,
    reason,
  };

  return {
    nextState: {
      ...state,
      phase: "ended",
      currentTurn: null,
      events: [...state.events, endEvent],
    },
    events: [endEvent],
  };
}
