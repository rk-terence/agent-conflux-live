import { afterEach, describe, expect, it } from "vitest";
import { readLogText } from "../read-log.js";
import { summarizeRun } from "../summarize-run.js";
import {
  createL2ChatFn,
  resolveL2ApiKey,
  resolveL2ProviderConfig,
  scoreRequestedL2,
} from "../cli.js";
import { buildInfraFailRun } from "./fixtures.js";

function load(lines: string[]) {
  const { events, parseErrors } = readLogText(lines.join("\n"));
  const summary = summarizeRun("test.ndjson", events, parseErrors);
  return { events, summary };
}

const originalZenmuxApiKey = process.env.ZENMUX_API_KEY;

afterEach(() => {
  if (originalZenmuxApiKey === undefined) {
    delete process.env.ZENMUX_API_KEY;
  } else {
    process.env.ZENMUX_API_KEY = originalZenmuxApiKey;
  }
});

describe("L2 CLI provider resolution", () => {
  it("accepts registered providers", () => {
    expect(resolveL2ProviderConfig("zenmux")).toEqual({
      provider: "zenmux",
      baseURL: "https://zenmux.ai/api/v1",
    });
  });

  it("rejects unsupported providers", () => {
    expect(() => resolveL2ProviderConfig("openai")).toThrow(
      'Unsupported L2 provider "openai". Supported providers: zenmux',
    );
  });

  it("requires the selected provider key when no explicit key is provided", () => {
    delete process.env.ZENMUX_API_KEY;

    expect(() => resolveL2ApiKey("zenmux")).toThrow(
      'Missing L2 API key for provider "zenmux". Provide --l2-api-key or set ZENMUX_API_KEY',
    );
  });

  it("reads and sanitizes the selected provider key from env", () => {
    process.env.ZENMUX_API_KEY = "abc\u0007def";

    expect(resolveL2ApiKey("zenmux")).toBe("abcdef");
  });

  it("accepts an explicit api key override", () => {
    delete process.env.ZENMUX_API_KEY;

    expect(
      createL2ChatFn({
        input: "/tmp/in.ndjson",
        output: "/tmp/out.json",
        l2: true,
        l2Model: "test-model",
        l2Provider: "zenmux",
        l2ApiKey: "explicit-key",
      }),
    ).toBeTypeOf("function");
  });
});

describe("scoreRequestedL2", () => {
  it("returns a blocked result before requiring scorer credentials", async () => {
    delete process.env.ZENMUX_API_KEY;
    const { events, summary } = load(buildInfraFailRun("missing_run_finished"));

    const result = await scoreRequestedL2(
      {
        input: "/tmp/in.ndjson",
        output: "/tmp/out.json",
        l2: true,
        l2Model: "test-model",
        l2Provider: "zenmux",
      },
      events,
      summary,
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reasons).toContain("missing_run_finished");
      expect(result.scorer_model).toBeNull();
    }
  });
});
