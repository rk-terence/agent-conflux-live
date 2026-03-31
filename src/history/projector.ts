import type {
  AgentId,
  CurrentTurn,
  DomainEvent,
  Participant,
  CollisionUtterance,
} from "../domain/types.js";

export type ProjectionParams = {
  readonly events: readonly DomainEvent[];
  readonly currentTurn: CurrentTurn | null;
  readonly perspectiveAgentId: AgentId;
  readonly participants: readonly Participant[];
};

export function projectHistory(params: ProjectionParams): string {
  const { events, currentTurn, perspectiveAgentId, participants } = params;

  const nameMap = new Map(participants.map(p => [p.agentId, p.name]));
  const name = (id: AgentId) =>
    id === perspectiveAgentId ? "你" : (nameMap.get(id) ?? id);

  const blocks: string[] = [];
  let pendingSpeaker: AgentId | null = null;
  let pendingSentences: string[] = [];

  const flushCompleted = () => {
    if (pendingSpeaker !== null && pendingSentences.length > 0) {
      blocks.push(`[${name(pendingSpeaker)}]: ${pendingSentences.join("")}`);
    }
    pendingSpeaker = null;
    pendingSentences = [];
  };

  for (const event of events) {
    switch (event.kind) {
      case "discussion_started":
        break;

      case "sentence_committed": {
        if (pendingSpeaker !== null && pendingSpeaker !== event.speakerId) {
          flushCompleted();
        }
        pendingSpeaker = event.speakerId;
        pendingSentences.push(event.sentence);
        break;
      }

      case "turn_ended":
        flushCompleted();
        break;

      case "collision": {
        if (event.during === "speech") {
          // The collision's first utterance is the speaker's sentence that
          // was also emitted as the last sentence_committed event.
          // Validate this assumption explicitly before removing the duplicate.
          const speakerUtterance = event.utterances[0];
          const lastPending = pendingSentences[pendingSentences.length - 1];

          if (
            pendingSpeaker === speakerUtterance.agentId &&
            lastPending === speakerUtterance.text
          ) {
            pendingSentences.pop();
          }

          if (pendingSentences.length > 0) {
            flushCompleted();
          } else {
            pendingSpeaker = null;
          }
          renderCollisionDuringSpeech(blocks, event.utterances, name, perspectiveAgentId);
        } else {
          flushCompleted();
          renderCollisionAtGap(blocks, event.utterances, name, perspectiveAgentId);
        }
        break;
      }

      case "silence_extended":
        flushCompleted();
        blocks.push(`(已经安静了 ${Math.round(event.cumulativeSeconds)} 秒)`);
        break;

      case "discussion_ended":
        flushCompleted();
        break;
    }
  }

  // In-progress speech
  if (currentTurn && pendingSpeaker === currentTurn.speakerId && pendingSentences.length > 0) {
    const elapsed = Math.round(currentTurn.speakingDuration);
    const n = name(currentTurn.speakerId);
    blocks.push(
      `[${n} 正在说（已说 ${elapsed} 秒）]: ${pendingSentences.join("")}...... （${n} 还在继续说）`,
    );
  } else {
    flushCompleted();
  }

  return blocks.join("\n\n");
}

// --- Collision renderers ---

function renderCollisionDuringSpeech(
  blocks: string[],
  utterances: readonly CollisionUtterance[],
  name: (id: AgentId) => string,
  perspectiveId: AgentId,
): void {
  const speaker = utterances[0];
  const others = utterances.slice(1);
  const otherNames = others.map(u => name(u.agentId)).join("、");
  const header = `[${name(speaker.agentId)} 正在说时，${otherNames} 也开口了]`;
  const lines = utterances.map(u => `[${name(u.agentId)}]: ${u.text}`);

  const involved = utterances.some(u => u.agentId === perspectiveId);
  const annotation = involved
    ? "(你们同时在说话)"
    : utterances.length === 2
      ? "(两人同时在说话)"
      : `(${utterances.length}人同时在说话)`;

  blocks.push(`${header}:\n${lines.join("\n")}\n${annotation}`);
}

function renderCollisionAtGap(
  blocks: string[],
  utterances: readonly CollisionUtterance[],
  name: (id: AgentId) => string,
  perspectiveId: AgentId,
): void {
  const names = utterances.map(u => name(u.agentId));
  const header =
    names.length === 2
      ? `[${names[0]} 和 ${names[1]} 同时说]`
      : `[${names.slice(0, -1).join("、")} 和 ${names[names.length - 1]} 同时说]`;

  const lines = utterances.map(u => `[${name(u.agentId)}]: ${u.text}`);

  const involved = utterances.some(u => u.agentId === perspectiveId);
  const annotation = involved
    ? "(你们同时开口，都只说了一句)"
    : "(几个人同时开口，都只说了一句)";

  blocks.push(`${header}:\n${lines.join("\n")}\n${annotation}`);
}
