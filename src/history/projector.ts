import type {
  AgentId,
  DomainEvent,
  Participant,
  CollisionUtterance,
} from "../domain/types.js";

export type ProjectionParams = {
  readonly events: readonly DomainEvent[];
  readonly currentTurn: null; // No longer used — turns complete in one step
  readonly perspectiveAgentId: AgentId;
  readonly participants: readonly Participant[];
};

export function projectHistory(params: ProjectionParams): string {
  const { events, perspectiveAgentId, participants } = params;

  const nameMap = new Map(participants.map(p => [p.agentId, p.name]));
  const name = (id: AgentId) =>
    id === perspectiveAgentId ? "你" : (nameMap.get(id) ?? id);

  const fmtTime = (t: number) => `${t.toFixed(1)}s`;

  const blocks: string[] = [];

  for (let idx = 0; idx < events.length; idx++) {
    const event = events[idx];
    switch (event.kind) {
      case "discussion_started":
        blocks.push(`[${fmtTime(event.timestamp)}] 讨论开始 — 话题：${event.topic}`);
        break;

      case "sentence_committed": {
        const speaker = name(event.speakerId);
        blocks.push(`[${fmtTime(event.timestamp)}] [${speaker}]: ${event.sentence}`);
        break;
      }

      case "turn_ended":
        // No need to render — turns end immediately after speech now
        break;

      case "collision": {
        // Look ahead: if the next event is a sentence_committed from one of
        // the collision participants, it means negotiation resolved the collision.
        const next = events[idx + 1];
        const colliderIds = new Set(event.utterances.map(u => u.agentId));
        if (next?.kind === "sentence_committed" && colliderIds.has(next.speakerId)) {
          renderResolvedCollision(blocks, event.timestamp, event.utterances, next.speakerId, name, perspectiveAgentId, fmtTime);
        } else {
          renderUnresolvedCollision(blocks, event.timestamp, event.utterances, name, perspectiveAgentId, fmtTime);
        }
        break;
      }

      case "silence_extended":
        blocks.push(`[${fmtTime(event.timestamp)}] (安静了 ${Math.round(event.intervalSeconds)} 秒，累计 ${Math.round(event.cumulativeSeconds)} 秒)`);
        break;

      case "discussion_ended":
        break;
    }
  }

  return blocks.join("\n\n");
}

// --- Collision renderers ---

/**
 * Unresolved collision — nobody's speech got through (all yielded).
 */
function renderUnresolvedCollision(
  blocks: string[],
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
    blocks.push(
      `[${fmtTime(timestamp)}] 你和 ${othersInCollision} 同时开口了，你想说的是「${myUtterance.text}」，但声音重叠，没有人听清各自说了什么`,
    );
  } else {
    const names = utterances.map(u => name(u.agentId));
    const nameList =
      names.length === 2
        ? `${names[0]} 和 ${names[1]}`
        : `${names.slice(0, -1).join("、")} 和 ${names[names.length - 1]}`;
    blocks.push(`[${fmtTime(timestamp)}] ${nameList} 同时开口了，声音重叠，你没听清他们说了什么`);
  }
}

/**
 * Resolved collision — negotiation produced a winner.
 */
function renderResolvedCollision(
  blocks: string[],
  timestamp: number,
  utterances: readonly CollisionUtterance[],
  winnerId: AgentId,
  name: (id: AgentId) => string,
  perspectiveId: AgentId,
  fmtTime: (t: number) => string,
): void {
  const yielders = utterances
    .filter(u => u.agentId !== winnerId)
    .map(u => name(u.agentId));
  const winnerName = name(winnerId);
  const yielderNames = yielders.join("、");

  if (perspectiveId === winnerId) {
    // I am the winner
    const allOthers = utterances
      .filter(u => u.agentId !== perspectiveId)
      .map(u => name(u.agentId))
      .join("、");
    blocks.push(
      `[${fmtTime(timestamp)}] 你和 ${allOthers} 同时开口了，${yielderNames} 决定让你先说`,
    );
  } else if (utterances.some(u => u.agentId === perspectiveId)) {
    // I was a yielder
    const myUtterance = utterances.find(u => u.agentId === perspectiveId)!;
    const allOthers = utterances
      .filter(u => u.agentId !== perspectiveId)
      .map(u => name(u.agentId));
    const othersWhoYielded = yielders.filter(n => n !== "你");
    const yielderDesc = othersWhoYielded.length > 0
      ? `你和 ${othersWhoYielded.join("、")} 决定让 ${winnerName} 先说`
      : `你决定让 ${winnerName} 先说`;
    blocks.push(
      `[${fmtTime(timestamp)}] 你和 ${allOthers.join("、")} 同时开口了，你想说的是「${myUtterance.text}」，${yielderDesc}`,
    );
  } else {
    // I was a bystander
    blocks.push(
      `[${fmtTime(timestamp)}] ${winnerName} 和 ${yielderNames} 同时开口了，${yielderNames} 让 ${winnerName} 先说`,
    );
  }
}
