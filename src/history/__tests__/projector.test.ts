import { describe, it, expect } from "vitest";
import { projectHistory } from "../projector.js";
import type {
  DomainEvent,
  Participant,
  CurrentTurn,
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
  currentTurn: CurrentTurn | null = null,
): string {
  return projectHistory({
    events,
    currentTurn,
    perspectiveAgentId,
    participants,
  });
}

// --- Tests ---

describe("projectHistory", () => {
  describe("completed speech", () => {
    it("renders a single completed turn", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "第一句。", 20, 0),
        sentence("claude", "第二句。", 15, 1),
        turnEnded("claude", 2),
      ];

      const result = project(events, "gpt");
      expect(result).toBe("[Claude]: 第一句。第二句。");
    });

    it("renders multiple completed turns from different speakers", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我先说。", 20, 0),
        turnEnded("claude", 1),
        sentence("gpt", "我接着。", 20, 0),
        turnEnded("gpt", 1),
      ];

      const result = project(events, "deepseek");
      expect(result).toBe("[Claude]: 我先说。\n\n[GPT-4o]: 我接着。");
    });
  });

  describe("first-person substitution", () => {
    it("replaces own name with 你 in completed speech", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我的观点。", 20, 0),
        turnEnded("claude", 1),
      ];

      const result = project(events, "claude");
      expect(result).toBe("[你]: 我的观点。");
    });

    it("replaces own name with 你 in other contexts", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("gpt", "我先来。", 20, 0),
        turnEnded("gpt", 1),
        sentence("claude", "好的。", 10, 0),
        turnEnded("claude", 1),
      ];

      const result = project(events, "claude");
      expect(result).toBe("[GPT-4o]: 我先来。\n\n[你]: 好的。");
    });
  });

  describe("in-progress speech", () => {
    it("renders in-progress annotation for active speaker", () => {
      const turn: CurrentTurn = {
        speakerId: "claude",
        startTime: 0,
        frozenHistorySnapshot: [],
        sentences: ["正在说的话。"],
        sentenceTokenCounts: [30],
        speakingDuration: 30 * TOKEN_TO_SECONDS, // 1.8s -> rounds to 2
        sentenceCount: 1,
      };

      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "正在说的话。", 30, 0),
      ];

      const result = project(events, "gpt", turn);
      expect(result).toBe(
        "[Claude 正在说（已说 2 秒）]: 正在说的话。...... （Claude 还在继续说）",
      );
    });

    it("uses 你 for in-progress speech from perspective agent's view as listener", () => {
      const turn: CurrentTurn = {
        speakerId: "claude",
        startTime: 0,
        frozenHistorySnapshot: [],
        sentences: ["我在说。"],
        sentenceTokenCounts: [50],
        speakingDuration: 50 * TOKEN_TO_SECONDS, // 3s
        sentenceCount: 1,
      };

      // Claude is the perspective — but this would only happen if
      // we render Claude's own view of their speech (unusual, but valid)
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我在说。", 50, 0),
      ];

      const result = project(events, "claude", turn);
      expect(result).toBe(
        "[你 正在说（已说 3 秒）]: 我在说。...... （你 还在继续说）",
      );
    });

    it("renders multi-sentence in-progress speech", () => {
      const turn: CurrentTurn = {
        speakerId: "gpt",
        startTime: 0,
        frozenHistorySnapshot: [],
        sentences: ["第一句。", "第二句。"],
        sentenceTokenCounts: [20, 30],
        speakingDuration: 50 * TOKEN_TO_SECONDS, // 3s
        sentenceCount: 2,
      };

      const events: DomainEvent[] = [
        startEvent,
        sentence("gpt", "第一句。", 20, 0),
        sentence("gpt", "第二句。", 30, 1),
      ];

      const result = project(events, "claude", turn);
      expect(result).toBe(
        "[GPT-4o 正在说（已说 3 秒）]: 第一句。第二句。...... （GPT-4o 还在继续说）",
      );
    });
  });

  describe("collision during speech", () => {
    it("renders collision with prior sentences as completed", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 0,
        during: "speech",
        utterances: [
          { agentId: "claude", text: "第三句。", tokenCount: 20 },
          { agentId: "gpt", text: "等等——", tokenCount: 10 },
        ],
      };

      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "第一句。", 20, 0),
        sentence("claude", "第二句。", 20, 1),
        sentence("claude", "第三句。", 20, 2), // collision sentence
        collision,
      ];

      const result = project(events, "deepseek");
      expect(result).toBe(
        "[Claude]: 第一句。第二句。\n\n" +
        "[Claude 正在说时，GPT-4o 也开口了]:\n" +
        "[Claude]: 第三句。\n" +
        "[GPT-4o]: 等等——\n" +
        "(两人同时在说话)",
      );
    });

    it("renders collision with no prior sentences", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 0,
        during: "speech",
        utterances: [
          { agentId: "claude", text: "唯一一句。", tokenCount: 20 },
          { agentId: "gpt", text: "打断——", tokenCount: 10 },
        ],
      };

      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "唯一一句。", 20, 0),
        collision,
      ];

      const result = project(events, "deepseek");
      expect(result).toBe(
        "[Claude 正在说时，GPT-4o 也开口了]:\n" +
        "[Claude]: 唯一一句。\n" +
        "[GPT-4o]: 打断——\n" +
        "(两人同时在说话)",
      );
    });

    it("uses first-person for speaker perspective in collision", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 0,
        during: "speech",
        utterances: [
          { agentId: "claude", text: "我在说。", tokenCount: 20 },
          { agentId: "gpt", text: "打断！", tokenCount: 10 },
        ],
      };

      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我在说。", 20, 0),
        collision,
      ];

      const result = project(events, "claude");
      expect(result).toBe(
        "[你 正在说时，GPT-4o 也开口了]:\n" +
        "[你]: 我在说。\n" +
        "[GPT-4o]: 打断！\n" +
        "(你们同时在说话)",
      );
    });

    it("uses first-person for interrupter perspective in collision", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 0,
        during: "speech",
        utterances: [
          { agentId: "claude", text: "我在说。", tokenCount: 20 },
          { agentId: "gpt", text: "打断！", tokenCount: 10 },
        ],
      };

      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我在说。", 20, 0),
        collision,
      ];

      const result = project(events, "gpt");
      expect(result).toBe(
        "[Claude 正在说时，你 也开口了]:\n" +
        "[Claude]: 我在说。\n" +
        "[你]: 打断！\n" +
        "(你们同时在说话)",
      );
    });
  });

  describe("collision at gap", () => {
    it("renders gap collision", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 0,
        during: "gap",
        utterances: [
          { agentId: "gpt", text: "我想说——", tokenCount: 15 },
          { agentId: "deepseek", text: "让我来——", tokenCount: 15 },
        ],
      };

      const events: DomainEvent[] = [startEvent, collision];
      const result = project(events, "claude");
      expect(result).toBe(
        "[GPT-4o 和 DeepSeek 同时说]:\n" +
        "[GPT-4o]: 我想说——\n" +
        "[DeepSeek]: 让我来——\n" +
        "(几个人同时开口，都只说了一句)",
      );
    });

    it("uses first-person in gap collision", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 0,
        during: "gap",
        utterances: [
          { agentId: "gpt", text: "我想说——", tokenCount: 15 },
          { agentId: "claude", text: "我也想说——", tokenCount: 15 },
        ],
      };

      const events: DomainEvent[] = [startEvent, collision];
      const result = project(events, "claude");
      expect(result).toBe(
        "[GPT-4o 和 你 同时说]:\n" +
        "[GPT-4o]: 我想说——\n" +
        "[你]: 我也想说——\n" +
        "(你们同时开口，都只说了一句)",
      );
    });
  });

  describe("silence", () => {
    it("renders silence annotation", () => {
      const silence: SilenceExtendedEvent = {
        kind: "silence_extended",
        timestamp: 3,
        intervalSeconds: 2,
        cumulativeSeconds: 3,
      };

      const events: DomainEvent[] = [startEvent, silence];
      const result = project(events, "claude");
      expect(result).toBe("(已经安静了 3 秒)");
    });

    it("renders progressive silence", () => {
      const events: DomainEvent[] = [
        startEvent,
        {
          kind: "silence_extended",
          timestamp: 1,
          intervalSeconds: 1,
          cumulativeSeconds: 1,
        },
        {
          kind: "silence_extended",
          timestamp: 3,
          intervalSeconds: 2,
          cumulativeSeconds: 3,
        },
      ];

      const result = project(events, "claude");
      expect(result).toBe("(已经安静了 1 秒)\n\n(已经安静了 3 秒)");
    });
  });

  describe("mixed sequence", () => {
    it("renders a realistic discussion sequence", () => {
      const events: DomainEvent[] = [
        startEvent,
        // Claude speaks
        sentence("claude", "我觉得AI有意识。", 30, 0),
        sentence("claude", "这是显而易见的。", 25, 1),
        turnEnded("claude", 2),
        // GPT responds
        sentence("gpt", "我不同意。", 20, 0),
        turnEnded("gpt", 1),
        // Silence
        {
          kind: "silence_extended",
          timestamp: 5,
          intervalSeconds: 1,
          cumulativeSeconds: 1,
        },
        // DeepSeek speaks
        sentence("deepseek", "我来说说。", 20, 0),
      ];

      const turn: CurrentTurn = {
        speakerId: "deepseek",
        startTime: 5,
        frozenHistorySnapshot: [],
        sentences: ["我来说说。"],
        sentenceTokenCounts: [20],
        speakingDuration: 20 * TOKEN_TO_SECONDS,
        sentenceCount: 1,
      };

      const result = project(events, "gpt", turn);
      expect(result).toBe(
        "[Claude]: 我觉得AI有意识。这是显而易见的。\n\n" +
        "[你]: 我不同意。\n\n" +
        "(已经安静了 1 秒)\n\n" +
        "[DeepSeek 正在说（已说 1 秒）]: 我来说说。...... （DeepSeek 还在继续说）",
      );
    });
  });
});
