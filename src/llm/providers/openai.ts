import OpenAI from "openai";
import type { AgentConfig, ChatRequest, LLMClient } from "../../types.js";

function extractErrorMessage(err: unknown, model: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Try to extract JSON error message from verbose/HTML bodies
  const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (jsonMatch) {
    return `${model}: ${jsonMatch[1]}`;
  }
  // Truncate long error bodies (e.g. HTML 500 responses)
  if (raw.length > 200) {
    return `${model}: ${raw.slice(0, 200)}...`;
  }
  return `${model}: ${raw}`;
}

export function createOpenAIClient(config: AgentConfig): LLMClient {
  // Strip non-printable ASCII from API key (ZenMux gotcha: Chinese IME invisible chars)
  const rawKey = config.apiKey || process.env.ZENMUX_API_KEY || process.env.OPENAI_API_KEY || "";
  const apiKey = rawKey.replace(/[^\x20-\x7E]/g, "");

  const baseURL = config.endpoint || "https://zenmux.ai/api/v1";

  const client = new OpenAI({ apiKey, baseURL });

  return {
    async chat(request: ChatRequest): Promise<string> {
      // Thinking models spend most of max_tokens on reasoning tokens;
      // apply 10x multiplier per PROVIDER.md guidance.
      const effectiveMaxTokens = config.thinkingModel
        ? request.maxTokens * 10
        : request.maxTokens;

      let response;
      try {
        response = await client.chat.completions.create({
          model: config.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          max_tokens: effectiveMaxTokens,
        });
      } catch (err: unknown) {
        // Truncate verbose/HTML error bodies per PROVIDER.md guidance
        throw new Error(extractErrorMessage(err, config.model));
      }

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error(`Empty response from model ${config.model}`);
      }
      return content;
    },
  };
}
