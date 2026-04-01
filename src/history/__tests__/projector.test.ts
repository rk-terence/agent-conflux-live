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
  describe("discussion_started", () => {
    it("renders as a markdown list item", () => {
      const result = project([startEvent], "claude");
      expect(result).toBe("- [0.0s] 讨论开始 — 话题：AI意识");
    });
  });

  describe("completed speech", () => {
    it("renders with bold speaker name and blockquote", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我觉得AI有意识。", 20, 0, 1),
        turnEnded("claude", 1),
      ];

      const result = project(events, "gpt");
      expect(result).toContain("- [1.0s] **Claude**：\n  > 我觉得AI有意识。");
    });

    it("renders multiple turns as separate list items", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我先说。", 20, 0, 1),
        turnEnded("claude", 1),
        sentence("gpt", "我接着。", 20, 0, 3),
        turnEnded("gpt", 1),
      ];

      const result = project(events, "deepseek");
      expect(result).toContain("**Claude**：\n  > 我先说。");
      expect(result).toContain("**GPT-4o**：\n  > 我接着。");
    });
  });

  describe("first-person substitution", () => {
    it("replaces own name with 你", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("claude", "我的观点。", 20, 0, 1),
        turnEnded("claude", 1),
      ];

      const result = project(events, "claude");
      expect(result).toContain("**你**：\n  > 我的观点。");
    });
  });

  describe("unresolved collision", () => {
    it("bystander sees summary only, no speech content", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 3,
        during: "gap",
        utterances: [
          { agentId: "gpt", text: "我想说——", tokenCount: 15 },
          { agentId: "deepseek", text: "让我来——", tokenCount: 15 },
        ],
      };

      const result = project([startEvent, collision], "claude");
      expect(result).toContain("- [3.0s] GPT-4o 和 DeepSeek 同时开口了，声音重叠，你没听清他们说了什么");
    });

    it("participant sees own unsaid speech in blockquote", () => {
      const collision: CollisionEvent = {
        kind: "collision",
        timestamp: 3,
        during: "gap",
        utterances: [
          { agentId: "gpt", text: "我想说——", tokenCount: 15 },
          { agentId: "claude", text: "我也想说——", tokenCount: 15 },
        ],
      };

      const result = project([startEvent, collision], "claude");
      expect(result).toContain("- [3.0s] 你和 GPT-4o 同时开口了，声音重叠，没有人听清");
      expect(result).toContain("  你想说的是：\n  > 我也想说——");
    });
  });

  describe("resolved collision", () => {
    const collision: CollisionEvent = {
      kind: "collision",
      timestamp: 3,
      during: "gap",
      utterances: [
        { agentId: "gpt", text: "我想说——", tokenCount: 15 },
        { agentId: "claude", text: "我也想说——", tokenCount: 15 },
      ],
    };
    const winnerSpeech = sentence("claude", "最终我说出了完整的话。", 20, 0, 3);

    it("winner sees own speech in blockquote", () => {
      const events: DomainEvent[] = [startEvent, collision, winnerSpeech, turnEnded("claude", 1)];
      const result = project(events, "claude");

      expect(result).toContain("GPT-4o 决定让你先说");
      expect(result).toContain("  你说：\n  > 最终我说出了完整的话。");
    });

    it("yielder sees both unsaid and winner's speech", () => {
      const events: DomainEvent[] = [startEvent, collision, winnerSpeech, turnEnded("claude", 1)];
      const result = project(events, "gpt");

      expect(result).toContain("你决定让 Claude 先说");
      expect(result).toContain("  你想说但没说出来的：\n  > 我想说——");
      expect(result).toContain("  Claude 说：\n  > 最终我说出了完整的话。");
    });

    it("bystander sees winner's speech", () => {
      const events: DomainEvent[] = [startEvent, collision, winnerSpeech, turnEnded("claude", 1)];
      const result = project(events, "deepseek");

      expect(result).toContain("GPT-4o 让 Claude 先说");
      expect(result).toContain("  Claude 说：\n  > 最终我说出了完整的话。");
    });

    it("does not render the merged sentence_committed as a separate item", () => {
      const events: DomainEvent[] = [startEvent, collision, winnerSpeech, turnEnded("claude", 1)];
      const result = project(events, "deepseek");

      // The winner's speech should only appear inside the collision item, not as a standalone
      const listItems = result.split("\n").filter(l => l.startsWith("- "));
      expect(listItems).toHaveLength(2); // start + collision (merged with speech)
    });
  });

  describe("silence", () => {
    it("renders with parentheses in list format", () => {
      const silence: SilenceExtendedEvent = {
        kind: "silence_extended",
        timestamp: 3,
        intervalSeconds: 2,
        cumulativeSeconds: 3,
      };

      const result = project([startEvent, silence], "claude");
      expect(result).toContain("- [3.0s] 安静了 2 秒（累计 3 秒）");
    });
  });

  describe("snapshots", () => {
    it("snapshot: mixed realistic sequence", () => {
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

      expect(project(events, "gpt")).toMatchSnapshot();
    });

    it("snapshot: collision then speech (yielder view)", () => {
      const events: DomainEvent[] = [
        startEvent,
        sentence("deepseek", "开场白。", 10, 0, 0.5),
        turnEnded("deepseek", 1),
        {
          kind: "collision",
          timestamp: 2,
          during: "gap",
          utterances: [
            { agentId: "claude", text: "我要反驳。", tokenCount: 15 },
            { agentId: "gpt", text: "我有不同看法。", tokenCount: 15 },
          ],
        },
        sentence("claude", "我要反驳——AI没有主观体验。", 30, 0, 2),
        turnEnded("claude", 1),
      ];

      expect(project(events, "gpt")).toMatchSnapshot();
    });

    it("snapshot: unresolved collision (participant view)", () => {
      const events: DomainEvent[] = [
        startEvent,
        {
          kind: "collision",
          timestamp: 1,
          during: "gap",
          utterances: [
            { agentId: "claude", text: "让我先说。", tokenCount: 10 },
            { agentId: "gpt", text: "我来。", tokenCount: 8 },
            { agentId: "deepseek", text: "等一下。", tokenCount: 8 },
          ],
        },
        {
          kind: "silence_extended",
          timestamp: 2.5,
          intervalSeconds: 1,
          cumulativeSeconds: 1,
        },
      ];

      expect(project(events, "claude")).toMatchSnapshot();
    });
  });
});
