import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildReactionInput,
} from "../builders/reaction.js";

const allNames = ["Claude", "GPT-4o", "DeepSeek"];
const topic = "AI意识问题";

describe("buildSystemPrompt", () => {
  it("includes agent name, participants, topic, and rules", () => {
    const prompt = buildSystemPrompt("Claude", allNames, topic);

    expect(prompt).toContain("你是 Claude");
    expect(prompt).toContain("其他参与者：GPT-4o、DeepSeek");
    expect(prompt).toContain("话题：AI意识问题");
    expect(prompt).toContain("没有主持人");
    expect(prompt).toContain("[silence]");
  });

  it("snapshot: system prompt structure", () => {
    const prompt = buildSystemPrompt("Claude", allNames, topic);
    expect(prompt).toMatchSnapshot();
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
      projectedHistory: "- [1.0s] **GPT-4o**：\n  > 我先说一句。",
    });

    expect(input.mode).toBe("reaction");
    expect(input.sessionId).toBe("s1");
    expect(input.iterationId).toBe(3);
    expect(input.agentId).toBe("claude");
    expect(input.maxTokens).toBe(300);
    expect(input.userPromptText).toBe(
      "- [1.0s] **GPT-4o**：\n  > 我先说一句。\n\n---\n你要发言吗？",
    );
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
      projectedHistory: "",
    });

    expect(input.userPromptText).toBe("---\n你要发言吗？");
  });

  it("snapshot: first round input", () => {
    const input = buildReactionInput({
      sessionId: "s1",
      iterationId: 0,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      projectedHistory: "",
    });
    expect(input).toMatchSnapshot();
  });

  it("snapshot: normal round with history", () => {
    const input = buildReactionInput({
      sessionId: "s1",
      iterationId: 5,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      projectedHistory: [
        "- [0.0s] 讨论开始 — 话题：AI意识问题",
        "- [1.0s] **GPT-4o**：",
        "  > 这是一个有趣的话题。",
        "- [2.0s] **DeepSeek**：",
        "  > 我同意。",
      ].join("\n"),
    });
    expect(input).toMatchSnapshot();
  });

  it("snapshot: with collision context", () => {
    const input = buildReactionInput({
      sessionId: "s1",
      iterationId: 3,
      agentId: "claude",
      agentName: "Claude",
      allNames,
      topic,
      projectedHistory: [
        "- [0.0s] 讨论开始 — 话题：AI意识问题",
        "- [1.0s] **GPT-4o**：",
        "  > 说了什么。",
      ].join("\n"),
      collisionContext: {
        streak: 2,
        otherNames: ["GPT-4o", "DeepSeek"],
        frequentColliders: ["GPT-4o 出现了 2 次"],
      },
    });
    expect(input).toMatchSnapshot();
  });
});
