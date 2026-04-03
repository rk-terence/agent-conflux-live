#!/usr/bin/env node

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { readLogLines } from "./read-log.js";
import { summarizeRun } from "./summarize-run.js";

// ── Argument Parsing ────────────────────────────────────────────────────────

function usage(): never {
  process.stderr.write(
    `Usage: agent-conflux-summarize --input <log.ndjson> [--output <summary.json>]

Options:
  --input <path>    Path to NDJSON log file (required)
  --output <path>   Path for summary JSON (default: <input>.summary.json)
  --help            Show this help message

Examples:
  node dist/analysis/cli.js --input runs/poetry-2min/discussion-xxx.ndjson
  node dist/analysis/cli.js --input runs/my-run/discussion.ndjson --output out/summary.json
`,
  );
  process.exit(1);
}

interface CliArgs {
  input: string;
  output: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let input = "";
  let output = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input") {
      input = args[++i];
      if (!input) usage();
    } else if (arg === "--output") {
      output = args[++i];
      if (!output) usage();
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

  input = resolve(input);

  // Default output: replace .ndjson with .summary.json
  if (!output) {
    output = input.replace(/\.ndjson$/, "") + ".summary.json";
  } else {
    output = resolve(output);
  }

  return { input, output };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const { input, output } = parseArgs(process.argv);

  if (!existsSync(input)) {
    process.stderr.write(`Error: input file not found: ${input}\n`);
    process.exit(1);
  }

  // Parse log
  const { events, parseErrors } = readLogLines(input);

  // Build summary
  const summary = summarizeRun(input, events, parseErrors);

  // Write output
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");

  // Print result
  const l0 = summary.classification.l0_infra;
  const l1 = summary.classification.l1_mechanics;
  const l0Label = l0.result === "pass" ? "PASS" : "FAIL";
  const l1Label = l1.result === "pass" ? "PASS" : l1.result === "fail" ? "FAIL" : "NOT_EVALUATED";

  console.log(`L0: ${l0Label} | L1: ${l1Label} | eligible_for_l2: ${summary.eligible_for_l2}`);

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

main();
