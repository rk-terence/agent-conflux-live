import { describe, it, expect } from "vitest";
import { runIteration } from "../engine.js";
import type { EngineIterationSuccess, EngineIterationFailure } from "../engine.js";
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

function expectSuccess(result: Awaited<ReturnType<typeof runIteration>>): asserts result is EngineIterationSuccess {
  if (!result.ok) {
    throw new Error(`Expected success but got failure: ${result.errors.map(e => e.message).join("; ")}`);
  }
}

function expectFailure(result: Awaited<ReturnType<typeof runIteration>>): asserts result is EngineIterationFailure {
  if (result.ok) {
    throw new Error("Expected failure but got success");
  }
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
    expectSuccess(result);

    expect(gw.calls).toHaveLength(3);
    expect(gw.calls.map(c => c.agentId).sort()).toEqual(["claude", "deepseek", "gpt"]);
    expect(gw.calls.every(c => c.mode === "reaction")).toBe(true);
  });

  it("produces silence backoff when all agents return [silence]", async () => {
    const state = initSession();
    const gw = new DummyGateway(() => "[silence]");

    const result = await runIteration(state, gw);
    expectSuccess(result);

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
    expectSuccess(result);

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
    expectSuccess(result);

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
    it("treats all-error as all-silence (no retry when everyone fails)", async () => {
      const state = initSession();
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => ({
        agentId: input.agentId,
        text: "timeout",
        finishReason: "error" as const,
      });

      const result = await runIteration(state, gw);
      // All errors → converted to silence → iteration succeeds
      expectSuccess(result);
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
      expectSuccess(result);
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
      expectSuccess(result);
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
      expectSuccess(result);
      // max_tokens is treated as speech now, so one agent spoke
      expect(result.events[0]).toMatchObject({ kind: "sentence_committed", speakerId: "claude" });
    });
  });

  it("exposes debug info on success", async () => {
    const state = initSession();
    const gw = new DummyGateway(() => "[silence]");

    const result = await runIteration(state, gw);
    expectSuccess(result);

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
    expectSuccess(r1);
    expect(r1.debug.iterationId).toBe(0);

    const r2 = await runIteration(r1.nextState, gw);
    expectSuccess(r2);
    expect(r2.debug.iterationId).toBe(1);
  });
});
