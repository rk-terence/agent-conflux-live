import { describe, it, expect } from "vitest";
import { readLogText } from "../read-log.js";
import { summarizeRun } from "../summarize-run.js";
import { extractL2Evidence } from "../l2-evidence.js";
import { buildL2Prompt } from "../l2-prompt.js";
import { buildL2EligibleRun } from "./fixtures.js";

describe("buildL2Prompt", () => {
  it("renders rubric instructions and evidence sections", () => {
    const { events, parseErrors } = readLogText(buildL2EligibleRun().join("\n"));
    const summary = summarizeRun("test.ndjson", events, parseErrors);
    const evidence = extractL2Evidence(events, summary);
    const prompt = buildL2Prompt(evidence);

    expect(prompt.systemPrompt).toContain("personality_contrast");
    expect(prompt.systemPrompt).toContain("Return JSON only");
    expect(prompt.systemPrompt).toContain("Include 0 to 3 candidate_quotes items total.");
    expect(prompt.userPrompt).toContain("Dialogue turns:");
    expect(prompt.userPrompt).toContain("Sampled private thoughts:");
    expect(prompt.userPrompt).toContain("Supporting collision context:");
    expect(prompt.userPrompt).toContain("Mechanics contamination hints:");
    expect(prompt.userPrompt).toContain("tier4_count=0");
    expect(prompt.userPrompt).toContain("[Turn 2] Bob");
  });
});
