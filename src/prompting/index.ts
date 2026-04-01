export {
  buildSystemPrompt,
  buildReactionInput,
} from "./builders/reaction.js";
export type { ReactionParams, CollisionContext } from "./builders/reaction.js";

export { buildNegotiationInput } from "./builders/negotiation.js";
export type { NegotiationCandidate, NegotiationRoundSnapshot } from "./builders/negotiation.js";

export { buildVotingInput } from "./builders/voting.js";
export type { VotingParams } from "./builders/voting.js";

export { render } from "./render.js";
export { composeUserPrompt } from "./compose.js";
export type { PromptParts } from "./compose.js";
export * from "./constants.js";
