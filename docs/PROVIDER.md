---
name: Provider
description: Provider integration notes and model behavior — API protocol, model presets, known quirks.
---

# ZenMux Platform

ZenMux is an LLM aggregation platform — one API key accesses models from all major providers (OpenAI, Google, DeepSeek, Qwen, etc.).

- Website: https://zenmux.ai
- Docs: https://zenmux.ai/docs/about/intro.html

## API Protocol

Using OpenAI-compatible protocol (`https://zenmux.ai/api/v1/chat/completions`).

## Key Gotchas

- **API key encoding**: API keys pasted from Chinese IME may contain invisible Unicode chars. The provider adapter should strip non-printable ASCII on construction.
- **Reasoning tokens eat max_tokens budget**: Thinking models (Gemini 2.5 Flash/Pro) spend most of `max_completion_tokens` on reasoning tokens, leaving almost nothing for actual output. Solution: set `thinkingModel: true` in `AgentConfig` — the provider adapter automatically multiplies `max_tokens` by 10 across all prompt modes.
- **`reasoning: { enabled: false }` not universally supported**: Gemini 2.5 Pro rejects this parameter (HTTP 400). We no longer send it — instead we increase the token budget.
- **Model slug format**: `provider/model-name`, e.g. `deepseek/deepseek-chat`, `google/gemini-2.5-flash`.
- **Error responses can be HTML**: HTTP 500 from some models returns a full HTML error page. The provider adapter should truncate error bodies > 200 chars and try to extract JSON error messages.

## Current Strategy: Full Response

The LLM client returns the model's complete response — no sentence extraction or stop sequences. Models are instructed via system prompt to produce their full speech in one response.

# Model Presets

> Recommended `AgentConfig` configurations. These are reference examples — adjust model slugs as providers update their offerings.

## Budget (for dev/iteration)

| Agent ID | Model Slug | Thinking | Notes |
|----------|-----------|----------|-------|
| deepseek | `deepseek/deepseek-chat` | no | Good Chinese, cheap. Very assertive in negotiation (almost never yields). Prone to action descriptions and history hallucination. |
| gemini | `google/gemini-2.5-flash` | yes | Needs high max_tokens due to reasoning overhead. Tends to be polite/yielding in negotiation. Produces verbose but substantive responses. |
| qwen | `qwen/qwen3-vl-plus` | no | Good Chinese. Balanced negotiation behavior. Produces thoughtful responses with rhetorical questions. |

## Premium (stronger models)

| Agent ID | Model Slug | Thinking | Notes |
|----------|-----------|----------|-------|
| deepseek | `deepseek/deepseek-v3.2` | no | Stronger instruction following than deepseek-chat |
| gemini | `google/gemini-2.5-pro` | yes | Most capable Gemini, needs high max_tokens |
| qwen | `qwen/qwen3-max` | no | Strongest Qwen variant |

## Removed Models

- **GPT-5n** (`openai/gpt-5-nano`): Returns empty content via ZenMux. Every response was `text: ""` with `finishReason: "stop_sequence"`. 3-5s latency suggests the API was processing but producing nothing. Removed.
- **Mistral** (`mistralai/mistral-large-2512`): Consistently returns HTTP 422 (`provider_unprocessable_entity_error`). Not available through ZenMux. Removed.

# Model Behavior Observations

## Collision & Negotiation Dynamics

The collision problem was the central challenge of this project. Key findings:

- **Prompt-only solutions don't work**: Telling models "don't rush" or reporting collision stats has negligible effect. Models are inherently eager to speak when polled.
- **Negotiation works well**: The insist/yield negotiation mechanism reliably converges (usually in 1-3 rounds). Models exhibit distinct "personalities" in negotiation.
- **Last-speaker-skip is essential**: Without it, assertive models (DeepSeek) monopolize the conversation by always insisting and always being polled.
- **@mention awareness helps**: When an agent is @-mentioned, the reaction turn directive nudges them to respond, and the negotiation prompt highlights they have reason to insist — preventing the situation where everyone yields when someone was directly asked.

## Per-Model Negotiation Personality

Based on observed behavior with real API:

- **DeepSeek (deepseek-chat)**: Inconsistent negotiation personality. In some runs, extremely assertive (never yields, insists round after round). In others, consistently passive — always chooses `mid` insistence, never escalates to `high`, and loses every collision against more assertive opponents. This variability may be topic-dependent or prompt-sensitive. Starvation hints (added to help passive agents self-correct) partially mitigate the passive case.
- **Gemini (2.5-flash)**: Very polite, tends to yield quickly. Often yields even when @-mentioned. Produces long, comprehensive responses when it does speak.
- **Qwen (qwen3-vl-plus)**: Balanced. Will insist when it has something specific to say (especially when continuing a thread). Yields when the discussion doesn't directly involve it.

## Normalization Issues

Problems discovered and fixed at the normalization layer:

- **DeepSeek action descriptions**: `（等了一秒，确认安静后）`, `（转向 Qwen）` — stripped by parenthetical regex.
- **DeepSeek history hallucination**: DeepSeek sometimes fabricates other agents' speech in timestamped history format like `[2.5s] Gemini 说：「...」`. Detected and discarded by the history hallucination check in utterance cleaning.
- **Gemini speaker prefix echo**: Mimics history format in output, e.g. `[你]: 没关系。`. Stripped by speaker prefix regex.
- **Gemini fragments**: With thinking models, reasoning tokens consume the budget, leaving outputs like `嗯，` or `DeepSeek`. Filtered by minimum length (4 chars).
- **Cross-turn repetition**: Both DeepSeek and Qwen repeat the same sentence across different turns when context doesn't change much. Detected by scanning all committed sentences and collision utterances in the session.

# Provider Testing

See README for setup. Use the session API with different `AgentConfig` presets to test provider behavior.
