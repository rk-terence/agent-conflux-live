import type {
  AgentId,
  DomainEvent,
  Participant,
  CollisionUtterance,
  SentenceCommittedEvent,
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
  let skipNext = false;

  for (let idx = 0; idx < events.length; idx++) {
    if (skipNext) {
      skipNext = false;
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
        break;

      case "collision": {
        const next = events[idx + 1];
        const colliderIds = new Set(event.utterances.map(u => u.agentId));
        if (next?.kind === "sentence_committed" && colliderIds.has(next.speakerId)) {
          renderResolvedCollision(items, event.timestamp, event.utterances, next as SentenceCommittedEvent, name, perspectiveAgentId, fmtTime);
          skipNext = true;
        } else {
          renderUnresolvedCollision(items, event.timestamp, event.utterances, name, perspectiveAgentId, fmtTime);
        }
        break;
      }

      case "silence_extended":
        items.push(`- [${fmtTime(event.timestamp)}] 安静了 ${Math.round(event.intervalSeconds)} 秒（累计 ${Math.round(event.cumulativeSeconds)} 秒）`);
        break;

      case "discussion_ended":
        break;
    }
  }

  return items.join("\n");
}

// ---------------------------------------------------------------------------
// Collision renderers
// ---------------------------------------------------------------------------

/**
 * Unresolved collision — nobody's speech got through (all yielded).
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
 * Resolved collision — negotiation produced a winner.
 * Merges the winner's speech (next sentence_committed) into this item.
 */
function renderResolvedCollision(
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
    // I am the winner
    const lines = [
      `- [${fmtTime(timestamp)}] 你和 ${yielderNames} 同时开口了，${yielderNames} 决定让你先说`,
      `  你说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  } else if (utterances.some(u => u.agentId === perspectiveId)) {
    // I was a yielder
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
    // I was a bystander
    const lines = [
      `- [${fmtTime(timestamp)}] ${winnerName} 和 ${yielderNames} 同时开口了，${yielderNames} 让 ${winnerName} 先说`,
      `  ${winnerName} 说：`,
      `  > ${winnerSpeech.sentence}`,
    ];
    items.push(lines.join("\n"));
  }
}
