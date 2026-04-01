#!/usr/bin/env node
/**
 * CLI runner for Agent Conflux discussions.
 *
 * Usage:
 *   npx tsx src/cli/run.ts --topic "AI 会取代人类吗？" --preset budget
 *   npx tsx src/cli/run.ts --topic "自由意志" --gateway smart-dummy
 *   npx tsx src/cli/run.ts --help
 *
 * Environment:
 *   ZENMUX_API_KEY — required when --gateway zenmux (default)
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { startDiscussion } from "../runner/runner.js";
import type { DiscussionConfig, DiscussionCallbacks } from "../runner/runner.js";
import type { IterationDebugInfo } from "../engine/engine.js";
import type { SessionState, Participant } from "../domain/types.js";
import type { ModelGateway } from "../model-gateway/types.js";
import { ZenMuxGateway, PRESET_BUDGET, PRESET_PREMIUM, presetToAgentModels, presetToThinkingSet } from "../model-gateway/zenmux.js";
import type { PresetAgent } from "../model-gateway/zenmux.js";
import { SmartDummyGateway } from "../model-gateway/smart-dummy.js";
import { DiscussionLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Load .env (lightweight, no dependencies)
// ---------------------------------------------------------------------------

try {
  const envContent = readFileSync(join(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not found — fine, use explicit args or existing env
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    topic:    { type: "string", short: "t", default: "AI 是否会取代人类的工作？" },
    preset:   { type: "string", short: "p", default: "budget" },
    gateway:  { type: "string", short: "g", default: "zenmux" },
    duration: { type: "string", short: "d", default: "300" },
    delay:    { type: "string", default: "100" },
    "log-dir":{ type: "string", default: "logs" },
    "api-key":{ type: "string" },
    help:     { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Agent Conflux CLI — Run multi-agent discussions with detailed logging

Options:
  -t, --topic <string>      Discussion topic (default: "AI 是否会取代人类的工作？")
  -p, --preset <string>     Model preset: budget | premium (default: budget)
  -g, --gateway <string>    Gateway: zenmux | smart-dummy (default: zenmux)
  -d, --duration <seconds>  Max virtual duration in seconds (default: 300)
      --delay <ms>          Iteration delay in ms (default: 100)
      --log-dir <path>      Log output directory (default: logs/)
      --api-key <key>       ZenMux API key (or set ZENMUX_API_KEY env var)
  -h, --help                Show this help

Examples:
  npx tsx src/cli/run.ts --topic "AI 会取代人类吗？"
  npx tsx src/cli/run.ts --gateway smart-dummy --topic "自由意志存在吗？"
  ZENMUX_API_KEY=sk-xxx npx tsx src/cli/run.ts --preset premium --duration 600
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const topic = values.topic!;
const presetName = values.preset as "budget" | "premium";
const gatewayType = values.gateway as "zenmux" | "smart-dummy";
const maxDuration = Number(values.duration);
const delayMs = Number(values.delay);
const logDir = join(process.cwd(), values["log-dir"]!);

// Select preset agents
const presetAgents: readonly PresetAgent[] = presetName === "premium" ? PRESET_PREMIUM : PRESET_BUDGET;
const participants: Participant[] = presetAgents.map(a => ({ agentId: a.agentId, name: a.name }));
const agentModelMap: Record<string, string> = {};
for (const a of presetAgents) {
  agentModelMap[a.agentId] = a.model;
}

// Build gateway
let gateway: ModelGateway;
if (gatewayType === "smart-dummy") {
  gateway = new SmartDummyGateway(0.3);
  console.log("🔧 Using SmartDummyGateway (no API calls)\n");
} else {
  const apiKey = values["api-key"] ?? process.env.ZENMUX_API_KEY;
  if (!apiKey) {
    console.error("Error: ZENMUX_API_KEY environment variable or --api-key flag is required for zenmux gateway.");
    console.error("  Use --gateway smart-dummy for offline testing.\n");
    process.exit(1);
  }
  gateway = new ZenMuxGateway({
    apiKey,
    agentModels: presetToAgentModels(presetAgents),
    thinkingAgents: presetToThinkingSet(presetAgents),
  });
  console.log(`🌐 Using ZenMuxGateway (preset: ${presetName})\n`);
}

// Session
const sessionId = `cli-${Date.now()}`;

// Logger
const logger = new DiscussionLogger(logDir, sessionId, agentModelMap);

console.log(`Topic:    ${topic}`);
console.log(`Agents:   ${presetAgents.map(a => `${a.name}(${a.model})`).join(", ")}`);
console.log(`Duration: ${maxDuration}s virtual max`);
console.log(`Logs:     ${logger.getLogPath()}`);
console.log(`          ${logger.getJsonlPath()}`);
console.log("");

// ---------------------------------------------------------------------------
// Console formatting helpers
// ---------------------------------------------------------------------------

const AGENT_COLORS: Record<string, string> = {
  deepseek: "\x1b[36m",  // cyan
  gemini:   "\x1b[33m",  // yellow
  qwen:     "\x1b[35m",  // magenta
  gpt:      "\x1b[32m",  // green
  mistral:  "\x1b[34m",  // blue
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function agentColor(agentId: string): string {
  return AGENT_COLORS[agentId] ?? "\x1b[37m";
}

function printEvent(e: import("../domain/types.js").DomainEvent): void {
  switch (e.kind) {
    case "sentence_committed": {
      // Primary speech — no indent, stands out
      const c = agentColor(e.speakerId);
      const name = participants.find(p => p.agentId === e.speakerId)?.name ?? e.speakerId;
      process.stdout.write(`${c}${BOLD}${name}${RESET}  ${e.sentence}\n`);
      break;
    }
    case "collision": {
      // Background info — indented
      const names = e.utterances.map(u => {
        const n = participants.find(p => p.agentId === u.agentId)?.name ?? u.agentId;
        return `${agentColor(u.agentId)}${n}${RESET}`;
      });
      process.stdout.write(`    ${DIM}collision: ${names.join(", ")} 同时开口${RESET}\n`);
      break;
    }
    case "turn_ended": {
      const name = participants.find(p => p.agentId === e.speakerId)?.name ?? e.speakerId;
      process.stdout.write(`    ${DIM}── ${name} 说完了 (${e.totalSentences}句, ${e.totalDuration.toFixed(1)}s) ──${RESET}\n`);
      break;
    }
    case "silence_extended":
      process.stdout.write(`    ${DIM}... 安静 ${e.intervalSeconds}s (累计 ${e.cumulativeSeconds}s) ...${RESET}\n`);
      break;
    case "discussion_ended":
      process.stdout.write(`\n${BOLD}讨论结束: ${e.reason}${RESET}\n`);
      break;
    case "discussion_started":
      break;
    case "collision_resolved":
      break; // displayed via printNegotiation
  }
}

// ---------------------------------------------------------------------------
// Run discussion
// ---------------------------------------------------------------------------

let currentState: SessionState | null = null;
let preIterationState: SessionState | null = null;

const config: DiscussionConfig = {
  sessionId,
  topic,
  participants,
  gateway,
  iterationDelayMs: delayMs,
  maxVirtualDurationSeconds: maxDuration,
};

// Buffer events so we can reorder them with negotiation info from onDebug.
// Actual flow: collision → negotiation → winner speaks
// Callback order: onStateChange → onEvents → onDebug
// We hold events in a buffer, then flush in correct order when onDebug arrives.
let pendingEvents: import("../domain/types.js").DomainEvent[] = [];

function printNegotiation(neg: IterationDebugInfo["negotiation"]): void {
  if (!neg) return;
  const INSISTENCE_COLOR: Record<string, string> = {
    high: "\x1b[31m",  // red
    mid: "\x1b[33m",   // yellow
    low: "\x1b[32m",   // green
  };
  for (const round of neg.rounds) {
    const desc = round.decisions.map(d => {
      const color = INSISTENCE_COLOR[d.insistence] ?? "";
      return `${color}${d.agentName}=${d.insistence}${RESET}`;
    }).join("  ");
    process.stdout.write(`    ${DIM}协商#${round.round}:${RESET} ${desc}\n`);
  }
  if (neg.voting) {
    const voteDesc = neg.voting.votes.map(v =>
      `${v.voterName}→${v.votedForName}`
    ).join("  ");
    process.stdout.write(`    ${DIM}投票:${RESET} ${voteDesc}\n`);
  }
  const winnerName = neg.winnerId
    ? participants.find(p => p.agentId === neg.winnerId)?.name ?? neg.winnerId
    : null;
  process.stdout.write(`    ${DIM}→ ${winnerName ? `${winnerName} 获得发言权` : "全部让步"} (tier ${neg.tier})${RESET}\n`);
}

const callbacks: DiscussionCallbacks = {
  onStateChange(state: SessionState) {
    preIterationState = currentState;
    currentState = state;
  },

  onEvents(events) {
    // Buffer events — they'll be flushed (and logged) in correct order by onDebug
    pendingEvents.push(...events);
  },

  onDebug(debug: IterationDebugInfo) {
    // Log to file — all logging happens here so iterationId is always correct.
    // Use preIterationState (captured before onStateChange updated currentState)
    // so iteration_start reflects the state *before* this iteration ran.
    if (preIterationState) {
      logger.logIterationStart(debug.iterationId, preIterationState);
    }
    for (let i = 0; i < debug.callInputs.length; i++) {
      logger.logPrompt(debug.callInputs[i]);
      logger.logResponse(debug.iterationId, debug.rawOutputs[i], debug.normalizedResults[i]);
    }
    if (debug.negotiation) {
      logger.logNegotiation(debug.iterationId, debug.negotiation);
    }
    // Log buffered events with correct iterationId
    if (pendingEvents.length > 0) {
      logger.logEvents(debug.iterationId, pendingEvents);
    }
    if (currentState) {
      logger.logIterationEnd(debug, currentState);
    }

    // Console: flush buffered events in correct order
    // With negotiation: collision → negotiation → winner's speech/other events
    // Without negotiation: all events in order
    const events = pendingEvents;
    pendingEvents = [];

    if (debug.negotiation) {
      // Print collision events first
      for (const e of events) {
        if (e.kind === "collision") printEvent(e);
      }
      // Then negotiation
      printNegotiation(debug.negotiation);
      // Then everything else (winner's speech, turn_ended, etc.)
      for (const e of events) {
        if (e.kind !== "collision") printEvent(e);
      }
    } else {
      for (const e of events) {
        printEvent(e);
      }
    }
  },

  onError(error) {
    console.error(`\n  ⚠ Fatal error: ${error.message}`);
    logger.logError("fatal", { message: error.message });
  },

  onEnd(state: SessionState) {
    const endEvent = state.events.findLast(e => e.kind === "discussion_ended");
    const reason = endEvent?.kind === "discussion_ended" ? endEvent.reason : "unknown";

    logger.logSessionEnd(reason, state.iterationCount, state.virtualTime);

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  Session complete`);
    console.log(`  Iterations: ${state.iterationCount}`);
    console.log(`  Virtual time: ${state.virtualTime.toFixed(1)}s`);
    console.log(`  Reason: ${reason}`);
    console.log(`  Logs: ${logger.getLogPath()}`);
    console.log(`${"═".repeat(60)}\n`);

    process.exit(0);
  },
};

// Log session start
logger.logSessionStart(sessionId, topic, participants);

// Start
console.log(`${"─".repeat(60)}`);
console.log(`  Starting discussion...`);
console.log(`${"─".repeat(60)}\n`);

const controls = startDiscussion(config, callbacks);

// Graceful shutdown on Ctrl+C
process.on("SIGINT", () => {
  console.log(`\n\n  Stopping discussion (Ctrl+C)...`);
  controls.stop();
});
