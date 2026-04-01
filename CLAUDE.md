# Docs

- Public-facing README file: README.md (Chinese) and README_EN.md (English)
- Architecture and system design: docs/ARCHITECTURE.md
- Provider integration notes and model behavior: docs/PROVIDER.md
- Roadmap and next steps: docs/ROADMAP.md

# Project Structure

- `src/` — Framework-agnostic core engine (TypeScript, pnpm root)
- `src/cli/` — CLI runner with detailed logging for dev/iteration
- `src/negotiation/` — Collision resolution via multi-round agent negotiation
- `ui/` — React UI application (separate pnpm project, imports core via `@core/` alias)
- Two pnpm projects: root (`pnpm test`) and `ui/` (`cd ui && pnpm dev`)

# Development

```bash
pnpm test                    # run core tests (66 tests)

# CLI runner (reads .env for ZENMUX_API_KEY)
npx tsx src/cli/run.ts                              # real API, budget preset
npx tsx src/cli/run.ts --gateway smart-dummy         # offline testing
npx tsx src/cli/run.ts --preset premium --duration 120
npx tsx src/cli/run.ts --help                        # all options
```

Before each commit, make sure all the docs are up-to-date with the code.

# Key Design Decisions

- **No speech collision / interruption** — only gap collisions exist; when someone is speaking, others wait
- **No "speaking" phase** — reducer stays in `turn_gap`; single speaker commits text + turn_ended atomically
- **Last speaker sits out** — the agent who just spoke is skipped in the next iteration, giving others a chance
- **Collision → negotiation** — when multiple agents speak simultaneously, a multi-round negotiation determines who gets the floor; each agent decides "insist" or "yield" based on full discussion context
- **All-yield retriggers** — if everyone yields in negotiation, all candidates re-enter the next round (up to 5 rounds max)
- **@mention awareness** — negotiation prompts detect if an agent was recently @-mentioned and hint they should speak
- Domain `AgentOutput` has no `error` variant — errors are retried once per agent, then converted to silence
- `finishReason: "max_tokens"` is treated as speech (not an error), since models now produce full responses
- Engine returns `{ ok: true }` always (errors → silence); never `{ ok: false }` to the runner
- Normalization strips parenthetical actions, speaker prefixes, history hallucinations, and fragments < 4 chars
- Verbatim repeat detection across ALL turns and collision utterances → converted to silence
- Per-model thinking config: models with `thinking: true` get 10x max_tokens to accommodate reasoning overhead
- Collision virtual time = `人数 × 0.5s` (not proportional to utterance length)
- History projection includes timestamps and shows negotiation outcomes (who yielded, who spoke)
