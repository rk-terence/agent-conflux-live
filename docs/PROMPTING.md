# Prompting Specification

## Purpose

This document defines the prompting system for AI Roundtable.

**Authority scope**: This document is the source of truth for **system prompt wording**, **turn directive wording**, **projected history rendering format**, and **response normalization rules**. Code must conform to the wording, format, and rules specified here.

For implementation details (function signatures, parameter flow, builder assembly logic), see `docs/ARCHITECTURE.md`.

## Prompt Structure

Every model call has exactly **three semantic parts**:

```
┌─────────────────────────────────────────┐
│  System Prompt                          │  ← Role, rules, behavioral constraints
├─────────────────────────────────────────┤
│  Projected History                      │  ← Perspective-specific markdown transcript
│                                         │
│  (blank line)                           │
│                                         │
│  Turn Directive                         │  ← Current instruction + situational hints
└─────────────────────────────────────────┘
```

Transport: the gateway receives `systemPrompt` and `userPromptText` (projected history + `\n\n` + turn directive). If projected history is empty, `userPromptText` contains only the turn directive.

### Ownership Boundaries

- **"What has happened so far"** → projected history
- **"What should you do now"** → turn directive
- Collision notices, @mention hints, starvation hints, round summaries, deadlock notes → all belong to the **turn directive**, never to projected history

## Three Prompt Modes

### 1. Reaction Mode

The primary mode. All agents are polled each iteration to decide whether to speak.

**System prompt**:

```
你是 {{agentName}}，在一个自由圆桌讨论中。
其他参与者：{{otherNames}}。
话题：{{topic}}

规则：
{{rules}}
```

**Rules** (joined with `- ` prefix):

1. 没有主持人，自由发言
2. 展现你的独特思维和性格
3. 不需要附和别人的观点，如果有不同意见可以直接表达
4. 可以 @某人 回应
5. 用中文
6. 不要输出动作描写、括号注释或旁白
7. 不要模仿对话记录的格式（不要加「你：」等前缀）
8. 沉默是完全正常的，不需要每次都发言
9. 重要：如果多人同时说话，声音会重叠，所有人都听不清各自说了什么。你心里想说的话只有你自己知道，别人听不到。所以不要急着抢话，想清楚再开口
10. 在对话记录中，**你** 就是你自己（{{agentName}}）的发言。不要用第三人称提到自己
11. 每次发言请把你想说的话说完整，不要只说半句；同时简洁表达，像日常对话一样说话
12. 用以下 JSON 格式回复（不要加 markdown 代码块标记）：{ "speech": "你想说的话", "insistence": "low" }
13. speech：你想说的话（字符串），如果不想说话则设为 null
14. insistence：如果有人也在同时说话，你有多坚持要发言？low（无所谓）/ mid（有话想说）/ high（非说不可）

**Expected output**: `{ "speech": "..." | null, "insistence": "low" | "mid" | "high" }`

**Token limit**: 250

**Turn directive assembly order**:

```
[mention hint]           ← optional, if @mentioned after last speech
[starvation hint]        ← optional, if consecutive collision losses >= 2
---
请用 JSON 格式回复。
[collision notice]       ← optional, if consecutive collisions occurred
```

### 2. Negotiation Mode

Used in Tier 2 collision resolution. Only tied-highest candidates participate.

**System prompt**:

```
你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。
刚才你和其他人同时开口了，声音重叠，没有人听清。
现在需要协商谁先发言。请根据讨论的上下文和你的判断，表明你的坚持程度。
用 JSON 格式回复（不要加 markdown 代码块标记）：{ "insistence": "low" }
insistence：low（愿意让步）/ mid（有话想说但可以等）/ high（非说不可）
```

**Expected output**: `{ "insistence": "low" | "mid" | "high" }`

**Token limit**: 30

**Turn directive assembly order**:

```
你和 {{otherNames}} 同时开口了。你想说的是「{{utterance}}」，但没有人听清。
[@mention hint]              ← optional
[starvation hint]            ← optional, if losses >= 2
[第 N 轮协商：decisions。]    ← one line per previous round
[僵持 context]               ← if previous rounds > 0

请用 JSON 格式回复你的坚持程度。
```

Round decision labels: `low` → "让步", `mid` → "犹豫", `high` → "坚持". Self is always "你".

### 3. Voting Mode

Used in Tier 3 bystander voting. Only non-colliding agents participate.

**System prompt**:

```
你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。
刚才有几个人同时开口了，声音重叠，没有人听清。
现在需要你投票决定谁先发言。你不知道他们想说什么，只知道谁想说话。
请用 JSON 格式回复（不要加 markdown 代码块标记）：{ "vote": "你想让谁先说的名字" }
```

**Expected output**: `{ "vote": "AgentName" }`

**Token limit**: 30

**Turn directive**: `想要发言的人：{{candidateNames}}。你觉得谁应该先说？`

## Situational Hints

Hints are injected into the turn directive. They are informational — they do not override the agent's autonomy.

### @Mention Hint

**Trigger**: agent was `@`-mentioned (exact `@AgentName` format) in projected history after their last speech.

Note: natural language mentions (e.g., "Gemini说的...") without `@` prefix are not detected.

**Reaction hint**: `有人在讨论中提到了你（@{{agentName}}），你可能想要回应。`

**Negotiation hint**: `注意：刚才有人在讨论中点名向你（@{{agentName}}）提问，你可能更有理由坚持发言来回应。`

