import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildReactionInput,
  buildContinuationInput,
} from "../builder.js";

const allNames = ["Claude", "GPT-4o", "DeepSeek"];
const topic = "AI意识问题";

describe("buildSystemPrompt", () => {
  it("includes agent name, participants, topic, and rules", () => {
    const prompt = buildSystemPrompt("Claude", allNames, topic);

    expect(prompt).toContain("你是 Claude");
    expect(prompt).toContain("参与者：Claude、GPT-4o、DeepSeek");
    expect(prompt).toContain("话题：AI意识问题");
    expect(prompt).toContain("没有主持人");
    expect(prompt).toContain("[silence]");
  });
});

describe("buildReactionInput", () => {
  it("builds correct reaction-mode call input", () => {
    const input = buildReactionInput({
      sessionId: "s1",
      iterationId: 3,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      historyText: "[GPT-4o]: 我先说一句。",
    });

    expect(input.mode).toBe("reaction");
    expect(input.sessionId).toBe("s1");
    expect(input.iterationId).toBe(3);
    expect(input.agentId).toBe("claude");
    expect(input.maxTokens).toBe(80);
    expect(input.historyText).toBe("[GPT-4o]: 我先说一句。\n\n---\n你的反应？");
    expect(input.assistantPrefill).toBeUndefined();
    expect(input.stopSequences).toBeUndefined();
  });

  it("handles empty history (first round)", () => {
    const input = buildReactionInput({
      sessionId: "s1",
      iterationId: 0,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      historyText: "",
    });

    expect(input.historyText).toBe("---\n你的反应？");
  });
});

describe("buildContinuationInput", () => {
  it("builds correct continuation-mode call input", () => {
    const input = buildContinuationInput({
      sessionId: "s1",
      iterationId: 5,
      agentId: "gpt",
      agentName: "GPT-4o",
      allNames,
      topic,
      frozenHistoryText: "[Claude]: 我先说了一句。",
      assistantPrefill: "我觉得这个问题很复杂。",
      speakingDurationSeconds: 18.3,
      sentenceCount: 3,
    });

    expect(input.mode).toBe("continuation");
    expect(input.agentId).toBe("gpt");
    expect(input.maxTokens).toBe(100);
    expect(input.stopSequences).toEqual(["。", "！", "？", "\n"]);
    expect(input.assistantPrefill).toBe("我觉得这个问题很复杂。");
    expect(input.selfStatusText).toBe("（你已经连续说了 18 秒 / 3 句）");
    expect(input.historyText).toContain("[Claude]: 我先说了一句。");
    expect(input.historyText).toContain("（你已经连续说了 18 秒 / 3 句）");
  });

  it("includes self-status even with empty history", () => {
    const input = buildContinuationInput({
      sessionId: "s1",
      iterationId: 1,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      frozenHistoryText: "",
      assistantPrefill: "我来开个头。",
      speakingDurationSeconds: 1.2,
      sentenceCount: 1,
    });

    expect(input.historyText).toBe("（你已经连续说了 1 秒 / 1 句）");
  });

  it("rounds speaking duration", () => {
    const input = buildContinuationInput({
      sessionId: "s1",
      iterationId: 2,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      frozenHistoryText: "",
      assistantPrefill: "测试。",
      speakingDurationSeconds: 0.4,
      sentenceCount: 1,
    });

    expect(input.selfStatusText).toBe("（你已经连续说了 0 秒 / 1 句）");
  });

  it("uses the same system prompt as reaction mode", () => {
    const reactionInput = buildReactionInput({
      sessionId: "s1",
      iterationId: 0,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      historyText: "",
    });

    const continuationInput = buildContinuationInput({
      sessionId: "s1",
      iterationId: 1,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      frozenHistoryText: "",
      assistantPrefill: "测试。",
      speakingDurationSeconds: 1,
      sentenceCount: 1,
    });

    expect(reactionInput.systemPrompt).toBe(continuationInput.systemPrompt);
  });
});
