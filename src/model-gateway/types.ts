export type CallMode = "reaction";

export type ModelCallInput = {
  readonly sessionId: string;
  readonly iterationId: number;
  readonly agentId: string;
  readonly mode: CallMode;
  readonly systemPrompt: string;
  readonly historyText: string;
  readonly assistantPrefill?: string;
  readonly selfStatusText?: string;
  readonly maxTokens: number;
  readonly stopSequences?: readonly string[];
  readonly abortSignal?: AbortSignal;
};

export type ModelCallOutput = {
  readonly agentId: string;
  readonly text: string;
  readonly finishReason:
    | "completed"
    | "stop_sequence"
    | "max_tokens"
    | "cancelled"
    | "error";
  readonly latencyMs?: number;
  readonly rawResponse?: unknown;
};

export interface ModelGateway {
  generate(input: ModelCallInput): Promise<ModelCallOutput>;
}
