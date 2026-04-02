import type {
  SessionState,
  TurnRecord,
  SpeechRecord,
  SilenceRecord,
  DiscussionStartedRecord,
  CollisionInfo,
  InterruptionInfo,
  Tier,
} from "../types.js";
import { formatNameList } from "../util/name-list.js";

/**
 * Render the event log as a perspective-specific markdown transcript.
 */
export function projectHistory(session: SessionState, viewer: string): string {
  const lines: string[] = [];

  for (const record of session.log) {
    const tier = getTier(record, session);
    const rendered = renderRecord(record, viewer, tier, session);
    if (rendered) lines.push(rendered);
  }

  return lines.join("\n");
}

function getTier(record: TurnRecord, session: SessionState): Tier {
  if (record.type === "discussion_started") return "recent";
  const age = session.currentTurn - record.turn;
  if (age <= session.config.recentTierSize) return "recent";
  if (age <= session.config.mediumTierEnd) return "medium";
  return "old";
}

function renderRecord(record: TurnRecord, viewer: string, tier: Tier, session: SessionState): string | null {
  switch (record.type) {
    case "discussion_started":
      return renderDiscussionStarted(record);
    case "silence":
      return renderSilence(record, tier);
    case "speech":
      return renderSpeech(record, viewer, tier);
  }
}

// ── Discussion Started ──

function renderDiscussionStarted(record: DiscussionStartedRecord): string {
  return `- [0.0s] 讨论开始 — 话题：${record.topic}`;
}

// ── Silence ──

function renderSilence(record: SilenceRecord, tier: Tier): string {
  const ts = formatTime(record.virtualTime);
  if (tier === "old") {
    return `- [${ts}] （安静了一阵）`;
  }
  return `- [${ts}] 安静了 ${record.duration} 秒（累计 ${record.accumulated} 秒）`;
}

// ── Speech ──

function renderSpeech(record: SpeechRecord, viewer: string, tier: Tier): string {
  const hasCollision = record.collision !== null;
  const hasInterruption = record.interruption !== null;

  if (hasCollision && hasInterruption) {
    return renderCollisionWithInterruption(record, viewer, tier);
  }
  if (hasCollision) {
    return renderCollisionNoInterruption(record, viewer, tier);
  }
  if (hasInterruption) {
    return renderInterruptionNoCollision(record, viewer, tier);
  }
  return renderPlainSpeech(record, viewer, tier);
}

// ── Plain Speech (no collision, no interruption) ──

function renderPlainSpeech(record: SpeechRecord, viewer: string, _tier: Tier): string {
  const ts = formatTime(record.virtualTime);
  const speaker = speakerLabel(record.speaker, viewer);
  return `- [${ts}] ${speaker}：\n  > ${record.utterance}`;
}

// ── Collision (no interruption) ──

function renderCollisionNoInterruption(record: SpeechRecord, viewer: string, tier: Tier): string {
  const ts = formatTime(record.virtualTime);
  const collision = record.collision!;
  const winner = collision.winner;
  const others = collision.colliders.filter((c) => c.agent !== winner).map((c) => c.agent);

  if (tier === "old") {
    const winnerName = nameInNarrative(winner, viewer);
    return `- [${ts}] 多人同时开口，${winnerName} 先说了\n  ${speakerLabel(winner, viewer)}：\n  > ${record.utterance}`;
  }

  // Build collision header line
  const allColliderNames = collision.colliders.map((c) => c.agent);
  const headerNames = allColliderNames.map((n) => nameInNarrative(n, viewer));
  const resolutionSummary = getResolutionSummary(collision, viewer);
  const header = `- [${ts}] ${formatNameList(headerNames)} 同时开口了，${resolutionSummary}`;

  const lines: string[] = [header];

  if (viewer === winner) {
    // Winner perspective
    lines.push(`  ${speakerLabel(winner, viewer)}：`);
    lines.push(`  > ${record.utterance}`);
  } else if (others.some((o) => o === viewer)) {
    // Yielder perspective
    const viewerCollider = collision.colliders.find((c) => c.agent === viewer);
    if (viewerCollider && tier === "recent") {
      lines.push(`  你想说但没说出来的：`);
      lines.push(`  > ${viewerCollider.utterance}`);
    }
    lines.push(`  ${speakerLabel(winner, viewer)}：`);
    lines.push(`  > ${record.utterance}`);
  } else {
    // Bystander perspective
    lines.push(`  ${speakerLabel(winner, viewer)}：`);
    lines.push(`  > ${record.utterance}`);
  }

  return lines.join("\n");
}

