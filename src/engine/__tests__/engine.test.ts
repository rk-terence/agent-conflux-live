import { describe, it, expect } from "vitest";
import { runIteration } from "../engine.js";
import { createSession } from "../../domain/session.js";
import { DummyGateway } from "../../model-gateway/dummy.js";
import type { ModelCallInput } from "../../model-gateway/types.js";
import type { SessionState } from "../../domain/types.js";

// --- Helpers ---

const participants = [
  { agentId: "claude", name: "Claude" },
  { agentId: "gpt", name: "GPT-4o" },
  { agentId: "deepseek", name: "DeepSeek" },
];

function initSession(): SessionState {
  return createSession({
    sessionId: "test",
    topic: "AI意识",
    participants,
  }).nextState;
}

// --- Tests ---

describe("runIteration", () => {
  it("throws on ended phase", async () => {
    const state = { ...initSession(), phase: "ended" as const };
    const gw = new DummyGateway(() => "[silence]");
    await expect(runIteration(state, gw)).rejects.toThrow(/phase/);
  });

  it("calls all agents concurrently in turn_gap", async () => {
    const state = initSession();
    const gw = new DummyGateway(() => "[silence]");

    const result = await runIteration(state, gw);

    expect(gw.calls).toHaveLength(3);
    expect(gw.calls.map(c => c.agentId).sort()).toEqual(["claude", "deepseek", "gpt"]);
    expect(gw.calls.every(c => c.mode === "reaction")).toBe(true);
  });

  it("produces silence backoff when all agents return [silence]", async () => {
    const state = initSession();
    const gw = new DummyGateway(() => "[silence]");

    const result = await runIteration(state, gw);

    expect(result.nextState.phase).toBe("turn_gap");
    expect(result.nextState.silenceState.consecutiveCount).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ kind: "silence_extended" });
  });

  it("creates turn and ends it immediately when one agent speaks", async () => {
    const state = initSession();
    const gw = new DummyGateway((input: ModelCallInput) =>
      input.agentId === "gpt" ? "我先来说一个观点。" : "[silence]",
    );

    const result = await runIteration(state, gw);

    expect(result.nextState.phase).toBe("turn_gap");
    expect(result.nextState.currentTurn).toBeNull();
    expect(result.events[0]).toMatchObject({ kind: "sentence_committed", speakerId: "gpt" });
    expect(result.events[1]).toMatchObject({ kind: "turn_ended", speakerId: "gpt" });
  });

  it("produces gap collision when multiple agents speak", async () => {
    const state = initSession();
    const gw = new DummyGateway((input: ModelCallInput) =>
      input.agentId === "deepseek" ? "[silence]" : "我想说——这是一个好问题。",
    );

    const result = await runIteration(state, gw);

    expect(result.nextState.phase).toBe("turn_gap");
    expect(result.events[0]).toMatchObject({ kind: "collision", during: "gap" });
  });

  it("all agents use reaction mode (no continuation)", async () => {
    const state = initSession();
    const gw = new DummyGateway(() => "[silence]");

    await runIteration(state, gw);

    expect(gw.calls.every(c => c.mode === "reaction")).toBe(true);
  });

  describe("error handling", () => {
    it("treats all-error as all-silence (skip retry on total failure — likely provider outage)", async () => {
      const state = initSession();
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => ({
        agentId: input.agentId,
        text: "timeout",
        finishReason: "error" as const,
      });

      const result = await runIteration(state, gw);
      // All errors → converted to silence → iteration succeeds

      expect(result.nextState.silenceState.consecutiveCount).toBe(1);
    });

    it("retries only the failed agent, keeps successful responses", async () => {
      const state = initSession();
      let claudeCalls = 0;
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => {
        if (input.agentId === "claude") {
          claudeCalls++;
          if (claudeCalls <= 1) throw new Error("network error");
          // Second call (retry) succeeds
          return { agentId: input.agentId, text: "[silence]", finishReason: "completed" as const };
        }
        return { agentId: input.agentId, text: "[silence]", finishReason: "completed" as const };
      };

      const result = await runIteration(state, gw);

      // Claude was called twice (initial + retry), others once each
      expect(claudeCalls).toBe(2);
    });

    it("converts persistent errors to silence after retry", async () => {
      const state = initSession();
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => {
        if (input.agentId === "claude") throw new Error("always fails");
        return { agentId: input.agentId, text: "[silence]", finishReason: "completed" as const };
      };

      const result = await runIteration(state, gw);
      // Claude failed twice but was converted to silence

      expect(result.nextState.silenceState.consecutiveCount).toBe(1);
    });

    it("treats max_tokens as speech (not an error)", async () => {
      const state = initSession();
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => ({
        agentId: input.agentId,
        text: input.agentId === "claude" ? "半句话没说完但也算数" : "[silence]",
        finishReason: input.agentId === "claude" ? "max_tokens" as const : "completed" as const,
      });

      const result = await runIteration(state, gw);

      // max_tokens is treated as speech now, so one agent spoke
      expect(result.events[0]).toMatchObject({ kind: "sentence_committed", speakerId: "claude" });
    });
  });

  it("exposes debug info on success", async () => {
    const state = initSession();
    const gw = new DummyGateway(() => "[silence]");

    const result = await runIteration(state, gw);


    expect(result.debug.iterationId).toBe(0);
    expect(result.debug.callInputs).toHaveLength(3);
    expect(result.debug.rawOutputs).toHaveLength(3);
    expect(result.debug.normalizedResults).toHaveLength(3);
    expect(result.debug.wallClockMs).toBeGreaterThanOrEqual(0);
  });

  it("increments iterationId across successive calls", async () => {
    let state = initSession();
    const gw = new DummyGateway(() => "[silence]");

    const r1 = await runIteration(state, gw);

    expect(r1.debug.iterationId).toBe(0);

    const r2 = await runIteration(r1.nextState, gw);

    expect(r2.debug.iterationId).toBe(1);
  });

  it("negotiation projected history does not include the current collision", async () => {
    const state = initSession();
    // Two agents speak with same insistence → collision → Tier 2 negotiation
    const negotiationCalls: ModelCallInput[] = [];
    const gw = new DummyGateway(() => "");
    gw.generate = async (input) => {
      if (input.mode === "negotiation") {
        negotiationCalls.push(input);
        // First agent declares low so negotiation converges
        return {
          agentId: input.agentId,
          text: input.agentId === "claude"
            ? '{"insistence": "low"}'
            : '{"insistence": "high"}',
          finishReason: "completed" as const,
        };
      }
      // Reaction mode: claude and gpt speak (same insistence), deepseek silent
      return {
        agentId: input.agentId,
        text: input.agentId === "deepseek" ? "[silence]" : "我要说话。",
        finishReason: "completed" as const,
      };
    };

    await runIteration(state, gw);

    // Negotiation should have been triggered (both have "mid" insistence from fallback)
    expect(negotiationCalls.length).toBeGreaterThan(0);

    // On the first iteration, the only event before the collision is discussion_started.
    // The projected history (before the first \n\n separator) should contain only that,
    // not the collision description — which belongs to the turn directive.
    for (const call of negotiationCalls) {
      const text = call.userPromptText;
      // composeUserPrompt joins: projectedHistory + "\n\n" + turnDirective
      // So the first segment before "\n\n" is the projected history.
      const firstSeparator = text.indexOf("\n\n");
      const projectedHistoryPart = firstSeparator === -1 ? "" : text.slice(0, firstSeparator);
      expect(projectedHistoryPart).toContain("讨论开始");
      expect(projectedHistoryPart).not.toContain("同时开口");
    }
  });

  it("resolves collision via Tier 1 when insistence levels differ (zero negotiation calls)", async () => {
    const state = initSession();
    let negotiationCalls = 0;
    const gw = new DummyGateway(() => "");
    gw.generate = async (input) => {
      if (input.mode === "negotiation") {
        negotiationCalls++;
        return { agentId: input.agentId, text: '{"insistence": "mid"}', finishReason: "completed" as const };
      }
      // claude speaks with high insistence, gpt with low — Tier 1 should resolve
      if (input.agentId === "claude") {
        return { agentId: input.agentId, text: '{"speech": "我的观点。", "insistence": "high"}', finishReason: "completed" as const };
      }
      if (input.agentId === "gpt") {
        return { agentId: input.agentId, text: '{"speech": "我也想说。", "insistence": "low"}', finishReason: "completed" as const };
      }
      return { agentId: input.agentId, text: '{"speech": null, "insistence": "low"}', finishReason: "completed" as const };
    };

    const result = await runIteration(state, gw);

    // Tier 1 should resolve with zero negotiation calls
    expect(negotiationCalls).toBe(0);
    // collision_resolved event emitted with tier info
    const resolvedEvent = result.events.find(e => e.kind === "collision_resolved");
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent).toMatchObject({ kind: "collision_resolved", winnerId: "claude", tier: 1 });
    // claude won, speech committed
    expect(result.events.some(e => e.kind === "sentence_committed" && e.speakerId === "claude")).toBe(true);
    expect(result.debug.negotiation?.tier).toBe(1);

    // Event sequence: collision → collision_resolved → sentence_committed
    const kinds = result.events.map(e => e.kind);
    const collIdx = kinds.indexOf("collision");
    const resIdx = kinds.indexOf("collision_resolved");
    const speechIdx = kinds.indexOf("sentence_committed");
    expect(collIdx).toBeLessThan(resIdx);
    expect(resIdx).toBeLessThan(speechIdx);
  });
});
