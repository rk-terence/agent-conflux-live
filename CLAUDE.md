# Docs

- Architecture and system design: docs/ARCHITECTURE.md
- Provider integration notes and model behavior: docs/PROVIDER.md

# Project Structure

- `src/` — Framework-agnostic core engine (TypeScript, pnpm root)
- `ui/` — React UI application (separate pnpm project, imports core via `@core/` alias)
- Two pnpm projects: root (`pnpm test`) and `ui/` (`cd ui && pnpm dev`)

# Development

```bash
pnpm test                    # run core tests (100 tests)
cd ui && pnpm dev            # start UI dev server (localhost:5173)
```

# Key Design Decisions

- Domain `AgentOutput` has no `error` variant — errors are handled by engine before reaching reducer
- `[silence]` in continuation mode → `end_of_turn` (documented exception in ARCHITECTURE.md)
- `finishReason: "max_tokens"` → error (truncated output violates sentence atomicity)
- `frozenHistorySnapshot` captures events BEFORE the speaker's first sentence
- End-of-turn iteration discards listener responses (they saw stale "someone speaking" context)
- Engine returns structured `{ ok: false, errors, debug }` on failure, never throws for gateway errors
