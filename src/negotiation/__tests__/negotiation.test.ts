import { describe, it, expect } from "vitest";
import { negotiateCollision } from "../negotiation.js";
import type { CollisionCandidate } from "../negotiation.js";
import { DummyGateway } from "../../model-gateway/dummy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allParticipants = [
  { agentId: "a", agentName: "Alice" },
  { agentId: "b", agentName: "Bob" },
  { agentId: "c", agentName: "Charlie" },
];
const allNames = ["Alice", "Bob", "Charlie"];
const topic = "测试话题";
const emptyHistories = new Map<string, string>();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("negotiateCollision", () => {
  describe("Tier 1: pre-declared insistence", () => {
    it("unique highest wins with zero API calls", async () => {
      const candidates: CollisionCandidate[] = [
        { agentId: "a", agentName: "Alice", utterance: "hi", insistence: "high" },
        { agentId: "b", agentName: "Bob", utterance: "hey", insistence: "low" },
      ];
      const gw = new DummyGateway(() => '{"insistence":"mid"}');

      const result = await negotiateCollision(
        candidates, allParticipants, allNames, topic,
        emptyHistories, gw, "s1", 0,
      );

      expect(result.tier).toBe(1);
      expect(result.winnerId).toBe("a");
      expect(result.rounds).toHaveLength(0);
      expect(gw.calls).toHaveLength(0); // zero API calls
    });

    it("tied insistence falls through to Tier 2", async () => {
      const candidates: CollisionCandidate[] = [
        { agentId: "a", agentName: "Alice", utterance: "hi", insistence: "high" },
        { agentId: "b", agentName: "Bob", utterance: "hey", insistence: "high" },
      ];
      // Round 1: Alice high, Bob low → Alice wins
      const gw = new DummyGateway((input) =>
        input.agentId === "a" ? '{"insistence":"high"}' : '{"insistence":"low"}',
      );

      const result = await negotiateCollision(
        candidates, allParticipants, allNames, topic,
        emptyHistories, gw, "s1", 0,
      );

      expect(result.tier).toBe(2);
      expect(result.winnerId).toBe("a");
      expect(result.rounds).toHaveLength(1);
    });
  });

  describe("Tier 2: narrowing invariant", () => {
    it("all-low does NOT re-introduce eliminated candidates", async () => {
      // A, B, C all start at "high" → Tier 1 tie → enter Tier 2
      const candidates: CollisionCandidate[] = [
        { agentId: "a", agentName: "Alice", utterance: "hi", insistence: "high" },
        { agentId: "b", agentName: "Bob", utterance: "hey", insistence: "high" },
        { agentId: "c", agentName: "Charlie", utterance: "yo", insistence: "high" },
      ];

      let callIdx = 0;
      const gw = new DummyGateway((input) => {
        // Round 1 (calls 0-2): 3 candidates — A=high, B=high, C=low → C eliminated
        // Round 2 (calls 3-4): 2 candidates — A=low, B=low → all-low, active stays [A,B]
        // Round 3 (calls 5-6): 2 candidates — A=high, B=low → A wins
        if (input.mode === "negotiation") {
          const i = callIdx++;
          if (i < 3) {
            return input.agentId === "c" ? '{"insistence":"low"}' : '{"insistence":"high"}';
          }
          if (i < 5) {
            return '{"insistence":"low"}'; // all-low
          }
          return input.agentId === "a" ? '{"insistence":"high"}' : '{"insistence":"low"}';
        }
        return "";
      });

      const result = await negotiateCollision(
        candidates, allParticipants, allNames, topic,
        emptyHistories, gw, "s1", 0,
      );

      // Verify C never appears in rounds after round 1
      for (const round of result.rounds) {
        if (round.round > 1) {
          const agentIds = round.decisions.map(d => d.agentId);
          expect(agentIds).not.toContain("c");
        }
      }

      // A wins at Tier 2, round 3
      expect(result.tier).toBe(2);
      expect(result.winnerId).toBe("a");
      expect(result.rounds).toHaveLength(3);
    });
  });

  describe("Tier 4: guaranteed convergence", () => {
    it("produces a winner even when all rounds deadlock", async () => {
      const candidates: CollisionCandidate[] = [
        { agentId: "a", agentName: "Alice", utterance: "hi", insistence: "high" },
        { agentId: "b", agentName: "Bob", utterance: "hey", insistence: "high" },
      ];
      // All rounds: both declare high → never converges
      const gw = new DummyGateway(() => '{"insistence":"high"}');

      const result = await negotiateCollision(
        candidates,
        // No bystanders — only a and b are participants
        [{ agentId: "a", agentName: "Alice" }, { agentId: "b", agentName: "Bob" }],
        ["Alice", "Bob"],
        topic,
        emptyHistories, gw, "s1", 0,
      );

      // Should fall through to Tier 4 (random)
      expect(result.tier).toBe(4);
      expect(result.winnerId).toBeDefined();
      expect(["a", "b"]).toContain(result.winnerId);
    });
  });
});
