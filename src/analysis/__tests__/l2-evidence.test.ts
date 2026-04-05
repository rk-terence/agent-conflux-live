import { describe, it, expect } from "vitest";
import { readLogText } from "../read-log.js";
import { summarizeRun } from "../summarize-run.js";
import { extractL2Evidence } from "../l2-evidence.js";
import { buildCleanRun, buildL2EligibleRun } from "./fixtures.js";

function load(lines: string[]) {
  const { events, parseErrors } = readLogText(lines.join("\n"));
  const summary = summarizeRun("test.ndjson", events, parseErrors);
  return { events, summary };
}

describe("extractL2Evidence", () => {
  it("extracts dialogue turns from committed speech records", () => {
    const { events, summary } = load(buildL2EligibleRun());
    const evidence = extractL2Evidence(events, summary);

    expect(evidence.dialogue_turns).toHaveLength(4);
    expect(evidence.dialogue_turns[0].speaker).toBe("Alice");
    expect(evidence.dialogue_turns[0].utterance).toContain("train platform");
    expect(evidence.dialogue_turns[1].speaker).toBe("Bob");
    expect(evidence.dialogue_turns[3].speaker).toBe("Alice");
  });

  it("cross-references collision evidence onto affected turns", () => {
    const { events, summary } = load(buildL2EligibleRun());
    const evidence = extractL2Evidence(events, summary);
    const bobTurn = evidence.dialogue_turns.find((turn) => turn.turn === 2);

    expect(bobTurn).toMatchObject({
      speaker: "Bob",
      had_collision: true,
      collision_tier: 2,
    });
    expect(bobTurn?.collision_colliders).toEqual(["Bob", "Carol"]);
    expect(evidence.supporting_collisions).toHaveLength(1);
    expect(evidence.supporting_collisions[0].rounds[0]).toMatchObject({
      tier: 2,
      round: 1,
      winner: "Bob",
    });
  });

  it("samples at most three thoughts per agent using first middle last", () => {
    const { events, summary } = load(buildL2EligibleRun());
    const evidence = extractL2Evidence(events, summary);
    const bobThoughts = evidence.sampled_thoughts.find((entry) => entry.agent === "Bob");

    expect(bobThoughts?.samples).toHaveLength(3);
    expect(bobThoughts?.samples.map((sample) => sample.slot)).toEqual([
      "first",
      "middle",
      "last",
    ]);
  });

  it("truncates long utterances and thoughts", () => {
    const mutated = buildL2EligibleRun().map((line) => {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.event === "turn_complete") {
        const record = obj.record as Record<string, unknown>;
        if (record.type === "speech" && record.turn === 1) {
          record.utterance = "u".repeat(350);
        }
      }
      if (obj.event === "thought_update" && obj.agent === "Alice") {
        obj.thought = "t".repeat(250);
      }
      return JSON.stringify(obj);
    });

    const { events, summary } = load(mutated);
    const evidence = extractL2Evidence(events, summary);
    const firstTurn = evidence.dialogue_turns.find((turn) => turn.turn === 1);
    const aliceThought = evidence.sampled_thoughts.find((entry) => entry.agent === "Alice");

    expect(firstTurn?.utterance.length).toBe(300);
    expect(firstTurn?.utterance.endsWith("...")).toBe(true);
    expect(aliceThought?.samples[0].text.length).toBe(200);
    expect(aliceThought?.samples[0].text.endsWith("...")).toBe(true);
  });

  it("pre-computes contamination hints from summary stats", () => {
    const { events, summary } = load(buildCleanRun({ turns: 5, silenceTurns: 0, collisionCount: 2, collisionTier: 4 }));
    const evidence = extractL2Evidence(events, summary);

    expect(evidence.contamination_hints).toMatchObject({
      tier4_count: 2,
      tier3_count: 0,
      truncation_suspected_count: 0,
      dedup_drop_count: 0,
      fallback_count: 0,
    });
  });

  it("keeps only the latest 30 dialogue turns", () => {
    const { events, summary } = load(buildCleanRun({ turns: 35, silenceTurns: 0 }));
    const evidence = extractL2Evidence(events, summary);

    expect(evidence.dialogue_turns).toHaveLength(30);
    expect(evidence.dialogue_turns[0].turn).toBe(6);
    expect(evidence.dialogue_turns[29].turn).toBe(35);
  });

  it("handles empty or minimal runs gracefully", () => {
    const { events, summary } = load([]);
    const evidence = extractL2Evidence(events, summary);

    expect(evidence.dialogue_turns).toEqual([]);
    expect(evidence.sampled_thoughts).toEqual([]);
    expect(evidence.supporting_collisions).toEqual([]);
    expect(evidence.agents).toEqual([]);
  });
});
