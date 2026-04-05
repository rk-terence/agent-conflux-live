import type { L2EvidenceDocument } from "./l2-evidence.js";

function formatDialogueTurn(turn: L2EvidenceDocument["dialogue_turns"][number]): string {
  const annotations: string[] = [];
  if (turn.insistence) annotations.push(`insistence=${turn.insistence}`);
  if (turn.had_collision) {
    annotations.push(
      `collision=tier${turn.collision_tier ?? "?"}${
        turn.collision_colliders.length > 0
          ? ` (${turn.collision_colliders.join(", ")})`
          : ""
      }`,
    );
  }
  if (turn.interrupted_by) {
    annotations.push(
      `interrupted_by=${turn.interrupted_by} success=${String(turn.interruption_succeeded)}`,
    );
  }
  const suffix = annotations.length > 0 ? ` [${annotations.join("; ")}]` : "";
  return `[Turn ${turn.turn}] ${turn.speaker}${suffix}\n${JSON.stringify(turn.utterance)}`;
}

function formatThoughts(evidence: L2EvidenceDocument): string {
  if (evidence.sampled_thoughts.length === 0) return "None";
  return evidence.sampled_thoughts
    .map((entry) => {
      const samples = entry.samples
        .map((sample) => `- ${sample.slot}: ${JSON.stringify(sample.text)}`)
        .join("\n");
      return `${entry.agent}\n${samples}`;
    })
    .join("\n\n");
}

function formatCollisions(evidence: L2EvidenceDocument): string {
  if (evidence.supporting_collisions.length === 0) return "None";
  return evidence.supporting_collisions
    .map((collision) => {
      const colliders =
        collision.colliders.length > 0
          ? collision.colliders
              .map((entry) => {
                const parts = [entry.agent];
                if (entry.insistence) parts.push(`insistence=${entry.insistence}`);
                if (entry.utterance) parts.push(`utterance=${JSON.stringify(entry.utterance)}`);
                return `- ${parts.join(" | ")}`;
              })
              .join("\n")
          : "- None";
      const rounds =
        collision.rounds.length > 0
          ? collision.rounds
              .map((round) => {
                const insistences = round.insistences
                  .map((item) => `${item.agent}:${item.insistence ?? "?"}`)
                  .join(", ");
                return `- round ${round.round} tier ${round.tier} | candidates: ${round.candidates.join(", ") || "none"} | insistences: ${insistences || "none"} | eliminated: ${round.eliminated.join(", ") || "none"} | winner: ${round.winner ?? "none"}`;
              })
              .join("\n")
          : "- None";
      return `Turn ${collision.turn} | winner=${collision.winner} | winner_insistence=${collision.winner_insistence ?? "?"} | tier=${collision.resolution_tier}\nColliders:\n${colliders}\nRounds:\n${rounds}`;
    })
    .join("\n\n");
}

export function buildL2Prompt(
  evidence: L2EvidenceDocument,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are scoring a multi-LLM conversation for publishable personality contrast.

Return JSON only. Do not wrap it in markdown fences.

Score exactly these five rubrics from 0 to 5:
- personality_contrast: distinct voices, priorities, or social styles are visible.
- dramatic_tension: interruptions, collisions, pressure, or disagreement create momentum.
- quotability: lines are memorable, specific, and worth excerpting.
- surprise: the exchange contains non-obvious turns, reversals, or revealing moments.
- arc_completion: the discussion develops rather than stalling in flat repetition.

Scale anchors:
- 0 = absent
- 1 = weak trace
- 2 = present but thin
- 3 = solid evidence
- 4 = strong and repeatable
- 5 = exceptional, unmistakable

Strict rules:
- Score only from the supplied evidence.
- Do not reward mechanics artifacts as content quality. Tier-3/Tier-4 resolution, fallback normalization, truncation, dedup drops, and similar artifacts are contamination, not personality.
- Prefer committed dialogue over speculation. Supporting thoughts and collision context may explain the dialogue, but should not override it.
- Include 0 to 3 candidate_quotes items total.
- Each rubric must include 1 to 3 evidence items quoting or closely excerpting the supplied evidence.
- If a rubric is weak, explain the failure mode concretely.

Return an object with this shape:
{
  "dominant_observation": string,
  "mechanics_contamination_note": string,
  "candidate_quotes": [{"turn": number, "speaker": string, "text": string}],
  "rubrics": [
    {
      "rubric": "personality_contrast" | "dramatic_tension" | "quotability" | "surprise" | "arc_completion",
      "score": 0-5,
      "why": string,
      "evidence": [{"turn": number, "speaker": string, "text": string}],
      "failure_mode": string | null
    }
  ]
}`;

  const userPrompt = [
    `Topic: ${evidence.topic ?? "Unknown"}`,
    `Agents: ${evidence.agents.join(", ") || "Unknown"}`,
    "",
    "Dialogue turns:",
    evidence.dialogue_turns.length > 0
      ? evidence.dialogue_turns.map(formatDialogueTurn).join("\n\n")
      : "None",
    "",
    "Sampled private thoughts:",
    formatThoughts(evidence),
    "",
    "Supporting collision context:",
    formatCollisions(evidence),
    "",
    "Mechanics contamination hints:",
    `tier4_count=${evidence.contamination_hints.tier4_count}, tier3_count=${evidence.contamination_hints.tier3_count}, truncation_suspected_count=${evidence.contamination_hints.truncation_suspected_count}, dedup_drop_count=${evidence.contamination_hints.dedup_drop_count}, fallback_count=${evidence.contamination_hints.fallback_count}`,
  ].join("\n");

  return { systemPrompt, userPrompt };
}
