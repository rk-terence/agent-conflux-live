# adversarial-review skill

Adversarial code review gate for the Claude-Codex review loop defined in `CLAUDE.md`.

## Why this exists

The [codex plugin](https://github.com/anthropics/claude-code-plugins) ships a built-in `/codex:adversarial-review` command, but it is one-shot — it cannot resume a previous review session. The workflow in `CLAUDE.md` requires iterative review: review, fix, re-check, repeat. That needs session continuity.

This skill wraps the same codex-companion runtime but uses its `task` subcommand instead of the native `adversarial-review` subcommand. The `task` mode supports `--resume-last`, which continues the previous Codex thread so the reviewer retains context across rounds.

## Upstream dependency

Requires the **openai-codex** Claude Code plugin installed at:

```
~/.claude/plugins/marketplaces/openai-codex/plugins/codex/
```

Specifically, this skill calls:

```
~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs
```

via the `task` subcommand. The companion manages Codex thread lifecycle, background job tracking, and session persistence.

## File structure

```
.claude/skills/adversarial-review/
├── README.md              # This file
├── SKILL.md               # Skill definition — parses flags and delegates to run.sh
├── run.sh                 # Wrapper script — assembles prompt, gathers git context, invokes companion
└── prompt-template.md     # Adversarial review prompt template (mirrors the codex plugin's built-in)
```

## Usage

```
/adversarial-review [focus text]            # Fresh review of uncommitted changes
/adversarial-review --resume [focus text]   # Continue previous review session
/adversarial-review --background [...]      # Run in background
```

## Design decisions

**`task` over `adversarial-review` subcommand** — The companion's native `adversarial-review` subcommand gathers repo context server-side and feeds it as `{{REVIEW_INPUT}}`. The `task` subcommand instead lets Codex run `git diff` itself, which is equivalent but supports `--resume-last` for session continuity.

**Wrapper script (`run.sh`)** — Prompt template assembly happens inside the shell script, not in the skill definition. This keeps the Bash command short enough to match Claude Code's permission pattern (`Bash(*adversarial-review/run.sh*)`), avoiding manual approval on every invocation.

**Prompt template tracks upstream** — `prompt-template.md` mirrors the codex plugin's built-in adversarial prompt at `~/.claude/plugins/.../prompts/adversarial-review.md`. Changes upstream should be reflected here.

## Limitations

- `--resume` uses `--resume-last`, which resumes the most recent Codex task thread in the workspace — not a pinned review thread. If another Codex task runs between the initial review and re-check, resume may attach to the wrong session.
- The `.claude/` directory must be committed for the skill to be available on other machines.
