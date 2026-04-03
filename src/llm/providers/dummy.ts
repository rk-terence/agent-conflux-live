import type { AgentConfig, ChatRequest, LLMClient } from "../../types.js";

/**
 * Dummy LLM provider for cost-free testing.
 * Produces deterministic JSON responses that follow the expected output format
 * for each prompt mode, detected by keywords in the system prompt.
 */
export function createDummyClient(config: AgentConfig): LLMClient {
  let callCount = 0;

  return {
    async chat(request: ChatRequest): Promise<string> {
      callCount++;
      // Small delay to simulate latency
      await new Promise((resolve) => setTimeout(resolve, 10));

      return generateResponse(config.name, request, callCount);
    },
  };
}

function generateResponse(agentName: string, request: ChatRequest, callCount: number): string {
  const sys = request.systemPrompt;
  const user = request.userPrompt;

  // Detect mode from system prompt keywords
  if (sys.includes("是否要打断对方") || sys.includes("决定是否要打断")) {
    // Interruption judge mode
    return JSON.stringify({
      interrupt: callCount % 3 === 0,
      urgency: "mid",
      reason: callCount % 3 === 0 ? "说得太长了" : null,
      thought: `${agentName}在考虑是否打断`,
    });
  }

  if (sys.includes("想打断你") || sys.includes("让步（停下来让对方说）")) {
    // Interruption defense mode
    return JSON.stringify({
      yield: callCount % 2 === 0,
      thought: `${agentName}在考虑是否让步`,
    });
  }

  if (sys.includes("协商谁先发言")) {
    // Negotiation mode
    const levels = ["low", "mid", "high"] as const;
    return JSON.stringify({
      insistence: levels[callCount % 3],
      thought: `${agentName}在协商中`,
    });
  }

  if (sys.includes("投票决定谁先发言")) {
    // Voting mode — pick first candidate from user prompt
    const candidateMatch = user.match(/想要发言的人：(.+?)。/);
    let candidates: string[] = [];
    if (candidateMatch) {
      // Split on "、" and " 和 " to handle all formatNameList output styles
      candidates = candidateMatch[1].split(/、| 和 /).map((s) => s.trim()).filter(Boolean);
    }
    const vote = candidates.length > 0
      ? candidates[callCount % candidates.length]
      : agentName;
    return JSON.stringify({
      vote,
      thought: `${agentName}投票了`,
    });
  }

  // Default: reaction mode
  const phrases = [
    `这个问题很有意思，我觉得需要从多个角度来看。`,
    `我同意部分观点，但是也有一些不同的想法。`,
    `让我换个角度思考一下这个问题。`,
    null, // silence
    `我想补充一点之前没有人提到的。`,
    null, // silence
  ];

  const utterance = phrases[callCount % phrases.length];

  return JSON.stringify({
    utterance,
    insistence: callCount % 2 === 0 ? "mid" : "low",
    thought: `${agentName}正在思考讨论的走向`,
  });
}
