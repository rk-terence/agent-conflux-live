**PRODUCT & TECHNICAL DESIGN**

**AI Roundtable**

去中心化多模型自由讨论实验平台

Version 0.6 | March 2026

*Interrupt eliminated as system concept. All concurrent speech is collision, resolved by models.*

# What & Why

AI Roundtable is an experiment platform where multiple large language models sit around a virtual roundtable and freely discuss a topic. No moderator, no fixed turn order. Each model autonomously decides when to speak, when to stay silent, and what to say.

The goal is to observe social behavior in a decentralized setting: who dominates, who stays quiet, who interrupts, who yields. This is a social experiment between large language models.

**DESIGN PHILOSOPHY**

-   **Minimal, grounded parameters.** No hand-tuned urgency scores or arbitration rules. The few parameters that exist (token-to-seconds ratio, silence backoff schedule, stop_sequences, max_tokens) are grounded in physical constraints or protocol necessity, not arbitrary tuning. All social behavior emerges from model weights and conversational context.

-   **One loop.** The entire engine is a single repeating cycle. There is no separate mechanism for interrupts, collisions, or silence---they are all natural outcomes of the same loop.

-   **Sentence as the atomic unit.** Each API call produces at most one sentence. This is the fundamental clock tick of the simulation.

## Time Model

Three rules govern how virtual time flows:

### 2.1 Speaking consumes time

Each sentence produced by an agent advances virtual time by token_count × 0.06 seconds, corresponding to natural Chinese speaking pace (~250 characters/minute).

### 2.2 Thinking is instantaneous

API calls consume real wall-clock time but zero virtual time. When agents are polled for their reaction, the virtual clock is frozen.

### 2.3 Silence grows exponentially

When all agents respond with [silence], virtual time advances by an exponentially growing interval: +1s, +2s, +4s, +8s, +16s (cap). Each re-poll appends a cumulative silence annotation to the history. Any speech resets the counter. Cumulative silence >60s ends the discussion.

## The Loop

The entire engine is a single loop. Every iteration, every agent is polled. There is no distinction between speakers and listeners at the system level---the distinction emerges from how each agent's API call is constructed.

### 3.1 Two calling modes

Each iteration, every agent receives one API call. But the call is constructed differently depending on whether the agent was speaking in the previous iteration:

**Continuation mode (for the current speaker):** The agent's previous partial speech is placed in an assistant message as a prefill. The model continues generating from where it left off. A stop_sequences parameter (`["。", "！", "？", "\n"]`) causes the model to stop at the next sentence boundary. The system prompt and conversation history are the same as what the speaker saw when they first started speaking. This is a pure completion: the model extends its own prior output.

**Reaction mode (for everyone else):** Standard chat format. The conversation history includes the speaker's in-progress speech with an atmosphere annotation showing elapsed time. The agent responds with either speech content (they want to talk) or [silence] (they continue listening).

### 3.2 The cycle

1.  Fire all API calls concurrently (Promise.all). The current speaker gets a continuation call; everyone else gets a reaction call.

2.  Collect all responses. The speaker's response is the next sentence of their ongoing speech. Each listener's response is either [silence] or speech content.

3.  Advance virtual time by the speaker's new sentence's token count × 0.06s.

4.  Check listener responses and branch:

-   **All listeners [silence]:** Append the speaker's new sentence to their ongoing speech in the history. The speaker continues in the next iteration (continuation mode again). This is a normal uninterrupted turn.

-   **One or more listeners also speak:** This is a collision---the speaker produced a sentence and one or more listeners also produced content in the same iteration. All outputs (the speaker's next sentence AND each listener's sentence) are emitted simultaneously as a collision event. In the next iteration, there is no current speaker---everyone enters reaction mode. Agents see the overlap in history and self-resolve: the original speaker may continue, may yield, or may push back. The person who spoke up may continue, may back off, or may defer. This is a social negotiation that the models resolve themselves.

