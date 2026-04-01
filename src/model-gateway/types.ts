export type CallMode = "reaction" | "negotiation" | "voting";

export type ModelCallInput = {
  readonly sessionId: string;
  readonly iterationId: number;
  readonly agentId: string;
  readonly mode: CallMode;
  readonly systemPrompt: string;
  /**
   * The user-side prompt text sent to the model.
   *
   * Semantically this is the serialized combination of:
   * - **projected history** — perspective-specific markdown transcript of prior events
   * - **turn directive** — the instruction for this call, including any situational hints
   *
   * These two parts are composed by the prompting layer before being passed here.
   */
  readonly userPromptText: string;
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
