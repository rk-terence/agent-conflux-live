# Provider Integration Notes

## ZenMux Platform

ZenMux is an LLM aggregation platform — one API key accesses models from all major providers (OpenAI, Anthropic, Google, DeepSeek, Qwen, Mistral, etc.).

- Website: https://zenmux.ai
- Docs: https://zenmux.ai/docs/about/intro.html

### API Protocol Choice

**Using OpenAI-compatible protocol** (`https://zenmux.ai/api/v1/chat/completions`).

The Anthropic-compatible endpoint (`/api/anthropic/v1/messages`) was attempted first because it returns `stop_sequence` in the response (tells you exactly which stop sequence triggered). However, it does NOT support all models — Qwen and others return 404 "model not supported by /v1/messages". So we use the OpenAI protocol for universal compatibility.

### Key Gotchas

- **API key encoding**: Browser `fetch` rejects non-ISO-8859-1 characters in headers. API keys pasted from Chinese IME or webpages may contain invisible Unicode chars. Gateway strips non-printable ASCII on construction.
- **Reasoning tokens eat max_tokens budget**: Models like Gemini 2.5 Flash and Qwen spend most of `max_completion_tokens` on thinking/reasoning tokens, leaving almost nothing for actual output. With `max_completion_tokens: 80`, Gemini produced only 4 visible tokens ("好的") while spending 72 on reasoning.
- **Solution**: Set `reasoning: { enabled: false }` in the request body. This is a ZenMux-supported parameter that disables thinking for all models. Dramatically reduces latency and cost.
- **Stop sequences limit**: OpenAI protocol supports max 4 stop sequences. Anthropic protocol supports max 5.
- **Stop sequences strip the matched token**: OpenAI API does not include the stop sequence in output text, and does not tell you which one matched. This makes stop sequences unreliable for our use case.
- **Model slug format**: `provider/model-name`, e.g. `deepseek/deepseek-chat`, `google/gemini-2.5-flash`.
- **Free models may be Studio-only**: `google/gemini-3-flash-preview-free` returned 404 via API — it's only available in ZenMux's web chat. Use paid variants.

### Current Strategy: No Stop Sequences

Instead of relying on API-level stop sequences, the gateway:
1. Lets the model generate freely (no `stop` parameter)
2. Extracts the first complete sentence client-side via `extractFirstSentence` (regex: `[。！？\n]`)
3. Detects `[silence]` via text prefix check

This guarantees:
- Complete sentences with punctuation intact
- No ambiguity about which stop triggered
- Works identically across all models and protocols

Tradeoff: the model generates more tokens than we use. Could optimize with streaming + early abort in the future.

## Model Behavior Observations

### Chronic Collision Problem

When all models are polled simultaneously in reaction mode (turn_gap phase), they almost always ALL choose to speak. This creates permanent collision loops where no single speaker ever gets the floor.

**What we've tried:**
- System prompt: "沉默是完全正常的，不需要每次都发言" — weak effect, models still eager to speak
- Collision hint in user prompt: told models they collided — models started meta-discussing the collision ("请继续", "抱歉打断") instead of actually yielding
- Factual collision streak stats: "已经连续 5 次出现多人同时发言的情况" — models can observe the pattern but don't reliably self-regulate

**What might work (untested):**
- Engine-level winner selection: on collision, randomly pick one speaker and discard others
- Per-model personality prompts: give each model a distinct communication style (some more assertive, some more reserved)
- Graduated silence pressure: after N consecutive collisions, increase the [silence] suggestion strength

### Model Personality Issues

- **Models produce action descriptions**: `（轻轻放下虚拟茶杯）`, `（指尖悬停半空）`. Fixed by adding "只输出你说的话，不要输出动作描写、括号注释或旁白" to system prompt. Mostly effective but some models still do it occasionally.
- **Gemini plays moderator**: tends to say "请继续" and "期待你的见解" instead of contributing substantive discussion
- **DeepSeek is too passive**: mostly agrees with others ("我同意", "我理解你的比喻") without offering original perspectives
- **Qwen likes em dashes**: frequently produces "——" mid-sentence, which was causing premature truncation when `——` was in the sentence boundary regex. Removed `——` from `extractFirstSentence`.

### Model Compatibility Matrix (Budget Preset)

| Agent ID | Model Slug | Price (in/out per M) | Notes |
|----------|-----------|---------------------|-------|
| deepseek | `deepseek/deepseek-chat` | $0.28/$0.42 | Good Chinese, cheap, passive personality |
| gemini | `google/gemini-2.5-flash` | $0.30/$2.50 | Fast, tends to moderate |
| qwen | `qwen/qwen3-vl-plus` | $0.20/$1.60 | Good Chinese, likes em dashes |
| gpt | `openai/gpt-5-nano` | $0.05/$0.40 | Cheapest, untested in discussions |
| mistral | `mistralai/mistral-large-2512` | $0.50/$1.50 | Untested in discussions |

## Testing Workflow (TODO)

UI-based testing is too slow for prompt iteration. Need a CLI/terminal test harness that:
- Runs N iterations headlessly
- Logs full prompt + response for each agent per iteration
- Outputs a timeline view for post-hoc analysis
- Allows rapid prompt A/B testing
