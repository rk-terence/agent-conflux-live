// --- Identity types ---

export type AgentId = string;
export type SessionId = string;

// --- Phase ---

export type SessionPhase =
  | "idle"       // created but not started
  | "turn_gap"   // no current speaker, awaiting next
  | "ended";     // discussion terminated

// --- CurrentTurn ---

export type CurrentTurn = {
  readonly speakerId: AgentId;
  readonly startTime: number;
  readonly frozenHistorySnapshot: readonly DomainEvent[];
  readonly sentences: readonly string[];
  readonly sentenceTokenCounts: readonly number[];
  readonly speakingDuration: number;
  readonly sentenceCount: number;
};

// --- Silence state ---

export type SilenceState = {
  readonly consecutiveCount: number;
  readonly cumulativeSeconds: number;
};

// --- Participant ---

export type Participant = {
  readonly agentId: AgentId;
  readonly name: string;
};

// --- SessionState ---

export type SessionState = {
  readonly sessionId: SessionId;
  readonly topic: string;
  readonly participants: readonly Participant[];
  readonly virtualTime: number;
  readonly phase: SessionPhase;
  readonly currentTurn: CurrentTurn | null;
  readonly silenceState: SilenceState;
  readonly events: readonly DomainEvent[];
  readonly iterationCount: number;
};

// --- DomainEvent ---

export type DomainEvent =
  | DiscussionStartedEvent
  | SentenceCommittedEvent
  | CollisionEvent
  | TurnEndedEvent
  | SilenceExtendedEvent
  | DiscussionEndedEvent;

export type DiscussionStartedEvent = {
  readonly kind: "discussion_started";
  readonly timestamp: number;
  readonly topic: string;
  readonly participants: readonly Participant[];
};

export type SentenceCommittedEvent = {
  readonly kind: "sentence_committed";
  readonly timestamp: number;
  readonly speakerId: AgentId;
  readonly sentence: string;
  readonly tokenCount: number;
  readonly durationSeconds: number;
  readonly turnSentenceIndex: number;
};

export type CollisionEvent = {
  readonly kind: "collision";
  readonly timestamp: number;
  readonly during: "speech" | "gap";
  readonly utterances: readonly CollisionUtterance[];
};

export type CollisionUtterance = {
  readonly agentId: AgentId;
  readonly text: string;
  readonly tokenCount: number;
};

export type TurnEndedEvent = {
  readonly kind: "turn_ended";
  readonly timestamp: number;
  readonly speakerId: AgentId;
  readonly totalSentences: number;
  readonly totalDuration: number;
};

export type SilenceExtendedEvent = {
  readonly kind: "silence_extended";
  readonly timestamp: number;
  readonly intervalSeconds: number;
  readonly cumulativeSeconds: number;
};

export type DiscussionEndedEvent = {
  readonly kind: "discussion_ended";
  readonly timestamp: number;
  readonly reason: "silence_timeout" | "duration_limit" | "manual" | "fatal_error";
};

// --- Reducer input types (no transport-layer errors) ---

export type AgentIterationResult = {
  readonly agentId: AgentId;
  readonly output: AgentOutput;
};

export type AgentOutput =
  | { readonly type: "speech"; readonly text: string; readonly tokenCount: number }
  | { readonly type: "silence" }
  | { readonly type: "end_of_turn" };

// --- IterationResult ---

export type IterationResult = {
  readonly iterationId: number;
  readonly results: readonly AgentIterationResult[];
};

// --- Reducer output ---

export type ReducerOutput = {
  readonly nextState: SessionState;
  readonly events: readonly DomainEvent[];
};
