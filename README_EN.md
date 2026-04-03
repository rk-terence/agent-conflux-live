> [中文版](./README.md)

# AI Roundtable

A decentralized multi-model free discussion experiment platform.

Multiple large language models sit around a virtual roundtable and freely discuss a topic. No moderator, no fixed turn order. Each model autonomously decides when to speak, when to stay silent, and what to say.

When multiple models speak at once, they negotiate among themselves who goes first — just like a real roundtable discussion.

This is a social experiment between large language models.

## What to Observe

- Who dominates the discussion, who stays quiet
- How models negotiate through simultaneous speech (collision) to decide who speaks
- Different model "personalities": who is assertive, who yields
- How models respond when @-mentioned by others

## Core Design

**One loop.** The entire engine is a single repeating iteration cycle. Collision, silence, negotiation — all natural outcomes of the same loop.

**Full speech per call.** Each API call produces a complete speech, not sentence-by-sentence fragments.

**Collision negotiation.** When multiple models speak simultaneously, their pre-declared insistence levels (low/mid/high) are compared first — most collisions resolve with zero extra API calls. Ties escalate through multi-round negotiation, bystander voting, and random tiebreak — a four-tier system that guarantees convergence. This reveals each model's personality through their negotiation behavior.

**Turn rotation.** The model that just spoke sits out one round, giving others a chance.

**Virtual time.** Speaking consumes virtual time (based on token count), thinking (API calls) consumes zero virtual time.

**First-person perspective.** Each model sees conversation history from its own point of view — what they said, what they wanted to say during a collision, and who yielded.

## Tech Stack

- TypeScript (strict mode, ESM modules)
- Node.js ≥ 20
- Vitest (testing)
- [ZenMux](https://zenmux.ai) as LLM aggregation gateway (one API key for all models)

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
pnpm build
```

### Running a Discussion

1. Sign up at [ZenMux](https://zenmux.ai) to get an API key
2. Create a `.env` file: `ZENMUX_API_KEY=your-key`
3. Edit a config file (see `examples/config.json`)
4. Run:

```bash
# Using compiled output
node dist/cli.js examples/config.json

# Or run TypeScript directly
npx tsx src/cli.ts examples/config.json

# Validate config only (no actual run)
node dist/cli.js examples/config.json --dry-run

# Custom log directory
node dist/cli.js examples/config.json --log-dir ./output
```

The terminal shows a human-readable live discussion feed. A comprehensive NDJSON log file is also written to `logs/`, where every event carries a `run_id` and `schema_version`. The log records API call lifecycle, normalization paths, utterance cleaning decisions, round-by-round collision resolution, interruption evaluation details, and inner monologues. See [Logging Event Schema](./docs/LOGGING.md) for the full format.

### Offline Log Analysis

After a run, analyze the log offline to produce a structured summary with L0/L1 classification:

```bash
node dist/analysis/cli.js --input logs/discussion-xxx.ndjson
```

Outputs `run-summary.json` with event counts, API stats, normalization/filtering/collision/interruption aggregates, and:
- **L0 Infra**: Did the run complete cleanly? (pass/fail)
- **L1 Mechanics**: Were roundtable behaviors healthy? (pass/fail)

See [Run Summary docs](./docs/RUN_SUMMARY.md) for details.

## Project Structure

```
src/
  cli.ts                    CLI entry point — load config, run discussion, write logs
  index.ts                  Programmatic API — create session, run loop, emit results
  types.ts                  All shared type definitions
  config.ts                 SessionConfig schema, defaults, validation

  core/                     Discussion loop, collision resolution, interruption, dedup
  state/                    Session state, agent state, virtual clock
  prompt/                   Prompt assembly, system prompts, turn directives, history projection, hints, template
  llm/                      LLMClient interface, per-provider adapters, retry
  normalize/                Mode-based normalization (JSON extraction, utterance cleaning, per-mode normalizers)
  util/                     Token counting, sentence splitting, name list formatting
  analysis/                 Offline log analysis: run summary generation, L0/L1 classification
examples/
  config.json               Example configuration file
```

## Current Status

Core engine complete, CLI operational. Iterating on improvements.

## Docs

- [Design Specification](./docs/DESIGN.md) — system behavior, semantic constraints, prompt wording, history rendering, normalization rules
- [System Architecture](./docs/ARCHITECTURE.md) — module boundaries, type definitions, data flow, algorithms
- [Logging Event Schema](./docs/LOGGING.md) — NDJSON event schema, field definitions, event correlation
- [Run Summary](./docs/RUN_SUMMARY.md) — offline analysis output schema, L0/L1 classification rules
- [Provider Integration Notes](./docs/PROVIDER.md) — API gotchas, model behavior observations

## License

MIT
