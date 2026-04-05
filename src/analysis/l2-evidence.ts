import type { ParsedEvent } from "./log-schema.js";
import type { RunSummary } from "./types.js";

const MAX_DIALOGUE_TURNS = 30;
const MAX_UTTERANCE_CHARS = 300;
const MAX_THOUGHT_CHARS = 200;

export interface L2EvidenceTurn {
  turn: number;
  speaker: string;
  utterance: string;
  insistence: string | null;
  had_collision: boolean;
  collision_tier: number | null;
  collision_colliders: string[];
  interrupted_by: string | null;
  interruption_succeeded: boolean | null;
}

export interface L2ThoughtSample {
  slot: "first" | "middle" | "last";
  text: string;
}

export interface L2EvidenceThoughts {
  agent: string;
  samples: L2ThoughtSample[];
}

export interface L2EvidenceCollisionRound {
  tier: number;
  round: number;
  candidates: string[];
  insistences: Array<{ agent: string; insistence: string | null }>;
  eliminated: string[];
  winner: string | null;
}

export interface L2EvidenceCollision {
  turn: number;
  winner: string;
  winner_insistence: string | null;
  resolution_tier: number;
  colliders: Array<{ agent: string; utterance: string | null; insistence: string | null }>;
  votes: Array<{ voter: string; voted_for: string | null }>;
  rounds: L2EvidenceCollisionRound[];
}

export interface L2ContaminationHints {
  tier4_count: number;
  tier3_count: number;
  truncation_suspected_count: number;
  dedup_drop_count: number;
  fallback_count: number;
}

export interface L2EvidenceDocument {
  topic: string | null;
  agents: string[];
  dialogue_turns: L2EvidenceTurn[];
  sampled_thoughts: L2EvidenceThoughts[];
  supporting_collisions: L2EvidenceCollision[];
  contamination_hints: L2ContaminationHints;
}

interface RawSpeechTurn {
  turn: number;
  speaker: string;
  utterance: string;
  insistence: string | null;
  collision_tier_from_record: number | null;
  collision_colliders_from_record: string[];
  interrupted_by: string | null;
  interruption_succeeded: boolean | null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}

function extractColliderNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    const agent = obj ? asString(obj.agent) : null;
    if (agent) names.push(agent);
  }
  return names;
}

function extractCollisionTier(raw: unknown): number | null {
  const obj = asRecord(raw);
  return obj ? asNumber(obj.resolutionTier) : null;
}

function extractInterruptionMeta(
  raw: unknown,
): { interruptedBy: string | null; success: boolean | null } {
  const obj = asRecord(raw);
  if (!obj) return { interruptedBy: null, success: null };
  const interrupter = asString(obj.interrupter);
  const success = typeof obj.success === "boolean" ? obj.success : null;
  return { interruptedBy: interrupter, success };
}

function extractSpeechTurn(ev: Extract<ParsedEvent, { event: "turn_complete" }>): RawSpeechTurn | null {
  const rec = ev.record;
  if (rec.type !== "speech" || !rec.speaker || typeof rec.utterance !== "string") {
    return null;
  }

  const interruption = extractInterruptionMeta(rec.interruption);

  return {
    turn: rec.turn,
    speaker: rec.speaker,
    utterance: truncate(rec.utterance, MAX_UTTERANCE_CHARS),
    insistence: typeof rec.insistence === "string" ? rec.insistence : null,
    collision_tier_from_record: extractCollisionTier(rec.collision),
    collision_colliders_from_record: extractColliderNames(asRecord(rec.collision)?.colliders),
    interrupted_by: interruption.interruptedBy,
    interruption_succeeded: interruption.success,
  };
}

function sampleThoughts(thoughts: string[]): L2ThoughtSample[] {
  if (thoughts.length === 0) return [];
  if (thoughts.length === 1) return [{ slot: "first", text: thoughts[0] }];
  if (thoughts.length === 2) {
    return [
      { slot: "first", text: thoughts[0] },
      { slot: "last", text: thoughts[1] },
    ];
  }

  const indexSlots: Array<[number, L2ThoughtSample["slot"]]> = [
    [0, "first"],
    [Math.floor(thoughts.length / 2), "middle"],
    [thoughts.length - 1, "last"],
  ];

  const seen = new Set<number>();
  const samples: L2ThoughtSample[] = [];

  for (const [index, slot] of indexSlots) {
    if (seen.has(index)) continue;
    seen.add(index);
    samples.push({ slot, text: thoughts[index] });
    if (samples.length === 3) break;
  }

  return samples;
}

