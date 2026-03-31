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

  it("creates new turn when one agent speaks at turn_gap", async () => {
    const state = initSession();
    const gw = new DummyGateway((input: ModelCallInput) =>
      input.agentId === "gpt" ? "我先来说一个观点。" : "[silence]",
    );

    const result = await runIteration(state, gw);
    expectSuccess(result);

    expect(result.nextState.phase).toBe("speaking");
    expect(result.nextState.currentTurn!.speakerId).toBe("gpt");
    expect(result.events[0]).toMatchObject({ kind: "sentence_committed", speakerId: "gpt" });
  });

  it("produces gap collision when multiple agents speak", async () => {
    const state = initSession();
    const gw = new DummyGateway((input: ModelCallInput) =>
      input.agentId === "deepseek" ? "[silence]" : "我想说——",
    );

    const result = await runIteration(state, gw);
    expectSuccess(result);

    expect(result.nextState.phase).toBe("turn_gap");
    expect(result.events[0]).toMatchObject({ kind: "collision", during: "gap" });
  });

  it("uses continuation mode for current speaker", async () => {
    let state = initSession();
    const gw = new DummyGateway((input: ModelCallInput) => {
      if (input.mode === "reaction") {
        return input.agentId === "claude" ? "我有一个想法。" : "[silence]";
      }
      return "让我继续说。";
    });

    const r1 = await runIteration(state, gw);
    expectSuccess(r1);
    expect(r1.nextState.currentTurn!.speakerId).toBe("claude");

    gw.calls.length = 0;
    const r2 = await runIteration(r1.nextState, gw);
    expectSuccess(r2);

    const speakerCall = gw.calls.find(c => c.agentId === "claude")!;
    expect(speakerCall.mode).toBe("continuation");
    expect(speakerCall.assistantPrefill).toBe("我有一个想法。");
    expect(speakerCall.stopSequences).toEqual(["。", "！", "？", "\n"]);

    const listenerCalls = gw.calls.filter(c => c.agentId !== "claude");
    expect(listenerCalls.every(c => c.mode === "reaction")).toBe(true);
  });

  it("handles collision during speech", async () => {
    let state = initSession();
    let callCount = 0;
    const gw = new DummyGateway((input: ModelCallInput) => {
      if (callCount < 3) {
        callCount++;
        return input.agentId === "claude" ? "我有想法。" : "[silence]";
      }
      if (input.agentId === "claude") return "继续说。";
      if (input.agentId === "gpt") return "等一下——";
      return "[silence]";
    });

    const r1 = await runIteration(state, gw);
    expectSuccess(r1);
    const r2 = await runIteration(r1.nextState, gw);
    expectSuccess(r2);

    expect(r2.nextState.phase).toBe("turn_gap");
    expect(r2.events.some(e => e.kind === "collision")).toBe(true);
  });

  it("handles end of turn (empty continuation)", async () => {
    let state = initSession();
    let iteration = 0;
    const gw = new DummyGateway((input: ModelCallInput) => {
      if (iteration === 0) {
        return input.agentId === "claude" ? "一句话。" : "[silence]";
      }
      if (input.mode === "continuation") return "";
      return "[silence]";
    });

    const r1 = await runIteration(state, gw);
    expectSuccess(r1);
    iteration = 1;
    const r2 = await runIteration(r1.nextState, gw);
    expectSuccess(r2);

    expect(r2.nextState.phase).toBe("turn_gap");
    expect(r2.events[0]).toMatchObject({ kind: "turn_ended" });
  });

  describe("error handling", () => {
    it("returns failure with debug when gateway returns error finishReason", async () => {
      const state = initSession();
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => ({
        agentId: input.agentId,
        text: "timeout",
        finishReason: "error" as const,
      });

      const result = await runIteration(state, gw);
      expectFailure(result);

      expect(result.errors.length).toBe(3);
      expect(result.errors[0].message).toContain("timeout");
      // Debug info is available even on failure
      expect(result.debug.callInputs).toHaveLength(3);
      expect(result.debug.rawOutputs).toHaveLength(3);
      expect(result.debug.normalizedResults).toHaveLength(3);
    });

    it("catches gateway Promise rejections with full debug", async () => {
      const state = initSession();
      const gw = new DummyGateway(() => "");
      gw.generate = async () => {
        throw new Error("ECONNREFUSED");
      };

      const result = await runIteration(state, gw);
      expectFailure(result);

      expect(result.errors[0].message).toContain("ECONNREFUSED");
      expect(result.debug.rawOutputs).toHaveLength(3);
      expect(result.debug.rawOutputs.every(o => o.finishReason === "error")).toBe(true);
    });

    it("returns failure on max_tokens truncation", async () => {
      const state = initSession();
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => ({
        agentId: input.agentId,
        text: "半句话没说完",
        finishReason: "max_tokens" as const,
      });

      const result = await runIteration(state, gw);
      expectFailure(result);

      expect(result.errors[0].message).toContain("truncated");
    });

    it("returns failure only for errored agents, preserving others in debug", async () => {
      const state = initSession();
      let callIndex = 0;
      const gw = new DummyGateway(() => "");
      gw.generate = async (input) => {
        callIndex++;
        if (input.agentId === "claude") {
          throw new Error("network error");
        }
        return {
          agentId: input.agentId,
          text: "[silence]",
          finishReason: "completed" as const,
        };
      };

      const result = await runIteration(state, gw);
      expectFailure(result);

      // Only claude errored
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].agentId).toBe("claude");
      // But debug has all 3 results
      expect(result.debug.normalizedResults).toHaveLength(3);
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

  it("uses frozen history for speaker, current history for listeners", async () => {
    let state = initSession();
    const gw = new DummyGateway((input: ModelCallInput) => {
      if (input.mode === "reaction") {
        return input.agentId === "claude" ? "我开始说。" : "[silence]";
      }
      return "继续。";
    });

    const r1 = await runIteration(state, gw);
    expectSuccess(r1);
    gw.calls.length = 0;

    await runIteration(r1.nextState, gw);

    const speakerCall = gw.calls.find(c => c.agentId === "claude")!;
    const listenerCall = gw.calls.find(c => c.agentId === "gpt")!;

    expect(speakerCall.historyText).not.toContain("正在说");
    expect(listenerCall.historyText).toContain("正在说");
  });

  it("speaker self-status reflects current turn state", async () => {
    let state = initSession();
    const gw = new DummyGateway((input: ModelCallInput) => {
      if (input.mode === "reaction") {
        return input.agentId === "claude" ? "第一句。" : "[silence]";
      }
      return "第二句。";
    });

    const r1 = await runIteration(state, gw);
    expectSuccess(r1);
    gw.calls.length = 0;
    await runIteration(r1.nextState, gw);

    const speakerCall = gw.calls.find(c => c.agentId === "claude")!;
    expect(speakerCall.selfStatusText).toContain("1 句");
    expect(speakerCall.mode).toBe("continuation");
  });
});
