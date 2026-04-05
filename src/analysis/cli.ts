#!/usr/bin/env node

import OpenAI from "openai";
import { existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readLogLines } from "./read-log.js";
import { summarizeRun } from "./summarize-run.js";
import { scoreL2, type L2ChatFn } from "./l2-score.js";
import type { ParsedEvent } from "./log-schema.js";
import type { L2Result, RunSummary } from "./types.js";

// ── Argument Parsing ────────────────────────────────────────────────────────

function usage(): never {
  process.stderr.write(
    `Usage: agent-conflux-summarize --input <log.ndjson> [--output <summary.json>] [--l2 --l2-model <model>]

Options:
  --input <path>    Path to NDJSON log file (required)
  --output <path>   Path for summary JSON (default: <input>.summary.json)
  --l2              Enable optional L2 content scoring
  --l2-model        Model used for L2 scoring (required with --l2)
  --l2-provider     Registered scorer provider label (default: zenmux)
  --l2-endpoint     OpenAI-compatible base URL for L2 scoring
  --l2-api-key      API key for L2 scoring (overrides env)
  --help            Show this help message

Examples:
  node dist/analysis/cli.js --input runs/poetry-2min/discussion-xxx.ndjson
  node dist/analysis/cli.js --input runs/my-run/discussion.ndjson --output out/summary.json
  node dist/analysis/cli.js --input runs/my-run/discussion.ndjson --l2 --l2-model gpt-4.1-mini
`,
  );
  process.exit(1);
}

interface CliArgs {
  input: string;
  output: string;
  l2: boolean;
  l2Model: string;
  l2Provider: string;
  l2Endpoint?: string;
  l2ApiKey?: string;
}

const L2_PROVIDER_CONFIGS = {
  zenmux: {
    baseURL: "https://zenmux.ai/api/v1",
  },
} as const;

type SupportedL2Provider = keyof typeof L2_PROVIDER_CONFIGS;

function formatSupportedProviders(): string {
  return Object.keys(L2_PROVIDER_CONFIGS).join(", ");
}

