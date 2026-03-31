export const TOKEN_TO_SECONDS = 0.06;
export const SILENCE_BACKOFF_SCHEDULE = [1, 2, 4, 8, 16] as const;
export const MAX_SILENCE_BACKOFF = 16;
export const CUMULATIVE_SILENCE_LIMIT = 60;

/**
 * Virtual time cost of a collision, in seconds.
 * Models the real-world moment of "everyone starts talking, realizes the
 * overlap, and pauses". Scales with the number of people involved —
 * more people = more confusion = slightly longer to sort out.
 *
 * Base cost: 0.5s per person involved.
 * Negotiation rounds (if any) are added by the engine after the fact.
 */
export const COLLISION_BASE_SECONDS_PER_PERSON = 0.5;
