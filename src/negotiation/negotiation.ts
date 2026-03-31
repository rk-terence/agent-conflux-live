/**
 * Collision negotiation module.
 *
 * When multiple agents speak simultaneously (collision), this module runs
 * a multi-round negotiation where each colliding agent decides whether to
 * "insist" (坚持发言) or "yield" (让步).
 *
 * The negotiation converges when exactly one agent insists (they win the floor)
 * or all agents yield (nobody speaks). Each round's decisions are fed back as
 * context for the next round, creating social pressure that naturally drives
 * convergence — models tend to yield when they see a deadlock persisting.
 */

import type { ModelGateway, ModelCallInput, ModelCallOutput } from "../model-gateway/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollisionCandidate = {
  readonly agentId: string;
  readonly agentName: string;
  readonly utterance: string;
};

export type NegotiationRoundResult = {
  readonly round: number;
  readonly decisions: readonly AgentDecision[];
};

export type AgentDecision = {
  readonly agentId: string;
  readonly agentName: string;
  readonly decision: "insist" | "yield";
  readonly rawText: string;
  /** The full prompt sent to this agent for this negotiation round */
  readonly prompt: ModelCallInput;
};

export type NegotiationOutcome = {
  /** The agent who won the floor, or null if all yielded */
  readonly winnerId: string | null;
  /** All negotiation rounds for logging/debug */
  readonly rounds: readonly NegotiationRoundResult[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum negotiation rounds before forcing all-yield */
const MAX_ROUNDS = 5;

const NEGOTIATION_MAX_TOKENS = 20;

// ---------------------------------------------------------------------------
// Main negotiation function
// ---------------------------------------------------------------------------

/**
 * @param perspectiveHistories - Map of agentId → their perspective-specific
 *   discussion history text (from the projector). Each agent sees the history
 *   from their own point of view, so they can make an informed decision about
 *   whether to insist or yield based on the full discussion context.
 */
export async function negotiateCollision(
  candidates: readonly CollisionCandidate[],
  allParticipantNames: readonly string[],
  topic: string,
  perspectiveHistories: ReadonlyMap<string, string>,
  gateway: ModelGateway,
  sessionId: string,
  iterationId: number,
  abortSignal?: AbortSignal,
): Promise<NegotiationOutcome> {
  const rounds: NegotiationRoundResult[] = [];

  // Active candidates still in the negotiation (those who haven't yielded)
  let active = [...candidates];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (active.length <= 1) break;

    const decisions = await runNegotiationRound(
      round,
      active,
      rounds,
      candidates,
      allParticipantNames,
      topic,
      perspectiveHistories,
      gateway,
      sessionId,
      iterationId,
      abortSignal,
    );

    rounds.push({ round, decisions });

    const insisting = decisions.filter(d => d.decision === "insist");
    const yielding = decisions.filter(d => d.decision === "yield");

    // Exactly one insists → winner
    if (insisting.length === 1) {
      return { winnerId: insisting[0].agentId, rounds };
    }

    // All yield → reset to all candidates for next round (everyone reconsiders).
    // In real life, when everyone politely defers, someone eventually speaks up.
    if (yielding.length === active.length) {
      active = [...candidates];
      continue;
    }

    // Multiple insist → narrow down to insisting agents for next round
    active = active.filter(c =>
      insisting.some(d => d.agentId === c.agentId),
    );
  }

  // Max rounds reached without convergence → treat as all-yield
  return { winnerId: null, rounds };
}

// ---------------------------------------------------------------------------
// Single negotiation round
// ---------------------------------------------------------------------------

async function runNegotiationRound(
  round: number,
  active: readonly CollisionCandidate[],
  previousRounds: readonly NegotiationRoundResult[],
  allCandidates: readonly CollisionCandidate[],
  allParticipantNames: readonly string[],
  topic: string,
  perspectiveHistories: ReadonlyMap<string, string>,
  gateway: ModelGateway,
  sessionId: string,
  iterationId: number,
  abortSignal?: AbortSignal,
): Promise<AgentDecision[]> {
  const calls = active.map(candidate => {
    const input = buildNegotiationInput(
      round,
      candidate,
      active,
      previousRounds,
      allCandidates,
      allParticipantNames,
      topic,
      perspectiveHistories.get(candidate.agentId) ?? "",
      sessionId,
      iterationId,
      abortSignal,
    );
    return gateway.generate(input).then(
      output => ({ candidate, input, output }),
      (err: unknown): { candidate: CollisionCandidate; input: ModelCallInput; output: ModelCallOutput } => ({
        candidate,
        input,
        output: {
          agentId: candidate.agentId,
          text: err instanceof Error ? err.message : String(err),
          finishReason: "error" as const,
        },
      }),
    );
  });

  const results = await Promise.all(calls);

  return results.map(({ candidate, input, output }) => ({
    agentId: candidate.agentId,
    agentName: candidate.agentName,
    decision: parseDecision(output.text),
    rawText: output.text,
    prompt: input,
  }));
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildNegotiationInput(
  round: number,
  candidate: CollisionCandidate,
  activeCandidates: readonly CollisionCandidate[],
  previousRounds: readonly NegotiationRoundResult[],
  allCandidates: readonly CollisionCandidate[],
  allParticipantNames: readonly string[],
  topic: string,
  discussionHistory: string,
  sessionId: string,
  iterationId: number,
  abortSignal?: AbortSignal,
): ModelCallInput {
  const otherNames = activeCandidates
    .filter(c => c.agentId !== candidate.agentId)
    .map(c => c.agentName);

  const systemPrompt = [
    `你是 ${candidate.agentName}，正在参与一个关于「${topic}」的圆桌讨论。`,
    `刚才你和其他人同时开口了，声音重叠，没有人听清。`,
    `现在需要协商谁先发言。请根据讨论的上下文和你的判断决定：坚持发言，还是让别人先说。`,
    `只回复"坚持"或"让步"，不要输出其他内容。`,
  ].join("\n");

  const historyParts: string[] = [];

  // Include discussion history so the model has full context
  if (discussionHistory) {
    historyParts.push("到目前为止的讨论：");
    historyParts.push(discussionHistory);
    historyParts.push("");
  }

  // Check if this candidate was @-mentioned AFTER their last speech.
  // Once they've spoken (responded), the mention is "consumed".
  const mentionTag = `@${candidate.agentName}`;
  const lastMention = discussionHistory.lastIndexOf(mentionTag);
  const selfTag = `[你]:`;
  const lastSpeech = discussionHistory.lastIndexOf(selfTag);
  const wasMentioned = lastMention !== -1 && lastMention > lastSpeech;

  // Describe the collision
  historyParts.push(`你和 ${otherNames.join("、")} 同时开口了。你想说的是「${candidate.utterance}」，但没有人听清。`);

  if (wasMentioned) {
    historyParts.push(`注意：刚才有人在讨论中点名向你（@${candidate.agentName}）提问，你可能更有理由坚持发言来回应。`);
  }

  // Add previous round results
  for (const pr of previousRounds) {
    const roundDesc = pr.decisions.map(d => {
      const name = d.agentId === candidate.agentId ? "你" : d.agentName;
      return `${name}${d.decision === "insist" ? "坚持" : "让步"}`;
    });
    historyParts.push(`第 ${pr.round} 轮协商：${roundDesc.join("，")}。`);
  }

  // Current round context
  if (previousRounds.length > 0) {
    const stillCompeting = activeCandidates
      .filter(c => c.agentId !== candidate.agentId)
      .map(c => c.agentName);
    historyParts.push(`目前还有你和 ${stillCompeting.join("、")} 都想说话，已经僵持了 ${previousRounds.length} 轮。`);
  }

  historyParts.push(`\n你要坚持发言，还是让步？`);

  return {
    sessionId,
    iterationId,
    agentId: candidate.agentId,
    mode: "reaction",
    systemPrompt,
    historyText: historyParts.join("\n"),
    maxTokens: NEGOTIATION_MAX_TOKENS,
    abortSignal,
  };
}

// ---------------------------------------------------------------------------
// Decision parsing
// ---------------------------------------------------------------------------

function parseDecision(text: string): "insist" | "yield" {
  const cleaned = text.trim().toLowerCase();

  // Check for explicit keywords
  if (cleaned.includes("坚持")) return "insist";
  if (cleaned.includes("让步")) return "yield";
  if (cleaned.includes("让")) return "yield";
  if (cleaned.includes("insist")) return "insist";
  if (cleaned.includes("yield")) return "yield";

  // Default: if we can't parse, treat as yield (conservative)
  return "yield";
}
