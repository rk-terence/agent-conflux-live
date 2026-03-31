import { describe, it, expect } from "vitest";
import { createSession } from "../session.js";

describe("createSession", () => {
  const params = {
    sessionId: "s1",
    topic: "AI意识问题",
    participants: [
      { agentId: "claude", name: "Claude" },
      { agentId: "gpt", name: "GPT-4o" },
    ],
  };

  it("returns initial state with turn_gap phase", () => {
    const { nextState } = createSession(params);

    expect(nextState.sessionId).toBe("s1");
    expect(nextState.topic).toBe("AI意识问题");
    expect(nextState.participants).toEqual(params.participants);
    expect(nextState.phase).toBe("turn_gap");
    expect(nextState.virtualTime).toBe(0);
    expect(nextState.currentTurn).toBeNull();
    expect(nextState.silenceState).toEqual({ consecutiveCount: 0, cumulativeSeconds: 0 });
    expect(nextState.iterationCount).toBe(0);
  });

  it("emits exactly one discussion_started event", () => {
    const { events } = createSession(params);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "discussion_started",
      timestamp: 0,
      topic: "AI意识问题",
      participants: params.participants,
    });
  });

  it("includes the start event in state.events", () => {
    const { nextState, events } = createSession(params);
    expect(nextState.events).toEqual(events);
  });
});
