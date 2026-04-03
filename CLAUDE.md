# Documentation

README files are public-facing, including README.md (Chinese) and README_EN.md (English).
They should be checked (and updated if outdated) before every `git push`.

All other documentation is in the `docs/` folder. Each file has YAML frontmatter with `name`, `description`, and optional `references` fields — read the frontmatter to understand each doc's scope.

They should be checked (and updated if outdated) before every `git commit`.

# Development Workflow: Claude–Codex Review Loop

After completing each round of development work, follow this procedure **before** committing or pushing:

1. Update docs if the changes affect them.
2. Run `/adversarial-review` (or `/adversarial-review [focus text]`) to start a fresh Codex adversarial review. If the reviewer is unavailable, proceed directly to step 4.
3. Read the review feedback. If there are reasonable suggestions:
   - Implement the fixes.
   - Run `/adversarial-review --resume [focus text]` to report fixes and get re-checked. The `--resume` flag continues the most recent Codex task thread in this repo; omitting it starts a new review. Avoid running other Codex tasks between the initial review and the re-check.
   - Repeat this step until Codex has no further concerns.
   - If a suggestion conflicts with the docs, defer to the doc authority matrix above.
4. Commit (and push if requested).