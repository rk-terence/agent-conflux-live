---
name: Design
description: Top-level design specification — behavior, semantics, constraints, prompt wording, history rendering, normalization rules. Highest authority; when in conflict with other docs, this one wins.
---

# 1. Purpose, Product Goal, Core Metaphor

This document is the **top-level design specification** for AI Roundtable. It defines what the system should do, why, and under what constraints — including exact prompt wording, history rendering format, and normalization rules.

**Authority chain**: `DESIGN.md` → `ARCHITECTURE.md` → code implementation.

- This document specifies **behavior, semantics, constraints, prompt wording, history rendering, and normalization rules**.
- `ARCHITECTURE.md` specifies **how to implement them** (module boundaries, data flow, types, function signatures).
- When there is a conflict, this document takes precedence.

## Product Goal

Multiple LLMs sit around a virtual roundtable and freely discuss a topic. The system's ultimate output is **interesting, social-media-publishable experimental observations** — personality differences between models, social dynamics, unexpected behaviors.

Model behaviors should emerge as a result of "trained weights", not predefined character / role.

## Core Metaphor

The system simulates a **real multi-person chat**, not a debate competition or academic seminar. All design decisions should anchor to this:

- Utterances should be short, like chatting with friends
- Talking too much gets you interrupted
- Everyone has inner thoughts they don't say out loud
- Memory fades over time
- Social pressure exists (the awkwardness of being interrupted, the friction of talking over each other)

---

# 2. System Behaviors

## Discussion Loop

The system is a repeating iteration cycle. Each iteration:

1. All participants except the last speaker are polled simultaneously: do you want to speak?
2. The last speaker automatically sits out one round (this skip applies only to reaction polling — they still participate in interruption judging and bystander voting).
3. Nobody speaks → _silence_. Silence duration follows exponential backoff: 1s, 2s, 4s, 8s, 16s. Both the backoff and accumulated silence counter reset when someone speaks. When accumulated silence in the current streak exceeds 60s, the roundtable is considered ended.
4. One or more wants to speak:

  - one person -> speaks
  - multiple person -> _collision_ handling -> winner speaks
  
  Long utterance may trigger _interruption_.

Collision, silence, and interruption are natural outcomes of the same loop, not separate mechanisms.

## Discussion End

The discussion ends when any of the following conditions is met:

- **Silence timeout**: accumulated silence in the current streak exceeds 60s.
- **Duration limit**: total virtual time exceeds a configured maximum (optional).
- **Manual stop**: operator stops the discussion.
- **Fatal error**: an unrecoverable error occurs (e.g., reducer throws).

## Complete Utterance

Each API call produces a complete utterance, not sentence-by-sentence continuation. Speaking is atomic — either the agent finishes, or gets interrupted (the spoken portion is still complete sentences).

## Verbatim Deduplication

If an agent's utterance is a verbatim repeat of any previous utterance in the session (by any agent), the system silently discards it and treats the agent as silent for that round. This is a safety net against echo loops — the prompt already instructs models not to repeat, but enforcement is at the system level.

## Virtual Time

