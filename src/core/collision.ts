import { randomUUID } from "node:crypto";
import type {
  SessionState,
  SessionObserver,
  LLMClient,
  AgentState,
  InsistenceLevel,
  CollisionInfo,
  ColliderEntry,
  VoteEntry,
  NegotiationContext,
  NegotiationResult,
  VotingResult,
  PromptMode,
} from "../types.js";
import type { LogContext } from "../log-context.js";
import { buildNegotiationPrompt, buildVotingPrompt } from "../prompt/prompt-builder.js";
import { normalizeNegotiation } from "../normalize/negotiation.js";
import { normalizeVoting } from "../normalize/voting.js";
import { withRetry, RetryExhaustedError } from "../llm/retry.js";
import { recordThought } from "../state/session.js";

interface Speaker {
  agent: AgentState;
  name: string;
  utterance: string;
  insistence: InsistenceLevel;
}

const INSISTENCE_ORDER: Record<InsistenceLevel, number> = { low: 0, mid: 1, high: 2 };

export async function resolveCollision(
  session: SessionState,
  clients: Map<string, LLMClient>,
  speakers: Speaker[],
  observer?: SessionObserver,
  logCtx?: LogContext,
): Promise<CollisionInfo> {
  const colliders: ColliderEntry[] = speakers.map((s) => ({
    agent: s.name,
    utterance: s.utterance,
    insistence: s.insistence,
  }));

  // Tier 1 — Insistence comparison
  const tier1Result = tryTier1(speakers);

  // Log tier 1 evaluation
  observer?.onCollisionRound?.({
    turn: session.currentTurn,
    tier: 1,
    round: 1,
    candidates: speakers.map((s) => s.name),
    insistences: speakers.map((s) => ({ agent: s.name, insistence: s.insistence })),
    eliminated: [],
    winner: tier1Result ? tier1Result.name : null,
  });

  if (tier1Result) {
    return {
      colliders,
      winner: tier1Result.name,
      winnerInsistence: tier1Result.insistence,
      resolutionTier: 1,
      votes: [],
    };
  }

  // Tier 2 — Negotiation
  let candidates = getHighestInsistenceCandidates(speakers);
  const previousRounds: NegotiationContext["previousRounds"] = [];

  for (let round = 1; round <= session.config.maxNegotiationRounds; round++) {
    const roundDecisions: { agent: string; insistence: InsistenceLevel }[] = [];

    // Build and call LLM in parallel for all candidates
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const ctx: NegotiationContext = {
          colliders: speakers.map((s) => ({ name: s.name, utterance: s.utterance })),
          thisAgentUtterance: candidate.utterance,
          previousRounds: [...previousRounds],
        };
        const prompt = buildNegotiationPrompt(candidate.agent, session, ctx);
        const client = clients.get(candidate.name)!;

        const callId = randomUUID();
        const request = {
          ...prompt,
          _meta: {
            callId,
            turn: session.currentTurn,
            agent: candidate.name,
            mode: "negotiation" as PromptMode,
            attempt: 0,
            provider: candidate.agent.config.provider,
            historyChars: prompt.historyChars,
            directiveChars: prompt.directiveChars,
          },
        };

        let result: NegotiationResult;
        try {
          const raw = await withRetry(
            () => client.chat(request),
            session.config.apiRetries,
            (attempt) => { request._meta!.attempt = attempt; },
          );
          const withMeta = normalizeNegotiation(raw);
          result = withMeta;

          // Emit normalize_result
          observer?.onNormalizeResult?.({
            callId,
            agent: candidate.name,
            mode: "negotiation",
            rawKind: withMeta._normMeta.rawKind,
            jsonExtracted: withMeta._normMeta.jsonExtracted,
            fallbackPath: withMeta._normMeta.fallbackPath,
            truncationSuspected: withMeta._normMeta.truncationSuspected,
            thoughtType: withMeta._normMeta.thoughtType,
            payload: { insistence: withMeta.insistence, thought: withMeta.thought },
          });
        } catch (err) {
          if (err instanceof RetryExhaustedError) {
            result = { insistence: "low", thought: null };
          } else {
            throw err;
          }
        }

        recordThought(session, session.currentTurn, candidate.name, "negotiation", result.thought, observer);
        return { candidate, result };
      }),
    );

    // Collect decisions
    for (const { candidate, result } of results) {
      candidate.insistence = result.insistence;
      roundDecisions.push({ agent: candidate.name, insistence: result.insistence });
    }
    previousRounds.push({ round, decisions: roundDecisions });

    // Evaluate
    const uniqueHighest = getUniqueHighest(candidates);

    // Determine eliminations
    let eliminated: string[] = [];
    let nextCandidates = candidates;

    if (uniqueHighest) {
      eliminated = candidates.filter((c) => c.name !== uniqueHighest.name).map((c) => c.name);
    } else if (!candidates.every((c) => c.insistence === "low")) {
      const minLevel = Math.min(...candidates.map((c) => INSISTENCE_ORDER[c.insistence]));
      const remaining = candidates.filter((c) => INSISTENCE_ORDER[c.insistence] > minLevel);
      if (remaining.length >= 1) {
        eliminated = candidates.filter((c) => INSISTENCE_ORDER[c.insistence] === minLevel).map((c) => c.name);
        nextCandidates = remaining;
      }
    }

    // Log tier 2 round
    observer?.onCollisionRound?.({
      turn: session.currentTurn,
      tier: 2,
      round,
      candidates: candidates.map((c) => c.name),
      insistences: roundDecisions,
      eliminated,
      winner: uniqueHighest ? uniqueHighest.name : (nextCandidates.length === 1 ? nextCandidates[0].name : null),
    });

    if (uniqueHighest) {
      return {
        colliders,
        winner: uniqueHighest.name,
        winnerInsistence: uniqueHighest.insistence,
        resolutionTier: 2,
        votes: [],
      };
    }

    // All low → reset (no elimination), continue
    if (candidates.every((c) => c.insistence === "low")) {
      continue;
    }

    // Eliminate lowest level
    const minLevel = Math.min(...candidates.map((c) => INSISTENCE_ORDER[c.insistence]));
    const remaining = candidates.filter((c) => INSISTENCE_ORDER[c.insistence] > minLevel);
    if (remaining.length === 1) {
      return {
        colliders,
        winner: remaining[0].name,
        winnerInsistence: remaining[0].insistence,
        resolutionTier: 2,
        votes: [],
      };
    }
    if (remaining.length > 1) {
      candidates = remaining;
    }
    // If remaining is empty (shouldn't happen if not all low), keep candidates
  }

  // Tier 3 — Bystander Voting
  const candidateNames = candidates.map((c) => c.name);
  const colliderNameSet = new Set(speakers.map((s) => s.name));
  const voters = session.agents.filter((a) => !colliderNameSet.has(a.name));

  if (voters.length > 0) {
    const voteResults = await Promise.all(
      voters.map(async (voter) => {
        const prompt = buildVotingPrompt(voter, session, candidateNames);
        const client = clients.get(voter.name)!;

        const callId = randomUUID();
        const request = {
          ...prompt,
          _meta: {
            callId,
            turn: session.currentTurn,
            agent: voter.name,
            mode: "voting" as PromptMode,
            attempt: 0,
            provider: voter.config.provider,
            historyChars: prompt.historyChars,
            directiveChars: prompt.directiveChars,
          },
        };

        let result: VotingResult;
        try {
          const raw = await withRetry(
            () => client.chat(request),
            session.config.apiRetries,
            (attempt) => { request._meta!.attempt = attempt; },
          );
          const withMeta = normalizeVoting(raw, candidateNames);
          result = withMeta;

          // Emit normalize_result
          observer?.onNormalizeResult?.({
            callId,
            agent: voter.name,
            mode: "voting",
            rawKind: withMeta._normMeta.rawKind,
            jsonExtracted: withMeta._normMeta.jsonExtracted,
            fallbackPath: withMeta._normMeta.fallbackPath,
            truncationSuspected: withMeta._normMeta.truncationSuspected,
            thoughtType: withMeta._normMeta.thoughtType,
            payload: { vote: withMeta.vote, thought: withMeta.thought },
          });
        } catch (err) {
          if (err instanceof RetryExhaustedError) {
            result = { vote: null, thought: null };
          } else {
            throw err;
          }
        }

        recordThought(session, session.currentTurn, voter.name, "voting", result.thought, observer);
        return { voter: voter.name, result };
      }),
    );

    // Tally
    const votes: VoteEntry[] = [];
    const tally = new Map<string, number>();
    for (const { voter, result } of voteResults) {
      if (result.vote !== null) {
        votes.push({ voter, votedFor: result.vote });
        tally.set(result.vote, (tally.get(result.vote) || 0) + 1);
      }
    }

    let tier3Winner: string | null = null;
    if (tally.size > 0) {
      const maxVotes = Math.max(...tally.values());
      const winners = [...tally.entries()].filter(([, count]) => count === maxVotes);
      if (winners.length === 1) {
        tier3Winner = winners[0][0];
      }
    }

    // Log tier 3 round
    observer?.onCollisionRound?.({
      turn: session.currentTurn,
      tier: 3,
      round: 1,
      candidates: candidateNames,
      insistences: candidates.map((c) => ({ agent: c.name, insistence: c.insistence })),
      eliminated: tier3Winner ? candidateNames.filter((n) => n !== tier3Winner) : [],
      winner: tier3Winner,
    });

    if (tier3Winner) {
      const winnerCandidate = candidates.find((c) => c.name === tier3Winner)!;
      return {
        colliders,
        winner: tier3Winner,
        winnerInsistence: winnerCandidate.insistence,
        resolutionTier: 3,
        votes,
      };
    }
    // Tie → fall through to Tier 4
  }

  // Tier 4 — Random
  const randomWinner = candidates[Math.floor(Math.random() * candidates.length)];

  // Log tier 4
  observer?.onCollisionRound?.({
    turn: session.currentTurn,
    tier: 4,
    round: 1,
    candidates: candidates.map((c) => c.name),
    insistences: candidates.map((c) => ({ agent: c.name, insistence: c.insistence })),
    eliminated: candidates.filter((c) => c.name !== randomWinner.name).map((c) => c.name),
    winner: randomWinner.name,
  });

  return {
    colliders,
    winner: randomWinner.name,
    winnerInsistence: randomWinner.insistence,
    resolutionTier: 4,
    votes: [],
  };
}

function tryTier1(speakers: Speaker[]): Speaker | null {
  return getUniqueHighest(speakers);
}

function getUniqueHighest(speakers: Speaker[]): Speaker | null {
  const maxLevel = Math.max(...speakers.map((s) => INSISTENCE_ORDER[s.insistence]));
  const atMax = speakers.filter((s) => INSISTENCE_ORDER[s.insistence] === maxLevel);
  return atMax.length === 1 ? atMax[0] : null;
}

function getHighestInsistenceCandidates(speakers: Speaker[]): Speaker[] {
  const maxLevel = Math.max(...speakers.map((s) => INSISTENCE_ORDER[s.insistence]));
  return speakers.filter((s) => INSISTENCE_ORDER[s.insistence] === maxLevel);
}
