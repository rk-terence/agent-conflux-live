import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildReactionInput,
} from "../builder.js";

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
    expect(input.maxTokens).toBe(300);
    expect(input.historyText).toBe("[GPT-4o]: 我先说一句。\n\n---\n你要发言吗？");
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

    expect(input.historyText).toBe("---\n你要发言吗？");
  });
});
