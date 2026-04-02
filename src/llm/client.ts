import type { AgentConfig, LLMClient } from "../types.js";
import { createOpenAIClient } from "./providers/openai.js";
import { createDummyClient } from "./providers/dummy.js";

export function createClient(config: AgentConfig): LLMClient {
  switch (config.provider) {
    case "openai":
    case "deepseek":
    case "qwen":
    case "google":
    case "zenmux":
      return createOpenAIClient(config);
    case "dummy":
      return createDummyClient(config);
    default:
      return createOpenAIClient(config);
  }
}
