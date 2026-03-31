# Provider Integration Notes

## ZenMux Platform

ZenMux is an LLM aggregation platform — one API key accesses models from all major providers (OpenAI, Google, DeepSeek, Qwen, etc.).

- Website: https://zenmux.ai
- Docs: https://zenmux.ai/docs/about/intro.html

### API Protocol

Using OpenAI-compatible protocol (`https://zenmux.ai/api/v1/chat/completions`).

### Key Gotchas

- **API key encoding**: Browser `fetch` rejects non-ISO-8859-1 characters in headers. API keys pasted from Chinese IME may contain invisible Unicode chars. Gateway strips non-printable ASCII on construction.
- **Reasoning tokens eat max_tokens budget**: Thinking models (Gemini 2.5 Flash/Pro) spend most of `max_completion_tokens` on reasoning tokens, leaving almost nothing for actual output. Solution: models with `thinking: true` in the preset get 10x max_tokens to compensate.
- **`reasoning: { enabled: false }` not universally supported**: Gemini 2.5 Pro rejects this parameter (HTTP 400). We no longer send it — instead we increase the token budget.
- **Model slug format**: `provider/model-name`, e.g. `deepseek/deepseek-chat`, `google/gemini-2.5-flash`.
- **Error responses can be HTML**: HTTP 500 from some models returns a full HTML error page. Gateway truncates error bodies > 200 chars and tries to extract JSON error messages.

### Current Strategy: Full Response

The gateway returns the model's complete response — no sentence extraction or stop sequences. Models are instructed via system prompt to produce their full speech in one response.

## Model Presets

### Budget (for dev/iteration)

| Agent ID | Model Slug | Thinking | Notes |
|----------|-----------|----------|-------|
| deepseek | `deepseek/deepseek-chat` | no | Good Chinese, cheap. Very assertive in negotiation (almost never yields). Prone to action descriptions and history hallucination. |
| gemini | `google/gemini-2.5-flash` | yes | Needs high max_tokens due to reasoning overhead. Tends to be polite/yielding in negotiation. Produces verbose but substantive responses. |
| qwen | `qwen/qwen3-vl-plus` | no | Good Chinese. Balanced negotiation behavior. Produces thoughtful responses with rhetorical questions. |

### Premium (stronger models)

| Agent ID | Model Slug | Thinking | Notes |
|----------|-----------|----------|-------|
| deepseek | `deepseek/deepseek-v3.2` | no | Stronger instruction following than deepseek-chat |
| gemini | `google/gemini-2.5-pro` | yes | Most capable Gemini, needs high max_tokens |
| qwen | `qwen/qwen3-max` | no | Strongest Qwen variant |

### Removed Models

- **GPT-5n** (`openai/gpt-5-nano`): Returns empty content via ZenMux. Every response was `text: ""` with `finishReason: "stop_sequence"`. 3-5s latency suggests the API was processing but producing nothing. Removed.
- **Mistral** (`mistralai/mistral-large-2512`): Consistently returns HTTP 422 (`provider_unprocessable_entity_error`). Not available through ZenMux. Removed.

## Model Behavior Observations

### Collision & Negotiation Dynamics

The collision problem was the central challenge of this project. Key findings:

- **Prompt-only solutions don't work**: Telling models "don't rush" or reporting collision stats has negligible effect. Models are inherently eager to speak when polled.
- **Negotiation works well**: The insist/yield negotiation mechanism reliably converges (usually in 1-3 rounds). Models exhibit distinct "personalities" in negotiation.
- **Last-speaker-skip is essential**: Without it, assertive models (DeepSeek) monopolize the conversation by always insisting and always being polled.
- **@mention awareness helps**: When an agent is @-mentioned and the negotiation prompt highlights this, they're more likely to insist — preventing the situation where everyone yields when someone was directly asked.

### Per-Model Negotiation Personality

Based on observed behavior with real API:

- **DeepSeek (deepseek-chat)**: Almost never yields. Extremely assertive. Will insist round after round until the other party gives up. This is a model-level personality trait, not a prompt issue.
- **Gemini (2.5-flash)**: Very polite, tends to yield quickly. Often yields even when @-mentioned. Produces long, comprehensive responses when it does speak.
- **Qwen (qwen3-vl-plus)**: Balanced. Will insist when it has something specific to say (especially when continuing a thread). Yields when the discussion doesn't directly involve it.

### Normalization Issues

Problems discovered and fixed at the normalization layer:

- **DeepSeek action descriptions**: `（等了一秒，确认安静后）`, `（转向 Qwen）` — stripped by parenthetical regex.
- **DeepSeek history hallucination**: In continuation mode (now removed), DeepSeek would fabricate other agents' speech in timestamped history format like `[2.5s] Gemini 说：「...」`. Detected and discarded by regex.
- **Gemini speaker prefix echo**: Mimics history format in output, e.g. `[你]: 没关系。`. Stripped by speaker prefix regex.
- **Gemini fragments**: With thinking models, reasoning tokens consume the budget, leaving outputs like `嗯，` or `DeepSeek`. Filtered by minimum length (4 chars).
- **Cross-turn repetition**: Both DeepSeek and Qwen repeat the same sentence across different turns when context doesn't change much. Detected by scanning all committed sentences and collision utterances in the session.

## CLI Testing Workflow

The CLI runner (`src/cli/run.ts`) addresses the need for rapid prompt iteration:

```bash
# Quick offline test with personality-driven dummy
npx tsx src/cli/run.ts --gateway smart-dummy --duration 60

# Real API test
npx tsx src/cli/run.ts --duration 120

# Premium models
npx tsx src/cli/run.ts --preset premium --duration 120
```

Logs are written to `logs/` with full prompt/response details for post-hoc analysis.
