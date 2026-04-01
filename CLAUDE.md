# Documentation

README files are public-facing, including README.md (Chinese) and README_EN.md (English).
They should be checked (and updated if outdated) before every `git push`.

All other documentations are in the `docs` folder:

- Architecture and system design: docs/ARCHITECTURE.md
- Provider integration notes and model behavior: docs/PROVIDER.md
- Roadmap and next steps: docs/ROADMAP.md

They should be checked (and updated if outdated) before every `git commit`.

# Project Structure

- `src/` — Framework-agnostic core engine (TypeScript, pnpm root)
- `src/cli/` — CLI runner with detailed logging for dev/iteration
- `src/negotiation/` — Collision resolution via multi-round agent negotiation
- `ui/` — React UI application (separate pnpm project, imports core via `@core/` alias)
- Two pnpm projects: root (`pnpm test`) and `ui/` (`cd ui && pnpm dev`)

## Architecture Note

For all core runtime and system-design decisions, follow `docs/ARCHITECTURE.md`.

This includes, but is not limited to:

- discussion loop and state invariants
- collision and negotiation behavior
- prompt structure and ownership boundaries
- history projection format
- normalization and failure-handling rules
- virtual-time rules
- model gateway boundaries

If `docs/ARCHITECTURE.md` and this section (in `CLAUDE.md`) appear inconsistent, treat `docs/ARCHITECTURE.md` as the _source of truth_ and update this section accordingly.

# Development Workflow: Claude–Codex Review Loop

After completing each round of development work, follow this procedure **before** committing or pushing:

1. Update `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/PROVIDER.md` if the changes affect them.
2. Request a Codex review of the current diff and a summary of changes (via `codex:codex-rescue` subagent or equivalent). If the reviewer is unavailable, proceed directly to step 3.
3. Read the review feedback, implement reasonable suggestions, then commit (and push if requested). If a suggestion conflicts with `docs/ARCHITECTURE.md`, defer to ARCHITECTURE.md.