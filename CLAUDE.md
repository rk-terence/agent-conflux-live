# Documentation

README files are public-facing, including README.md (Chinese) and README_EN.md (English).
They should be checked (and updated if outdated) before every `git push`.

All other documentations are in the `docs` folder:

- Architecture, system design, and implementation details: docs/ARCHITECTURE.md
- Prompting specification (prompt structure, history format, templates, normalization): docs/PROMPTING.md
- Provider integration notes and model behavior: docs/PROVIDER.md
- Roadmap and next steps: docs/ROADMAP.md

They should be checked (and updated if outdated) before every `git commit`.

## Doc Authority Matrix

| Domain | Source of truth | Contains |
|--------|----------------|----------|
| System prompt wording, turn directive wording, history projection format, response normalization rules | `docs/PROMPTING.md` | Prompt spec — code must conform to it |
| System design, module boundaries, implementation details | `docs/ARCHITECTURE.md` | Architecture and implementation |
| Model behavior observations, API integration | `docs/PROVIDER.md` | Empirical notes, not guarantees |
| Planned work | `docs/ROADMAP.md` | Future work only, not current guarantees |

# Project Structure

- `src/` — Framework-agnostic core engine (TypeScript, pnpm root)
- `src/cli/` — CLI runner with detailed logging for dev/iteration
- `src/negotiation/` — Collision resolution via multi-round agent negotiation
- `ui/` — React UI application (separate pnpm project, imports core via `@core/` alias)
- Two pnpm projects: root (`pnpm test`) and `ui/` (`cd ui && pnpm dev`)

# Development Workflow: Claude–Codex Review Loop

After completing each round of development work, follow this procedure **before** committing or pushing:

1. Update `docs/ARCHITECTURE.md`, `docs/PROMPTING.md`, `docs/ROADMAP.md`, and `docs/PROVIDER.md` if the changes affect them.
2. Request a Codex review of the current diff (via `codex:codex-rescue` subagent, using `--fresh` for the first review). If the reviewer is unavailable, proceed directly to step 4.
3. Read the review feedback. If there are reasonable suggestions:
   - Implement the fixes.
   - Report what was fixed back to Codex (via `codex:codex-rescue` with `--resume` to preserve review context).
   - Read Codex's response. Repeat this step until Codex has no further concerns.
   - If a suggestion conflicts with the docs, defer to the doc authority matrix above.
4. Commit (and push if requested).