function extractCollision(
  ev: Extract<ParsedEvent, { event: "collision_resolved" }>,
  turn: number,
  rounds: L2EvidenceCollisionRound[],
): L2EvidenceCollision {
  const colliders = Array.isArray(ev.colliders)
    ? ev.colliders
        .map((item) => {
          const obj = asRecord(item);
          if (!obj) return null;
          const agent = asString(obj.agent);
          if (!agent) return null;
          return {
            agent,
            utterance: asString(obj.utterance),
            insistence: asString(obj.insistence),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];

  const votes = Array.isArray(ev.votes)
    ? ev.votes
        .map((item) => {
          const obj = asRecord(item);
          if (!obj) return null;
          const voter = asString(obj.voter);
          if (!voter) return null;
          return { voter, voted_for: asString(obj.votedFor) };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];

  return {
    turn,
    winner: ev.winner,
    winner_insistence: asString(ev.winnerInsistence),
    resolution_tier: ev.resolutionTier,
    colliders,
    votes,
    rounds,
  };
}

export function extractL2Evidence(
  events: ParsedEvent[],
  summary: RunSummary,
): L2EvidenceDocument {
  const speechTurns: RawSpeechTurn[] = [];
  const thoughtsByAgent = new Map<string, string[]>();
  const collisions: L2EvidenceCollision[] = [];
  const agents = summary.session.agents.map((agent) => agent.name);

  let currentTurn = 0;
  let pendingCollisionRounds: L2EvidenceCollisionRound[] = [];
  let pendingCollisionTurn: number | null = null;

  for (const ev of events) {
    if ("_unknown" in ev) continue;

    switch (ev.event) {
      case "turn_start": {
        currentTurn = ev.turn;
        break;
      }

      case "turn_complete": {
        const speechTurn = extractSpeechTurn(ev);
        if (speechTurn) {
          speechTurns.push(speechTurn);
        }
        break;
      }

      case "thought_update": {
        if (typeof ev.thought !== "string") break;
        const thoughts = thoughtsByAgent.get(ev.agent) ?? [];
        thoughts.push(truncate(ev.thought, MAX_THOUGHT_CHARS));
        thoughtsByAgent.set(ev.agent, thoughts);
        break;
      }

      case "collision_start": {
        pendingCollisionRounds = [];
        pendingCollisionTurn = currentTurn;
        break;
      }

      case "collision_round": {
        pendingCollisionTurn = ev.turn;
        pendingCollisionRounds.push({
          tier: ev.tier,
          round: typeof ev.round === "number" ? ev.round : 1,
          candidates: asStringArray(ev.candidates),
          insistences: Array.isArray(ev.insistences)
            ? ev.insistences
                .map((item) => {
                  const agent = asString(asRecord(item)?.agent);
                  if (!agent) return null;
                  return {
                    agent,
                    insistence: asString(asRecord(item)?.insistence),
                  };
                })
                .filter((item): item is NonNullable<typeof item> => item !== null)
            : [],
          eliminated: asStringArray(ev.eliminated),
          winner: typeof ev.winner === "string" ? ev.winner : null,
        });
        break;
      }

      case "collision_resolved": {
        collisions.push(
          extractCollision(ev, pendingCollisionTurn ?? currentTurn, pendingCollisionRounds),
        );
        pendingCollisionRounds = [];
        pendingCollisionTurn = null;
        break;
      }
    }
  }

  const collisionsByTurn = new Map<number, L2EvidenceCollision[]>();
  for (const collision of collisions) {
    const group = collisionsByTurn.get(collision.turn);
    if (group) {
      group.push(collision);
    } else {
      collisionsByTurn.set(collision.turn, [collision]);
    }
  }

  const dialogueTurns = speechTurns
    .map((turn) => {
      const turnCollisions = collisionsByTurn.get(turn.turn);
      return {
        turn: turn.turn,
        speaker: turn.speaker,
        utterance: turn.utterance,
        insistence: turn.insistence,
        had_collision:
          turnCollisions !== undefined || turn.collision_tier_from_record !== null,
        collision_tier: turnCollisions
          ? Math.max(...turnCollisions.map((c) => c.resolution_tier))
          : turn.collision_tier_from_record,
        collision_colliders: turnCollisions
          ? [...new Set(turnCollisions.flatMap((c) => c.colliders.map((e) => e.agent)))]
          : turn.collision_colliders_from_record,
        interrupted_by: turn.interrupted_by,
        interruption_succeeded: turn.interruption_succeeded,
      };
    })
    .slice(-MAX_DIALOGUE_TURNS);

  const includedTurns = new Set(dialogueTurns.map((turn) => turn.turn));

  return {
    topic: summary.session.topic,
    agents,
    dialogue_turns: dialogueTurns,
    sampled_thoughts: agents
      .map((agent) => ({
        agent,
        samples: sampleThoughts(thoughtsByAgent.get(agent) ?? []),
      }))
      .filter((entry) => entry.samples.length > 0),
    supporting_collisions: collisions.filter((collision) => includedTurns.has(collision.turn)),
    contamination_hints: {
      tier4_count: summary.mechanics.tier4_count,
      tier3_count: summary.mechanics.tier3_count,
      truncation_suspected_count: summary.api.truncation_suspected_count,
      dedup_drop_count: summary.filtering.dedup_drop_count,
      fallback_count: summary.api.fallback_count,
    },
  };
}
