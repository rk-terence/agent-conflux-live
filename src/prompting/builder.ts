/**
 * Re-exports from the new builders/reaction module for backwards compatibility.
 */
export {
  buildSystemPrompt,
  buildReactionInput,
} from "./builders/reaction.js";
export type {
  CollisionContext,
  ReactionParams,
} from "./builders/reaction.js";
