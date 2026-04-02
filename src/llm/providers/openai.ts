import OpenAI from "openai";
import type { AgentConfig, ChatRequest, LLMClient } from "../../types.js";

export function createOpenAIClient(config: AgentConfig): LLMClient {
  // Strip non-printable ASCII from API key (ZenMux gotcha: Chinese IME invisible chars)
  const rawKey = config.apiKey || process.env.ZENMUX_API_KEY || process.env.OPENAI_API_KEY || "";
  const apiKey = rawKey.replace(/[^\x20-\x7E]/g, "");

  const baseURL = config.endpoint || "https://zenmux.ai/api/v1";

  const client = new OpenAI({ apiKey, baseURL });

  return {
    async chat(request: ChatRequest): Promise<string> {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        max_tokens: request.maxTokens,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error(`Empty response from model ${config.model}`);
      }
      return content;
    },
  };
}