function normalizeProviderLabel(provider: string): string {
  return provider.trim().toLowerCase();
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let input = "";
  let output = "";
  let l2 = false;
  let l2Model = "";
  let l2Provider = "zenmux";
  let l2Endpoint: string | undefined;
  let l2ApiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input") {
      input = args[++i];
      if (!input) usage();
    } else if (arg === "--output") {
      output = args[++i];
      if (!output) usage();
    } else if (arg === "--l2") {
      l2 = true;
    } else if (arg === "--l2-model") {
      l2Model = args[++i];
      if (!l2Model) usage();
    } else if (arg === "--l2-provider") {
      l2Provider = args[++i];
      if (!l2Provider) usage();
    } else if (arg === "--l2-endpoint") {
      l2Endpoint = args[++i];
      if (!l2Endpoint) usage();
    } else if (arg === "--l2-api-key") {
      l2ApiKey = args[++i];
      if (!l2ApiKey) usage();
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Unknown option: ${arg}\n`);
      usage();
    }
  }

  if (!input) {
    process.stderr.write("Error: --input is required\n\n");
    usage();
  }
  if (l2 && !l2Model) {
    process.stderr.write("Error: --l2-model is required when --l2 is enabled\n\n");
    usage();
  }

  input = resolve(input);

  // Default output: replace .ndjson with .summary.json
  if (!output) {
    output = input.replace(/\.ndjson$/, "") + ".summary.json";
  } else {
    output = resolve(output);
  }

  return { input, output, l2, l2Model, l2Provider, l2Endpoint, l2ApiKey };
}

// ── Main ────────────────────────────────────────────────────────────────────

export function resolveL2ProviderConfig(
  provider: string,
): { provider: SupportedL2Provider; baseURL: string } {
  const normalizedProvider = normalizeProviderLabel(provider);
  const config = L2_PROVIDER_CONFIGS[normalizedProvider as SupportedL2Provider];
  if (!config) {
    throw new Error(
      `Unsupported L2 provider "${provider}". Supported providers: ${formatSupportedProviders()}`,
    );
  }

  return { provider: normalizedProvider as SupportedL2Provider, baseURL: config.baseURL };
}

export function resolveL2ApiKey(provider: string, explicitApiKey?: string): string {
  const { provider: resolvedProvider } = resolveL2ProviderConfig(provider);
  const envVarName = `${resolvedProvider.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_API_KEY`;
  const rawKey = explicitApiKey || process.env[envVarName] || "";
  const apiKey = rawKey.replace(/[^\x20-\x7E]/g, "");
  if (!apiKey) {
    throw new Error(
      `Missing L2 API key for provider "${resolvedProvider}". Provide --l2-api-key or set ${envVarName}`,
    );
  }

  return apiKey;
}

export function createL2ChatFn(args: CliArgs): L2ChatFn {
  const { baseURL } = resolveL2ProviderConfig(args.l2Provider);
  const apiKey = resolveL2ApiKey(args.l2Provider, args.l2ApiKey);
  const resolvedBaseURL = args.l2Endpoint || baseURL;
  const client = new OpenAI({
    apiKey,
    baseURL: resolvedBaseURL,
    timeout: 60_000,
  });

  return async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const response = await client.chat.completions.create({
      model: args.l2Model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`Empty L2 scorer response from model ${args.l2Model}`);
    }
    return content;
  };
}

export async function scoreRequestedL2(
  args: CliArgs,
  events: ParsedEvent[],
  summary: RunSummary,
): Promise<L2Result> {
  if (!summary.eligible_for_l2) {
    return scoreL2(
      events,
      summary,
      async () => {
        throw new Error("L2 scorer should not be called for blocked runs");
      },
      args.l2Model,
    );
  }

  const chatFn = createL2ChatFn(args);
  return scoreL2(events, summary, chatFn, args.l2Model);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const { input, output } = args;

  if (!existsSync(input)) {
    process.stderr.write(`Error: input file not found: ${input}\n`);
    process.exit(1);
  }

  // Parse log
  const { events, parseErrors } = readLogLines(input);

  // Build summary
  const summary = summarizeRun(input, events, parseErrors);

  // Write base summary (L0/L1) before attempting L2 so the artifact exists
  // even if the remote scorer hangs or the process is interrupted.
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");

  if (args.l2) {
    try {
      summary.l2 = await scoreRequestedL2(args, events, summary);
      const tmpPath = join(dirname(output), `.${Date.now()}.summary.tmp`);
      writeFileSync(tmpPath, JSON.stringify(summary, null, 2) + "\n");
      renameSync(tmpPath, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Warning: L2 scoring failed: ${message}\n`);
    }
  }

  // Print result
  const l0 = summary.classification.l0_infra;
  const l1 = summary.classification.l1_mechanics;
  const l0Label = l0.result === "pass" ? "PASS" : "FAIL";
  const l1Label = l1.result === "pass" ? "PASS" : l1.result === "fail" ? "FAIL" : "NOT_EVALUATED";

  console.log(`L0: ${l0Label} | L1: ${l1Label} | eligible_for_l2: ${summary.eligible_for_l2}`);
  if (summary.l2?.status === "scored") {
    console.log(`L2: scored (weighted: ${summary.l2.weighted_total_100}/100)`);
  } else if (summary.l2?.status === "blocked") {
    console.log(`L2: blocked (${summary.l2.reasons.join(", ")})`);
  }

  if (l0.reasons.length > 0) {
    console.log(`  L0 reasons: ${l0.reasons.join(", ")}`);
  }
  if (l1.reasons.length > 0) {
    console.log(`  L1 reasons: ${l1.reasons.join(", ")}`);
  }

  console.log(`Summary written to: ${output}`);

  // Exit code: 0 if L0 pass, 1 if L0 fail
  process.exit(l0.result === "pass" ? 0 : 1);
}

const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