// ── Interruption (no collision) ──

function renderInterruptionNoCollision(record: SpeechRecord, viewer: string, tier: Tier): string {
  const ts = formatTime(record.virtualTime);
  const interruption = record.interruption!;
  const speaker = record.speaker;
  const interrupter = interruption.interrupter;

  if (interruption.success) {
    return renderSuccessfulInterruption(ts, speaker, interrupter, interruption, record, viewer, tier);
  } else {
    return renderFailedInterruption(ts, speaker, interrupter, interruption, record, viewer, tier);
  }
}

function renderSuccessfulInterruption(
  ts: string,
  speaker: string,
  interrupter: string,
  interruption: InterruptionInfo,
  record: SpeechRecord,
  viewer: string,
  tier: Tier,
): string {
  if (tier === "old") {
    const spkName = nameInNarrative(speaker, viewer);
    const intName = nameInNarrative(interrupter, viewer);
    return `- [${ts}] ${spkName} 被 ${intName} 打断了\n  ${speakerLabel(speaker, viewer)} 说了一半：\n  > ${interruption.spokenPart}`;
  }

  if (viewer === speaker) {
    // Speaker (interrupted) perspective
    const intName = nameInNarrative(interrupter, viewer);
    const lines = [
      `- [${ts}] 你说话时被 ${intName} 打断了`,
      `  你说出来的部分：`,
      `  > ${interruption.spokenPart}`,
    ];
    if (tier === "recent") {
      lines.push(`  你还想说的：`);
      lines.push(`  > ${interruption.unspokenPart}`);
    }
    return lines.join("\n");
  }

  if (viewer === interrupter) {
    // Interrupter perspective
    const spkName = nameInNarrative(speaker, viewer);
    return [
      `- [${ts}] ${spkName} 说话时你打断了它`,
      `  ${speakerLabel(speaker, viewer)} 说了一半：`,
      `  > ${interruption.spokenPart}`,
    ].join("\n");
  }

  // Bystander perspective
  const spkName = nameInNarrative(speaker, viewer);
  const intName = nameInNarrative(interrupter, viewer);
  return [
    `- [${ts}] ${spkName} 说话时被 ${intName} 打断了`,
    `  ${speakerLabel(speaker, viewer)} 说了一半：`,
    `  > ${interruption.spokenPart}`,
  ].join("\n");
}

function renderFailedInterruption(
  ts: string,
  speaker: string,
  interrupter: string,
  interruption: InterruptionInfo,
  record: SpeechRecord,
  viewer: string,
  tier: Tier,
): string {
  if (tier === "old") {
    const intName = nameInNarrative(interrupter, viewer);
    const spkName = nameInNarrative(speaker, viewer);
    return `- [${ts}] ${intName} 试图打断 ${spkName} 未果\n  ${speakerLabel(speaker, viewer)}：\n  > ${record.utterance}`;
  }

  if (viewer === speaker) {
    const intName = nameInNarrative(interrupter, viewer);
    return [
      `- [${ts}] ${intName} 试图打断你，但你坚持说完了`,
      `  ${speakerLabel(speaker, viewer)}：`,
      `  > ${record.utterance}`,
    ].join("\n");
  }

  if (viewer === interrupter) {
    const spkName = nameInNarrative(speaker, viewer);
    return [
      `- [${ts}] 你试图打断 ${spkName}，但它坚持说完了`,
      `  ${speakerLabel(speaker, viewer)}：`,
      `  > ${record.utterance}`,
    ].join("\n");
  }

  // Bystander
  const intName = nameInNarrative(interrupter, viewer);
  const spkName = nameInNarrative(speaker, viewer);
  return [
    `- [${ts}] ${intName} 试图打断 ${spkName}，但 ${spkName} 坚持说完了`,
    `  ${speakerLabel(speaker, viewer)}：`,
    `  > ${record.utterance}`,
  ].join("\n");
}

// ── Collision + Interruption ──

