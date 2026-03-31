import type { ModelCallInput } from "../model-gateway/types.js";
import { REACTION_MAX_TOKENS } from "./constants.js";

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
  const otherNames = allNames.filter(n => n !== agentName);
  return [
    `你是 ${agentName}，在一个自由圆桌讨论中。`,
    `其他参与者：${otherNames.join("、")}。`,
    `话题：${topic}`,
    ``,
    `规则：`,
    `- 没有主持人，自由发言`,
    `- 展现你的独特思维和性格`,
    `- 可以 @某人 回应`,
    `- 用中文`,
    `- 只输出你说的话，不要输出动作描写、括号注释或旁白`,
    `- 不要模仿对话记录的格式（不要加 [你]: 等前缀）`,
    `- 如果你没有想说的，回复 [silence]`,
    `- 沉默是完全正常的，不需要每次都发言`,
    `- 重要：如果多人同时说话，声音会重叠，所有人都听不清各自说了什么。你心里想说的话只有你自己知道，别人听不到。所以不要急着抢话，想清楚再开口`,
    `- 在对话记录中，[你] 就是你自己（${agentName}）的发言。不要用第三人称提到自己`,
    `- 每次发言请把你想说的话说完整，不要只说半句`,
  ].join("\n");
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
    ? `${params.historyText}\n\n---\n你要发言吗？`
    : "---\n你要发言吗？";

  // Collision context — factual observation, no behavioral prescription
  if (params.collisionContext && params.collisionContext.streak > 0) {
    const ctx = params.collisionContext;
    const parts: string[] = [];
    parts.push(`已经连续 ${ctx.streak} 次有人同时开口，导致大家都没听清。`);
    if (ctx.frequentColliders.length > 0) {
      parts.push(`${ctx.frequentColliders.join("、")} 每次都在抢话。`);
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
