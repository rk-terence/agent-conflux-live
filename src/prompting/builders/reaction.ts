import type { ModelCallInput } from "../../model-gateway/types.js";
import { REACTION_MAX_TOKENS } from "../constants.js";
import { composeUserPrompt } from "../compose.js";
import { render } from "../render.js";
import {
  REACTION_SYSTEM_TEMPLATE,
  REACTION_SYSTEM_RULES,
  REACTION_TURN_PROMPT,
  COLLISION_NOTICE_TEMPLATE,
  FREQUENT_COLLIDERS_TEMPLATE,
  REACTION_MENTION_HINT_TEMPLATE,
  REACTION_STARVATION_HINT_TEMPLATE,
} from "../templates/reaction.js";
import { wasMentionedAfterLastSpeech } from "../mention-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollisionContext = {
  /** How many consecutive collisions have occurred */
  readonly streak: number;
  /** Names of others in the most recent collision (from this agent's perspective) */
  readonly otherNames: readonly string[];
  /** Per-participant collision count in the recent streak, e.g. "Gemini 出现了 3 次" */
  readonly frequentColliders: readonly string[];
};

export type ReactionParams = {
  readonly sessionId: string;
  readonly iterationId: number;
  readonly agentId: string;
  readonly agentName: string;
  readonly allNames: readonly string[];
  readonly topic: string;
  /** Projected history — perspective-specific markdown transcript from the history projector */
  readonly projectedHistory: string;
  /** Collision context for situational awareness (part of the turn directive) */
  readonly collisionContext?: CollisionContext;
  /** How many consecutive collisions this agent lost (0 = none) */
  readonly consecutiveCollisionLosses?: number;
  readonly abortSignal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  agentName: string,
  allNames: readonly string[],
  topic: string,
): string {
  const otherNames = allNames.filter(n => n !== agentName);
  const rules = REACTION_SYSTEM_RULES
    .map(r => `- ${render(r, { agentName })}`)
    .join("\n");

  return render(REACTION_SYSTEM_TEMPLATE, {
    agentName,
    otherNames: otherNames.join("、"),
    topic,
    rules,
  });
}

// ---------------------------------------------------------------------------
// Turn directive
// ---------------------------------------------------------------------------

function buildTurnDirective(
  collisionContext?: CollisionContext,
  mentionHint?: string,
  starvationHint?: string,
): string {
  const parts: string[] = [];

  if (mentionHint) {
    parts.push(mentionHint);
  }

  if (starvationHint) {
    parts.push(starvationHint);
  }

  parts.push(`---\n${REACTION_TURN_PROMPT}`);

  if (collisionContext && collisionContext.streak > 0) {
    parts.push(buildCollisionNotice(collisionContext));
  }

  return parts.join("\n");
}

function buildCollisionNotice(ctx: CollisionContext): string {
  const noticeParts: string[] = [];
  noticeParts.push(render(COLLISION_NOTICE_TEMPLATE, { streak: String(ctx.streak) }));
  if (ctx.frequentColliders.length > 0) {
    noticeParts.push(render(FREQUENT_COLLIDERS_TEMPLATE, {
      colliders: ctx.frequentColliders.join("、"),
    }));
  }
  return `（${noticeParts.join("")}）`;
}

// ---------------------------------------------------------------------------
// Full reaction input
// ---------------------------------------------------------------------------

export function buildReactionInput(params: ReactionParams): ModelCallInput {
  const systemPrompt = buildSystemPrompt(params.agentName, params.allNames, params.topic);
  const mentionHint = wasMentionedAfterLastSpeech(params.projectedHistory, params.agentName)
    ? render(REACTION_MENTION_HINT_TEMPLATE, { agentName: params.agentName })
    : undefined;
  const losses = params.consecutiveCollisionLosses ?? 0;
  const starvationHint = losses >= 2
    ? render(REACTION_STARVATION_HINT_TEMPLATE, { losses: String(losses) })
    : undefined;
  const turnDirective = buildTurnDirective(params.collisionContext, mentionHint, starvationHint);

  return {
    sessionId: params.sessionId,
    iterationId: params.iterationId,
    agentId: params.agentId,
    mode: "reaction",
    systemPrompt,
    userPromptText: composeUserPrompt({
      projectedHistory: params.projectedHistory,
      turnDirective,
    }),
    maxTokens: REACTION_MAX_TOKENS,
    abortSignal: params.abortSignal,
  };
}
