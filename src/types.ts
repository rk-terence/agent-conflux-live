// ── Primitives ──

export type InsistenceLevel = "low" | "mid" | "high";
export type PromptMode = "reaction" | "negotiation" | "voting" | "judge" | "defense";
export type Tier = "recent" | "medium" | "old";

// ── Configuration ──

export interface AgentConfig {
  name: string;
  provider: string;       // "openai" | "anthropic" | "google" | "dummy" | etc.
  model: string;          // provider-specific model ID
  endpoint?: string;      // custom API endpoint (for OpenAI-compatible providers)
  apiKey?: string;        // falls back to environment variable if absent
  thinkingModel?: boolean; // thinking models need ~10x max_tokens for reasoning overhead
}

export interface SessionConfig {
  topic: string;
  agents: AgentConfig[];
  recentTierSize: number;
  mediumTierEnd: number;
  silenceTimeout: number;
  silenceBackoffCap: number;
  maxDuration: number | null;
  interruptionThreshold: number;
  tokenTimeCost: number;
  collisionTimeCost: number;
  maxNegotiationRounds: number;
  apiRetries: number;
  tokenCounter?: (text: string) => number;
}

// ── Turn Records (Event Log) ──

export type TurnRecord = DiscussionStartedRecord | SilenceRecord | SpeechRecord;

export interface DiscussionStartedRecord {
  type: "discussion_started";
  turn: 0;
  virtualTime: 0;
  topic: string;
}

export interface SilenceRecord {
  type: "silence";
  turn: number;
  virtualTime: number;
  duration: number;
  accumulated: number;
}

export interface SpeechRecord {
  type: "speech";
  turn: number;
  virtualTime: number;
  speaker: string;
  utterance: string;
  insistence: InsistenceLevel;
  collision: CollisionInfo | null;
  interruption: InterruptionInfo | null;
}

// ── Collision Types ──

export interface CollisionInfo {
  colliders: ColliderEntry[];
  winner: string;
  winnerInsistence: InsistenceLevel;
  resolutionTier: 1 | 2 | 3 | 4;
  votes: VoteEntry[];
}

export interface ColliderEntry {
  agent: string;
  utterance: string;
  insistence: InsistenceLevel;
}

export interface VoteEntry {
  voter: string;
  votedFor: string;
}

// ── Interruption Types ──

export interface InterruptionInfo {
  interrupter: string;
  urgency: InsistenceLevel;
  reason: string | null;
  spokenPart: string;
  unspokenPart: string;
  success: boolean;
}

// ── Thought Log ──

export interface ThoughtEntry {
  turn: number;
  agent: string;
  mode: PromptMode;
  thought: string | null;
}

// ── Agent State ──

export interface AgentState {
  name: string;
  config: AgentConfig;
  currentThought: string | null;
  consecutiveCollisionLosses: number;
  interruptedCount: number;
  lastSpokeTurn: number | null;
}

// ── Session State ──

export interface SessionState {
  config: SessionConfig;
  agents: AgentState[];
  log: TurnRecord[];
  thoughtLog: ThoughtEntry[];
  currentTurn: number;
  virtualTime: number;
  silenceBackoffStep: number;
  silenceAccumulated: number;
  floorHolder: string | null;
  lastSpeaker: string | null;
  endReason: string | null;
  collisionStreak: number;
  collisionStreakColliders: string[];
  stopRequested: boolean;
}

// ── Prompt Types ──

export interface PromptSet {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

// ── LLM Types ──

export interface ChatRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export interface LLMClient {
  chat(request: ChatRequest): Promise<string>;
}

// ── Normalization Result Types ──

export interface ReactionResult {
  utterance: string | null;
  insistence: InsistenceLevel;
  thought: string | null;
}

export interface NegotiationResult {
  insistence: InsistenceLevel;
  thought: string | null;
}

export interface VotingResult {
  vote: string | null;
  thought: string | null;
}

export interface JudgeResult {
  interrupt: boolean;
  urgency: InsistenceLevel;
  reason: string | null;
  thought: string | null;
}

export interface DefenseResult {
  yield: boolean;
  thought: string | null;
}

// ── Prompt Context Types ──

export interface NegotiationContext {
  colliders: { name: string; utterance: string }[];
  thisAgentUtterance: string;
  previousRounds: { round: number; decisions: { agent: string; insistence: InsistenceLevel }[] }[];
}

export interface JudgeContext {
  speakerName: string;
  spokenPart: string;
}

export interface DefenseContext {
  spokenPart: string;
  unspokenPart: string;
  interrupterName: string;
  reason: string | null;
}

// ── Observer Interface ──

export interface SessionObserver {
  onTurnStart?(turn: number, virtualTime: number): void;
  onReactionResults?(results: Map<string, ReactionResult>): void;
  onCollisionStart?(colliders: string[]): void;
  onCollisionResolved?(info: CollisionInfo): void;
  onInterruptionAttempt?(speaker: string, interrupter: string): void;
  onTurnComplete?(record: TurnRecord): void;
  onThoughtUpdate?(agent: string, thought: string): void;
  onSessionEnd?(reason: string, session: SessionState): void;
}
