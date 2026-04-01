import { describe, it, expect } from "vitest";
import { buildNegotiationInput } from "../builders/negotiation.js";

const candidates = [
  { agentId: "claude", agentName: "Claude", utterance: "我觉得AI是有意识的", insistence: "high" as const },
  { agentId: "gpt", agentName: "GPT-4o", utterance: "意识是个哲学问题", insistence: "high" as const },
];

const allNames = ["Claude", "GPT-4o", "DeepSeek"];
const topic = "AI意识问题";

describe("buildNegotiationInput", () => {
  it("snapshot: first round, no prior history", () => {
    const input = buildNegotiationInput(
      1,
      candidates[0],
      candidates,
      [],
      candidates,
      allNames,
      topic,
      "",
      "s1",
      2,
    );
    expect(input).toMatchSnapshot();
  });

  it("snapshot: first round with discussion history", () => {
    const history = "- [0.5s] **DeepSeek**：\n  > 大家好。\n- [1.0s] **你**：\n  > 你好。\n- [1.5s] **GPT-4o**：\n  > 开始吧。";
    const input = buildNegotiationInput(
      1,
      candidates[0],
      candidates,
      [],
      candidates,
      allNames,
      topic,
      history,
      "s1",
      3,
    );
    expect(input).toMatchSnapshot();
  });

  it("snapshot: round 2 with previous round results (deadlock)", () => {
    const previousRounds = [
      {
        round: 1,
        decisions: [
          { agentId: "claude", agentName: "Claude", insistence: "high" as const },
          { agentId: "gpt", agentName: "GPT-4o", insistence: "high" as const },
        ],
      },
    ];
    const history = "- [1.0s] **DeepSeek**：\n  > 讨论中。";
    const input = buildNegotiationInput(
      2,
      candidates[0],
      candidates,
      previousRounds,
      candidates,
      allNames,
      topic,
      history,
      "s1",
      4,
    );
    expect(input).toMatchSnapshot();
  });

  it("snapshot: with @mention hint", () => {
    // History where someone @-mentioned Claude AFTER Claude's last speech
    const history = "- [1.0s] **你**：\n  > 我之前说过了。\n- [2.0s] **GPT-4o**：\n  > @Claude 你怎么看？";
    const input = buildNegotiationInput(
      1,
      candidates[0],
      candidates,
      [],
      candidates,
      allNames,
      topic,
      history,
      "s1",
      5,
    );
    expect(input).toMatchSnapshot();
    expect(input.userPromptText).toContain("点名向你（@Claude）提问");
  });

  it("does not include mention hint when mention is before collision-winner speech", () => {
    const history = "- [1.0s] **GPT-4o**：\n  > @Claude 你怎么看？\n- [2.0s] 你和 GPT-4o 同时开口了，经过协商你获得了发言权\n  你说：\n  > 我回应了。";
    const input = buildNegotiationInput(
      1,
      candidates[0],
      candidates,
      [],
      candidates,
      allNames,
      topic,
      history,
      "s1",
      5,
    );
    expect(input.userPromptText).not.toContain("点名向你");
  });

  it("does not include mention hint when mention is before last speech", () => {
    const history = "- [1.0s] **GPT-4o**：\n  > @Claude 你先说。\n- [2.0s] **你**：\n  > 好的我说了。";
    const input = buildNegotiationInput(
      1,
      candidates[0],
      candidates,
      [],
      candidates,
      allNames,
      topic,
      history,
      "s1",
      5,
    );
    expect(input.userPromptText).not.toContain("点名向你");
  });

  it("uses NEGOTIATION_MAX_TOKENS (30)", () => {
    const input = buildNegotiationInput(
      1,
      candidates[0],
      candidates,
      [],
      candidates,
      allNames,
      topic,
      "",
      "s1",
      1,
    );
    expect(input.maxTokens).toBe(30);
  });

  it("uses negotiation mode", () => {
    const input = buildNegotiationInput(
      1,
      candidates[0],
      candidates,
      [],
      candidates,
      allNames,
      topic,
      "",
      "s1",
      1,
    );
    expect(input.mode).toBe("negotiation");
  });
});
