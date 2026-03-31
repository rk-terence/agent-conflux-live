import type { ModelCallInput } from "../model-gateway/types.js";
import {
  REACTION_MAX_TOKENS,
  CONTINUATION_MAX_TOKENS,
  CONTINUATION_STOP_SEQUENCES,
} from "./constants.js";

export type CollisionContext = {
  /** How many consecutive collisions have occurred */
  readonly streak: number;
  /** Names of others in the most recent collision (from this agent's perspective) */
  readonly otherNames: readonly string[];
  /** Per-participant collision count in the recent streak, e.g. "Gemini 出现了 3 次" */
  readonly frequentColliders: readonly string[];
};

export function buildSystemPrompt(
  agentName: string,
  allNames: readonly string[],
  topic: string,
): string {
  return (
    `你是 ${agentName}，在一个自由圆桌讨论中。` +
    ` 参与者：${allNames.join("、")}。` +
    `话题：${topic}` +
    ` 规则：` +
    ` - 没有主持人，自由发言` +
    ` - 展现你的独特思维和性格` +
    ` - 可以 @某人 回应` +
    ` - 用中文` +
    ` - 只输出你说的话，不要输出动作描写、括号注释或旁白` +
    ` - 如果你没有想说的，回复 [silence]` +
    ` - 沉默是完全正常的，不需要每次都发言`
  );
}

export type ReactionParams = {
  readonly sessionId: string;
  readonly iterationId: number;
  readonly agentId: string;
  readonly agentName: string;
  readonly allNames: readonly string[];
  readonly topic: string;
  readonly historyText: string;
  /** Collision context for situational awareness */
  readonly collisionContext?: CollisionContext;
  readonly abortSignal?: AbortSignal;
};

export function buildReactionInput(params: ReactionParams): ModelCallInput {
  const systemPrompt = buildSystemPrompt(params.agentName, params.allNames, params.topic);

  let historyText = params.historyText
    ? `${params.historyText}\n\n---\n你的反应？`
    : "---\n你的反应？";

  // Collision context — factual observation, no behavioral prescription
  if (params.collisionContext && params.collisionContext.streak > 0) {
    const ctx = params.collisionContext;
    const parts: string[] = [];
    parts.push(`已经连续 ${ctx.streak} 次出现多人同时发言的情况。`);
    if (ctx.frequentColliders.length > 0) {
      parts.push(`其中 ${ctx.frequentColliders.join("、")} 每次都在抢话。`);
    }
    historyText += `\n（${parts.join("")}）`;
  }

  return {
    sessionId: params.sessionId,
    iterationId: params.iterationId,
    agentId: params.agentId,
    mode: "reaction",
    systemPrompt,
    historyText,
    maxTokens: REACTION_MAX_TOKENS,
    abortSignal: params.abortSignal,
  };
}

export type ContinuationParams = {
  readonly sessionId: string;
  readonly iterationId: number;
  readonly agentId: string;
  readonly agentName: string;
  readonly allNames: readonly string[];
  readonly topic: string;
  readonly frozenHistoryText: string;
  readonly assistantPrefill: string;
  readonly speakingDurationSeconds: number;
  readonly sentenceCount: number;
  readonly abortSignal?: AbortSignal;
};

export function buildContinuationInput(params: ContinuationParams): ModelCallInput {
  const systemPrompt = buildSystemPrompt(params.agentName, params.allNames, params.topic);
  const elapsed = Math.round(params.speakingDurationSeconds);
  const selfStatus = `（你已经连续说了 ${elapsed} 秒 / ${params.sentenceCount} 句）`;

  const historyText = params.frozenHistoryText
    ? `${params.frozenHistoryText}\n${selfStatus}`
    : selfStatus;

  return {
    sessionId: params.sessionId,
    iterationId: params.iterationId,
    agentId: params.agentId,
    mode: "continuation",
    systemPrompt,
    historyText,
    assistantPrefill: params.assistantPrefill,
    selfStatusText: selfStatus,
    maxTokens: CONTINUATION_MAX_TOKENS,
    stopSequences: [...CONTINUATION_STOP_SEQUENCES],
    abortSignal: params.abortSignal,
  };
}
