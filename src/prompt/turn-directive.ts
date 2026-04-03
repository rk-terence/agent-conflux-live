import type {
  AgentState,
  SessionState,
  NegotiationContext,
  JudgeContext,
  DefenseContext,
  InsistenceLevel,
} from "../types.js";
import { getMentionHint, getStarvationHint, getInterruptionPressureHint, getCollisionNotice } from "./hints.js";
import { formatNameList } from "../util/name-list.js";

const INSISTENCE_LABELS: Record<InsistenceLevel, string> = {
  low: "让步",
  mid: "犹豫",
  high: "坚持",
};

/**
 * Reaction mode turn directive.
 * Assembly order per DESIGN.md:
 *   [inner monologue]
 *   [mention hint]
 *   [starvation hint]
 *   [interruption pressure]
 *   [collision notice]
 *   ---
 *   请用 JSON 格式回复。
 */
export function buildReactionDirective(agent: AgentState, session: SessionState): string {
  const lines: string[] = [];

  // Inner monologue
  if (agent.currentThought !== null) {
    lines.push(`你目前的内心状态：${agent.currentThought}`);
  }

  // Mention hint
  const mention = getMentionHint(agent, session, "reaction");
  if (mention) lines.push(mention);

  // Starvation hint
  const starvation = getStarvationHint(agent, "reaction");
  if (starvation) lines.push(starvation);

  // Interruption pressure hint
  const pressure = getInterruptionPressureHint(agent);
  if (pressure) lines.push(pressure);

  // Collision notice
  const collision = getCollisionNotice(session);
  if (collision) lines.push(collision);

  lines.push("---");
  lines.push("请用 JSON 格式回复。");

  return lines.join("\n");
}

/**
 * Negotiation mode turn directive.
 * Assembly order per DESIGN.md:
 *   [inner monologue]
 *   你和 {{otherNames}} 同时开口了。你想说的是「{{utterance}}」，但没有人听清。
 *   [@mention hint]
 *   [starvation hint]
 *   [第 N 轮协商：decisions。]  (one line per previous round)
 *   [僵持提示]
 *
 *   请用 JSON 格式回复你的坚持程度。
 */
export function buildNegotiationDirective(
  agent: AgentState,
  session: SessionState,
  ctx: NegotiationContext,
): string {
  const lines: string[] = [];

  // Inner monologue
  if (agent.currentThought !== null) {
    lines.push(`你目前的内心状态：${agent.currentThought}`);
  }

  // Collision statement
  const otherNames = ctx.colliders
    .filter((c) => c.name !== agent.name)
    .map((c) => c.name);
  lines.push(
    `你和 ${formatNameList(otherNames)} 同时开口了。你想说的是「${ctx.thisAgentUtterance}」，但没有人听清。`,
  );

  // Mention hint
  const mention = getMentionHint(agent, session, "negotiation");
  if (mention) lines.push(mention);

  // Starvation hint
  const starvation = getStarvationHint(agent, "negotiation");
  if (starvation) lines.push(starvation);

  // Previous round summaries
  for (const round of ctx.previousRounds) {
    const decisionParts = round.decisions.map((d) => {
      const name = d.agent === agent.name ? "你" : d.agent;
      return `${name} ${INSISTENCE_LABELS[d.insistence]}`;
    });
    lines.push(`第 ${round.round} 轮协商：${decisionParts.join("，")}。`);
  }

  // 僵持提示 — if previous rounds > 0
  if (ctx.previousRounds.length > 0) {
    lines.push(
      `已经协商了 ${ctx.previousRounds.length} 轮还没有结果。如果继续僵持，可能会由其他人投票或随机决定。`,
    );
  }

  lines.push("");
  lines.push("请用 JSON 格式回复你的坚持程度。");

  return lines.join("\n");
}

/**
 * Voting mode turn directive.
 *   [inner monologue]
 *   想要发言的人：{{candidateNames}}。你觉得谁应该先说？
 */
export function buildVotingDirective(
  agent: AgentState,
  session: SessionState,
  candidates: string[],
): string {
  const lines: string[] = [];

  if (agent.currentThought !== null) {
    lines.push(`你目前的内心状态：${agent.currentThought}`);
  }

  lines.push(`想要发言的人：${formatNameList(candidates)}。你觉得谁应该先说？`);

  return lines.join("\n");
}

/**
 * Judge mode turn directive.
 *   [inner monologue]
 *   {{speakerName}} 正在说话，你目前听到的是：
 *   > {{spokenPart}}
 *
 *   你想打断吗？用 JSON 格式回复。
 */
export function buildJudgeDirective(
  agent: AgentState,
  session: SessionState,
  ctx: JudgeContext,
): string {
  const lines: string[] = [];

  if (agent.currentThought !== null) {
    lines.push(`你目前的内心状态：${agent.currentThought}`);
  }

  lines.push(`${ctx.speakerName} 正在说话，你目前听到的是：`);
  lines.push(ctx.spokenPart.split("\n").map((l) => `> ${l}`).join("\n"));
  lines.push("");
  lines.push("你想打断吗？用 JSON 格式回复。");

  return lines.join("\n");
}

/**
 * Defense mode turn directive.
 *   [inner monologue]
 *   你正在说话。你已经说了：
 *   > {{spokenPart}}
 *
 *   你还想继续说：
 *   > {{unspokenPart}}
 *
 *   {{interrupterName}} 想打断你，理由是：「{{reason}}」
 *     OR: {{interrupterName}} 想打断你。
 *
 *   你让步还是坚持？用 JSON 格式回复。
 */
export function buildDefenseDirective(
  agent: AgentState,
  session: SessionState,
  ctx: DefenseContext,
): string {
  const lines: string[] = [];

  if (agent.currentThought !== null) {
    lines.push(`你目前的内心状态：${agent.currentThought}`);
  }

  lines.push("你正在说话。你已经说了：");
  lines.push(ctx.spokenPart.split("\n").map((l) => `> ${l}`).join("\n"));
  lines.push("");
  lines.push("你还想继续说：");
  lines.push(ctx.unspokenPart.split("\n").map((l) => `> ${l}`).join("\n"));
  lines.push("");

  // Conditional reason line
  if (ctx.reason !== null) {
    lines.push(`${ctx.interrupterName} 想打断你，理由是：「${ctx.reason}」`);
  } else {
    lines.push(`${ctx.interrupterName} 想打断你。`);
  }

  lines.push("");
  lines.push("你让步还是坚持？用 JSON 格式回复。");

  return lines.join("\n");
}
