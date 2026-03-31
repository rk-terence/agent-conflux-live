import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZenMuxGateway } from "../zenmux.js";
import type { ModelCallInput } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reactionInput(overrides?: Partial<ModelCallInput>): ModelCallInput {
  return {
    sessionId: "s1",
    iterationId: 1,
    agentId: "claude",
    mode: "reaction",
    systemPrompt: "你是 Claude",
    historyText: "---\n你的反应？",
    maxTokens: 80,
    ...overrides,
  };
}

function mockFetchOk(content: string, finish_reason: string = "stop") {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "chatcmpl-test",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  });
}

const BASE_CONFIG = {
  apiKey: "test-key",
  agentModels: { claude: "anthropic/claude-haiku-4.5" },
  defaultModel: "deepseek/deepseek-chat",
};

// ---------------------------------------------------------------------------
// Gateway tests
// ---------------------------------------------------------------------------

describe("ZenMuxGateway", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // -- No stop sequences sent -----------------------------------------------

  it("does NOT send stop sequences to API", async () => {
    const mockFn = mockFetchOk("这很有趣。");
    globalThis.fetch = mockFn as unknown as typeof fetch;

    const gw = new ZenMuxGateway(BASE_CONFIG);
    await gw.generate(reactionInput());

    const body = JSON.parse(mockFn.mock.calls[0][1].body);
    expect(body.stop).toBeUndefined();
  });

  // -- Full response returned (no sentence extraction) ----------------------

  it("returns full multi-sentence output without extraction", async () => {
    globalThis.fetch = mockFetchOk("这很有趣。但我有不同看法。让我解释一下。") as unknown as typeof fetch;

    const gw = new ZenMuxGateway(BASE_CONFIG);
    const out = await gw.generate(reactionInput());

    expect(out.text).toBe("这很有趣。但我有不同看法。让我解释一下。");
    expect(out.finishReason).toBe("completed");
  });

  // -- [silence] handling ---------------------------------------------------

  it("handles exact [silence]", async () => {
    globalThis.fetch = mockFetchOk("[silence]") as unknown as typeof fetch;

    const gw = new ZenMuxGateway(BASE_CONFIG);
    const out = await gw.generate(reactionInput());

    expect(out.text).toBe("[silence]");
    expect(out.finishReason).toBe("completed");
  });

  it("truncates [silence] followed by rambling", async () => {
    globalThis.fetch = mockFetchOk("[silence]\n不对我还是想说点什么。") as unknown as typeof fetch;

    const gw = new ZenMuxGateway(BASE_CONFIG);
    const out = await gw.generate(reactionInput());

    expect(out.text).toBe("[silence]");
  });

  it("handles [沉默]", async () => {
    globalThis.fetch = mockFetchOk("[沉默]") as unknown as typeof fetch;

    const gw = new ZenMuxGateway(BASE_CONFIG);
    const out = await gw.generate(reactionInput());

    expect(out.text).toBe("[silence]");
  });

  // -- Error handling -------------------------------------------------------

  it("returns error on HTTP failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => "rate limited",
    }) as unknown as typeof fetch;

    const gw = new ZenMuxGateway(BASE_CONFIG);
    const out = await gw.generate(reactionInput());

    expect(out.finishReason).toBe("error");
    expect(out.text).toContain("429");
  });

  // -- Abort ----------------------------------------------------------------

  it("returns cancelled if signal already aborted", async () => {
    globalThis.fetch = mockFetchOk("nope") as unknown as typeof fetch;
    const gw = new ZenMuxGateway(BASE_CONFIG);
    const ctrl = new AbortController();
    ctrl.abort();

    const out = await gw.generate(reactionInput({ abortSignal: ctrl.signal }));

    expect(out.finishReason).toBe("cancelled");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // -- Config defaults ------------------------------------------------------

  it("uses default base URL and budget", async () => {
    globalThis.fetch = mockFetchOk("ok。") as unknown as typeof fetch;

    const gw = new ZenMuxGateway({ apiKey: "k", agentModels: {} });
    await gw.generate(reactionInput());

    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://zenmux.ai/api/v1/chat/completions");

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(80);
    expect(body.reasoning).toBeUndefined();
    expect(body.model).toBe("deepseek/deepseek-chat");
  });
});
