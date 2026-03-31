import type { ModelGateway, ModelCallInput, ModelCallOutput } from "./types.js";

export type DummyResponseFn = (input: ModelCallInput) => string;

/**
 * A dummy ModelGateway for testing. Responses are determined by
 * a user-supplied function, enabling full control in tests.
 */
export class DummyGateway implements ModelGateway {
  private readonly respondFn: DummyResponseFn;
  readonly calls: ModelCallInput[] = [];

  constructor(respondFn: DummyResponseFn) {
    this.respondFn = respondFn;
  }

  async generate(input: ModelCallInput): Promise<ModelCallOutput> {
    this.calls.push(input);

    if (input.abortSignal?.aborted) {
      return {
        agentId: input.agentId,
        text: "",
        finishReason: "cancelled",
      };
    }

    const text = this.respondFn(input);

    return {
      agentId: input.agentId,
      text,
      finishReason: input.stopSequences ? "stop_sequence" : "completed",
    };
  }
}
