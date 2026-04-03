import type { AgentConfig, LLMClient } from "../types.js";
import { createOpenAIClient } from "./providers/openai.js";
import type { ApiCallHook } from "./providers/openai.js";
import { createDummyClient } from "./providers/dummy.js";

export type { ApiCallInfo, ApiCallHook } from "./providers/openai.js";

export function createClient(config: AgentConfig, onApiCall?: ApiCallHook): LLMClient {
  switch (config.provider) {
    case "openai":
    case "deepseek":
    case "qwen":
    case "google":
    case "zenmux":
      return createOpenAIClient(config, onApiCall);
    case "dummy":
      return createDummyClient(config);
    default:
      return createOpenAIClient(config, onApiCall);
  }
}
