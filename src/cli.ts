#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildConfig, type SessionConfigInput } from "./config.js";
import { createSession, requestStop } from "./state/session.js";
import { createClient } from "./llm/client.js";
import type { ApiCallInfo } from "./llm/client.js";
import { runDiscussion } from "./core/discussion-loop.js";
import type {
  SessionObserver,
  SessionState,
  TurnRecord,
  CollisionInfo,
  ReactionResult,
  LLMClient,
} from "./types.js";

// ── .env loader ──────────────────────────────────────────────────────────────

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), ".env");
  let text: string;
  try {
    text = readFileSync(envPath, "utf-8");
  } catch {
    return; // no .env file
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// ── Argument parsing ─────────────────────────────────────────────────────────

function usage(): never {
  process.stderr.write(
    `Usage: agent-conflux <config.json> [options]

Options:
  --log-dir <dir>   Directory for log files (default: ./logs)
  --dry-run         Validate config and exit without running

Examples:
  agent-conflux examples/config.json
  agent-conflux my-debate.json --log-dir ./output
`,
  );
  process.exit(1);
}

interface CliArgs {
  configPath: string;
  logDir: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let configPath = "";
  let logDir = "./logs";
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--log-dir") {
      logDir = args[++i];
      if (!logDir) usage();
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Unknown option: ${arg}\n`);
      usage();
    } else if (!configPath) {
      configPath = arg;
    } else {
      usage();
    }
  }

  if (!configPath) usage();
  return { configPath: resolve(configPath), logDir: resolve(logDir), dryRun };
}

// ── NDJSON File Logger ───────────────────────────────────────────────────────

class FileLogger {
  private stream: ReturnType<typeof createWriteStream>;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: "a" });
  }

  log(event: string, data: Record<string, unknown> = {}): void {
    const entry = { ts: new Date().toISOString(), event, ...data };
    this.stream.write(JSON.stringify(entry) + "\n");
  }

  close(): Promise<void> {
    return new Promise((res) => this.stream.end(res));
  }
}

// ── Console colors ───────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = (code: string, text: string) => (isTTY ? `${code}${text}\x1b[0m` : text);
const bold = (t: string) => c("\x1b[1m", t);
const dim = (t: string) => c("\x1b[2m", t);
const cyan = (t: string) => c("\x1b[36m", t);
const green = (t: string) => c("\x1b[32m", t);
const yellow = (t: string) => c("\x1b[33m", t);
const red = (t: string) => c("\x1b[31m", t);
const magenta = (t: string) => c("\x1b[35m", t);

function preview(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ── Console + File Observer ──────────────────────────────────────────────────

function createObserver(logger: FileLogger): SessionObserver {
  return {
    onTurnStart(turn, virtualTime) {
      console.log(`\n${cyan(bold(`── Turn ${turn} (${virtualTime.toFixed(1)}s) ──`))}`);
      logger.log("turn_start", { turn, virtualTime });
    },

    onReactionResults(results: Map<string, ReactionResult>) {
      const serialized: Record<string, ReactionResult> = {};
      for (const [name, r] of results) {
        serialized[name] = r;
        if (r.utterance) {
          console.log(
            `  ${green(name)} wants to speak ${dim(`[${r.insistence}]`)}: "${preview(r.utterance, 60)}"`,
          );
        } else {
          console.log(`  ${dim(`${name}: silent`)}`);
        }
      }
      logger.log("reaction_results", { results: serialized });
    },

    onCollisionStart(colliders: string[]) {
      console.log(`  ${yellow(`⚡ Collision: ${colliders.join(" vs ")}`)}`);
      logger.log("collision_start", { colliders });
    },

    onCollisionResolved(info: CollisionInfo) {
      console.log(`  ${yellow(`→ Winner: ${info.winner} (Tier ${info.resolutionTier})`)}`);
      logger.log("collision_resolved", {
        winner: info.winner,
        winnerInsistence: info.winnerInsistence,
        resolutionTier: info.resolutionTier,
        colliders: info.colliders,
        votes: info.votes,
      });
    },

    onInterruptionAttempt(speaker: string, interrupter: string) {
      console.log(`  ${magenta(`✋ ${interrupter} interrupts ${speaker}`)}`);
      logger.log("interruption_attempt", { speaker, interrupter });
    },

    onTurnComplete(record: TurnRecord) {
      if (record.type === "silence") {
        console.log(
          `  ${dim(`🔇 Silence: ${record.duration.toFixed(1)}s (accumulated: ${record.accumulated.toFixed(1)}s)`)}`,
        );
      } else if (record.type === "speech") {
        console.log(`  ${bold(`🗣  ${record.speaker}:`)} "${preview(record.utterance, 80)}"`);
        if (record.interruption) {
          const status = record.interruption.success ? green("SUCCESS") : red("FAILED");
          console.log(`     Interruption by ${record.interruption.interrupter}: ${status}`);
        }
      }
      logger.log("turn_complete", { record });
    },

    onThoughtUpdate(agent: string, thought: string) {
      console.log(`  ${dim(`💭 ${agent}: ${preview(thought, 60)}`)}`);
      logger.log("thought_update", { agent, thought });
    },

    onSessionEnd(reason: string, session: SessionState) {
      console.log(`\n${cyan(bold(`══ Session ended: ${reason} ══`))}`);
      console.log(`  Turns: ${session.currentTurn}`);
      console.log(`  Virtual time: ${session.virtualTime.toFixed(1)}s`);
      console.log(`  Speech events: ${session.log.filter((r) => r.type === "speech").length}`);
      console.log(`  Thoughts recorded: ${session.thoughtLog.length}`);
      logger.log("session_end", {
        reason,
        turns: session.currentTurn,
        virtualTime: session.virtualTime,
        speechCount: session.log.filter((r) => r.type === "speech").length,
        thoughtCount: session.thoughtLog.length,
      });
      // Dump full session state for post-hoc analysis
      logger.log("session_final_state", {
        log: session.log,
        thoughtLog: session.thoughtLog,
        agents: session.agents.map((a) => ({
          name: a.name,
          model: a.config.model,
          consecutiveCollisionLosses: a.consecutiveCollisionLosses,
          interruptedCount: a.interruptedCount,
          lastSpokeTurn: a.lastSpokeTurn,
          currentThought: a.currentThought,
        })),
      });
    },
  };
}

// ── API call logging hook ────────────────────────────────────────────────────

function createApiCallHook(logger: FileLogger): (info: ApiCallInfo) => void {
  return (info: ApiCallInfo) => {
    if (info.error) {
      logger.log("api_call_error", {
        agent: info.agent,
        model: info.model,
        request: {
          systemPrompt: info.request.systemPrompt,
          userPrompt: info.request.userPrompt,
          maxTokens: info.request.maxTokens,
        },
        error: info.error,
        durationMs: info.durationMs,
      });
      process.stderr.write(
        `  ${red(`✗ API error [${info.agent}/${info.model}]: ${preview(info.error, 100)}`)}\n`,
      );
    } else {
      logger.log("api_call", {
        agent: info.agent,
        model: info.model,
        request: {
          systemPrompt: info.request.systemPrompt,
          userPrompt: info.request.userPrompt,
          maxTokens: info.request.maxTokens,
        },
        rawResponse: info.rawResponse,
        content: info.content,
        durationMs: info.durationMs,
      });
    }
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile();
  const { configPath, logDir, dryRun } = parseArgs(process.argv);

  // 1. Load config file
  if (!existsSync(configPath)) {
    process.stderr.write(`${red(`Config file not found: ${configPath}`)}\n`);
    process.exit(1);
  }

  let rawConfig: SessionConfigInput;
  try {
    const text = readFileSync(configPath, "utf-8");
    rawConfig = JSON.parse(text) as SessionConfigInput;
  } catch (err) {
    process.stderr.write(`${red("Failed to parse config file:")}\n`);
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // 2. Build & validate config
  const config = buildConfig(rawConfig);

  if (dryRun) {
    console.log(`${green("Config is valid.")}`);
    console.log(`  Topic:  ${config.topic}`);
    console.log(`  Agents: ${config.agents.map((a) => `${a.name} (${a.model})`).join(", ")}`);
    process.exit(0);
  }

  // 3. Set up file logger
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = resolve(logDir, `discussion-${ts}.ndjson`);
  const logger = new FileLogger(logFile);

  // Log config (redact API keys)
  logger.log("session_config", {
    configPath,
    config: {
      ...config,
      agents: config.agents.map((a) => ({ ...a, apiKey: a.apiKey ? "***" : undefined })),
    },
  });

  // 4. Print header
  console.log(cyan(bold("╔══════════════════════════════════════════════════════╗")));
  console.log(cyan(bold("║  Agent Conflux — Roundtable Discussion               ║")));
  console.log(cyan(bold("╚══════════════════════════════════════════════════════╝")));
  console.log();
  console.log(`  ${bold("Topic:")}   ${config.topic}`);
  console.log(
    `  ${bold("Agents:")}  ${config.agents.map((a) => `${a.name} ${dim(`(${a.model})`)}`).join(", ")}`,
  );
  if (config.maxDuration !== null) {
    console.log(`  ${bold("Limit:")}   ${config.maxDuration}s virtual time`);
  }
  console.log(`  ${bold("Log:")}     ${logFile}`);

  // 5. Create session & instrumented clients
  const session = createSession(config);
  const apiHook = createApiCallHook(logger);
  const clients = new Map<string, LLMClient>();
  for (const agentConfig of config.agents) {
    clients.set(agentConfig.name, createClient(agentConfig, apiHook));
  }

  // 6. Handle Ctrl+C gracefully
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) {
      process.stderr.write("\nForce quit.\n");
      process.exit(1);
    }
    stopping = true;
    console.log(`\n${yellow("Received SIGINT, requesting graceful stop…")}`);
    logger.log("sigint_received");
    requestStop(session);
  });

  // 7. Run the discussion
  const observer = createObserver(logger);
  try {
    await runDiscussion(session, clients, observer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n${red(`Fatal error: ${msg}`)}\n`);
    logger.log("fatal_error", { error: msg, stack: err instanceof Error ? err.stack : undefined });
  }

  // 8. Close logger & print footer
  await logger.close();
  console.log(`\n${dim(`Full log written to: ${logFile}`)}`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