-   **Speaker produces end-of-turn:** the continuation call returns an empty string, or the model outputs only the stop_sequence character itself with no preceding content. This is the deterministic end-of-turn signal. Short utterances like "崩" or "好吧" are NOT end-of-turn---they are valid one-sentence speech acts. Only a truly empty generation (zero content tokens before the stop sequence) counts.

### 3.3 First turn

At the very start, there is no current speaker. All agents get reaction mode with an empty history (plus the topic). This is equivalent to the opening silence. One or more agents will produce speech, which kicks off the loop.

### 3.4 Silence

If no one is currently speaking and all agents return [silence], the exponential backoff from Section 2.3 applies. The history annotation is updated and everyone is re-polled. If no one speaks for 60 cumulative seconds, the discussion ends.

### 3.5 Why this is enough

This single loop naturally produces all the social phenomena we want to observe:

-   **Uninterrupted speech:** the speaker keeps producing sentences while all listeners return [silence].

-   **Voluntary stop:** the speaker's continuation call returns empty (zero content tokens). This is the only end-of-turn signal. Short replies like "崩" are valid speech, not end-of-turn.

-   **Collision during speech:** a listener returns speech while someone is speaking. Both outputs are emitted. Neither is forcibly truncated.

-   **Interruption (emergent):** after a collision during speech, the original speaker chooses [silence] in the next round---they yield the floor. This is not a system action; it is the speaker's own decision.

-   **Refusing to yield (emergent):** after a collision during speech, the original speaker continues anyway, ignoring or pushing back on the interjection. The models negotiate who gets the floor.

-   **Collision at turn gap:** multiple agents produce speech in the same iteration when no one was speaking. After a collision, all agents enter reaction mode and self-resolve.

-   **Silence and ice-breaking:** nobody speaks, pressure accumulates via annotation, eventually someone breaks.

-   **Variable speech length:** the speaker decides each sentence whether to continue, producing anything from one-liners to long monologues.

No special-case code for any of these. They are all the same loop.

## History Format

The conversation history is the primary input to every agent. It must accurately convey temporal relationships and each agent receives a first-person perspective.

### 4.1 Completed speech

[Claude]: 我觉得意识的定义本身就是模糊的，我们连人类意识都没有共识。而且从哲学角度看，这个问题可能根本无解。

### 4.2 In-progress speech (for listeners in reaction mode)

[Claude 正在说（已说 18 秒）]: 我觉得意识的定义本身就是模糊的， 我们连人类意识都没有共识。 而且从哲学角度看...... （Claude 还在继续说）

The elapsed time annotation gives listeners a natural patience signal. The model sees how long someone has been talking and decides for itself whether to keep listening or interject.

### 4.3 Collision

[GPT-4o 和 DeepSeek 同时说]: [GPT-4o]: 但这恰恰是问题所在—— [DeepSeek]: 我想从另一个角度—— (几个人同时开口，都只说了一句)

### 4.4 Collision during speech

When a listener speaks while someone is talking, both outputs appear at the same timestamp. The speaker's ongoing speech is not truncated by the system---it simply has a collision appended:

[Claude 正在说时，GPT-4o 也开口了]: [Claude]: 而且从哲学角度看，这个问题可能根本无解。 [GPT-4o]: 等等——你这个前提本身就有问题。 (两人同时在说话)

What happens next is entirely up to the models. In the following reaction-mode iteration, Claude may yield ("好吧你说"), may insist ("让我说完"), or may engage with the interjection. GPT-4o may continue its point or defer. The system does not force either outcome.

### 4.5 Silence

(已经安静了 7 秒)

### 4.6 First-person perspective

Each agent receives a slightly different history. In collision events, the agent's own name is replaced with "you":

**What GPT-4o sees (it was the one who spoke up):**

[Claude 正在说时，你也开口了]: [Claude]: 而且从哲学角度看，这个问题可能根本无解。 [你]: 等等——你这个前提本身就有问题。 (你们同时在说话)

**What Claude sees (it was the one being talked over):**

