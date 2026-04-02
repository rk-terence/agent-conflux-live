# Documentation

README files are public-facing, including README.md (Chinese) and README_EN.md (English).
They should be checked (and updated if outdated) before every `git push`.

All other documentations are in the `docs` folder:

- Top-level design specification: docs/DESIGN.md
- Architecture, system design, and implementation details conforming to the design specification: docs/ARCHITECTURE.md
- Provider integration notes and model behavior: docs/PROVIDER.md

They should be checked (and updated if outdated) before every `git commit`.

# Development Workflow: Claude–Codex Review Loop

After completing each round of development work, follow this procedure **before** committing or pushing:

1. Update docs if the changes affect them.
2. Request a Codex review of the current diff (via `codex:codex-rescue` subagent, using `--fresh` for the first review). If the reviewer is unavailable, proceed directly to step 4.
3. Read the review feedback. If there are reasonable suggestions:
   - Implement the fixes.
   - Report what was fixed back to Codex (via `codex:codex-rescue` with `--resume` to preserve review context).
   - Read Codex's response. Repeat this step until Codex has no further concerns.
   - If a suggestion conflicts with the docs, defer to the doc authority matrix above.
4. Commit (and push if requested).