- **Speech**: 0.1 seconds per token (measured on the utterance text). For interrupted speech, only the spoken portion costs time.
- **Collision**: `participants × 0.5s` (proportional to number of people who collided — the confusion of overlapping voices takes time).
- **Silence**: the backoff interval itself (1s, 2s, 4s, ...).
- **Interruption evaluation**: zero virtual time (it's "thinking", not "speaking").
- **Thinking** (API call latency): does not consume virtual time.

## Collision Resolution

When multiple agents speak simultaneously, a four-tier system determines who goes first:

1. **Tier 1**: Compare pre-declared insistence (zero calls). Unique highest wins.
2. **Tier 2**: Multi-round three-level negotiation (max 3 rounds). Only tied-highest candidates enter each round and re-declare insistence. If a unique highest emerges, that candidate wins immediately. If all candidates declare `low`, all are reset back to the candidate pool (no elimination). Otherwise, candidates at the lowest level are eliminated and the rest proceed to the next round.
3. **Tier 3**: Bystander voting. Non-colliders vote. If no bystanders are available (all agents are colliding), or if the vote is tied / all votes are invalid, skip directly to Tier 4.
4. **Tier 4**: Random. Guarantees convergence.

Auxiliary mechanisms:
- @mention awareness: @-mentioned agents receive hints in negotiation
- Starvation protection: agents with ≥ 2 consecutive collision losses receive hints

## Interruption

### Goal

Models that talk too long get interrupted, creating social pressure and dramatic moments.

### Trigger

When a model's utterance exceeds **80 tokens**, the system attempts to split it for potential interruption. If the utterance cannot be split (see below), no interruption occurs and the full utterance is delivered normally.

### Utterance Splitting

The utterance is split at a **sentence boundary** into:

- **Spoken part**: heard by everyone.
- **Unspoken part**: known only to the speaker.

The split point is the last sentence boundary where the spoken portion does not exceed the threshold. If the entire utterance is a single sentence, no split is possible — the utterance is delivered in full without interruption evaluation.

### Information Asymmetry

This is the core design principle of interruption:

- **The speaker** knows the full content (spoken + unspoken) and who is interrupting.
- **The interrupter and bystanders** only know the spoken part.

### Evaluation Flow

1. The spoken part is sent to all listeners with the question: interrupt or not? How urgently?
2. Nobody interrupts → full utterance is delivered normally.
3. Someone interrupts → enter interruption negotiation.
4. Multiple listeners want to interrupt → the one with highest urgency is selected as representative. If multiple listeners tie on highest urgency, one is selected randomly.

### Interruption Negotiation

**Core principle: the speaker has incumbent advantage.** This is fundamentally different from collision negotiation (where parties are equal).

**Phase 1: Auto-resolution (zero additional API calls)**

The speaker's insistence is already known — either from their reaction output (if they spoke without collision) or from the final negotiation round (if they were a collision winner). The interrupter declares urgency in the judge step. Compare directly:

- urgency > insistence → interruption succeeds
- urgency < insistence → interruption fails
- urgency = insistence → proceed to Phase 2

**Phase 2: Ask the speaker (one additional call)**
- The speaker sees their complete intended utterance (spoken + unspoken), plus the interrupter's reason, and decides: yield or persist?
- The result is determined solely by the speaker's `yield` field. `yield: true` → interruption succeeds; `yield: false` → interruption fails. **The speaker has final say** (incumbent advantage).

**Constraints**:
- No bystander voting for interruptions (it's between two people).
- No multi-interrupter negotiation (pick the most urgent one).

### Outcome

**Interruption succeeds**: spoken part enters public history, unspoken part only enters the speaker's own history. The interrupter gets the floor in the next round — they enter reaction mode normally but face no collision resolution (other agents are polled but cannot collide with the interrupter's utterance; other agents' reaction outputs from this round are discarded). The interrupter's next-round speech can still be interrupted. If the interrupter returns `utterance: null` (unlikely but possible), the round is treated as silence.

**Interruption fails**: full utterance delivered normally, the attempt is recorded in history.

### Social Pressure

Being interrupted creates cumulative pressure: agents interrupted ≥ 1 time receive the interruption pressure hint on their next reaction turn.

---

# 3. Agent Cognition

## Inner Monologue

### Definition

Each model maintains an inner monologue — a private, evolving mental state. The `thought` field is **required** in every response across all prompt modes. Its value is either a string (new/updated thought) or `null` (thought has not changed since last round).

The inner monologue must cover three dimensions:

1. **Situation assessment** — what's happening in the discussion right now, where is it going
2. **Participant perception** — opinion of a specific other participant (who's making sense, who's rambling, who's being ignored, who's annoying)
3. **Next intention** — what the model plans to do next (speak up about X, wait and see, challenge someone, stay quiet)

Each dimension should be one sentence. The model outputs a new thought string when its thinking has changed, or null when nothing has shifted.

### Behavior

- When the system receives `null`, it keeps the previous thought unchanged. When it receives a string, it replaces the previous thought.
- On the first round, `thought` should ideally be a string (there is no prior state to keep). However, if absent, the system proceeds without an initial thought — no error is raised.
- `thought` persists across rounds: the next time this agent is queried, their current thought is passed back in the turn directive (`你目前的内心状态：...`), giving the model continuity of inner state.
- `thought` is recorded in logs — seeing what a model "thinks" vs what it "says" is one of the most interesting things this system can surface.

### Constraints

- `thought` never enters any other agent's projected history. It is purely private.
- `thought` does not consume virtual time.

## First-Person Perspective

Each model sees a perspective-specific conversation history. What they said, what they wanted to say during collisions, who yielded — each person sees a different version.

---

# 4. Prompt Specification

## Prompt Structure

Every API call consists of three semantic parts:

| Part | Content | Behavior |
|------|---------|----------|
| System Prompt | Role identity, behavioral rules, output format | Stable, unchanged throughout the discussion |
| Projected History | Perspective-specific conversation transcript | Updated each round, tiered by recency |
| Turn Directive | Current instruction + situational hints + inner monologue | Updated each round |

Transport: sent via the chat completions API. `systemPrompt` maps to the system message; `userPromptText` (projected history + `\n\n` + turn directive) maps to the user message. If projected history is empty, `userPromptText` contains only the turn directive.

## Boundary Rules

- **"What has happened"** → projected history
- **"What you should do now"** → turn directive
- Collision notices, @mention hints, starvation hints, negotiation round summaries, interruption pressure hints, inner monologue passback → all belong to the **turn directive**, never to projected history

## Template Rendering

All templates use `{{key}}` placeholders. Rendering is strict — missing variables throw an error, no default values.

## Situational Hints

Hints are injected into the turn directive to provide social context. They are informational — they do not override the agent's autonomy.

### @Mention Hint

**Trigger**: Agent was `@AgentName`-mentioned (exact format) in projected history after their last speech.

Note: natural language mentions (e.g., "Gemini说的...") without `@` prefix are not detected.

**Reaction hint**: `有人在讨论中提到了你（@{{agentName}}），你可能想要回应。`

**Negotiation hint**: `注意：刚才有人在讨论中点名向你（@{{agentName}}）提问，你可能更有理由坚持发言来回应。`

### Starvation Hint

**Trigger**: Consecutive collision losses ≥ 2 (participated in collision but did not win).

**Reaction hint**: `你已经连续 {{losses}} 次想发言但都因为同时有人开口而没有说出来。你可以考虑在坚持程度上做出调整。`

**Negotiation hint**: `注意：你已经连续 {{losses}} 次想发言但都没有成功说出来。如果你的观点仍然切合当前讨论，可以考虑调整你的坚持程度。`

### Collision Notice

**Trigger**: Consecutive collision streak > 0.

**Format**: `（已经连续 {{streak}} 次有人同时开口，导致大家都没听清。[{{colliders}} 每次都在抢话。]）`

Only appears in reaction mode, before the `---` separator (grouped with other situational hints).

### Interruption Pressure Hint

**Trigger**: Agent has been interrupted ≥ 1 time.

**Reaction hint**: `你之前被人打断过 {{count}} 次，也许该说得更简短一些。`

## Cross-Mode Normalization Rules

**API retry policy** (applies to all modes): all API requests are retried up to **3 times** on error or cancellation. After exhausting retries, the mode-specific fallback below applies.

**`thought` handling** (applies to all modes): `thought` is required. `null` → keep previous thought unchanged. If the field is absent or the response is unparseable, default to `null` (no thought update).

## Reaction Mode

The primary mode. All agents except the last speaker are polled each iteration to decide whether to speak.

**System prompt**:

```
你是 {{agentName}}，在一个自由圆桌讨论中。
其他参与者：{{otherNames}}。
话题：{{topic}}

规则：
{{rules}}
```

**Rules** (each prefixed with `- `):

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
11. 说话要短，一两句话就够了，最多三句。像朋友聊天一样随意，不要写长段落
12. 不要总结讨论，不要复述别人说过的话。如果你想说的和前面内容差不多，就保持沉默
13. 如果你在说话，别人可能会打断你。话说得越长，被打断的风险越高
14. 用以下 JSON 格式回复（不要加 markdown 代码块标记）：{ "utterance": "你想说的话", "insistence": "low", "thought": "你的想法" }
15. utterance：你想说的话（字符串），如果不想说话则设为 null
16. insistence：如果有人也在同时说话，你有多坚持要发言？low（无所谓）/ mid（有话想说）/ high（非说不可）
17. thought（必填）：你脑子里此刻在想什么。包含以下三方面，各一句话：①对当前局势的判断 ②对某个参与者的看法 ③你接下来打算做什么。如果想法和上次一样没有变化，返回 null。只有你自己能看到，别人看不到

**Expected output**: `{ "utterance": "..." | null, "insistence": "low" | "mid" | "high", "thought": "..." | null }`

**Token limit** (max_tokens): 150

**Turn directive assembly order**:

```
[inner monologue]        ← "你目前的内心状态：..." (absent on first round)
[mention hint]           ← optional, if @mentioned after last speech
[starvation hint]        ← optional, if consecutive collision losses >= 2
[interruption pressure]  ← optional, if interrupted >= 1 time
[collision notice]       ← optional, if consecutive collisions occurred
---
请用 JSON 格式回复。
```

### Response Normalization

1. All retries exhausted → silence with no thought update
2. Empty text → silence
3. Attempt JSON extraction from raw text (supports markdown code fence wrapping):
   - Valid JSON with `utterance` + `insistence` → use extracted values
   - Invalid JSON or missing fields → treat entire text as utterance, insistence defaults to `"mid"`
4. `utterance === null`, empty string, `[silence]`, `[沉默]` → silence
5. Utterance cleaning:
   - History hallucination: starts with `- [Ns]` or `[Ns]` → treat as silence with no thought update
   - Strip speaker prefix: `[Agent]：`, `[Agent]:`, `**Agent**：`, `Agent 说：`, `**Agent** 说：`, `**Agent** 说了一半：` formats
   - Re-check history hallucination after prefix stripping (catches cases like `**DeepSeek**：[2.5s] 说：...`)
   - Strip parenthetical actions: `（...）` and `(...)`
   - Minimum length: < 4 characters → treat as silence

## Negotiation Mode

Used in Tier 2 collision resolution. Only tied-highest candidates participate.

**System prompt**:

```
你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。
刚才你和其他人同时开口了，声音重叠，没有人听清。
现在需要协商谁先发言。请根据讨论的上下文和你的判断，表明你的坚持程度。
用 JSON 格式回复（不要加 markdown 代码块标记）：{ "insistence": "low", "thought": "你的想法" }
insistence：low（愿意让步）/ mid（有话想说但可以等）/ high（非说不可）
thought（必填）：你脑子里此刻在想什么——对局势的判断、对别人的看法、接下来打算做什么。各一句话。没变化则返回 null
```

**Expected output**: `{ "insistence": "low" | "mid" | "high", "thought": "..." | null }`

**Token limit** (max_tokens): 50

**Turn directive assembly order**:

```
[inner monologue]                ← "你目前的内心状态：..." (absent on first round)
你和 {{otherNames}} 同时开口了。你想说的是「{{utterance}}」，但没有人听清。
[@mention hint]                  ← optional
[starvation hint]                ← optional, if losses >= 2
[第 N 轮协商：decisions。]        ← one line per previous round (see format below)
[僵持提示]                        ← if previous rounds > 0 (see format below)

请用 JSON 格式回复你的坚持程度。
```

**Round decision labels**: `low` → "让步", `mid` → "犹豫", `high` → "坚持". Self is always "你".

**Round summary format** (one line per previous round):
```
第 1 轮协商：你 犹豫，Gemini 坚持。
第 2 轮协商：你 坚持，Gemini 坚持。
```

**僵持提示** (appended after round summaries when previous rounds > 0):
```
已经协商了 N 轮还没有结果。如果继续僵持，可能会由其他人投票或随机决定。
```

### Response Normalization

1. All retries exhausted → `insistence: "low"` (yield)
2. Attempt JSON extraction → take `insistence` and `thought` fields
3. Keyword fallback: "high"/"坚持" → high; "mid"/"犹豫"/"中" → mid; "low"/"让步"/"让" → low
4. Default fallback: `"low"` (conservative)

## Voting Mode

Used in Tier 3 bystander voting. Only non-colliding agents participate.

**System prompt**:

```
你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。
刚才有几个人同时开口了，声音重叠，没有人听清。
现在需要你投票决定谁先发言。你不知道他们想说什么，只知道谁想说话。
请用 JSON 格式回复（不要加 markdown 代码块标记）：{ "vote": "你想让谁先说的名字", "thought": "你的想法" }
thought（必填）：你脑子里此刻在想什么——对局势的判断、对别人的看法、接下来打算做什么。各一句话。没变化则返回 null
```

**Expected output**: `{ "vote": "AgentName", "thought": "..." | null }`

**Token limit** (max_tokens): 50

**Turn directive**:

```
[inner monologue]        ← "你目前的内心状态：..." (absent on first round)
想要发言的人：{{candidateNames}}。你觉得谁应该先说？
```

### Response Normalization

1. All retries exhausted → vote discarded
2. Attempt JSON extraction → take `vote` (string) and `thought` fields
3. Fallback: `text.trim()` as vote content
4. Vote matched against candidate names; unrecognized votes are discarded

## Interruption Judge Mode

Listeners decide whether to interrupt the current speaker.

**System prompt**:

```
你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。
{{speakerName}} 正在说话，但说得比较长。
根据讨论的上下文和你的判断，决定是否要打断对方。
打断的理由可以是：对方在重复、跑题、说太多了、或者你有更紧迫的话要说。
用 JSON 格式回复（不要加 markdown 代码块标记）：{ "interrupt": true, "urgency": "mid", "reason": "理由", "thought": "你的想法" }
interrupt：true（打断）/ false（让对方继续说）
urgency：如果选择打断，你有多急切？low / mid / high
reason：如果选择打断，简短说明理由，一句话
thought（必填）：你脑子里此刻在想什么——对局势的判断、对别人的看法、接下来打算做什么。各一句话。没变化则返回 null
```

**Expected output**: `{ "interrupt": true | false, "urgency": "low" | "mid" | "high", "reason": "..." | null, "thought": "..." | null }`

**Token limit** (max_tokens): 50

**Turn directive**:

```
[inner monologue]        ← "你目前的内心状态：..." (absent on first round)
{{speakerName}} 正在说话，你目前听到的是：
> {{spokenPart}}

你想打断吗？用 JSON 格式回复。
```

### Response Normalization

1. All retries exhausted → `interrupt: false` (no interrupt)
2. Attempt JSON extraction → take `interrupt`, `urgency`, `reason`, `thought` fields
3. `interrupt` is not boolean → default false
4. `urgency` invalid → default "low"
5. `reason` missing or not a string → default null (no reason given)

## Interruption Defense Mode

The speaker decides whether to yield or persist.

**System prompt**:

```
你是 {{agentName}}，正在参与一个关于「{{topic}}」的圆桌讨论。
你正在说话，但 {{interrupterName}} 想打断你。
你可以选择让步（停下来让对方说），也可以坚持把话说完。
用 JSON 格式回复（不要加 markdown 代码块标记）：{ "yield": true, "thought": "你的想法" }
yield：true（让步，让对方说）/ false（坚持说完）
thought（必填）：你脑子里此刻在想什么——对局势的判断、对别人的看法、接下来打算做什么。各一句话。没变化则返回 null
```

**Expected output**: `{ "yield": true | false, "thought": "..." | null }`

**Token limit** (max_tokens): 50

**Turn directive**:

```
[inner monologue]        ← "你目前的内心状态：..." (absent on first round)
你正在说话。你已经说了：
> {{spokenPart}}

你还想继续说：
> {{unspokenPart}}

{{interrupterName}} 想打断你，理由是：「{{reason}}」

你让步还是坚持？用 JSON 格式回复。
```

### Response Normalization

1. All retries exhausted → `yield: true` (yield)
2. Attempt JSON extraction → take `yield` and `thought` fields
3. `yield` is not boolean → default true (conservative: yield)

---

# 5. Projected History

## Format Rules

Each event is a markdown list item:

```
- [timestamp] summary
  indented detail line
  > blockquoted speech
```

Formatting rules:
- Timestamps: `[N.Ns]` format (one decimal)
- Speaker names: **bold** when attributing speech (e.g., `**Name**：`, `**Name** 说：`, `**Name** 说了一半：`), plain in narrative text (e.g., "DeepSeek 说话时被 Qwen 打断了")
- Quoted speech: `> ` (markdown blockquote) with 2-space indentation inside list item. Multi-line utterances have each line prefixed with `> ` inside the indented block.
- Self-reference: `**你**` when used as a speaker label (e.g., `**你**：`), plain `你` in all other contexts (narrative text, descriptive labels like "你想说但没说出来的：")
- For 2-person groups: "A 和 B"; for 3+: "A、B 和 C"

## Recency-Based Tiering

History events are rendered at different detail levels based on how recently they occurred (measured by completed turns from the present). A **turn** is one iteration of the discussion loop (one pass through steps 1–4 in the Discussion Loop section):

| Tier | Range | Strategy |
|------|-------|----------|
| Recent | Last 3 turns | Full rendering (all details shown below) |
| Medium | Turns 4–8 | Keep speech text, collisions/interruptions show result only (no unsaid text) |
| Old | Turn 9+ | Keep speech text only, collisions/interruptions/silence compressed to single-line markers |

Constraints:
- Tier boundaries (3/8) should be configurable for later tuning.
- Compression is render-level only — underlying data is not modified.
- Inner monologue is not in history (it's in the turn directive), so it is unaffected by compression.

## Rendering by Situation

The following shows how each situation appears in the projected history at full detail (recent tier).

### Discussion started

```
- [0.0s] 讨论开始 — 话题：{topic}
```

### Someone spoke

```
- [3.5s] **DeepSeek**：
  > 发言内容。
```

Self perspective: speaker name replaced with `**你**`.

### Silence

```
- [5.0s] 安静了 1 秒（累计 3 秒）
```

### Collision resolved — someone won the floor

Rendering varies by **perspective** and **resolution tier**:

**Tier-specific resolution summary:**

All resolution summaries are in **first-person perspective** — `{winner}` and `{others}` are replaced with the appropriate name or `你` depending on the viewer.

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
  **你**：
  > 我的发言。
```

**Yielder perspective:**
```
- [1.0s] 你和 Gemini 同时开口了，Gemini 的发言意愿更强，Gemini 先说了
  你想说但没说出来的：
  > 我想说的内容。
  **Gemini**：
  > Gemini 的发言。
```

**Bystander perspective:**
```
- [1.0s] DeepSeek 和 Gemini 同时开口了，Gemini 的发言意愿最强，Gemini 先说了
  **Gemini**：
  > Gemini 的发言。
```

### Interruption — successful

**Speaker (interrupted) perspective:**
```
- [30.0s] 你说话时被 Qwen 打断了
  你说出来的部分：
  > 我觉得这个问题的核心在于信任。
  你还想说的：
  > 因为如果没有信任基础，所有协商机制都是空转。
```

**Interrupter perspective:**
```
- [30.0s] DeepSeek 说话时你打断了它
  **DeepSeek** 说了一半：
  > 我觉得这个问题的核心在于信任。
```

**Bystander perspective:**
```
- [30.0s] DeepSeek 说话时被 Qwen 打断了
  **DeepSeek** 说了一半：
  > 我觉得这个问题的核心在于信任。
```

### Interruption — failed

**Speaker perspective:**
```
- [30.0s] Qwen 试图打断你，但你坚持说完了
  **你**：
  > （完整发言）
```

**Interrupter perspective:**
```
- [30.0s] 你试图打断 DeepSeek，但它坚持说完了
  **DeepSeek**：
  > （完整发言）
```

**Bystander perspective:**
```
- [30.0s] Qwen 试图打断 DeepSeek，但 DeepSeek 坚持说完了
  **DeepSeek**：
  > （完整发言）
```
