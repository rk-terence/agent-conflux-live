import { describe, it, expect } from "vitest";
import { projectHistory } from "../projector.js";
import type {
  DomainEvent,
  Participant,
  DiscussionStartedEvent,
  SentenceCommittedEvent,
  TurnEndedEvent,
  CollisionEvent,
  SilenceExtendedEvent,
} from "../../domain/types.js";
import { TOKEN_TO_SECONDS } from "../../domain/constants.js";

// --- Helpers ---

const participants: Participant[] = [
  { agentId: "claude", name: "Claude" },
  { agentId: "gpt", name: "GPT-4o" },
  { agentId: "deepseek", name: "DeepSeek" },
];

const startEvent: DiscussionStartedEvent = {
  kind: "discussion_started",
  timestamp: 0,
  topic: "AI意识",
  participants,
};

function sentence(
  speakerId: string,
  text: string,
  tokenCount: number,
  turnSentenceIndex: number,
  timestamp?: number,
): SentenceCommittedEvent {
  return {
    kind: "sentence_committed",
    timestamp: timestamp ?? 0,
    speakerId,
    sentence: text,
    tokenCount,
    durationSeconds: tokenCount * TOKEN_TO_SECONDS,
    turnSentenceIndex,
  };
}

function turnEnded(speakerId: string, totalSentences: number): TurnEndedEvent {
  return {
    kind: "turn_ended",
    timestamp: 0,
    speakerId,
    totalSentences,
    totalDuration: 0,
  };
}

function project(
  events: DomainEvent[],
  perspectiveAgentId: string,
): string {
  return projectHistory({
    events,
    currentTurn: null,
    perspectiveAgentId,
    participants,
  });
}

// --- Tests ---

describe("projectHistory", () => {
  describe("completed speech", () => {
    it("renders a completed turn with timestamp", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我觉得AI有意识。", 20, 0, 1),
        turnEnded("claude", 1),
      ];

      const result = project(events, "gpt");
      expect(result).toContain("[1.0s] [Claude]: 我觉得AI有意识。");
    });

    it("renders multiple completed turns from different speakers", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我先说。", 20, 0, 1),
        turnEnded("claude", 1),
        sentence("gpt", "我接着。", 20, 0, 3),
        turnEnded("gpt", 1),
      ];

      const result = project(events, "deepseek");
      expect(result).toContain("[Claude]: 我先说。");
      expect(result).toContain("[GPT-4o]: 我接着。");
    });
  });

  describe("first-person substitution", () => {
    it("replaces own name with 你 in completed speech", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我的观点。", 20, 0, 1),
        turnEnded("claude", 1),
      ];

      const result = project(events, "claude");
      expect(result).toContain("[你]: 我的观点。");
    });
  });

  describe("collision at gap", () => {
    it("bystander sees nobody's content", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 3,
        during: "gap",
        utterances: [
          { agentId: "gpt", text: "我想说——", tokenCount: 15 },
          { agentId: "deepseek", text: "让我来——", tokenCount: 15 },
        ],
      };

      const events: DomainEvent[] = [startEvent, collision];
      const result = project(events, "claude");
      expect(result).toContain("[3.0s] GPT-4o 和 DeepSeek 同时开口了，声音重叠，你没听清他们说了什么");
    });

    it("participant sees own content", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 3,
        during: "gap",
        utterances: [
          { agentId: "gpt", text: "我想说——", tokenCount: 15 },
          { agentId: "claude", text: "我也想说——", tokenCount: 15 },
        ],
      };

      const events: DomainEvent[] = [startEvent, collision];
      const result = project(events, "claude");
      expect(result).toContain("[3.0s] 你和 GPT-4o 同时开口了，你想说的是「我也想说——」，但声音重叠，没有人听清各自说了什么");
    });
  });

  describe("silence", () => {
    it("renders silence annotation with timestamp", () => {
      const silence: SilenceExtendedEvent = {
        kind: "silence_extended",
        timestamp: 3,
        intervalSeconds: 2,
        cumulativeSeconds: 3,
      };

      const events: DomainEvent[] = [startEvent, silence];
      const result = project(events, "claude");
      expect(result).toContain("[3.0s] (安静了 2 秒，累计 3 秒)");
    });
  });

  describe("discussion_started", () => {
    it("renders discussion start with topic", () => {
      const result = project([startEvent], "claude");
      expect(result).toContain("[0.0s] 讨论开始 — 话题：AI意识");
    });
  });

  describe("mixed sequence", () => {
    it("renders a realistic discussion sequence", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我觉得AI有意识。", 30, 0, 1),
        turnEnded("claude", 1),
        sentence("gpt", "我不同意。", 20, 0, 4),
        turnEnded("gpt", 1),
        {
          kind: "silence_extended",
          timestamp: 5,
          intervalSeconds: 1,
          cumulativeSeconds: 1,
        },
        sentence("deepseek", "我来说说。", 20, 0, 7),
        turnEnded("deepseek", 1),
      ];

      const result = project(events, "gpt");
      expect(result).toContain("[Claude]: 我觉得AI有意识。");
      expect(result).toContain("[你]: 我不同意。");
      expect(result).toContain("(安静了 1 秒，累计 1 秒)");
      expect(result).toContain("[DeepSeek]: 我来说说。");
    });
  });
});
