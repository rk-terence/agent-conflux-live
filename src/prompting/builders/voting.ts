import type { ModelCallInput } from "../../model-gateway/types.js";
import { VOTING_MAX_TOKENS } from "../constants.js";
import { composeUserPrompt } from "../compose.js";
import { render } from "../render.js";
import {
  VOTING_SYSTEM_TEMPLATE,
  VOTING_CANDIDATES_TEMPLATE,
} from "../templates/voting.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VotingParams = {
  readonly voterId: string;
  readonly voterName: string;
  readonly candidateNames: readonly string[];
  readonly topic: string;
  readonly projectedHistory: string;
  readonly sessionId: string;
  readonly iterationId: number;
  readonly abortSignal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Full voting input
// ---------------------------------------------------------------------------

export function buildVotingInput(params: VotingParams): ModelCallInput {
  const systemPrompt = render(VOTING_SYSTEM_TEMPLATE, {
    agentName: params.voterName,
    topic: params.topic,
  });

  const turnDirective = render(VOTING_CANDIDATES_TEMPLATE, {
    candidateNames: params.candidateNames.join("、"),
  });

  return {
    sessionId: params.sessionId,
    iterationId: params.iterationId,
    agentId: params.voterId,
    mode: "voting",
    systemPrompt,
    userPromptText: composeUserPrompt({
      projectedHistory: params.projectedHistory,
      turnDirective,
    }),
    maxTokens: VOTING_MAX_TOKENS,
    abortSignal: params.abortSignal,
  };
}