function renderCollisionWithInterruption(record: SpeechRecord, viewer: string, tier: Tier): string {
  const ts = formatTime(record.virtualTime);
  const collision = record.collision!;
  const interruption = record.interruption!;
  const winner = collision.winner;
  const interrupter = interruption.interrupter;

  if (tier === "old") {
    const winnerName = nameInNarrative(winner, viewer);
    if (interruption.success) {
      const intName = nameInNarrative(interrupter, viewer);
      return `- [${ts}] 多人同时开口，${winnerName} 先说了，随后被 ${intName} 打断\n  ${speakerLabel(winner, viewer)} 说了一半：\n  > ${interruption.spokenPart}`;
    } else {
      const intName = nameInNarrative(interrupter, viewer);
      return `- [${ts}] 多人同时开口，${winnerName} 先说了，${intName} 试图打断未果\n  ${speakerLabel(winner, viewer)}：\n  > ${record.utterance}`;
    }
  }

  // Recent / Medium: render collision block, then interruption within it
  const allColliderNames = collision.colliders.map((c) => c.agent);
  const headerNames = allColliderNames.map((n) => nameInNarrative(n, viewer));
  const resolutionSummary = getResolutionSummary(collision, viewer);
  const lines: string[] = [`- [${ts}] ${formatNameList(headerNames)} 同时开口了，${resolutionSummary}`];

  // Yielder's unsaid text (recent only)
  const others = collision.colliders.filter((c) => c.agent !== winner);
  if (viewer !== winner && others.some((o) => o.agent === viewer) && tier === "recent") {
    const viewerCollider = collision.colliders.find((c) => c.agent === viewer);
    if (viewerCollider) {
      lines.push(`  你想说但没说出来的：`);
      lines.push(`  > ${viewerCollider.utterance}`);
    }
  }

  // Winner's speech — may be interrupted
  if (interruption.success) {
    if (viewer === winner) {
      const intName = nameInNarrative(interrupter, viewer);
      lines.push(`  你说出来的部分：`);
      lines.push(`  > ${interruption.spokenPart}`);
      if (tier === "recent") {
        lines.push(`  你还想说的：`);
        lines.push(`  > ${interruption.unspokenPart}`);
      }
      lines.push(`  （被 ${intName} 打断了）`);
    } else {
      lines.push(`  ${speakerLabel(winner, viewer)} 说了一半：`);
      lines.push(`  > ${interruption.spokenPart}`);
      const intName = nameInNarrative(interrupter, viewer);
      if (viewer === interrupter) {
        lines.push(`  （你打断了${nameInNarrative(winner, viewer)}）`);
      } else {
        lines.push(`  （被 ${intName} 打断了）`);
      }
    }
  } else {
    // Failed interruption
    lines.push(`  ${speakerLabel(winner, viewer)}：`);
    lines.push(`  > ${record.utterance}`);
    const intName = nameInNarrative(interrupter, viewer);
    if (viewer === interrupter) {
      lines.push(`  （你试图打断但未果）`);
    } else {
      lines.push(`  （${intName} 试图打断未果）`);
    }
  }

  return lines.join("\n");
}

// ── Resolution Summary ──

function getResolutionSummary(collision: CollisionInfo, viewer: string): string {
  const winner = collision.winner;
  const others = collision.colliders.filter((c) => c.agent !== winner).map((c) => c.agent);

  const isWinner = viewer === winner;
  const isYielder = others.includes(viewer);

  switch (collision.resolutionTier) {
    case 1:
      if (isWinner) {
        return `${formatNameList(others.map((n) => nameInNarrative(n, viewer)))} 发言意愿没你高，你先说了`;
      } else if (isYielder) {
        const wn = nameInNarrative(winner, viewer);
        return `${wn} 的发言意愿更强，${wn} 先说了`;
      } else {
        const wn = nameInNarrative(winner, viewer);
        return `${wn} 的发言意愿最强，${wn} 先说了`;
      }
    case 2:
      if (isWinner) return "经过协商你获得了发言权";
      return `经过协商 ${nameInNarrative(winner, viewer)} 获得了发言权`;
    case 3:
      if (isWinner) return "大家投票让你先说";
      if (isYielder) return `大家投票让 ${nameInNarrative(winner, viewer)} 先说`;
      // Bystander: check if they voted for the winner
      const voterRecord = collision.votes.find((v) => v.voter === viewer);
      if (voterRecord && voterRecord.votedFor === winner) {
        const wn = nameInNarrative(winner, viewer);
        return `你投票给了 ${wn}，${wn} 先说了`;
      }
      return `大家投票让 ${nameInNarrative(winner, viewer)} 先说`;
    case 4:
      if (isWinner) return "僵持不下，最终你先说了";
      return `僵持不下，最终 ${nameInNarrative(winner, viewer)} 先说了`;
  }
}

// ── Helpers ──

function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

/** Speaker label: **你** or **Name** — used before ： */
function speakerLabel(agent: string, viewer: string): string {
  return agent === viewer ? "**你**" : `**${agent}**`;
}

/** Name in narrative text: 你 or plain name — no bold */
function nameInNarrative(agent: string, viewer: string): string {
  return agent === viewer ? "你" : agent;
}
