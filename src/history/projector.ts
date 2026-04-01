import type {
  AgentId,
  DomainEvent,
  Participant,
  CollisionUtterance,
  CollisionResolvedEvent,
  SentenceCommittedEvent,
  ResolutionTier,
} from "../domain/types.js";

export type ProjectionParams = {
  readonly events: readonly DomainEvent[];
  readonly currentTurn: null; // No longer used — turns complete in one step
  readonly perspectiveAgentId: AgentId;
  readonly participants: readonly Participant[];
};

/**
 * Projects domain events into a markdown-formatted, perspective-specific
 * history string suitable for LLM consumption.
 *
 * Output format:
 * - Each event is a markdown list item: `- [timestamp] summary`
 * - Details within an event use 2-space indented continuation lines
 * - Quoted speech uses `> ` (inside the list item indentation)
 * - Resolved collisions merge with the winner's speech into a single item
 */
export function projectHistory(params: ProjectionParams): string {
  const { events, perspectiveAgentId, participants } = params;

  const nameMap = new Map(participants.map(p => [p.agentId, p.name]));
  const name = (id: AgentId) =>
    id === perspectiveAgentId ? "你" : (nameMap.get(id) ?? id);

  const fmtTime = (t: number) => `${t.toFixed(1)}s`;

  const items: string[] = [];
  let skip = 0;

  for (let idx = 0; idx < events.length; idx++) {
    if (skip > 0) {
      skip--;
      continue;
    }

    const event = events[idx];
    switch (event.kind) {
      case "discussion_started":
        items.push(`- [${fmtTime(event.timestamp)}] 讨论开始 — 话题：${event.topic}`);
        break;

      case "sentence_committed": {
        const speaker = name(event.speakerId);
        items.push(`- [${fmtTime(event.timestamp)}] **${speaker}**：\n  > ${event.sentence}`);
        break;
      }

      case "turn_ended":
      case "discussion_ended":
      case "collision_resolved":
        // collision_resolved is consumed by the collision handler via lookahead
        break;

      case "collision": {
        // Lookahead: collision_resolved? → sentence_committed?
        const next1 = events[idx + 1];
        const next2 = events[idx + 2];

        if (next1?.kind === "collision_resolved") {
          const resolved = next1 as CollisionResolvedEvent;
          // Find the winner's speech (next after collision_resolved)
          if (next2?.kind === "sentence_committed" && next2.speakerId === resolved.winnerId) {
            renderResolvedCollision(items, event.timestamp, event.utterances, resolved, next2, name, perspectiveAgentId, fmtTime);
            skip = 2; // skip collision_resolved + sentence_committed
          } else {
            // resolved event but no speech follows (shouldn't happen, but handle gracefully)
            renderUnresolvedCollision(items, event.timestamp, event.utterances, name, perspectiveAgentId, fmtTime);
            skip = 1; // skip collision_resolved
          }
        } else {
          // No collision_resolved — unresolved collision (legacy or all-yield)
          const colliderIds = new Set(event.utterances.map(u => u.agentId));
          if (next1?.kind === "sentence_committed" && colliderIds.has(next1.speakerId)) {
            // Legacy path: collision followed directly by speech (no resolved event)
            renderResolvedCollisionLegacy(items, event.timestamp, event.utterances, next1, name, perspectiveAgentId, fmtTime);
            skip = 1;
          } else {
            renderUnresolvedCollision(items, event.timestamp, event.utterances, name, perspectiveAgentId, fmtTime);
          }
        }
        break;
      }

      case "silence_extended":
        items.push(`- [${fmtTime(event.timestamp)}] 安静了 ${Math.round(event.intervalSeconds)} 秒（累计 ${Math.round(event.cumulativeSeconds)} 秒）`);
        break;
    }
  }

  return items.join("\n");
}

// ---------------------------------------------------------------------------
// Collision renderers
// ---------------------------------------------------------------------------

/**
 * Unresolved collision — nobody's speech got through.
 */
function renderUnresolvedCollision(
  items: string[],
  timestamp: number,
  utterances: readonly CollisionUtterance[],
  name: (id: AgentId) => string,
  perspectiveId: AgentId,
  fmtTime: (t: number) => string,
): void {
  const myUtterance = utterances.find(u => u.agentId === perspectiveId);

  if (myUtterance) {
    const othersInCollision = utterances
      .filter(u => u.agentId !== perspectiveId)
      .map(u => name(u.agentId))
      .join("、");
    items.push([
      `- [${fmtTime(timestamp)}] 你和 ${othersInCollision} 同时开口了，声音重叠，没有人听清`,
      `  你想说的是：`,
      `  > ${myUtterance.text}`,
    ].join("\n"));
  } else {
    const names = utterances.map(u => name(u.agentId));
    const nameList =
      names.length === 2
        ? `${names[0]} 和 ${names[1]}`
        : `${names.slice(0, -1).join("、")} 和 ${names[names.length - 1]}`;
    items.push(`- [${fmtTime(timestamp)}] ${nameList} 同时开口了，声音重叠，你没听清他们说了什么`);
  }
}

/**
 * Resolved collision with tier-aware rendering.
 */
