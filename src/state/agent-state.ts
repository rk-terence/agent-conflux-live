import type { AgentConfig, AgentState } from "../types.js";

export function createAgentState(config: AgentConfig): AgentState {
  return {
    name: config.name,
    config,
    currentThought: null,
    consecutiveCollisionLosses: 0,
    interruptedCount: 0,
    lastSpokeTurn: null,
  };
}

/** Max characters for persisted thought. Prevents unbounded prompt growth
 *  when thought text is injected into subsequent turn directives. */
export const MAX_THOUGHT_CHARS = 200;

export function updateThought(agent: AgentState, thought: string | null): void {
  if (thought !== null) {
    agent.currentThought = thought.length > MAX_THOUGHT_CHARS
      ? thought.slice(0, MAX_THOUGHT_CHARS)
      : thought;
  }
  // null means "unchanged" — keep previous thought
}

export function recordCollisionLoss(agent: AgentState): void {
  agent.consecutiveCollisionLosses++;
}

export function resetCollisionLosses(agent: AgentState): void {
  agent.consecutiveCollisionLosses = 0;
}

export function recordInterrupted(agent: AgentState): void {
  agent.interruptedCount++;
}

export function setLastSpoke(agent: AgentState, turn: number): void {
  agent.lastSpokeTurn = turn;
}
