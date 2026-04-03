// Public API
export { buildConfig } from "./config.js";
export type { SessionConfigInput } from "./config.js";
export { createSession, requestStop } from "./state/session.js";
export { createClient } from "./llm/client.js";
export { runDiscussion } from "./core/discussion-loop.js";

// Re-export all types
export type {
  AgentConfig,
  SessionConfig,
  SessionState,
  AgentState,
  TurnRecord,
  DiscussionStartedRecord,
  SilenceRecord,
  SpeechRecord,
  CollisionInfo,
  ColliderEntry,
  VoteEntry,
  InterruptionInfo,
  ThoughtEntry,
  InsistenceLevel,
  PromptMode,
  Tier,
  PromptSet,
  ChatRequest,
  LLMClient,
  ReactionResult,
  NegotiationResult,
  VotingResult,
  JudgeResult,
  DefenseResult,
  NegotiationContext,
  JudgeContext,
  DefenseContext,
  SessionObserver,
} from "./types.js";

// Convenience runner
import type { SessionConfig, SessionState, SessionObserver, LLMClient } from "./types.js";
import { buildConfig, type SessionConfigInput } from "./config.js";
import { createSession } from "./state/session.js";
import { createClient } from "./llm/client.js";
import { runDiscussion } from "./core/discussion-loop.js";

/**
 * Create and run a complete roundtable discussion session.
 */
export async function startDiscussion(
  input: SessionConfigInput,
  observer?: SessionObserver,
): Promise<SessionState> {
  const config = buildConfig(input);
  const session = createSession(config);

  const clients = new Map<string, LLMClient>();
  for (const agentConfig of config.agents) {
    clients.set(agentConfig.name, createClient(agentConfig));
  }

  await runDiscussion(session, clients, observer);
  return session;
}
