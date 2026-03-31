import type { ModelGateway, ModelCallInput, ModelCallOutput } from "./types.js";

/**
 * A dummy gateway that simulates realistic discussion behavior.
 * - In reaction mode: randomly speaks (~30%) or stays silent (~70%)
 * - In continuation mode: continues for 1-3 sentences then stops
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

const CONTINUATIONS: Record<string, string[]> = {
  claude: [
    "而且从更深层的角度看，这不仅仅是技术问题。",
    "所以我认为关键在于我们如何定义边界。",
    "这也是为什么跨学科的视角如此重要。",
  ],
  gpt4o: [
    "进一步说，这个推论会导致几个有趣的结论。",
    "我们可以用反证法来验证这个假设。",
    "最终这个问题可能没有唯一的答案。",
  ],
  gemini: [
    "如果把时间维度也考虑进去，情况更加复杂。",
    "所以说，观察者本身就是系统的一部分。",
    "这也验证了我之前提到的那个类比。",
  ],
  deepseek: [
    "从这个模型出发，我们可以推导出几个结论。",
    "当然，这个分析也有它的局限性。",
    "数据表明这种模式是普遍存在的。",
  ],
  qwen: [
    "在东方思想中，这被称为'不二'。",
    "所以也许答案不在于选择，而在于超越选择。",
    "这恰好印证了辩证法的核心思想。",
  ],
  llama: [
    "在实际部署中我们见过类似的情况。",
    "这需要更多的实验来验证。",
    "但不管怎样，透明度是第一位的。",
  ],
};

const DEFAULT_REACTIONS = [
  "这是一个值得深入探讨的问题。",
  "我有不同的看法。",
  "让我想想这个问题。",
  "我基本同意，但有补充。",
  "这个角度很新颖。",
];

const DEFAULT_CONTINUATIONS = [
  "所以总的来说，这个问题值得继续讨论。",
  "当然，以上只是我的个人观点。",
  "希望大家也能分享自己的想法。",
];

export class SmartDummyGateway implements ModelGateway {
  private speakChance: number;
  private maxContinuations: Map<string, number> = new Map();
  private continuationCount: Map<string, number> = new Map();

  constructor(speakChance = 0.3) {
    this.speakChance = speakChance;
  }

  async generate(input: ModelCallInput): Promise<ModelCallOutput> {
    // Small delay to simulate network
    await new Promise(r => setTimeout(r, 50 + Math.random() * 150));

    if (input.abortSignal?.aborted) {
      return { agentId: input.agentId, text: "", finishReason: "cancelled" };
    }

    if (input.mode === "continuation") {
      return this.handleContinuation(input);
    }

    return this.handleReaction(input);
  }

  private handleReaction(input: ModelCallInput): ModelCallOutput {
    const shouldSpeak = Math.random() < this.speakChance;

    if (!shouldSpeak) {
      return {
        agentId: input.agentId,
        text: "[silence]",
        finishReason: "completed",
      };
    }

    // Start a new turn — set how many continuations this speaker will do
    const maxCont = Math.floor(Math.random() * 3); // 0-2 continuations after first sentence
    this.maxContinuations.set(input.agentId, maxCont);
    this.continuationCount.set(input.agentId, 0);

    const pool = SAMPLE_REACTIONS[input.agentId] ?? DEFAULT_REACTIONS;
    const text = pool[Math.floor(Math.random() * pool.length)];

    return {
      agentId: input.agentId,
      text,
      finishReason: "completed",
    };
  }

  private handleContinuation(input: ModelCallInput): ModelCallOutput {
    const count = this.continuationCount.get(input.agentId) ?? 0;
    const max = this.maxContinuations.get(input.agentId) ?? 0;

    if (count >= max) {
      // End turn
      return {
        agentId: input.agentId,
        text: "",
        finishReason: "stop_sequence",
      };
    }

    this.continuationCount.set(input.agentId, count + 1);

    const pool = CONTINUATIONS[input.agentId] ?? DEFAULT_CONTINUATIONS;
    const text = pool[Math.floor(Math.random() * pool.length)];

    return {
      agentId: input.agentId,
      text,
      finishReason: "stop_sequence",
    };
  }
}
