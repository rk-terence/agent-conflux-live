import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelCallInput, ModelCallOutput } from "../model-gateway/types.js";
import type { IterationDebugInfo } from "../engine/engine.js";
import type { DomainEvent, SessionState } from "../domain/types.js";
import type { NormalizedResult } from "../normalization/normalize.js";
import type { NegotiationOutcome } from "../negotiation/negotiation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogEntry =
  | { type: "session_start"; timestamp: string; sessionId: string; topic: string; participants: { agentId: string; name: string; model: string }[] }
  | { type: "iteration_start"; timestamp: string; iterationId: number; phase: string; virtualTime: number }
  | { type: "prompt"; timestamp: string; iterationId: number; agentId: string; mode: string; systemPrompt: string; userPromptText: string; assistantPrefill?: string; selfStatusText?: string; maxTokens: number }
  | { type: "response"; timestamp: string; iterationId: number; agentId: string; rawText: string; finishReason: string; latencyMs?: number; normalizedType: string; normalizedText?: string }
  | { type: "events"; timestamp: string; iterationId: number; events: readonly DomainEvent[] }
  | { type: "iteration_end"; timestamp: string; iterationId: number; wallClockMs: number; nextPhase: string; virtualTime: number }
  | { type: "error"; timestamp: string; message: string; details?: unknown }
  | { type: "session_end"; timestamp: string; reason: string; totalIterations: number; totalVirtualTime: number };

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export class DiscussionLogger {
  private readonly logPath: string;
  private readonly jsonlPath: string;
  private readonly agentModelMap: Record<string, string>;

  constructor(logDir: string, sessionId: string, agentModelMap: Record<string, string>) {
    mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `discussion-${sessionId}-${ts}`;
    this.logPath = join(logDir, `${base}.log`);
    this.jsonlPath = join(logDir, `${base}.jsonl`);
    this.agentModelMap = agentModelMap;

    // Initialize files
    writeFileSync(this.logPath, "");
    writeFileSync(this.jsonlPath, "");
  }

  getLogPath(): string { return this.logPath; }
  getJsonlPath(): string { return this.jsonlPath; }

  // --- Structured JSONL ---

  private appendJsonl(entry: LogEntry): void {
    appendFileSync(this.jsonlPath, JSON.stringify(entry) + "\n");
  }

  // --- Human-readable log ---

  private appendLog(text: string): void {
    appendFileSync(this.logPath, text + "\n");
  }

  private separator(): void {
    this.appendLog("─".repeat(80));
  }

  // --- Public API ---

  logSessionStart(sessionId: string, topic: string, participants: { agentId: string; name: string }[]): void {
    const now = ts();
    const agentInfo = participants.map(p => ({
      agentId: p.agentId,
      name: p.name,
      model: this.agentModelMap[p.agentId] ?? "unknown",
    }));

    this.appendJsonl({ type: "session_start", timestamp: now, sessionId, topic, participants: agentInfo });

    this.appendLog(`${"═".repeat(80)}`);
    this.appendLog(`  DISCUSSION SESSION: ${sessionId}`);
    this.appendLog(`  Topic: ${topic}`);
    this.appendLog(`  Started: ${now}`);
    this.appendLog(`${"═".repeat(80)}`);
    this.appendLog("");
    this.appendLog("  Participants:");
    for (const a of agentInfo) {
      this.appendLog(`    - ${a.name} (${a.agentId}) → ${a.model}`);
    }
    this.appendLog("");
  }

  logIterationStart(iterationId: number, state: SessionState): void {
    const now = ts();
    this.appendJsonl({
      type: "iteration_start",
      timestamp: now,
      iterationId,
      phase: state.phase,
      virtualTime: state.virtualTime,
    });

    this.separator();
    this.appendLog(`ITERATION #${iterationId}  |  phase=${state.phase}  |  virtualTime=${state.virtualTime.toFixed(1)}s  |  ${now}`);
    if (state.currentTurn) {
      this.appendLog(`  Current speaker: ${state.currentTurn.speakerId} (${state.currentTurn.sentenceCount} sentences, ${state.currentTurn.speakingDuration.toFixed(1)}s)`);
    }
    this.appendLog("");
  }

  logPrompt(input: ModelCallInput): void {
    const now = ts();
    const model = this.agentModelMap[input.agentId] ?? "unknown";

    this.appendJsonl({
      type: "prompt",
      timestamp: now,
      iterationId: input.iterationId,
      agentId: input.agentId,
      mode: input.mode,
      systemPrompt: input.systemPrompt,
      userPromptText: input.userPromptText,
      assistantPrefill: input.assistantPrefill,
      selfStatusText: input.selfStatusText,
      maxTokens: input.maxTokens,
    });

    this.appendLog(`  ┌─ PROMPT → ${input.agentId} [${model}] (${input.mode} mode)`);
    this.appendLog(`  │  maxTokens=${input.maxTokens}`);
    this.appendLog(`  │`);
    this.appendLog(`  │  [System Prompt]`);
    for (const line of input.systemPrompt.split("\n")) {
      this.appendLog(`  │  │ ${line}`);
    }
    this.appendLog(`  │`);
    this.appendLog(`  │  [User Prompt (History + Turn Directive)]`);
    for (const line of input.userPromptText.split("\n")) {
      this.appendLog(`  │  │ ${line}`);
    }
    if (input.assistantPrefill) {
      this.appendLog(`  │`);
      this.appendLog(`  │  [Assistant Prefill]`);
      this.appendLog(`  │  │ ${input.assistantPrefill}`);
    }
    if (input.selfStatusText) {
      this.appendLog(`  │`);
      this.appendLog(`  │  [Self Status]`);
      this.appendLog(`  │  │ ${input.selfStatusText}`);
    }
    this.appendLog(`  └─`);
    this.appendLog("");
  }

  logResponse(iterationId: number, output: ModelCallOutput, normalized: NormalizedResult): void {
    const now = ts();
    const model = this.agentModelMap[output.agentId] ?? "unknown";
    const normType = normalized.output.type;
    const normText = "text" in normalized.output ? (normalized.output as { text: string }).text : undefined;

    this.appendJsonl({
      type: "response",
      timestamp: now,
      iterationId,
      agentId: output.agentId,
      rawText: output.text,
      finishReason: output.finishReason,
      latencyMs: output.latencyMs,
      normalizedType: normType,
      normalizedText: normText,
    });

    this.appendLog(`  ┌─ RESPONSE ← ${output.agentId} [${model}]`);
    this.appendLog(`  │  finishReason=${output.finishReason}  latency=${output.latencyMs?.toFixed(0) ?? "?"}ms`);
    this.appendLog(`  │`);
    this.appendLog(`  │  [Raw Text]`);
    if (output.text) {
      for (const line of output.text.split("\n")) {
        this.appendLog(`  │  │ ${line}`);
      }
    } else {
      this.appendLog(`  │  │ (empty)`);
    }
    this.appendLog(`  │`);
    this.appendLog(`  │  [Normalized] type=${normType}${normText ? ` text="${normText}"` : ""}`);
    this.appendLog(`  └─`);
    this.appendLog("");
  }

  logNegotiation(iterationId: number, negotiation: NegotiationOutcome): void {
    const now = ts();
    this.appendJsonl({ type: "negotiation" as never, timestamp: now, iterationId, negotiation } as never);

    this.appendLog(`  ┌─ NEGOTIATION (tier ${negotiation.tier}, ${negotiation.rounds.length} rounds)`);
    for (const round of negotiation.rounds) {
      this.appendLog(`  │`);
      this.appendLog(`  │  ── Round ${round.round} ──`);
      for (const d of round.decisions) {
        this.appendLog(`  │`);
        this.appendLog(`  │  [${d.agentName}] → insistence=${d.insistence} (raw: "${d.rawText.trim()}")`);
        this.appendLog(`  │    [System Prompt]`);
        for (const line of d.prompt.systemPrompt.split("\n")) {
          this.appendLog(`  │    │ ${line}`);
        }
        this.appendLog(`  │    [User Prompt]`);
        for (const line of d.prompt.userPromptText.split("\n")) {
          this.appendLog(`  │    │ ${line}`);
        }
      }
    }
    if (negotiation.voting) {
      this.appendLog(`  │`);
      this.appendLog(`  │  ── Voting ──`);
      for (const v of negotiation.voting.votes) {
        this.appendLog(`  │  [${v.voterName}] → voted for ${v.votedForName} (raw: "${v.rawText.trim()}")`);
      }
    }
    this.appendLog(`  │`);
    const winner = negotiation.winnerId;
    this.appendLog(`  │  Result: tier ${negotiation.tier}, ${winner ? `${winner} wins the floor` : "all yielded — nobody speaks"}`);
    this.appendLog(`  └─`);
    this.appendLog("");
  }

  logEvents(iterationId: number, events: readonly DomainEvent[]): void {
    if (events.length === 0) return;
    const now = ts();
    this.appendJsonl({ type: "events", timestamp: now, iterationId, events });

    this.appendLog(`  Events:`);
    for (const e of events) {
      this.appendLog(`    • ${formatEvent(e)}`);
    }
    this.appendLog("");
  }

  logIterationEnd(debug: IterationDebugInfo, nextState: SessionState): void {
    const now = ts();
    this.appendJsonl({
      type: "iteration_end",
      timestamp: now,
      iterationId: debug.iterationId,
      wallClockMs: debug.wallClockMs,
      nextPhase: nextState.phase,
      virtualTime: nextState.virtualTime,
    });

    this.appendLog(`  Wall clock: ${debug.wallClockMs}ms  |  Next phase: ${nextState.phase}  |  Virtual time: ${nextState.virtualTime.toFixed(1)}s`);
    this.appendLog("");
  }

  logError(message: string, details?: unknown): void {
    const now = ts();
    this.appendJsonl({ type: "error", timestamp: now, message, details });
    this.appendLog(`  ⚠ ERROR: ${message}`);
    if (details) {
      this.appendLog(`    ${JSON.stringify(details, null, 2).split("\n").join("\n    ")}`);
    }
    this.appendLog("");
  }

  logSessionEnd(reason: string, totalIterations: number, totalVirtualTime: number): void {
    const now = ts();
    this.appendJsonl({ type: "session_end", timestamp: now, reason, totalIterations, totalVirtualTime });

    this.appendLog("");
    this.appendLog(`${"═".repeat(80)}`);
    this.appendLog(`  SESSION ENDED: ${reason}`);
    this.appendLog(`  Total iterations: ${totalIterations}`);
    this.appendLog(`  Total virtual time: ${totalVirtualTime.toFixed(1)}s`);
    this.appendLog(`  Ended: ${now}`);
    this.appendLog(`${"═".repeat(80)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString();
}

function formatEvent(e: DomainEvent): string {
  switch (e.kind) {
    case "discussion_started":
      return `discussion_started — topic="${e.topic}"`;
    case "sentence_committed":
      return `sentence_committed — ${e.speakerId}: "${e.sentence}" (${e.tokenCount} tokens, ${e.durationSeconds.toFixed(1)}s)`;
    case "collision":
      return `collision (${e.during}) — ${e.utterances.map(u => `${u.agentId}: "${u.text}"`).join(" vs ")}`;
    case "turn_ended":
      return `turn_ended — ${e.speakerId} (${e.totalSentences} sentences, ${e.totalDuration.toFixed(1)}s)`;
    case "silence_extended":
      return `silence_extended — ${e.intervalSeconds}s (cumulative: ${e.cumulativeSeconds}s)`;
    case "discussion_ended":
      return `discussion_ended — reason=${e.reason}`;
  }
}
