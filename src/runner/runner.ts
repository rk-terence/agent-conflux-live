import type { SessionState, DomainEvent, Participant } from "../domain/types.js";
import type { ModelGateway } from "../model-gateway/types.js";
import { createSession, endDiscussion } from "../domain/session.js";
import { runIteration, EngineFatalError } from "../engine/engine.js";
import type { IterationDebugInfo } from "../engine/engine.js";

export type DiscussionConfig = {
  sessionId: string;
  topic: string;
  participants: readonly Participant[];
  gateway: ModelGateway;
  /** Delay between iterations in ms (for UI rendering) */
  iterationDelayMs?: number;
  /** Virtual duration limit in seconds. Discussion ends when virtualTime exceeds this. */
  maxVirtualDurationSeconds?: number;
};

export type DiscussionError =
  { type: "fatal"; error: unknown; message: string; debug: IterationDebugInfo | null };

export type DiscussionCallbacks = {
  onStateChange: (state: SessionState) => void;
  onEvents: (events: readonly DomainEvent[]) => void;
  onDebug?: (debug: IterationDebugInfo) => void;
  onError?: (error: DiscussionError) => void;
  onEnd?: (state: SessionState) => void;
};

export type DiscussionControls = {
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

export function startDiscussion(
  config: DiscussionConfig,
  callbacks: DiscussionCallbacks,
): DiscussionControls {
  const { sessionId, topic, participants, gateway } = config;
  const delayMs = config.iterationDelayMs ?? 300;
  const maxDuration = config.maxVirtualDurationSeconds ?? Infinity;

  let paused = false;
  let stopped = false;
  const abortController = new AbortController();

  // Helper: terminate through domain, emit canonical state + events
  const terminate = (
    currentState: SessionState,
    reason: "manual" | "duration_limit" | "fatal_error",
  ): SessionState => {
    const { nextState, events: endEvents } = endDiscussion(currentState, reason);
    callbacks.onStateChange(nextState);
    callbacks.onEvents(endEvents);
    callbacks.onEnd?.(nextState);
    return nextState;
  };

  const { nextState: initialState, events: startEvents } = createSession({
    sessionId,
    topic,
    participants,
  });

  callbacks.onStateChange(initialState);
  callbacks.onEvents(startEvents);

  // Mutable reference so stop() can access the latest state for manual termination
  let currentState = initialState;

  (async () => {
    let state = initialState;

    try {
      while (state.phase !== "ended" && !stopped) {
        while (paused && !stopped) {
          await delay(100);
        }
        if (stopped) break;

        const result = await runIteration(state, gateway, abortController.signal);

        if (stopped) break;

        state = result.nextState;
        currentState = state;
        callbacks.onStateChange(state);
        callbacks.onEvents(result.events);
        callbacks.onDebug?.(result.debug);

        // Check virtual duration limit
        if (state.virtualTime >= maxDuration && state.phase !== "ended") {
          state = terminate(state, "duration_limit");
          currentState = state;
          break;
        }

        if (state.phase === "ended") {
          callbacks.onEnd?.(state);
          break;
        }

        await delay(delayMs);
      }

      // Manual stop: produce canonical termination
      if (stopped && state.phase !== "ended") {
        terminate(state, "manual");
      }
    } catch (err: unknown) {
      const debug = err instanceof EngineFatalError ? err.debug : null;
      callbacks.onError?.({
        type: "fatal",
        error: err,
        message: err instanceof Error ? err.message : String(err),
        debug,
      });
      // Fatal: terminate through domain with distinct reason
      terminate(state, "fatal_error");
    }
  })();

  return {
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    stop() {
      stopped = true;
      abortController.abort();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
