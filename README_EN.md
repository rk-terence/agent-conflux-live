> [中文版](./README.md)

# AI Roundtable

A decentralized multi-model free discussion experiment platform.

Multiple large language models sit around a virtual roundtable and freely discuss a topic. No moderator, no fixed turn order. Each model autonomously decides when to speak, when to stay silent, and what to say.

This is a social experiment between large language models.

## What to Observe

- Who dominates the discussion, who stays quiet
- Who interrupts others, who yields
- How models self-coordinate after simultaneous speech (collision)
- How different model "personalities" emerge through conversation

## Core Design

**One loop.** The entire engine is a single repeating iteration cycle. Collision, silence, interruption — all natural outcomes of the same loop.

**Sentence as atomic unit.** Each API call produces at most one sentence. This is the fundamental clock tick of the simulation.

**Virtual time.** Speaking consumes virtual time (based on token count), thinking (API calls) consumes zero virtual time. Silence grows exponentially.

**First-person perspective.** Each model sees conversation history from its own point of view.

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

# Start UI
cd ui && pnpm dev
```

Open `http://localhost:5173` and select Demo mode (simulated data, no API key needed) to try it out.

### Using Real Models

1. Sign up at [ZenMux](https://zenmux.ai) to get an API key
2. In the UI, switch to **ZenMux** mode
3. Enter your API key, select Budget or Premium preset
4. Choose a topic and start the discussion

## Project Structure

```
src/                          # Framework-agnostic core engine
  domain/                     # State types, reducer, session init
  engine/                     # Single-iteration orchestrator
  history/                    # Perspective-specific transcript projection
  prompting/                  # System prompt, call input builders
  model-gateway/              # Gateway interface, Dummy + ZenMux implementations
  normalization/              # Raw output → AgentOutput classification
  runner/                     # Discussion loop driver

ui/                           # React application (separate pnpm project)
  src/
    hooks/useDiscussion.ts    # React hook bridging runner ↔ components
    components/
      SetupScreen.tsx         # Model selection, topic, duration config
      DiscussionScreen.tsx    # Top bar, view toggle, debug panel
      RoundtableView.tsx      # Circular table with avatars + subtitle bubbles
      ListView.tsx            # Chronological event timeline
```

## Current Status

Core engine complete with 100 passing tests. UI supports both Demo mode and real API mode via ZenMux.

**Known issues:**

- Simultaneous speech (collision) occurs too frequently — turn-taking mechanism needs further optimization
- Some models tend toward meta-conversation rather than substantive discussion — prompt tuning in progress
- See [docs/PROVIDER.md](./docs/PROVIDER.md) for details

## Docs

- [System Architecture](./docs/ARCHITECTURE.md) — module boundaries, data flow, design constraints
- [Provider Integration Notes](./docs/PROVIDER.md) — API gotchas, model behavior observations, prompt tuning

## License

MIT
