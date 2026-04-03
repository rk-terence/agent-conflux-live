// Public API
export { buildConfig } from "./config.js";
export type { SessionConfigInput } from "./config.js";
export { createSession, requestStop } from "./state/session.js";
export { createClient } from "./llm/client.js";
export type { ApiCallInfo, ApiCallHook } from "./llm/client.js";
export { runDiscussion } from "./core/discussion-loop.js";
export { LogContext } from "./log-context.js";
export { SCHEMA_VERSION } from "./log-types.js";

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
  ChatRequestMeta,
  LLMClient,
  ReactionResult,
  NegotiationResult,
  VotingResult,
  JudgeResult,
  DefenseResult,
  ReactionResultWithMeta,
  NegotiationResultWithMeta,
  VotingResultWithMeta,
  JudgeResultWithMeta,
  DefenseResultWithMeta,
  NegotiationContext,
  JudgeContext,
  DefenseContext,
  SessionObserver,
} from "./types.js";

export type {
  NormalizeMeta,
  NormalizeResultInfo,
  UtteranceFilterInfo,
  CollisionRoundInfo,
  InterruptionEvalInfo,
} from "./log-types.js";

// Convenience runner
import type { SessionState, SessionObserver, LLMClient } from "./types.js";
import { buildConfig, type SessionConfigInput } from "./config.js";
import { createSession } from "./state/session.js";
import { createClient } from "./llm/client.js";
import { runDiscussion } from "./core/discussion-loop.js";
import { LogContext } from "./log-context.js";

/**
 * Create and run a complete roundtable discussion session.
 */
export async function startDiscussion(
  input: SessionConfigInput,
  observer?: SessionObserver,
  logCtx?: LogContext,
): Promise<SessionState> {
  const config = buildConfig(input);
  const session = createSession(config);

  const clients = new Map<string, LLMClient>();
  for (const agentConfig of config.agents) {
    clients.set(agentConfig.name, createClient(agentConfig));
  }

  await runDiscussion(session, clients, observer, logCtx);
  return session;
}
