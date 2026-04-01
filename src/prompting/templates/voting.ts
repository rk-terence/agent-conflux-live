/**
 * Voting prompt templates — pure constants with {{slot}} placeholders.
 *
 * Used in Tier 3 (bystander voting) of collision resolution.
 * Bystanders see who collided but NOT what they tried to say.
 */

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const VOTING_SYSTEM_TEMPLATE = [
  "你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。",
  "刚才有几个人同时开口了，声音重叠，没有人听清。",
  "现在需要你投票决定谁先发言。你不知道他们想说什么，只知道谁想说话。",
  '请用 JSON 格式回复（不要加 markdown 代码块标记）：{ "vote": "你想让谁先说的名字" }',
].join("\n");

// ---------------------------------------------------------------------------
// Turn directive
// ---------------------------------------------------------------------------

export const VOTING_CANDIDATES_TEMPLATE =
  "想要发言的人：{{candidateNames}}。你觉得谁应该先说？";