[你正在说时，GPT-4o 也开口了]: [你]: 而且从哲学角度看，这个问题可能根本无解。 [GPT-4o]: 等等——你这个前提本身就有问题。 (你们同时在说话)

The framing is symmetrical and neutral. Neither party is labeled by the system as having a privileged or subordinate role. The models interpret the social dynamics themselves.

## Calling Conventions

All agents share a single system prompt. The difference between the two calling modes lies entirely in message construction.

### 5.1 Shared system prompt

你是 {name}，在一个自由圆桌讨论中。 参与者：{all_names}。话题：{topic} 规则： - 没有主持人，自由发言 - 展现你的独特思维和性格 - 可以 \@某人 回应 - 用中文 - 如果你没有想说的，回复 [silence] - 沉默是完全正常的

### 5.2 Continuation mode (speaker)

The speaker's call uses assistant prefill. The messages array ends with an assistant message containing everything the speaker has said so far. The model continues generating, producing the next sentence. stop_sequences forces it to halt at a sentence boundary.

**Speaker self-awareness:** before the assistant prefill, the user message includes a lightweight status annotation: "（你已经连续说了 18 秒 / 3 句）". This gives the speaker a sense of elapsed time and social self-regulation, preventing the model from monologuing indefinitely simply because it has no awareness of how long it has been talking. Without this, the prefill's frozen context would create a systematic bias toward long uncontested speech.

```json
messages: [
  { role: "user", content: "[history up to when speaker started]\n(你已经连续说了 18 秒 / 3 句)" },
  { role: "assistant", content: "Sentence 1. Sentence 2. Sentence 3." }
]
stop_sequences: ["。", "！", "？", "\n"]
max_tokens: 100
```

If the model generates very little or nothing (empty completion), the speaker has finished their turn. The engine detects this and transitions to a turn-gap state.

### 5.3 Reaction mode (listeners + between turns)

Standard chat. The user message contains the full updated history (including in-progress speech with time annotation). The agent responds with speech content or [silence].

```json
messages: [
  { role: "user", content: "[full history]\n\n---\n你的反应？" }
]
max_tokens: 80
```

### 5.4 Why prefill matters

Without prefill, the speaker would need to re-read the entire conversation and re-decide what to say every sentence. With prefill, the model picks up exactly where it left off---same train of thought, same rhetorical momentum. This produces more coherent multi-sentence speeches and avoids the artificial pattern of the model restating or summarizing its own prior sentences.

It also avoids wasted tokens: if a collision occurs after sentence 2 and the speaker yields, only the tokens for sentences 1--2 were generated. Without prefill, the speaker would have generated a full 4-sentence response upfront, with unused portions discarded.

## Cost Model

A typical discussion with 4 models, 15 speaking turns, average 3 sentences per turn:

  ----------------------------------------------------------- --------------------- ---------------- -----------------
  **Operation**                                               **Calls/iteration**   **Iterations**   **Total calls**

  Speaking iterations (speaker continues + listeners react)   N (4)                 ~45 (15×3)      ~180

  Turn-gap polls (between speakers)                           N (4)                 ~15             ~60

  Silence polls (exponential backoff)                         N (4)                 ~5              ~20

  **TOTAL**                                                                                          **~260 calls**
  ----------------------------------------------------------- --------------------- ---------------- -----------------

Although the call count is high, individual calls are cheap:

-   Speaker continuation: max_tokens=100, output is one sentence (~20--40 tokens).

-   Listener reaction: max_tokens=80, output is [silence] (~1 token) in ~85% of cases.

-   All N calls per iteration fire concurrently---wall-clock time per iteration is one API round-trip.

Estimated cost at typical API pricing (\$3/M input, \$15/M output): ~\$0.20--\$0.35 per discussion. Comparable to previous versions despite higher call count, because each call generates far fewer output tokens.

## Multi-Provider API Layer

