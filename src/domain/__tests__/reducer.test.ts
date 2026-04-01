import { describe, it, expect } from "vitest";
import { reduceIteration } from "../reducer.js";
import { createSession } from "../session.js";
import type {
  SessionState,
  IterationResult,
} from "../types.js";
import { TOKEN_TO_SECONDS } from "../constants.js";

// --- Helpers ---

const participants = [
  { agentId: "claude", name: "Claude" },
  { agentId: "gpt", name: "GPT-4o" },
  { agentId: "deepseek", name: "DeepSeek" },
] as const;

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  const { nextState } = createSession({
    sessionId: "test",
    topic: "AI意识",
    participants,
  });
  return { ...nextState, ...overrides };
}

function iter(id: number, results: IterationResult["results"]): IterationResult {
  return { iterationId: id, results };
}

// --- Tests ---

describe("reduceIteration", () => {
  describe("no-op on terminal phases", () => {
    it("returns unchanged state when phase is ended", () => {
      const state = makeSession({ phase: "ended" });
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "你好", tokenCount: 10, insistence: "mid" } },
      ]);
      const { nextState, events } = reduceIteration(state, result);
      expect(nextState).toBe(state);
      expect(events).toEqual([]);
    });

    it("returns unchanged state when phase is idle", () => {
      const state = makeSession({ phase: "idle" });
      const result = iter(0, []);
      const { nextState, events } = reduceIteration(state, result);
      expect(nextState).toBe(state);
      expect(events).toEqual([]);
    });
  });

  describe("turn gap — single speaker claims floor", () => {
    it("commits sentence and ends turn immediately", () => {
      const state = makeSession({ phase: "turn_gap" });
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "speech", text: "我先说。", tokenCount: 50, insistence: "mid" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("turn_gap");
      expect(nextState.currentTurn).toBeNull();
      expect(nextState.virtualTime).toBeCloseTo(50 * TOKEN_TO_SECONDS);
      expect(nextState.silenceState).toEqual({ consecutiveCount: 0, cumulativeSeconds: 0 });

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        kind: "sentence_committed",
        speakerId: "gpt",
        turnSentenceIndex: 0,
      });
      expect(events[1]).toMatchObject({
        kind: "turn_ended",
        speakerId: "gpt",
        totalSentences: 1,
      });
    });
  });

  describe("turn gap — collision", () => {
    it("emits gap collision when multiple agents speak", () => {
      const state = makeSession({ phase: "turn_gap" });
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "我觉得——", tokenCount: 20, insistence: "mid" } },
        { agentId: "gpt", output: { type: "speech", text: "首先——", tokenCount: 30, insistence: "mid" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("turn_gap");
      expect(nextState.currentTurn).toBeNull();
      // 2 speakers × 0.5s per person = 1.0s
      expect(nextState.virtualTime).toBeCloseTo(1.0);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "collision",
        during: "gap",
        utterances: [
          { agentId: "claude", text: "我觉得——" },
          { agentId: "gpt", text: "首先——" },
        ],
      });
    });
  });

  describe("turn gap — silence backoff", () => {
    it("applies first backoff interval (1s)", () => {
      const state = makeSession({ phase: "turn_gap" });
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.virtualTime).toBe(1);
      expect(nextState.silenceState).toEqual({ consecutiveCount: 1, cumulativeSeconds: 1 });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "silence_extended",
        intervalSeconds: 1,
        cumulativeSeconds: 1,
      });
    });

    it("progresses through backoff schedule", () => {
      let state = makeSession({ phase: "turn_gap" });
      const allSilent = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const expectedIntervals = [1, 2, 4, 8, 16];
      let cumulative = 0;

      for (let i = 0; i < expectedIntervals.length; i++) {
        const { nextState, events } = reduceIteration(state, { ...allSilent, iterationId: i });
        cumulative += expectedIntervals[i];

        expect(nextState.silenceState.consecutiveCount).toBe(i + 1);
        expect(nextState.silenceState.cumulativeSeconds).toBe(cumulative);
        expect(events[0]).toMatchObject({
          kind: "silence_extended",
          intervalSeconds: expectedIntervals[i],
        });

        state = nextState;
      }
    });

    it("caps backoff at 16s", () => {
      const state = makeSession({
        phase: "turn_gap",
        silenceState: { consecutiveCount: 10, cumulativeSeconds: 40 },
      });
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);
      expect(events[0]).toMatchObject({ kind: "silence_extended", intervalSeconds: 16 });
      expect(nextState.silenceState.cumulativeSeconds).toBe(56);
    });

    it("ends discussion when cumulative silence >= 60s", () => {
      const state = makeSession({
        phase: "turn_gap",
        silenceState: { consecutiveCount: 5, cumulativeSeconds: 55 },
      });
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("ended");
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ kind: "silence_extended" });
      expect(events[1]).toMatchObject({ kind: "discussion_ended", reason: "silence_timeout" });
    });
  });

  describe("silence reset on speech", () => {
    it("resets silence state when someone speaks after silence", () => {
      const state = makeSession({
        phase: "turn_gap",
        silenceState: { consecutiveCount: 3, cumulativeSeconds: 7 },
      });
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "打破沉默。", tokenCount: 20, insistence: "mid" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState } = reduceIteration(state, result);
      expect(nextState.silenceState).toEqual({ consecutiveCount: 0, cumulativeSeconds: 0 });
      expect(nextState.phase).toBe("turn_gap");
    });
  });

  describe("virtual time calculation", () => {
    it("advances time by tokenCount * TOKEN_TO_SECONDS", () => {
      const state = makeSession({ phase: "turn_gap", virtualTime: 10 });
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "测试。", tokenCount: 50, insistence: "mid" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState } = reduceIteration(state, result);
      expect(nextState.virtualTime).toBeCloseTo(10 + 50 * TOKEN_TO_SECONDS);
    });
  });

  describe("iteration count", () => {
    it("increments on each iteration", () => {
      const state = makeSession({ phase: "turn_gap", iterationCount: 5 });
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState } = reduceIteration(state, result);
      expect(nextState.iterationCount).toBe(6);
    });
  });
});
