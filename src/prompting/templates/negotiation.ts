/**
 * Negotiation prompt templates — pure constants with {{slot}} placeholders.
 */

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const NEGOTIATION_SYSTEM_TEMPLATE = [
  "你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。",
  "刚才你和其他人同时开口了，声音重叠，没有人听清。",
  "现在需要协商谁先发言。请根据讨论的上下文和你的判断，表明你的坚持程度。",
  '用 JSON 格式回复（不要加 markdown 代码块标记）：{ "insistence": "low" }',
  "insistence：low（愿意让步）/ mid（有话想说但可以等）/ high（非说不可）",
].join("\n");

// ---------------------------------------------------------------------------
// History blocks
// ---------------------------------------------------------------------------

export const DISCUSSION_HISTORY_HEADER = "到目前为止的讨论：";

export const COLLISION_DESC_TEMPLATE =
  "你和 {{otherNames}} 同时开口了。你想说的是「{{utterance}}」，但没有人听清。";

export const MENTION_HINT_TEMPLATE =
  "注意：刚才有人在讨论中点名向你（@{{agentName}}）提问，你可能更有理由坚持发言来回应。";

export const ROUND_RESULT_TEMPLATE =
  "第 {{round}} 轮协商：{{decisions}}。";

export const DEADLOCK_TEMPLATE =
  "目前还有你和 {{competitors}} 都想说话，已经僵持了 {{roundCount}} 轮。";

export const NEGOTIATION_QUESTION = "请用 JSON 格式回复你的坚持程度。";
