import { describe, it, expect } from "vitest";
import { normalizeOutput, estimateTokenCount } from "../normalize.js";
import type { ModelCallOutput } from "../../model-gateway/types.js";

function makeOutput(overrides: Partial<ModelCallOutput> = {}): ModelCallOutput {
  return {
    agentId: "claude",
    text: "",
    finishReason: "completed",
    ...overrides,
  };
}

describe("normalizeOutput", () => {
  describe("reaction mode", () => {
    it("classifies [silence] as silence", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[silence]" }),
        "reaction",
      );
      expect(result.output.type).toBe("silence");
    });

    it("classifies [silence] with whitespace as silence", () => {
      const result = normalizeOutput(
        makeOutput({ text: "  [silence]  " }),
        "reaction",
      );
      expect(result.output.type).toBe("silence");
    });

    it("classifies [SILENCE] as silence (case insensitive)", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[SILENCE]" }),
        "reaction",
      );
      expect(result.output.type).toBe("silence");
    });

    it("classifies [沉默] as silence", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[沉默]" }),
        "reaction",
      );
      expect(result.output.type).toBe("silence");
    });

    it("classifies empty text as silence", () => {
      const result = normalizeOutput(
        makeOutput({ text: "  " }),
        "reaction",
      );
      expect(result.output.type).toBe("silence");
    });

    it("classifies non-empty text as speech with default insistence", () => {
      const result = normalizeOutput(
        makeOutput({ text: "我觉得这个问题很重要。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "我觉得这个问题很重要。",
        insistence: "mid",
      });
      expect((result.output as any).tokenCount).toBeGreaterThan(0);
    });

    it("trims speech text", () => {
      const result = normalizeOutput(
        makeOutput({ text: "  你好世界测试  " }),
        "reaction",
      );
      expect(result.output).toMatchObject({ type: "speech", text: "你好世界测试", insistence: "mid" });
    });

    it("parses structured JSON with speech and insistence", () => {
      const result = normalizeOutput(
        makeOutput({ text: '{"speech": "这是我的观点。", "insistence": "high"}' }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "这是我的观点。",
        insistence: "high",
      });
    });

    it("parses structured JSON with null speech as silence", () => {
      const result = normalizeOutput(
        makeOutput({ text: '{"speech": null, "insistence": "low"}' }),
        "reaction",
      );
      expect(result.output.type).toBe("silence");
    });

    it("parses JSON wrapped in markdown code fences", () => {
      const result = normalizeOutput(
        makeOutput({ text: '```json\n{"speech": "测试代码围栏。", "insistence": "low"}\n```' }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "测试代码围栏。",
        insistence: "low",
      });
    });

    it("falls back to free-form text with default insistence on malformed JSON", () => {
      const result = normalizeOutput(
        makeOutput({ text: "这不是JSON，但是合法发言内容。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "这不是JSON，但是合法发言内容。",
        insistence: "mid",
      });
    });
  });

  describe("speaker prefix stripping", () => {
    it("strips [你]: prefix from speech", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[你]: 没关系，我同意。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "没关系，我同意。",
      });
    });

    it("strips [你]：prefix with full-width colon", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[你]：看来大家都很感兴趣。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "看来大家都很感兴趣。",
      });
    });

    it("strips [AgentName]: prefix", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[Gemini]: 我同意这个观点。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "我同意这个观点。",
      });
    });

    it("strips [AgentName]: prefix with hyphen in name", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[GPT-4o]: 这个问题值得思考。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "这个问题值得思考。",
      });
    });

    it("strips **AgentName**： markdown prefix", () => {
      const result = normalizeOutput(
        makeOutput({ text: "**Claude**：我有不同看法。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "我有不同看法。",
      });
    });

    it("strips **AgentName**： markdown prefix with hyphen", () => {
      const result = normalizeOutput(
        makeOutput({ text: "**GPT-4o**：让我来分析一下。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "让我来分析一下。",
      });
    });

    it("strips **AgentName**： markdown prefix with spaces and dots", () => {
      const result = normalizeOutput(
        makeOutput({ text: "**Gemini 2.5 Pro**：我的看法是这样的。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "我的看法是这样的。",
      });
    });

    it("detects markdown-format history hallucination", () => {
      const result = normalizeOutput(
        makeOutput({ text: "- [1.5s] **Claude**：\n  > 之前的话" }),
        "reaction",
      );
      expect(result.output).toMatchObject({ type: "silence" });
    });
  });

  describe("parenthetical stripping", () => {
    it("strips full-width parentheticals from speech", () => {
      const result = normalizeOutput(
        makeOutput({ text: "（等了一秒，确认安静后）我们来讨论一下。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "我们来讨论一下。",
      });
    });

    it("strips half-width parentheticals from speech", () => {
      const result = normalizeOutput(
        makeOutput({ text: "(turns to Qwen) 你觉得呢？这很重要。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "你觉得呢？这很重要。",
      });
    });

    it("treats pure parenthetical as silence in reaction mode", () => {
      const result = normalizeOutput(
        makeOutput({ text: "（安静地等待片刻，确认当前没有其他人正在说话）" }),
        "reaction",
      );
      expect(result.output.type).toBe("silence");
    });

    it("strips multiple parentheticals", () => {
      const result = normalizeOutput(
        makeOutput({ text: "（停顿片刻）我同意（点头）这个观点。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "我同意这个观点。",
      });
    });
  });

  describe("error and cancellation", () => {
    it("classifies error finishReason as error", () => {
      const result = normalizeOutput(
        makeOutput({ text: "timeout", finishReason: "error" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "error",
        message: "Model call failed: timeout",
      });
    });

    it("classifies cancelled finishReason as error", () => {
      const result = normalizeOutput(
        makeOutput({ finishReason: "cancelled" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "error",
        message: "Model call was cancelled",
      });
    });

    it("treats max_tokens as speech (uses whatever text we got)", () => {
      const result = normalizeOutput(
        makeOutput({ text: "说到一半没说完但也算数", finishReason: "max_tokens" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "说到一半没说完但也算数",
      });
    });
  });

  describe("raw output preservation", () => {
    it("preserves raw model output for debug", () => {
      const raw = makeOutput({ text: "测试文本内容", rawResponse: { id: "resp_123" } });
      const result = normalizeOutput(raw, "reaction");
      expect(result.raw).toBe(raw);
    });
  });
});

describe("estimateTokenCount", () => {
  it("returns at least 1 for any non-empty string", () => {
    expect(estimateTokenCount("a")).toBeGreaterThanOrEqual(1);
    expect(estimateTokenCount("好")).toBeGreaterThanOrEqual(1);
  });

  it("estimates CJK text higher than ASCII text of same length", () => {
    const cjk = estimateTokenCount("你好世界");
    const ascii = estimateTokenCount("abcd");
    expect(cjk).toBeGreaterThan(ascii);
  });

  it("handles mixed content", () => {
    const count = estimateTokenCount("AI意识");
    expect(count).toBeGreaterThan(0);
  });
});