### Starvation Hint

**Trigger**: agent has consecutively lost >= 2 collisions without successfully speaking (participating in collision but not winning).

**Reaction hint**: `你已经连续 {{losses}} 次想发言但都因为同时有人开口而没有说出来。你可以考虑在坚持程度上做出调整。`

**Negotiation hint**: `注意：你已经连续 {{losses}} 次想发言但都没有成功说出来。如果你的观点仍然切合当前讨论，可以考虑调整你的坚持程度。`

### Collision Notice

**Trigger**: consecutive collision streak > 0.

**Format**: `（已经连续 {{streak}} 次有人同时开口，导致大家都没听清。[{{colliders}} 每次都在抢话。]）`

Appears only in reaction mode, after the `---` separator.

## Projected History Format

Each event is a markdown list item:
```
- [timestamp] summary
  indented detail line
  > blockquoted speech
```

Formatting rules:
- Timestamps: `[N.Ns]` format (one decimal)
- Speaker names: `**Name**：` (bold, full-width colon)
- Quoted speech: `> ` (markdown blockquote) with 2-space indentation inside list item
- Self-reference: agent's own name is always replaced with `**你**` (or `你` in collision context)
- For 2-person collisions: "A 和 B"；for 3+: "A、B 和 C"

### Event Rendering — Exhaustive

#### discussion_started

```
- [0.0s] 讨论开始 — 话题：{topic}
```

#### sentence_committed (standalone)

```
- [3.5s] **DeepSeek**：
  > 发言内容。
```

Self perspective: speaker name replaced with `**你**`.

#### silence_extended

```
- [5.0s] 安静了 1 秒（累计 3 秒）
```

#### Resolved collision (collision → collision_resolved → sentence_committed)

Three events merged into one list item. Rendering varies by **perspective** and **resolution tier**:

**Tier-specific resolution summary:**

| Tier | Winner | Yielder | Bystander |
|------|--------|---------|-----------|
| 1 | {others} 发言意愿没你高，你先说了 | {winner} 的发言意愿更强，{winner} 先说了 | {winner} 的发言意愿最强，{winner} 先说了 |
| 2 | 经过协商你获得了发言权 | 经过协商 {winner} 获得了发言权 | 经过协商 {winner} 获得了发言权 |
| 3 | 大家投票让你先说 | 大家投票让 {winner} 先说 | 你投票给了 {winner}，{winner} 先说了 / 大家投票让 {winner} 先说 |
| 4 | 僵持不下，最终你先说了 | 僵持不下，最终 {winner} 先说了 | 僵持不下，最终 {winner} 先说了 |

Tier 3 bystander: "你投票给了..." only when this bystander voted for the winner.

**Winner perspective:**
```
- [1.0s] 你和 Gemini 同时开口了，Gemini 发言意愿没你高，你先说了
  你说：
  > 我的发言。
```

**Yielder perspective:**
```
- [1.0s] 你和 Gemini 同时开口了，Gemini 的发言意愿更强，Gemini 先说了
  你想说但没说出来的：
  > 我想说的内容。
  Gemini 说：
  > Gemini 的发言。
```

**Bystander perspective:**
```
- [1.0s] DeepSeek、Gemini 同时开口了，Gemini 的发言意愿最强，Gemini 先说了
  Gemini 说：
  > Gemini 的发言。
```

#### Unresolved collision (no winner)

**Participant perspective:**
```
- [2.0s] 你和 Gemini、Qwen 同时开口了，声音重叠，没有人听清
  你想说的是：
  > 我想说的内容。
```

**Non-participant perspective:**
```
- [2.0s] DeepSeek 和 Gemini 同时开口了，声音重叠，你没听清他们说了什么
```

#### Events that produce no output

`turn_ended`、`discussion_ended`、`collision_resolved` — consumed internally, not rendered.

## Response Normalization Rules

### Reaction Mode

1. `finishReason: "error"` 或 `"cancelled"` → error（engine 会重试，最终转为 silence）
2. Empty text → silence
3. 尝试从 raw text 中提取 JSON（支持 markdown code fence 包裹）：
   - JSON 有效且包含 `speech` + `insistence` → 使用提取值
   - JSON 无效或字段缺失 → 全文当作 speech，insistence 默认 `"mid"`
4. `speech === null`、空字符串、`[silence]`、`[沉默]` → silence
5. Speech 清洗：
   - 历史幻觉检测：以 `- [数字s]` 或 `[数字s]` 开头 → 整段丢弃
   - 去除 speaker prefix：`[Agent]:` 或 `**Agent**：` 格式
   - 去除括号动作描写：`（...）` 和 `(...)`
   - 最短长度：< 4 字符 → 视为 silence

### Negotiation Mode

1. 尝试提取 JSON → 取 `insistence` 字段
2. 关键词 fallback："high"/"坚持" → high；"mid"/"犹豫"/"中" → mid；"low"/"让步"/"让" → low
3. 默认 fallback：`"low"`（保守策略）

### Voting Mode

1. 尝试提取 JSON → 取 `vote` 字段（字符串）
2. Fallback：`text.trim()` 作为投票内容
3. 投票内容与候选人名匹配；无法识别的投票视为废票（不计入统计）

## Template Rendering

All templates use `{{key}}` placeholders. Rendering is strict — missing variables throw an error, no default values.
