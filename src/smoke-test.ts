import { startDiscussion } from "./index.js";
import type { SessionObserver, TurnRecord, SessionState, CollisionInfo, ReactionResult } from "./types.js";

const observer: SessionObserver = {
  onTurnStart(turn, virtualTime) {
    console.log(`\n── Turn ${turn} (${virtualTime.toFixed(1)}s) ──`);
  },
  onReactionResults(results: Map<string, ReactionResult>) {
    for (const [name, r] of results) {
      const action = r.utterance ? `wants to speak: "${r.utterance.slice(0, 30)}..."` : "silent";
      console.log(`  ${name}: ${action} [${r.insistence}]`);
    }
  },
  onCollisionStart(colliders: string[]) {
    console.log(`  ⚡ Collision: ${colliders.join(", ")}`);
  },
  onCollisionResolved(info: CollisionInfo) {
    console.log(`  → Winner: ${info.winner} (Tier ${info.resolutionTier})`);
  },
  onTurnComplete(record: TurnRecord) {
    if (record.type === "silence") {
      console.log(`  🔇 Silence: ${record.duration}s (accumulated: ${record.accumulated}s)`);
    } else if (record.type === "speech") {
      console.log(`  🗣  ${record.speaker}: "${record.utterance.slice(0, 50)}..."`);
      if (record.interruption) {
        console.log(`     Interruption by ${record.interruption.interrupter}: ${record.interruption.success ? "SUCCESS" : "FAILED"}`);
      }
    }
  },
  onThoughtUpdate(agent: string, thought: string) {
    console.log(`  💭 ${agent}: ${thought.slice(0, 40)}...`);
  },
  onSessionEnd(reason: string, session: SessionState) {
    console.log(`\n══ Session ended: ${reason} ══`);
    console.log(`  Turns: ${session.currentTurn}, Virtual time: ${session.virtualTime.toFixed(1)}s`);
    console.log(`  Events: ${session.log.length}, Thoughts: ${session.thoughtLog.length}`);
  },
};

async function main() {
  console.log("Starting smoke test with dummy provider...\n");

  const session = await startDiscussion(
    {
      topic: "AI 会取代人类的工作吗？",
      agents: [
        { name: "DeepSeek", provider: "dummy", model: "dummy" },
        { name: "Gemini", provider: "dummy", model: "dummy" },
        { name: "Qwen", provider: "dummy", model: "dummy" },
      ],
      silenceTimeout: 15,
      maxDuration: 30,
    },
    observer,
  );

  console.log("\n── Thought Log ──");
  for (const entry of session.thoughtLog.slice(0, 10)) {
    console.log(`  [T${entry.turn}] ${entry.agent} (${entry.mode}): ${entry.thought ?? "(unchanged)"}`);
  }
}

main().catch(console.error);
