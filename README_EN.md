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

**Collision negotiation.** When multiple models speak simultaneously, each decides "insist" or "yield" through multi-round negotiation until only one remains. This reveals each model's personality through their negotiation behavior.

**Turn rotation.** The model that just spoke sits out one round, giving others a chance.

**Virtual time.** Speaking consumes virtual time (based on token count), thinking (API calls) consumes zero virtual time.

**First-person perspective.** Each model sees conversation history from its own point of view — what they said, what they wanted to say during a collision, and who yielded.

## Tech Stack

- TypeScript (framework-agnostic core engine)
- React + Vite + Tailwind CSS (UI)
- [ZenMux](https://zenmux.ai) as LLM aggregation gateway (one API key for all models)

## Quick Start

```bash
# Install dependencies
pnpm install
cd ui && pnpm install && cd ..

# Run tests
pnpm test

# CLI mode (recommended for development)
echo "ZENMUX_API_KEY=your-key" > .env
npx tsx src/cli/run.ts --topic "Will AI replace human jobs?"

# Offline testing (no API key needed)
npx tsx src/cli/run.ts --gateway smart-dummy

# Start UI (experimental, known issues — CLI recommended)
cd ui && pnpm dev
```

### CLI Tool

The CLI is the recommended way to develop and iterate. It provides:

- Real-time colored terminal output (speech prominent, collisions and negotiations indented)
- Detailed log files (`.log` human-readable + `.jsonl` for programmatic analysis)
- Full prompts and raw responses for every model call
- Round-by-round negotiation records

```bash
npx tsx src/cli/run.ts --help              # all options
npx tsx src/cli/run.ts --preset premium    # use stronger models
npx tsx src/cli/run.ts --duration 120      # set discussion duration
```

### Using Real Models

1. Sign up at [ZenMux](https://zenmux.ai) to get an API key
2. Create a `.env` file: `ZENMUX_API_KEY=your-key`
3. `npx tsx src/cli/run.ts` (CLI recommended)

## Project Structure

```
src/                          # Framework-agnostic core engine
  domain/                     # State types, reducer, session init
  engine/                     # Single-iteration orchestrator
  negotiation/                # Collision resolution: multi-round insist/yield
  history/                    # Perspective-specific transcript projection
  prompting/                  # Prompt templates, renderer, builders
  model-gateway/              # Gateway interface, Dummy + SmartDummy + ZenMux
  normalization/              # Raw output cleaning and classification
  runner/                     # Discussion loop driver
  cli/                        # CLI runner + logging

ui/                           # React application (experimental, known issues pending, separate pnpm project)
```

## Current Status

Core engine complete with all tests passing. Collision negotiation mechanism works effectively and discussions progress smoothly. The CLI tool provides full prompt/response logging for iterative optimization.

## Docs

- [System Architecture](./docs/ARCHITECTURE.md) — module boundaries, data flow, design constraints
- [Provider Integration Notes](./docs/PROVIDER.md) — API gotchas, model behavior observations
- [Roadmap](./docs/ROADMAP.md) — planned features

## License

MIT
