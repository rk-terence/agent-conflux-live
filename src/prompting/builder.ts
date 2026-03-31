import type { ModelCallInput } from "../model-gateway/types.js";
import {
  REACTION_MAX_TOKENS,
  CONTINUATION_MAX_TOKENS,
  CONTINUATION_STOP_SEQUENCES,
} from "./constants.js";

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
    ` - 如果你没有想说的，回复 [silence]` +
    ` - 沉默是完全正常的`
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
  readonly abortSignal?: AbortSignal;
};

export function buildReactionInput(params: ReactionParams): ModelCallInput {
  const systemPrompt = buildSystemPrompt(params.agentName, params.allNames, params.topic);

  const historyText = params.historyText
    ? `${params.historyText}\n\n---\n你的反应？`
    : "---\n你的反应？";

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
