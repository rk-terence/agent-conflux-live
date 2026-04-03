import type {
  SessionState,
  SessionObserver,
  LLMClient,
  AgentState,
  InsistenceLevel,
  InterruptionInfo,
  JudgeResult,
  DefenseResult,
} from "../types.js";
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
): Promise<InterruptionInfo | null> {
  const tokenCount = createTokenCounter(session.config.tokenCounter);

  // 1. Attempt split
  const split = splitUtterance(speaker.utterance, session.config.interruptionThreshold, tokenCount);
  if (split === null) return null;

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

      let result: JudgeResult;
      try {
        const raw = await withRetry(() => client.chat(prompt), session.config.apiRetries);
        result = normalizeJudge(raw);
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
  if (interrupters.length === 0) return null;

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
  const speakerClient = clients.get(speaker.name)!;

  let defenseResult: DefenseResult;
  try {
    const raw = await withRetry(() => speakerClient.chat(defensePrompt), session.config.apiRetries);
    defenseResult = normalizeDefense(raw);
  } catch (err) {
    if (err instanceof RetryExhaustedError) {
      defenseResult = { yield: true, thought: null };
    } else {
      throw err;
    }
  }

  recordThought(session, session.currentTurn, speaker.name, "defense", defenseResult.thought, observer);

  return {
    interrupter: representative.listener.name,
    urgency: representative.result.urgency,
    reason: representative.result.reason,
    spokenPart,
    unspokenPart,
    success: defenseResult.yield,
  };
}
