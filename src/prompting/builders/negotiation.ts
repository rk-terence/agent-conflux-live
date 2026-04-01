import type { ModelCallInput } from "../../model-gateway/types.js";
import { NEGOTIATION_MAX_TOKENS } from "../constants.js";
import { composeUserPrompt } from "../compose.js";
import { render } from "../render.js";
import {
  NEGOTIATION_SYSTEM_TEMPLATE,
  COLLISION_DESC_TEMPLATE,
  MENTION_HINT_TEMPLATE,
  NEGOTIATION_STARVATION_HINT_TEMPLATE,
  ROUND_RESULT_TEMPLATE,
  DEADLOCK_TEMPLATE,
  NEGOTIATION_QUESTION,
} from "../templates/negotiation.js";
import { wasMentionedAfterLastSpeech } from "../mention-utils.js";

// ---------------------------------------------------------------------------
// Types (re-used from negotiation module)
// ---------------------------------------------------------------------------

export type NegotiationCandidate = {
  readonly agentId: string;
  readonly agentName: string;
  readonly utterance: string;
};

export type NegotiationRoundSnapshot = {
  readonly round: number;
  readonly decisions: readonly {
    readonly agentId: string;
    readonly agentName: string;
    readonly insistence: "low" | "mid" | "high";
  }[];
};

// ---------------------------------------------------------------------------
// Turn directive assembly
// ---------------------------------------------------------------------------

const INSISTENCE_LABEL: Record<"low" | "mid" | "high", string> = {
  low: "让步",
  mid: "犹豫",
  high: "坚持",
};

function buildRoundSummary(
  round: NegotiationRoundSnapshot,
  selfAgentId: string,
): string {
  const decisions = round.decisions.map(d => {
    const name = d.agentId === selfAgentId ? "你" : d.agentName;
    return `${name}${INSISTENCE_LABEL[d.insistence]}`;
  });
  return render(ROUND_RESULT_TEMPLATE, {
    round: String(round.round),
    decisions: decisions.join("，"),
  });
}

function buildTurnDirective(
  candidate: NegotiationCandidate,
  activeCandidates: readonly NegotiationCandidate[],
  previousRounds: readonly NegotiationRoundSnapshot[],
  projectedHistory: string,
  consecutiveCollisionLosses?: number,
): string {
  const parts: string[] = [];

  // Collision description
  const otherNames = activeCandidates
    .filter(c => c.agentId !== candidate.agentId)
    .map(c => c.agentName);

  parts.push(render(COLLISION_DESC_TEMPLATE, {
    otherNames: otherNames.join("、"),
    utterance: candidate.utterance,
  }));

  // @mention hint
  if (wasMentionedAfterLastSpeech(projectedHistory, candidate.agentName)) {
    parts.push(render(MENTION_HINT_TEMPLATE, {
      agentName: candidate.agentName,
    }));
  }

  // Starvation hint
  if (consecutiveCollisionLosses != null && consecutiveCollisionLosses >= 2) {
    parts.push(render(NEGOTIATION_STARVATION_HINT_TEMPLATE, {
      losses: String(consecutiveCollisionLosses),
    }));
  }

  // Previous round summaries
  for (const pr of previousRounds) {
    parts.push(buildRoundSummary(pr, candidate.agentId));
  }

  // Deadlock context
  if (previousRounds.length > 0) {
    const competitors = activeCandidates
      .filter(c => c.agentId !== candidate.agentId)
      .map(c => c.agentName);
    parts.push(render(DEADLOCK_TEMPLATE, {
      competitors: competitors.join("、"),
      roundCount: String(previousRounds.length),
    }));
  }

  parts.push(`\n${NEGOTIATION_QUESTION}`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildNegotiationInput(
  round: number,
  candidate: NegotiationCandidate,
  activeCandidates: readonly NegotiationCandidate[],
  previousRounds: readonly NegotiationRoundSnapshot[],
  _allCandidates: readonly NegotiationCandidate[],
  _allParticipantNames: readonly string[],
  topic: string,
  projectedHistory: string,
  sessionId: string,
  iterationId: number,
  abortSignal?: AbortSignal,
  consecutiveCollisionLosses?: number,
): ModelCallInput {
  const systemPrompt = render(NEGOTIATION_SYSTEM_TEMPLATE, {
    agentName: candidate.agentName,
    topic,
  });

  const turnDirective = buildTurnDirective(
    candidate,
    activeCandidates,
    previousRounds,
    projectedHistory,
    consecutiveCollisionLosses,
  );

  return {
    sessionId,
    iterationId,
    agentId: candidate.agentId,
    mode: "negotiation",
    systemPrompt,
    userPromptText: composeUserPrompt({ projectedHistory, turnDirective }),
    maxTokens: NEGOTIATION_MAX_TOKENS,
    abortSignal,
  };
}
