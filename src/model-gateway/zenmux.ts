import type { ModelGateway, ModelCallInput, ModelCallOutput } from "./types.js";

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type AgentPreset = {
  readonly agentModels: Record<string, string>;
  readonly defaultModel: string;
};

/** A participant slot in a preset: agentId + display info + model slug */
export type PresetAgent = {
  readonly agentId: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  /** If true, model uses reasoning/thinking tokens that consume the max_tokens budget.
   *  Gateway will request higher max_tokens to compensate. */
  readonly thinking?: boolean;
};

/** Budget preset — cheap but capable, for dev/iteration */
export const PRESET_BUDGET: readonly PresetAgent[] = [
  { agentId: "deepseek", name: "DeepSeek",  provider: "DeepSeek",  model: "deepseek/deepseek-chat" },
  { agentId: "gemini",   name: "Gemini",    provider: "Google",    model: "google/gemini-2.5-flash", thinking: true },
  { agentId: "qwen",     name: "Qwen",      provider: "Alibaba",   model: "qwen/qwen3-vl-plus" },
];

/** Premium preset — strongest available models */
export const PRESET_PREMIUM: readonly PresetAgent[] = [
  { agentId: "deepseek", name: "DeepSeek",  provider: "DeepSeek",  model: "deepseek/deepseek-v3.2" },
  { agentId: "gemini",   name: "Gemini",    provider: "Google",    model: "google/gemini-2.5-pro", thinking: true },
  { agentId: "qwen",     name: "Qwen",      provider: "Alibaba",   model: "qwen/qwen3-max" },
];

/** Build agentModels record from a preset agent list */
export function presetToAgentModels(agents: readonly PresetAgent[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of agents) map[a.agentId] = a.model;
  return map;
}

/** Build thinking model set from a preset agent list */
export function presetToThinkingSet(agents: readonly PresetAgent[]): ReadonlySet<string> {
  return new Set(agents.filter(a => a.thinking).map(a => a.agentId));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZenMuxConfig = {
  /** ZenMux API key */
  readonly apiKey: string;
  /** Base URL (OpenAI-compatible) */
  readonly baseUrl?: string;
  /** Map agentId → model slug */
  readonly agentModels: Record<string, string>;
  /** Fallback model when agentId not in agentModels */
  readonly defaultModel?: string;
  /** Optional temperature override (default 0.7) */
  readonly temperature?: number;
  /** Agent IDs whose models use thinking tokens (need higher max_tokens) */
  readonly thinkingAgents?: ReadonlySet<string>;
};

type OaiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OaiChoice = {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | null;
};

type OaiResponse = {
  id: string;
  choices: OaiChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

// ---------------------------------------------------------------------------
// Sentence extraction — we own the truncation, so we know exactly what's there
// ---------------------------------------------------------------------------

const SENTENCE_ENDS = /[。！？\n]/;

/**
 * Extract the first complete sentence from model output.
 * Returns the text up to and including the first sentence-ending punctuation.
 * If no boundary found, returns the full text (model stopped naturally).
 */
export function extractFirstSentence(text: string): string {
  const match = SENTENCE_ENDS.exec(text);
  if (!match) return text;
  return text.slice(0, match.index + match[0].length);
}

/**
 * If the model output starts with [silence], the answer is silence.
 * Models sometimes output [silence] then keep talking.
 */
function extractSilence(text: string): string | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("[silence]") || trimmed.startsWith("[沉默]")) {
    return "[silence]";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gateway (OpenAI protocol via ZenMux, no stop sequences)
// ---------------------------------------------------------------------------

/** Thinking models need higher max_tokens to accommodate reasoning overhead */
const THINKING_TOKEN_MULTIPLIER = 10;

export class ZenMuxGateway implements ModelGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly agentModels: Record<string, string>;
  private readonly defaultModel: string;
  private readonly temperature: number;
  private readonly thinkingAgents: ReadonlySet<string>;

  constructor(config: ZenMuxConfig) {
    // Strip invisible Unicode chars that break HTTP headers
    this.apiKey = config.apiKey.replace(/[^\x20-\x7E]/g, "");
    this.baseUrl = (config.baseUrl ?? "https://zenmux.ai/api/v1").replace(/\/+$/, "");
    this.agentModels = config.agentModels;
    this.defaultModel = config.defaultModel ?? "deepseek/deepseek-chat";
    this.temperature = config.temperature ?? 0.7;
    this.thinkingAgents = config.thinkingAgents ?? new Set();
  }

  async generate(input: ModelCallInput): Promise<ModelCallOutput> {
    if (input.abortSignal?.aborted) {
      return { agentId: input.agentId, text: "", finishReason: "cancelled" };
    }

    const model = this.agentModels[input.agentId] ?? this.defaultModel;
    const messages = this.buildMessages(input);
    const isThinking = this.thinkingAgents.has(input.agentId);

    // Thinking models (e.g. Gemini 2.5 Pro) consume reasoning tokens from the
    // max_tokens budget, so we request a much higher limit to ensure the actual
    // output isn't truncated. For non-thinking models we keep the budget tight.
    const effectiveMaxTokens = isThinking
      ? input.maxTokens * THINKING_TOKEN_MULTIPLIER
      : input.maxTokens;

    // No stop sequences — we extract the first sentence ourselves.
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: effectiveMaxTokens,
      max_completion_tokens: effectiveMaxTokens,
      temperature: this.temperature,
    };

    const t0 = performance.now();

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      // Extract useful error info; truncate HTML/long responses to keep logs clean
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message ?? parsed?.error?.type ?? raw;
      } catch {
        // Not JSON — likely HTML error page, just show status code
        detail = raw.length > 200 ? "(response body too large)" : raw;
      }
      return {
        agentId: input.agentId,
        text: `HTTP ${res.status}: ${detail}`,
        finishReason: "error",
        latencyMs: performance.now() - t0,
      };
    }

    const json = (await res.json()) as OaiResponse;
    const latencyMs = performance.now() - t0;
    const choice = json.choices?.[0];

    if (!choice) {
      return {
        agentId: input.agentId,
        text: "No choices in response",
        finishReason: "error",
        latencyMs,
        rawResponse: json,
      };
    }

    let text = choice.message.content ?? "";

    // Check for silence first
    const silence = extractSilence(text);
    if (silence) {
      return {
        agentId: input.agentId,
        text: silence,
        finishReason: "completed",
        latencyMs,
        rawResponse: json,
      };
    }

    // Return the full response — no sentence extraction.
    // Models now produce their complete speech in one call.
    return {
      agentId: input.agentId,
      text: text.trim(),
      finishReason: "completed",
      latencyMs,
      rawResponse: json,
    };
  }

  private buildMessages(input: ModelCallInput): OaiMessage[] {
    const msgs: OaiMessage[] = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.historyText },
    ];

    if (input.mode === "continuation" && input.assistantPrefill) {
      msgs.push({ role: "assistant", content: input.assistantPrefill });
    }

    return msgs;
  }
}
