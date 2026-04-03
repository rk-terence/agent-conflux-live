import type { AgentState, SessionState, SpeechRecord, ColliderEntry } from "../types.js";

/**
 * @Mention hint — scan delivered text visible to this agent after their last speech
 * for @AgentName pattern.
 */
export function getMentionHint(
  agent: AgentState,
  session: SessionState,
  mode: "reaction" | "negotiation",
): string | null {
  const pattern = new RegExp(`@${escapeRegex(agent.name)}(?=\\W|$)`);
  const lastSpoke = agent.lastSpokeTurn ?? -1;

  for (const record of session.log) {
    if (record.type !== "speech") continue;
    if (record.turn <= lastSpoke) continue;

    // Check main utterance (visible to everyone for normal speech / failed interruptions)
    if (record.interruption?.success) {
      // Successful interruption: only spoken part is public
      if (pattern.test(record.interruption.spokenPart)) {
        return buildMentionText(agent.name, mode);
      }
    } else {
      // Normal speech or failed interruption: full utterance is public
      if (pattern.test(record.utterance)) {
        return buildMentionText(agent.name, mode);
      }
    }

    // Check collision losers' utterances — only visible to the loser themselves
    if (record.collision) {
      for (const collider of record.collision.colliders) {
        if (collider.agent === agent.name && collider.agent !== record.speaker) {
          // This agent was a collision loser — they can see their own intended utterance
          // but we're checking if someone MENTIONED this agent, not their own text
          // Losers' text is private, so skip for mention detection
        }
      }
    }
  }

  return null;
}

function buildMentionText(agentName: string, mode: "reaction" | "negotiation"): string {
  if (mode === "reaction") {
    return `有人在讨论中提到了你（@${agentName}），你可能想要回应。`;
  }
  return `注意：刚才有人在讨论中点名向你（@${agentName}）提问，你可能更有理由坚持发言来回应。`;
}

/**
 * Starvation hint — consecutive collision losses >= 2
 */
export function getStarvationHint(
  agent: AgentState,
  mode: "reaction" | "negotiation",
): string | null {
  if (agent.consecutiveCollisionLosses < 2) return null;
  const losses = agent.consecutiveCollisionLosses;

  if (mode === "reaction") {
    return `你已经连续 ${losses} 次想发言但都因为同时有人开口而没有说出来。你可以考虑在坚持程度上做出调整。`;
  }
  return `注意：你已经连续 ${losses} 次想发言但都没有成功说出来。如果你的观点仍然切合当前讨论，可以考虑调整你的坚持程度。`;
}

/**
 * Interruption pressure hint — interrupted >= 1 time
 */
export function getInterruptionPressureHint(agent: AgentState): string | null {
  if (agent.interruptedCount < 1) return null;
  return `你之前被人打断过 ${agent.interruptedCount} 次，也许该说得更简短一些。`;
}

/**
 * Collision notice — consecutive collision streak > 0
 */
export function getCollisionNotice(session: SessionState): string | null {
  if (session.collisionStreak <= 0) return null;

  const colliderClause = session.collisionStreakColliders.length > 0
    ? `${session.collisionStreakColliders.join("、")} 每次都在抢话。`
    : "";

  return `（已经连续 ${session.collisionStreak} 次有人同时开口，导致大家都没听清。${colliderClause}）`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
