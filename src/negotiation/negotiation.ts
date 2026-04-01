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
import { buildNegotiationInput } from "../prompting/builders/negotiation.js";

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
