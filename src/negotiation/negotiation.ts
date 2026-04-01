/**
 * Collision negotiation module — four-tier resolution.
 *
 * When multiple agents speak simultaneously (collision), this module resolves
 * who gets the floor using a tiered system:
 *
 * Tier 1: Pre-declared insistence comparison (zero API calls)
 * Tier 2: Multi-round three-level negotiation (max 3 rounds)
 * Tier 3: Bystander voting (one API call per bystander)
 * Tier 4: Random tiebreak (guaranteed convergence)
 */

import type { InsistenceLevel, ResolutionTier } from "../domain/types.js";
import type { ModelGateway, ModelCallInput, ModelCallOutput } from "../model-gateway/types.js";
import { buildNegotiationInput } from "../prompting/builders/negotiation.js";
import { buildVotingInput } from "../prompting/builders/voting.js";
import { extractJson, isInsistenceLevel } from "../normalization/normalize.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollisionCandidate = {
  readonly agentId: string;
  readonly agentName: string;
  readonly utterance: string;
  readonly insistence: InsistenceLevel;
};

export type NegotiationRoundResult = {
  readonly round: number;
  readonly decisions: readonly AgentDecision[];
};

export type AgentDecision = {
  readonly agentId: string;
  readonly agentName: string;
  readonly insistence: InsistenceLevel;
  readonly rawText: string;
  /** The full prompt sent to this agent for this negotiation round */
  readonly prompt: ModelCallInput;
};

export type VoteResult = {
  readonly voterId: string;
  readonly voterName: string;
  readonly votedForId: string;
  readonly votedForName: string;
  readonly rawText: string;
};

export type VotingRoundResult = {
  readonly votes: readonly VoteResult[];
};

export type { ResolutionTier } from "../domain/types.js";

export type NegotiationOutcome = {
  /** The agent who won the floor, or null if all yielded */
  readonly winnerId: string | null;
  /** Which tier resolved the collision */
  readonly tier: ResolutionTier;
  /** All negotiation rounds for logging/debug (Tier 2) */
  readonly rounds: readonly NegotiationRoundResult[];
  /** Voting results if Tier 3 was used */
  readonly voting?: VotingRoundResult;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum negotiation rounds in Tier 2 */
const MAX_ROUNDS = 3;

/** Ordinal mapping for insistence comparison */
const INSISTENCE_ORD: Record<InsistenceLevel, number> = { low: 0, mid: 1, high: 2 };

// ---------------------------------------------------------------------------
// Main negotiation function
// ---------------------------------------------------------------------------

/**
 * @param candidates - Agents who collided, with their pre-declared insistence
 * @param allParticipants - All agents in the discussion (for bystander voting)
 * @param allParticipantNames - All agent names
 * @param topic - Discussion topic
 * @param perspectiveHistories - Map of agentId → perspective-specific history text
 * @param gateway - Model gateway for API calls
 */
export async function negotiateCollision(
  candidates: readonly CollisionCandidate[],
  allParticipants: readonly { readonly agentId: string; readonly agentName: string }[],
  allParticipantNames: readonly string[],
  topic: string,
  perspectiveHistories: ReadonlyMap<string, string>,
  gateway: ModelGateway,
  sessionId: string,
  iterationId: number,
  abortSignal?: AbortSignal,
): Promise<NegotiationOutcome> {
  // --- Tier 1: Pre-declared insistence comparison (zero API calls) ---
  const tier1Winner = tryTier1(candidates);
  if (tier1Winner) {
    return { winnerId: tier1Winner, tier: 1, rounds: [] };
  }

  // --- Tier 2: Multi-round three-level negotiation ---
  const maxLevel = maxInsistence(candidates.map(c => c.insistence));
  let active = candidates.filter(c => c.insistence === maxLevel);
  const rounds: NegotiationRoundResult[] = [];

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

    const roundMaxLevel = maxInsistence(decisions.map(d => d.insistence));
    const atMax = decisions.filter(d => d.insistence === roundMaxLevel);

    // Exactly one at highest level → winner
    if (atMax.length === 1) {
      return { winnerId: atMax[0].agentId, tier: 2, rounds };
    }

    // All declare low → keep current active set and retry (don't widen back
    // to include candidates already eliminated in previous rounds — that would
    // violate the "each layer strictly narrows uncertainty" invariant)
    if (decisions.every(d => d.insistence === "low")) {
      continue;
    }

    // Multiple at highest → narrow down
    active = active.filter(c =>
      atMax.some(d => d.agentId === c.agentId),
    );
  }

  // --- Tier 3: Bystander voting ---
  const colliderIds = new Set(candidates.map(c => c.agentId));
  const bystanders = allParticipants.filter(p => !colliderIds.has(p.agentId));

  if (bystanders.length > 0) {
    const votingResult = await runVotingRound(
      bystanders,
      active,
      topic,
      perspectiveHistories,
      gateway,
      sessionId,
      iterationId,
      abortSignal,
    );

    const talliedWinner = tallyVotes(votingResult.votes, active);
    if (talliedWinner) {
      return { winnerId: talliedWinner, tier: 3, rounds, voting: votingResult };
    }

    // Vote tie → fall through to Tier 4
    const winnerId = randomWinner(active);
    return { winnerId, tier: 4, rounds, voting: votingResult };
  }

  // --- Tier 4: Random tiebreak ---
  const winnerId = randomWinner(active);
  return { winnerId, tier: 4, rounds };
}

