import { randomUUID } from "node:crypto";
import type {
  SessionState,
  SessionObserver,
  LLMClient,
  AgentState,
  InsistenceLevel,
  InterruptionInfo,
  JudgeResult,
  DefenseResult,
  PromptMode,
} from "../types.js";
import type { LogContext } from "../log-context.js";
import type { InterruptionEvalInfo } from "../log-types.js";
import { splitUtterance } from "../util/sentence-split.js";
import { createTokenCounter } from "../util/token-count.js";
import { buildJudgePrompt, buildDefensePrompt } from "../prompt/prompt-builder.js";
import { normalizeJudge } from "../normalize/judge.js";
import { normalizeDefense } from "../normalize/defense.js";
import { withRetry, RetryExhaustedError } from "../llm/retry.js";
import { recordThought } from "../state/session.js";

const INSISTENCE_ORDER: Record<InsistenceLevel, number> = { low: 0, mid: 1, high: 2 };

interface SpeakerInfo {
  agent: AgentState;
  name: string;
  utterance: string;
}

export async function evaluateInterruption(
  session: SessionState,
  clients: Map<string, LLMClient>,
  speaker: SpeakerInfo,
  effectiveInsistence: InsistenceLevel,
  observer?: SessionObserver,
  logCtx?: LogContext,
): Promise<InterruptionInfo | null> {
  const tokenCount = createTokenCounter(session.config.tokenCounter);

  // 1. Attempt split
  const split = splitUtterance(speaker.utterance, session.config.interruptionThreshold, tokenCount);
  if (split === null) {
    // Emit evaluation event for no-split case
    observer?.onInterruptionEvaluation?.({
      turn: session.currentTurn,
      speaker: speaker.name,
      spokenPartChars: speaker.utterance.length,
      unspokenPartChars: 0,
      listeners: session.agents.filter((a) => a.name !== speaker.name).map((a) => a.name),
      interruptRequested: [],
      urgencies: [],
      representative: null,
      representativeUrgency: null,
      resolutionMethod: "no_split",
      defenseYielded: null,
      finalResult: false,
    });
    return null;
  }

  const { spokenPart, unspokenPart } = split;

  // 2. Determine listeners: all agents except the speaker
  const listeners = session.agents.filter((a) => a.name !== speaker.name);

  // 3–6. Build judge prompts and call LLM in parallel
  const judgeResults = await Promise.all(
    listeners.map(async (listener) => {
      const prompt = buildJudgePrompt(listener, session, {
        speakerName: speaker.name,
        spokenPart,
      });
      const client = clients.get(listener.name)!;

      const callId = randomUUID();
      const request = {
        ...prompt,
        _meta: {
          callId,
          turn: session.currentTurn,
          agent: listener.name,
          mode: "judge" as PromptMode,
          attempt: 0,
          provider: listener.config.provider,
          historyChars: prompt.historyChars,
          directiveChars: prompt.directiveChars,
        },
      };

      let result: JudgeResult;
      try {
        const raw = await withRetry(
          () => client.chat(request),
          session.config.apiRetries,
          (attempt) => { request._meta!.attempt = attempt; },
        );
        const withMeta = normalizeJudge(raw);
        result = withMeta;

        // Emit normalize_result
        observer?.onNormalizeResult?.({
          callId,
          agent: listener.name,
          mode: "judge",
          rawKind: withMeta._normMeta.rawKind,
          jsonExtracted: withMeta._normMeta.jsonExtracted,
          fallbackPath: withMeta._normMeta.fallbackPath,
          truncationSuspected: withMeta._normMeta.truncationSuspected,
          thoughtType: withMeta._normMeta.thoughtType,
          payload: { interrupt: withMeta.interrupt, urgency: withMeta.urgency, reason: withMeta.reason, thought: withMeta.thought },
        });
      } catch (err) {
        if (err instanceof RetryExhaustedError) {
          result = { interrupt: false, urgency: "low", reason: null, thought: null };
        } else {
          throw err;
        }
      }

      // 7. Update thoughts for all listeners
      recordThought(session, session.currentTurn, listener.name, "judge", result.thought, observer);
      return { listener, result };
    }),
  );

  // 8. Filter for interrupt: true
  const interrupters = judgeResults.filter(({ result }) => result.interrupt);
  if (interrupters.length === 0) {
    // Emit evaluation event
    observer?.onInterruptionEvaluation?.({
      turn: session.currentTurn,
      speaker: speaker.name,
      spokenPartChars: spokenPart.length,
      unspokenPartChars: unspokenPart.length,
      listeners: listeners.map((l) => l.name),
      interruptRequested: [],
      urgencies: judgeResults.map(({ listener, result }) => ({ agent: listener.name, urgency: result.urgency })),
      representative: null,
      representativeUrgency: null,
      resolutionMethod: "no_interrupt",
      defenseYielded: null,
      finalResult: false,
    });
    return null;
  }

  // 9. Select representative: highest urgency, ties broken randomly
  const maxUrgency = Math.max(...interrupters.map(({ result }) => INSISTENCE_ORDER[result.urgency]));
  const topInterrupters = interrupters.filter(
    ({ result }) => INSISTENCE_ORDER[result.urgency] === maxUrgency,
  );
  const representative = topInterrupters[Math.floor(Math.random() * topInterrupters.length)];

  // Phase 1 — Auto-resolution
  const speakerLevel = INSISTENCE_ORDER[effectiveInsistence];
  const interrupterLevel = INSISTENCE_ORDER[representative.result.urgency];

  if (interrupterLevel > speakerLevel) {
    // Emit evaluation event
    observer?.onInterruptionEvaluation?.({
      turn: session.currentTurn,
      speaker: speaker.name,
      spokenPartChars: spokenPart.length,
      unspokenPartChars: unspokenPart.length,
      listeners: listeners.map((l) => l.name),
      interruptRequested: interrupters.map(({ listener }) => listener.name),
      urgencies: judgeResults.map(({ listener, result }) => ({ agent: listener.name, urgency: result.urgency })),
      representative: representative.listener.name,
      representativeUrgency: representative.result.urgency,
      resolutionMethod: "auto_win",
      defenseYielded: null,
      finalResult: true,
    });
    return {
      interrupter: representative.listener.name,
      urgency: representative.result.urgency,
      reason: representative.result.reason,
      spokenPart,
      unspokenPart,
      success: true,
    };
  }

  if (interrupterLevel < speakerLevel) {
    // Emit evaluation event
    observer?.onInterruptionEvaluation?.({
      turn: session.currentTurn,
      speaker: speaker.name,
      spokenPartChars: spokenPart.length,
      unspokenPartChars: unspokenPart.length,
      listeners: listeners.map((l) => l.name),
      interruptRequested: interrupters.map(({ listener }) => listener.name),
      urgencies: judgeResults.map(({ listener, result }) => ({ agent: listener.name, urgency: result.urgency })),
      representative: representative.listener.name,
      representativeUrgency: representative.result.urgency,
      resolutionMethod: "auto_lose",
      defenseYielded: null,
      finalResult: false,
    });
    return {
      interrupter: representative.listener.name,
      urgency: representative.result.urgency,
      reason: representative.result.reason,
      spokenPart,
      unspokenPart,
      success: false,
    };
  }

  // Phase 2 — Ask the speaker
  const defensePrompt = buildDefensePrompt(speaker.agent, session, {
    spokenPart,
    unspokenPart,
    interrupterName: representative.listener.name,
    reason: representative.result.reason,
  });

  const defenseCallId = randomUUID();
  const defenseRequest = {
    ...defensePrompt,
    _meta: {
      callId: defenseCallId,
      turn: session.currentTurn,
      agent: speaker.name,
      mode: "defense" as PromptMode,
      attempt: 0,
      provider: speaker.agent.config.provider,
      historyChars: defensePrompt.historyChars,
      directiveChars: defensePrompt.directiveChars,
    },
  };

  const speakerClient = clients.get(speaker.name)!;

  let defenseResult: DefenseResult;
  try {
    const raw = await withRetry(
      () => speakerClient.chat(defenseRequest),
      session.config.apiRetries,
      (attempt) => { defenseRequest._meta!.attempt = attempt; },
    );
    const withMeta = normalizeDefense(raw);
    defenseResult = withMeta;

    // Emit normalize_result
    observer?.onNormalizeResult?.({
      callId: defenseCallId,
      agent: speaker.name,
      mode: "defense",
      rawKind: withMeta._normMeta.rawKind,
      jsonExtracted: withMeta._normMeta.jsonExtracted,
      fallbackPath: withMeta._normMeta.fallbackPath,
      truncationSuspected: withMeta._normMeta.truncationSuspected,
      thoughtType: withMeta._normMeta.thoughtType,
      payload: { yield: withMeta.yield, thought: withMeta.thought },
    });
  } catch (err) {
    if (err instanceof RetryExhaustedError) {
      defenseResult = { yield: true, thought: null };
    } else {
      throw err;
    }
  }

  recordThought(session, session.currentTurn, speaker.name, "defense", defenseResult.thought, observer);

  // Emit evaluation event
  observer?.onInterruptionEvaluation?.({
    turn: session.currentTurn,
    speaker: speaker.name,
    spokenPartChars: spokenPart.length,
    unspokenPartChars: unspokenPart.length,
    listeners: listeners.map((l) => l.name),
    interruptRequested: interrupters.map(({ listener }) => listener.name),
    urgencies: judgeResults.map(({ listener, result }) => ({ agent: listener.name, urgency: result.urgency })),
    representative: representative.listener.name,
    representativeUrgency: representative.result.urgency,
    resolutionMethod: "defense",
    defenseYielded: defenseResult.yield,
    finalResult: defenseResult.yield,
  });

  return {
    interrupter: representative.listener.name,
    urgency: representative.result.urgency,
    reason: representative.result.reason,
    spokenPart,
    unspokenPart,
    success: defenseResult.yield,
  };
}
