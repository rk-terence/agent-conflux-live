import OpenAI from "openai";
import type { AgentConfig, ChatRequest, LLMClient } from "../../types.js";

/** Information about a completed (or failed) API call, for logging/instrumentation. */
export interface ApiCallInfo {
  agent: string;
  model: string;
  request: ChatRequest;
  rawResponse?: unknown;   // Full ChatCompletion object (includes reasoning_content, usage, etc.)
  content?: string;        // Extracted content string on success
  error?: string;          // Error message on failure
  durationMs: number;
}

export type ApiCallHook = (info: ApiCallInfo) => void;

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

/** Fire the hook in a best-effort manner; never let hook failures alter request semantics. */
function safeHook(hook: ApiCallHook | undefined, info: ApiCallInfo): void {
  if (!hook) return;
  try {
    hook({
      ...info,
      // Pass a frozen snapshot of request so hooks cannot mutate prompts for retries
      request: { ...info.request },
    });
  } catch {
    // Hook errors are silently swallowed — telemetry must not break the request path.
  }
}

export function createOpenAIClient(config: AgentConfig, onApiCall?: ApiCallHook): LLMClient {
  // Strip non-printable ASCII from API key (ZenMux gotcha: Chinese IME invisible chars)
  const rawKey = config.apiKey || process.env.ZENMUX_API_KEY || process.env.OPENAI_API_KEY || "";
  const apiKey = rawKey.replace(/[^\x20-\x7E]/g, "");

  const baseURL = config.endpoint || "https://zenmux.ai/api/v1";

  const client = new OpenAI({ apiKey, baseURL });

  return {
    async chat(request: ChatRequest): Promise<string> {
      const start = Date.now();

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
        const errorMsg = extractErrorMessage(err, config.model);
        safeHook(onApiCall, {
          agent: config.name,
          model: config.model,
          request,
          error: errorMsg,
          durationMs: Date.now() - start,
        });
        // Truncate verbose/HTML error bodies per PROVIDER.md guidance
        throw new Error(errorMsg);
      }

      const content = response.choices[0]?.message?.content;
      if (!content) {
        const errorMsg = `Empty response from model ${config.model}`;
        safeHook(onApiCall, {
          agent: config.name,
          model: config.model,
          request,
          rawResponse: response,
          error: errorMsg,
          durationMs: Date.now() - start,
        });
        throw new Error(errorMsg);
      }

      safeHook(onApiCall, {
        agent: config.name,
        model: config.model,
        request,
        rawResponse: response,
        content,
        durationMs: Date.now() - start,
      });

      return content;
    },
  };
}