// ---------------------------------------------------------------------------
// Tier 1: Pre-declared insistence comparison
// ---------------------------------------------------------------------------

function tryTier1(candidates: readonly CollisionCandidate[]): string | null {
  const max = maxInsistence(candidates.map(c => c.insistence));
  const atMax = candidates.filter(c => c.insistence === max);
  return atMax.length === 1 ? atMax[0].agentId : null;
}

// ---------------------------------------------------------------------------
// Tier 2: Negotiation rounds
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
    insistence: parseInsistence(output.text),
    rawText: output.text,
    prompt: input,
  }));
}

// ---------------------------------------------------------------------------
// Tier 3: Bystander voting
// ---------------------------------------------------------------------------

async function runVotingRound(
  bystanders: readonly { readonly agentId: string; readonly agentName: string }[],
  activeCandidates: readonly CollisionCandidate[],
  topic: string,
  perspectiveHistories: ReadonlyMap<string, string>,
  gateway: ModelGateway,
  sessionId: string,
  iterationId: number,
  abortSignal?: AbortSignal,
): Promise<VotingRoundResult> {
  const candidateNames = activeCandidates.map(c => c.agentName);

  const calls = bystanders.map(voter => {
    const input = buildVotingInput({
      voterId: voter.agentId,
      voterName: voter.agentName,
      candidateNames,
      topic,
      projectedHistory: perspectiveHistories.get(voter.agentId) ?? "",
      sessionId,
      iterationId,
      abortSignal,
    });
    return gateway.generate(input).then(
      output => ({ voter, output }),
      (err: unknown) => ({
        voter,
        output: {
          agentId: voter.agentId,
          text: err instanceof Error ? err.message : String(err),
          finishReason: "error" as const,
        } as ModelCallOutput,
      }),
    );
  });

  const results = await Promise.all(calls);

  const votes: VoteResult[] = results.map(({ voter, output }) => {
    const votedName = parseVote(output.text);
    const votedCandidate = activeCandidates.find(c => c.agentName === votedName);
    return {
      voterId: voter.agentId,
      voterName: voter.agentName,
      votedForId: votedCandidate?.agentId ?? "",
      votedForName: votedName,
      rawText: output.text,
    };
  });

  return { votes };
}

/**
 * Tally votes and return the winner's agentId if there's a unique highest.
 * Returns null on tie.
 */
function tallyVotes(
  votes: readonly VoteResult[],
  candidates: readonly CollisionCandidate[],
): string | null {
  const counts = new Map<string, number>();
  for (const v of votes) {
    if (v.votedForId) {
      counts.set(v.votedForId, (counts.get(v.votedForId) ?? 0) + 1);
    }
  }

  if (counts.size === 0) return null;

  let maxCount = 0;
  for (const c of counts.values()) {
    if (c > maxCount) maxCount = c;
  }

  const winners = [...counts.entries()].filter(([, c]) => c === maxCount);
  if (winners.length === 1) return winners[0][0];

  return null; // tie
}

// ---------------------------------------------------------------------------
// Decision parsing
// ---------------------------------------------------------------------------

function parseInsistence(text: string): InsistenceLevel {
  const json = extractJson(text);
  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if (isInsistenceLevel(obj.insistence)) return obj.insistence;
  }

  // Keyword fallback
  const cleaned = text.trim().toLowerCase();
  if (cleaned.includes("high") || cleaned.includes("坚持")) return "high";
  if (cleaned.includes("mid") || cleaned.includes("犹豫") || cleaned.includes("中")) return "mid";
  if (cleaned.includes("low") || cleaned.includes("让步") || cleaned.includes("让")) return "low";

  // Default: conservative
  return "low";
}

function parseVote(text: string): string {
  const json = extractJson(text);
  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if (typeof obj.vote === "string") return obj.vote;
  }

  // Fallback: return the trimmed text as the vote
  return text.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maxInsistence(levels: readonly InsistenceLevel[]): InsistenceLevel {
  let max: InsistenceLevel = "low";
  for (const l of levels) {
    if (INSISTENCE_ORD[l] > INSISTENCE_ORD[max]) max = l;
  }
  return max;
}

function randomWinner(candidates: readonly CollisionCandidate[]): string {
  return candidates[Math.floor(Math.random() * candidates.length)].agentId;
}
