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
};

/** Budget preset for debug/PAYG — cheap but capable models */
export const PRESET_BUDGET: readonly PresetAgent[] = [
  { agentId: "deepseek", name: "DeepSeek",  provider: "DeepSeek",  model: "deepseek/deepseek-chat" },
  { agentId: "gemini",   name: "Gemini",    provider: "Google",    model: "google/gemini-2.5-flash" },
  { agentId: "qwen",     name: "Qwen",      provider: "Alibaba",   model: "qwen/qwen3-vl-plus" },
  { agentId: "gpt",      name: "GPT-5n",    provider: "OpenAI",    model: "openai/gpt-5-nano" },
  { agentId: "mistral",  name: "Mistral",   provider: "Mistral",   model: "mistralai/mistral-large-2512" },
];

/** Premium preset for subscription — stronger models */
export const PRESET_PREMIUM: readonly PresetAgent[] = [
  { agentId: "deepseek", name: "DeepSeek",  provider: "DeepSeek",  model: "deepseek/deepseek-v3.2" },
  { agentId: "gemini",   name: "Gemini",    provider: "Google",    model: "google/gemini-3-flash-preview" },
  { agentId: "qwen",     name: "Qwen",      provider: "Alibaba",   model: "qwen/qwen3-max" },
  { agentId: "gpt",      name: "GPT-5n",    provider: "OpenAI",    model: "openai/gpt-5-nano" },
  { agentId: "mistral",  name: "Mistral",   provider: "Mistral",   model: "mistralai/mistral-large-2512" },
];

/** Build agentModels record from a preset agent list */
export function presetToAgentModels(agents: readonly PresetAgent[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of agents) map[a.agentId] = a.model;
  return map;
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

export class ZenMuxGateway implements ModelGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly agentModels: Record<string, string>;
  private readonly defaultModel: string;
  private readonly temperature: number;

  constructor(config: ZenMuxConfig) {
    // Strip invisible Unicode chars that break HTTP headers
    this.apiKey = config.apiKey.replace(/[^\x20-\x7E]/g, "");
    this.baseUrl = (config.baseUrl ?? "https://zenmux.ai/api/v1").replace(/\/+$/, "");
    this.agentModels = config.agentModels;
    this.defaultModel = config.defaultModel ?? "deepseek/deepseek-chat";
    this.temperature = config.temperature ?? 0.7;
  }

  async generate(input: ModelCallInput): Promise<ModelCallOutput> {
    if (input.abortSignal?.aborted) {
      return { agentId: input.agentId, text: "", finishReason: "cancelled" };
    }

    const model = this.agentModels[input.agentId] ?? this.defaultModel;
    const messages = this.buildMessages(input);

    // No stop sequences — we extract the first sentence ourselves.
    // Disable reasoning to cut latency and cost; roundtable discussion
    // only needs one short sentence per call, not deep thinking.
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: input.maxTokens,
      max_completion_tokens: input.maxTokens,
      temperature: this.temperature,
      reasoning: { enabled: false },
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
      const detail = await res.text().catch(() => "");
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

    // Strip echoed prefill for continuation mode
    if (input.mode === "continuation" && input.assistantPrefill && text.startsWith(input.assistantPrefill)) {
      text = text.slice(input.assistantPrefill.length);
    }

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

    // Extract first sentence — we own the boundary, punctuation intact
    text = extractFirstSentence(text);

    return {
      agentId: input.agentId,
      text,
      finishReason: "stop_sequence",
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
