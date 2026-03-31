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

    it("classifies non-empty text as speech", () => {
      const result = normalizeOutput(
        makeOutput({ text: "我觉得这个问题很重要。" }),
        "reaction",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "我觉得这个问题很重要。",
      });
      expect((result.output as any).tokenCount).toBeGreaterThan(0);
    });

    it("trims speech text", () => {
      const result = normalizeOutput(
        makeOutput({ text: "  你好  " }),
        "reaction",
      );
      expect(result.output).toMatchObject({ type: "speech", text: "你好" });
    });
  });

  describe("continuation mode", () => {
    it("classifies empty text as end_of_turn", () => {
      const result = normalizeOutput(
        makeOutput({ text: "" }),
        "continuation",
      );
      expect(result.output.type).toBe("end_of_turn");
    });

    it("classifies whitespace-only text as end_of_turn", () => {
      const result = normalizeOutput(
        makeOutput({ text: "   " }),
        "continuation",
      );
      expect(result.output.type).toBe("end_of_turn");
    });

    it("classifies lone stop sequence as end_of_turn", () => {
      for (const stop of ["。", "！", "？"]) {
        const result = normalizeOutput(
          makeOutput({ text: stop }),
          "continuation",
        );
        expect(result.output.type).toBe("end_of_turn");
      }
    });

    it("classifies non-empty text as speech", () => {
      const result = normalizeOutput(
        makeOutput({ text: "这是下一句话" }),
        "continuation",
      );
      expect(result.output).toMatchObject({
        type: "speech",
        text: "这是下一句话",
      });
    });

    it("classifies [silence] as end_of_turn in continuation mode", () => {
      const result = normalizeOutput(
        makeOutput({ text: "[silence]" }),
        "continuation",
      );
      // Model echoed the system prompt's silence instruction instead of
      // continuing speech — treat as end of turn, not transcript content.
      expect(result.output.type).toBe("end_of_turn");
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
        "continuation",
      );
      expect(result.output).toMatchObject({
        type: "error",
        message: "Model call was cancelled",
      });
    });

    it("classifies max_tokens as error (truncated output)", () => {
      const result = normalizeOutput(
        makeOutput({ text: "说到一半没说完", finishReason: "max_tokens" }),
        "reaction",
      );
      expect(result.output.type).toBe("error");
      expect((result.output as any).message).toContain("truncated");
    });

    it("classifies max_tokens as error in continuation mode too", () => {
      const result = normalizeOutput(
        makeOutput({ text: "半句话", finishReason: "max_tokens" }),
        "continuation",
      );
      expect(result.output.type).toBe("error");
    });
  });

  describe("raw output preservation", () => {
    it("preserves raw model output for debug", () => {
      const raw = makeOutput({ text: "测试", rawResponse: { id: "resp_123" } });
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
