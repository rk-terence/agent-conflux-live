import { describe, it, expect } from "vitest";
import { readLogText } from "../read-log.js";
import { summarizeRun } from "../summarize-run.js";
import {
  computeWeightedTotal,
  scoreL2,
  validateL2Response,
} from "../l2-score.js";
import type { L2RubricScore } from "../types.js";
import {
  buildInfraFailRun,
  buildL2EligibleRun,
} from "./fixtures.js";

function load(lines: string[]) {
  const { events, parseErrors } = readLogText(lines.join("\n"));
  const summary = summarizeRun("test.ndjson", events, parseErrors);
  return { events, summary };
}

function validResponse() {
  return {
    dominant_observation:
      "Alice is atmospheric, Bob is structural, and Carol injects destabilizing comic detail.",
    mechanics_contamination_note:
      "There is one real collision and one interruption, but the strongest scores come from the content of the lines, not the mechanics themselves.",
    candidate_quotes: [
      {
        turn: 1,
        speaker: "Alice",
        text: "I want the poem to feel like a train platform at 2 a.m., all fluorescent loneliness and bad coffee.",
      },
      {
        turn: 3,
        speaker: "Carol",
        text: "the pigeon should look like it paid rent and still hates everyone here.",
      },
    ],
    rubrics: [
      {
        rubric: "personality_contrast",
        score: 5,
        why: "The models pursue visibly different creative instincts.",
        evidence: [
          { turn: 1, speaker: "Alice", text: "fluorescent loneliness and bad coffee" },
          { turn: 2, speaker: "Bob", text: "sadness lands harder when the logistics are painfully specific" },
        ],
        failure_mode: null,
      },
      {
        rubric: "dramatic_tension",
        score: 4,
        why: "Collision and interruption amplify a real disagreement over tone.",
        evidence: [
          { turn: 2, speaker: "Bob", text: "give it a timetable and a missed connection" },
          { turn: 3, speaker: "Carol", text: "the pigeon should look like it paid rent" },
        ],
        failure_mode: null,
      },
      {
        rubric: "quotability",
        score: 3,
        why: "Several lines are excerptable, especially Alice and Carol.",
        evidence: [
          { turn: 1, speaker: "Alice", text: "all fluorescent loneliness and bad coffee" },
        ],
        failure_mode: null,
      },
      {
        rubric: "surprise",
        score: 2,
        why: "Carol's absurd image shifts the tone in a memorable way.",
        evidence: [
          { turn: 3, speaker: "Carol", text: "paid rent and still hates everyone here" },
        ],
        failure_mode: "Only one moment truly jolts the exchange.",
      },
      {
        rubric: "arc_completion",
        score: 1,
        why: "Alice does synthesize the disagreement into a combined direction.",
        evidence: [
          { turn: 4, speaker: "Alice", text: "Keep Bob's missed connection, keep Carol's landlord pigeon" },
        ],
        failure_mode: "The arc is short and ends just as it gets interesting.",
      },
    ],
  };
}

describe("validateL2Response", () => {
  it("accepts a well-formed response", () => {
    const result = validateL2Response(validResponse());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.rubrics).toHaveLength(5);
      expect(result.result.candidate_quotes).toHaveLength(2);
    }
  });

  it("rejects malformed rubric structures", () => {
    const malformed = validResponse();
    malformed.rubrics = malformed.rubrics.slice(0, 4);
    malformed.rubrics[0]!.score = 6;
    malformed.rubrics[1]!.evidence = [];
    delete (malformed.rubrics[2] as Record<string, unknown>).why;

    const result = validateL2Response(malformed);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(" | ")).toContain("missing rubric: arc_completion");
      expect(result.errors.join(" | ")).toContain("score must be an integer between 0 and 5");
      expect(result.errors.join(" | ")).toContain("evidence must contain 1 to 3 items");
      expect(result.errors.join(" | ")).toContain("why must be a non-empty string");
    }
  });
});

describe("computeWeightedTotal", () => {
  it("computes boundary and mixed scores correctly", () => {
    const allFives: L2RubricScore[] = validResponse().rubrics.map((rubric) => ({
      ...rubric,
      score: 5,
    }));
    const allZeros: L2RubricScore[] = validResponse().rubrics.map((rubric) => ({
      ...rubric,
      score: 0,
    }));

    expect(computeWeightedTotal(allFives)).toBe(100);
    expect(computeWeightedTotal(allZeros)).toBe(0);
    expect(computeWeightedTotal(validResponse().rubrics)).toBe(70);
  });
});

describe("scoreL2", () => {
  it("returns blocked when eligible_for_l2 is false", async () => {
    const { events, summary } = load(buildInfraFailRun("missing_run_finished"));
    const result = await scoreL2(events, summary, async () => {
      throw new Error("should not be called");
    }, "test-model");

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reasons).toContain("missing_run_finished");
      expect(result.reasons).toContain("blocked_by_l0");
      expect(result.scorer_model).toBeNull();
    }
  });

  it("scores an eligible run using a mocked chat function", async () => {
    const { events, summary } = load(buildL2EligibleRun());
    const result = await scoreL2(
      events,
      summary,
      async () => `\`\`\`json\n${JSON.stringify(validResponse(), null, 2)}\n\`\`\``,
      "mock-scorer",
    );

    expect(result.status).toBe("scored");
    if (result.status === "scored") {
      expect(result.weighted_total_100).toBe(70);
      expect(result.scorer_model).toBe("mock-scorer");
      expect(result.human_decision_required).toBe(true);
      expect(result.rubrics[0]?.rubric).toBe("personality_contrast");
      expect(result.candidate_quotes[0]?.speaker).toBe("Alice");
    }
  });
});
