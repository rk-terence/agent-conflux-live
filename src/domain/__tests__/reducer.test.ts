import { describe, it, expect } from "vitest";
import { reduceIteration } from "../reducer.js";
import { createSession } from "../session.js";
import type {
  SessionState,
  IterationResult,
  CurrentTurn,
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

function makeTurn(overrides: Partial<CurrentTurn> = {}): CurrentTurn {
  return {
    speakerId: "claude",
    startTime: 0,
    frozenHistorySnapshot: [],
    sentences: ["第一句话。"],
    sentenceTokenCounts: [20],
    speakingDuration: 20 * TOKEN_TO_SECONDS,
    sentenceCount: 1,
    ...overrides,
  };
}

function speakingState(turnOverrides: Partial<CurrentTurn> = {}, stateOverrides: Partial<SessionState> = {}): SessionState {
  return makeSession({
    phase: "speaking",
    currentTurn: makeTurn(turnOverrides),
    ...stateOverrides,
  });
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
        { agentId: "claude", output: { type: "speech", text: "你好", tokenCount: 10 } },
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

  describe("speaking phase — uninterrupted continuation", () => {
    it("appends sentence and advances time", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "第二句话。", tokenCount: 30 } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("speaking");
      expect(nextState.currentTurn!.sentences).toEqual(["第一句话。", "第二句话。"]);
      expect(nextState.currentTurn!.sentenceCount).toBe(2);
      expect(nextState.currentTurn!.speakingDuration).toBeCloseTo(
        20 * TOKEN_TO_SECONDS + 30 * TOKEN_TO_SECONDS,
      );
      expect(nextState.virtualTime).toBeCloseTo(30 * TOKEN_TO_SECONDS);
      expect(nextState.silenceState).toEqual({ consecutiveCount: 0, cumulativeSeconds: 0 });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "sentence_committed",
        speakerId: "claude",
        sentence: "第二句话。",
        tokenCount: 30,
        turnSentenceIndex: 1,
      });
    });
  });

  describe("speaking phase — collision during speech", () => {
    it("emits sentence + collision, transitions to turn_gap", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "继续说。", tokenCount: 20 } },
        { agentId: "gpt", output: { type: "speech", text: "等一下——", tokenCount: 15 } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("turn_gap");
      expect(nextState.currentTurn).toBeNull();

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ kind: "sentence_committed", speakerId: "claude" });
      expect(events[1]).toMatchObject({
        kind: "collision",
        during: "speech",
        utterances: [
          { agentId: "claude", text: "继续说。", tokenCount: 20 },
          { agentId: "gpt", text: "等一下——", tokenCount: 15 },
        ],
      });
    });

    it("includes multiple colliding listeners", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "继续。", tokenCount: 10 } },
        { agentId: "gpt", output: { type: "speech", text: "等等——", tokenCount: 8 } },
        { agentId: "deepseek", output: { type: "speech", text: "我也想说——", tokenCount: 12 } },
      ]);

      const { nextState, events } = reduceIteration(state, result);
      const collision = events.find(e => e.kind === "collision");
      expect(collision).toBeDefined();
      expect((collision as any).utterances).toHaveLength(3);
      expect(nextState.phase).toBe("turn_gap");
    });
  });

  describe("speaking phase — end of turn", () => {
    it("ends turn when speaker returns end_of_turn, no listeners speak", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "claude", output: { type: "end_of_turn" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("turn_gap");
      expect(nextState.currentTurn).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "turn_ended",
        speakerId: "claude",
        totalSentences: 1,
      });
    });

    it("discards listener speech at end of turn (they saw stale context)", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "claude", output: { type: "end_of_turn" } },
        { agentId: "gpt", output: { type: "speech", text: "我来说。", tokenCount: 25 } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      // Listener speech is discarded — they were reacting to "someone speaking"
      expect(nextState.phase).toBe("turn_gap");
      expect(nextState.currentTurn).toBeNull();
      expect(nextState.virtualTime).toBe(0); // no time advance
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "turn_ended", speakerId: "claude" });
    });

    it("discards multiple listener speech at end of turn", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "claude", output: { type: "end_of_turn" } },
        { agentId: "gpt", output: { type: "speech", text: "我来！", tokenCount: 20 } },
        { agentId: "deepseek", output: { type: "speech", text: "让我说！", tokenCount: 30 } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("turn_gap");
      expect(nextState.currentTurn).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "turn_ended" });
    });
  });

  describe("speaking phase — protocol errors", () => {
    it("throws when speaker is missing from results", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      expect(() => reduceIteration(state, result)).toThrow(/missing/);
    });

    it("throws when speaker returns silence in continuation mode", () => {
      const state = speakingState();
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      expect(() => reduceIteration(state, result)).toThrow(/protocol error/);
    });
  });

  describe("turn gap — single speaker claims floor", () => {
    it("creates new turn for the single speaker", () => {
      const state = makeSession({ phase: "turn_gap" });
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "speech", text: "我先说。", tokenCount: 50 } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("speaking");
      expect(nextState.currentTurn!.speakerId).toBe("gpt");
      expect(nextState.currentTurn!.startTime).toBe(0);
      expect(nextState.currentTurn!.sentences).toEqual(["我先说。"]);
      expect(nextState.virtualTime).toBeCloseTo(50 * TOKEN_TO_SECONDS);
      expect(nextState.silenceState).toEqual({ consecutiveCount: 0, cumulativeSeconds: 0 });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "sentence_committed",
        speakerId: "gpt",
        turnSentenceIndex: 0,
      });
    });

    it("stores frozen history snapshot BEFORE the speaker's first sentence", () => {
      const state = makeSession({ phase: "turn_gap" });
      const result = iter(0, [
        { agentId: "claude", output: { type: "silence" } },
        { agentId: "gpt", output: { type: "speech", text: "开始。", tokenCount: 10 } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState } = reduceIteration(state, result);
      // Snapshot is state.events BEFORE the sentence was added
      expect(nextState.currentTurn!.frozenHistorySnapshot).toEqual(state.events);
      // state.events should have the sentence, but snapshot should not
      expect(nextState.events.length).toBe(state.events.length + 1);
    });
  });

  describe("turn gap — collision", () => {
    it("emits gap collision when multiple agents speak", () => {
      const state = makeSession({ phase: "turn_gap" });
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "我觉得——", tokenCount: 20 } },
        { agentId: "gpt", output: { type: "speech", text: "首先——", tokenCount: 30 } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState, events } = reduceIteration(state, result);

      expect(nextState.phase).toBe("turn_gap");
      expect(nextState.currentTurn).toBeNull();
      expect(nextState.virtualTime).toBeCloseTo(30 * TOKEN_TO_SECONDS);

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
        { agentId: "claude", output: { type: "speech", text: "打破沉默。", tokenCount: 20 } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState } = reduceIteration(state, result);
      expect(nextState.silenceState).toEqual({ consecutiveCount: 0, cumulativeSeconds: 0 });
      expect(nextState.phase).toBe("speaking");
    });
  });

  describe("virtual time calculation", () => {
    it("advances time by tokenCount * 0.06", () => {
      const state = makeSession({ phase: "turn_gap", virtualTime: 10 });
      const result = iter(0, [
        { agentId: "claude", output: { type: "speech", text: "测试。", tokenCount: 50 } },
        { agentId: "gpt", output: { type: "silence" } },
        { agentId: "deepseek", output: { type: "silence" } },
      ]);

      const { nextState } = reduceIteration(state, result);
      expect(nextState.virtualTime).toBeCloseTo(10 + 50 * 0.06);
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
