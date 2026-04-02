import type {
  SessionConfig,
  SessionState,
  TurnRecord,
  SpeechRecord,
  SilenceRecord,
  PromptMode,
  AgentState,
} from "../types.js";
import { createAgentState, updateThought } from "./agent-state.js";
import { computeTurnTimeCost } from "./virtual-clock.js";

export function createSession(config: SessionConfig): SessionState {
  const agents = config.agents.map((ac) => createAgentState(ac));

  const session: SessionState = {
    config,
    agents,
    log: [],
    thoughtLog: [],
    currentTurn: 1,
    virtualTime: 0,
    silenceBackoffStep: 0,
    silenceAccumulated: 0,
    floorHolder: null,
    lastSpeaker: null,
    endReason: null,
    collisionStreak: 0,
    collisionStreakColliders: [],
  };

  // Append discussion_started as turn 0
  session.log.push({
    type: "discussion_started",
    turn: 0,
    virtualTime: 0,
    topic: config.topic,
  });

  return session;
}

export function appendTurnRecord(session: SessionState, record: TurnRecord): void {
  session.log.push(record);
  if (record.type === "speech" || record.type === "silence") {
    const timeCost = computeTurnTimeCost(record, session.config);
    session.virtualTime += timeCost;
  }
}

export function advanceVirtualTime(session: SessionState, seconds: number): void {
  session.virtualTime += seconds;
}

export function resetSilenceStreak(session: SessionState): void {
  session.silenceBackoffStep = 0;
  session.silenceAccumulated = 0;
}

export function recordThought(
  session: SessionState,
  turn: number,
  agentName: string,
  mode: PromptMode,
  thought: string | null,
): void {
  session.thoughtLog.push({ turn, agent: agentName, mode, thought });
  const agent = session.agents.find((a) => a.name === agentName);
  if (agent) {
    updateThought(agent, thought);
  }
}

export function updateCollisionStreak(session: SessionState, colliderNames: string[]): void {
  if (session.collisionStreak === 0) {
    // First collision in new streak — seed
    session.collisionStreakColliders = [...colliderNames];
  } else {
    // Subsequent — intersect
    const set = new Set(colliderNames);
    session.collisionStreakColliders = session.collisionStreakColliders.filter((n) => set.has(n));
  }
  session.collisionStreak++;
}

export function resetCollisionStreak(session: SessionState): void {
  session.collisionStreak = 0;
  session.collisionStreakColliders = [];
}

export function setFloorHolder(session: SessionState, name: string | null): void {
  session.floorHolder = name;
}

export function setLastSpeaker(session: SessionState, name: string): void {
  session.lastSpeaker = name;
}

export function clearLastSpeaker(session: SessionState): void {
  session.lastSpeaker = null;
}