function renderResolvedCollision(
  items: string[],
  timestamp: number,
  utterances: readonly CollisionUtterance[],
  resolved: CollisionResolvedEvent,
  winnerSpeech: SentenceCommittedEvent,
  name: (id: AgentId) => string,
  perspectiveId: AgentId,
  fmtTime: (t: number) => string,
): void {
  const winnerId = resolved.winnerId;
  const winnerName = name(winnerId);
  const otherColliders = utterances
    .filter(u => u.agentId !== perspectiveId)
    .map(u => name(u.agentId))
    .join("、");
  const tier = resolved.tier;

  if (perspectiveId === winnerId) {
    // I am the winner
    const resolution = tierSummaryWinner(tier, otherColliders, perspectiveId, resolved);
    const lines = [
      `- [${fmtTime(timestamp)}] 你和 ${otherColliders} 同时开口了，${resolution}`,
      `  你说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  } else if (utterances.some(u => u.agentId === perspectiveId)) {
    // I was a yielder
    const myUtterance = utterances.find(u => u.agentId === perspectiveId)!;
    const resolution = tierSummaryYielder(tier, winnerName, perspectiveId, resolved);
    const lines = [
      `- [${fmtTime(timestamp)}] 你和 ${otherColliders} 同时开口了，${resolution}`,
      `  你想说但没说出来的：`,
      `  > ${myUtterance.text}`,
      `  ${winnerName} 说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  } else {
    // I was a bystander
    const allColliderNames = utterances.map(u => name(u.agentId)).join("、");
    const resolution = tierSummaryBystander(tier, winnerName, perspectiveId, resolved);
    const lines = [
      `- [${fmtTime(timestamp)}] ${allColliderNames} 同时开口了，${resolution}`,
      `  ${winnerName} 说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  }
}

// ---------------------------------------------------------------------------
// Tier-specific resolution summaries
// ---------------------------------------------------------------------------

function tierSummaryWinner(
  tier: ResolutionTier,
  otherNames: string,
  _perspectiveId: AgentId,
  _resolved: CollisionResolvedEvent,
): string {
  switch (tier) {
    case 1: return `${otherNames} 发言意愿没你高，你先说了`;
    case 2: return `经过协商你获得了发言权`;
    case 3: return `大家投票让你先说`;
    case 4: return `僵持不下，最终你先说了`;
  }
}

function tierSummaryYielder(
  tier: ResolutionTier,
  winnerName: string,
  _perspectiveId: AgentId,
  _resolved: CollisionResolvedEvent,
): string {
  switch (tier) {
    case 1: return `${winnerName} 的发言意愿更强，${winnerName} 先说了`;
    case 2: return `经过协商 ${winnerName} 获得了发言权`;
    case 3: return `大家投票让 ${winnerName} 先说`;
    case 4: return `僵持不下，最终 ${winnerName} 先说了`;
  }
}

function tierSummaryBystander(
  tier: ResolutionTier,
  winnerName: string,
  perspectiveId: AgentId,
  resolved: CollisionResolvedEvent,
): string {
  switch (tier) {
    case 1: return `${winnerName} 的发言意愿最强，${winnerName} 先说了`;
    case 2: return `经过协商 ${winnerName} 获得了发言权`;
    case 3: {
      // If this bystander voted, mention their vote
      const myVote = resolved.votes?.find(v => v.voterId === perspectiveId);
      if (myVote && myVote.votedForId === resolved.winnerId) {
        return `你投票给了 ${winnerName}，${winnerName} 先说了`;
      }
      return `大家投票让 ${winnerName} 先说`;
    }
    case 4: return `僵持不下，最终 ${winnerName} 先说了`;
  }
}

// ---------------------------------------------------------------------------
// Legacy renderer (no collision_resolved event — backwards compatibility)
// ---------------------------------------------------------------------------

function renderResolvedCollisionLegacy(
  items: string[],
  timestamp: number,
  utterances: readonly CollisionUtterance[],
  winnerSpeech: SentenceCommittedEvent,
  name: (id: AgentId) => string,
  perspectiveId: AgentId,
  fmtTime: (t: number) => string,
): void {
  const winnerId = winnerSpeech.speakerId;
  const winnerName = name(winnerId);
  const yielders = utterances
    .filter(u => u.agentId !== winnerId)
    .map(u => name(u.agentId));
  const yielderNames = yielders.join("、");

  if (perspectiveId === winnerId) {
    const lines = [
      `- [${fmtTime(timestamp)}] 你和 ${yielderNames} 同时开口了，${yielderNames} 决定让你先说`,
      `  你说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  } else if (utterances.some(u => u.agentId === perspectiveId)) {
    const myUtterance = utterances.find(u => u.agentId === perspectiveId)!;
    const othersWhoYielded = yielders.filter(n => n !== "你");
    const yielderDesc = othersWhoYielded.length > 0
      ? `你和 ${othersWhoYielded.join("、")} 决定让 ${winnerName} 先说`
      : `你决定让 ${winnerName} 先说`;
    const lines = [
      `- [${fmtTime(timestamp)}] 你和 ${utterances.filter(u => u.agentId !== perspectiveId).map(u => name(u.agentId)).join("、")} 同时开口了，${yielderDesc}`,
      `  你想说但没说出来的：`,
      `  > ${myUtterance.text}`,
      `  ${winnerName} 说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  } else {
    const lines = [
      `- [${fmtTime(timestamp)}] ${winnerName} 和 ${yielderNames} 同时开口了，${yielderNames} 让 ${winnerName} 先说`,
      `  ${winnerName} 说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  }
}
