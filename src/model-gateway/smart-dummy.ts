import type { ModelGateway, ModelCallInput, ModelCallOutput } from "./types.js";

/**
 * A dummy gateway that simulates realistic discussion behavior.
 * - In reaction mode: randomly speaks or stays silent based on personality profile
 * - Detects negotiation prompts and responds with personality-driven insist/yield
 * - Produces varied Chinese text to make the discussion feel alive
 */

const SAMPLE_REACTIONS: Record<string, string[]> = {
  claude: [
    "我觉得这个问题需要从多个角度来看。",
    "这是一个有趣的观点，但我有不同看法。",
    "从哲学层面来说，这个问题确实很复杂。",
    "我同意你的部分观点，但有一点需要补充。",
    "让我换个角度来思考这个问题。",
  ],
  gpt4o: [
    "从数据的角度来看，情况可能并非如此。",
    "这恰恰说明了问题的核心所在。",
    "我想补充一个关键的视角。",
    "等等，这个逻辑链条有一个缺陷。",
    "如果我们把这个推到极端会怎样？",
  ],
  gemini: [
    "你们都忽略了一个关键因素。",
    "我从另一个维度来分析这个问题。",
    "这让我想到了一个有趣的类比。",
    "其实这两种观点并不矛盾。",
    "我觉得我们需要重新定义讨论的范围。",
  ],
  deepseek: [
    "从技术实现的角度来看，这是可行的。",
    "我认为这里有一个隐含的假设需要质疑。",
    "如果用数学来建模这个问题会很有启发。",
    "这个问题的本质是信息论的问题。",
    "让我从计算复杂度的角度来分析。",
  ],
  qwen: [
    "我想从东方哲学的视角来回应。",
    "这个问题在不同文化中有不同的答案。",
    "也许我们应该先界定什么是'理解'。",
    "我觉得大家的分歧在于前提假设不同。",
    "有一个思想实验可以帮助我们理清思路。",
  ],
  llama: [
    "从开源社区的经验来看，情况不太一样。",
    "我同意这个方向，但实施路径需要讨论。",
    "这个观点有实证支持吗？",
    "我想提一个可能不受欢迎的反对意见。",
    "我们是不是把问题过度简化了？",
  ],
};

const DEFAULT_REACTIONS = [
  "这是一个值得深入探讨的问题。",
  "我有不同的看法。",
  "让我想想这个问题。",
  "我基本同意，但有补充。",
  "这个角度很新颖。",
];

/**
 * Personality profiles that influence speaking eagerness and negotiation style.
 * This lets us test collision + negotiation behavior with the dummy gateway.
 */
type Personality = {
  /** Base probability of speaking in reaction mode */
  readonly speakChance: number;
  /** Probability of insisting (vs yielding) during negotiation */
  readonly insistChance: number;
};

const PERSONALITIES: Record<string, Personality> = {
  deepseek: { speakChance: 0.7, insistChance: 0.8 },  // assertive, almost never yields (matches real API observation)
  gemini:   { speakChance: 0.5, insistChance: 0.25 },  // polite, tends to yield quickly
  qwen:     { speakChance: 0.6, insistChance: 0.5 },   // balanced
};

const DEFAULT_PERSONALITY: Personality = { speakChance: 0.4, insistChance: 0.4 };

export class SmartDummyGateway implements ModelGateway {
  private readonly speakChanceOverride: number | undefined;

  /**
   * @param speakChanceOverride If provided, overrides each personality's speakChance.
   *   Useful for tests or demos that want a specific activity level.
   */
  constructor(speakChanceOverride?: number) {
    this.speakChanceOverride = speakChanceOverride;
  }

  async generate(input: ModelCallInput): Promise<ModelCallOutput> {
    // Small delay to simulate network
    await new Promise(r => setTimeout(r, 50 + Math.random() * 150));

    if (input.abortSignal?.aborted) {
      return { agentId: input.agentId, text: "", finishReason: "cancelled" };
    }

    // Detect negotiation prompts (system prompt contains "坚持发言" or "让步")
    if (input.systemPrompt.includes("坚持发言，还是让别人先说")) {
      return this.handleNegotiation(input);
    }

    return this.handleReaction(input);
  }

  private handleReaction(input: ModelCallInput): ModelCallOutput {
    const personality = PERSONALITIES[input.agentId] ?? DEFAULT_PERSONALITY;
    const speakChance = this.speakChanceOverride ?? personality.speakChance;
    const shouldSpeak = Math.random() < speakChance;

    if (!shouldSpeak) {
      return {
        agentId: input.agentId,
        text: "[silence]",
        finishReason: "completed",
      };
    }

    const pool = SAMPLE_REACTIONS[input.agentId] ?? DEFAULT_REACTIONS;
    const text = pool[Math.floor(Math.random() * pool.length)];

    return {
      agentId: input.agentId,
      text,
      finishReason: "completed",
    };
  }

  private handleNegotiation(input: ModelCallInput): ModelCallOutput {
    const personality = PERSONALITIES[input.agentId] ?? DEFAULT_PERSONALITY;

    // Later negotiation rounds: increase yield probability (social pressure)
    let insistChance = personality.insistChance;
    const roundMatch = input.historyText.match(/已经僵持了 (\d+) 轮/);
    if (roundMatch) {
      const stalledRounds = parseInt(roundMatch[1], 10);
      // Each stalled round reduces insist chance by 20%
      insistChance = Math.max(0.1, insistChance - stalledRounds * 0.2);
    }

    const decision = Math.random() < insistChance ? "坚持" : "让步";

    return {
      agentId: input.agentId,
      text: decision,
      finishReason: "completed",
    };
  }
}