Six providers supported through a unified call interface:

  -------------- ------------------ --------------------- ---------------------------------
  **Provider**   **Model**          **Auth**              **Prefill support**

  Anthropic      Claude Sonnet 4    x-api-key header      Native (trailing assistant msg)

  OpenAI         GPT-4o             Bearer token          Via compatible adapters

  Google         Gemini 2.5 Flash   API key query param   Via compatible adapters

  DeepSeek       DeepSeek Chat      Bearer token          Native (\"prefix\": true)

  Qwen           Qwen Plus          Bearer token          Via compatible adapters

  Groq           Llama 3.3 70B      Bearer token          Via compatible adapters
  -------------- ------------------ --------------------- ---------------------------------

For providers without native prefill, compatible adapter techniques (instruction-based continuation, prompt formatting) ensure equivalent behavior. API keys stored in browser memory only.

## User Interface

### 8.1 Setup screen

-   Model selector: grid of 6 models, toggle on/off

-   API key inputs per provider

-   Topic selector: presets + custom input

-   Virtual duration slider (60--600 seconds)

### 8.2 Discussion screen

-   Top bar: participant avatars with state dots, virtual clock, controls

-   Event stream: chronological timeline, each event with virtual timestamp

-   Speech: sentences appear one by one as they are generated, with speaker avatar

-   **Collision:** multiple messages at same timestamp, stacked. Two visual subtypes: "collision at gap" (nobody was speaking) and "collision during speech" (someone was mid-turn). Both use the same engine path, but the display label differs for observability and analytics.

-   Silence: centered annotation with cumulative time

-   **Debug panel (toggle):** shows every agent's raw response per iteration, including [silence] markers

## Version History

  ---------------------- ----------------------------------------------------- -------------------------------------------------------------------------------
  **Aspect**             **V1 (0.1)**                                          **Current (0.6)**

  Core loop              Tick-based, then event-driven                         Single sentence-by-sentence loop

  Prompt types           5 (opening, reaction, speech, collision, interrupt)   1 system prompt + 2 calling modes

  Speaker generation     Full response in one call, then chunked for display   One sentence per call via prefill continuation

  Interrupt mechanism    Separate trigger-based system                         Eliminated. Collision during speech, resolved by models themselves

  Collision resolution   Extra API round (yield/insist/laugh)                  First sentences emitted, next poll self-resolves

  Thinking time          Artificial delay classes                              Instantaneous (zero)

  Speaking time          Fixed random range                                    token_count × 0.06s per sentence

  Silence                Fixed delay + nudge                                   Exponential backoff + annotation

  Artificial params      ~6                                                   Minimal, grounded (token ratio, backoff schedule, stop_sequences, max_tokens)

  History format         Merged messages                                       First-person, in-progress, collision blocks

  Wasted tokens          Full response generated even if speaker yields        Only sentences actually spoken are generated
  ---------------------- ----------------------------------------------------- -------------------------------------------------------------------------------

## Future Directions

-   **Export & share:** shareable images/video from transcripts for social media.

-   **Personality analytics:** post-discussion stats: speak/silence ratio, collision frequency, yielding rate, average turn length per model.

-   **Observer mode:** human can inject messages or vote.

-   **Cross-language:** same topic in Chinese vs English.

-   **Adversarial injection:** secretly instruct one model to be contrarian.

-   **Variable sentence granularity:** experiment with clause-level chunking for even finer-grained interaction.

Appendix: Implementation Constraints

  ---------------------- ------------------------------------------------------------
  **Component**          **Constraint**

  Application form       Browser-based interactive discussion experience

  Core execution model   Single iteration loop, polling all agents each round

  Model integration      Unified adapter boundary over provider-specific APIs

  Speaker calls          Continuation-style generation with sentence-boundary stopping

  Listener calls         Reaction-style generation with bounded output

  Time system            Virtual clock, advanced by speech output or silence interval

  Concurrency            All agents are polled concurrently in each iteration

  Backend                Not required by the product design at this stage
  ---------------------- ------------------------------------------------------------
