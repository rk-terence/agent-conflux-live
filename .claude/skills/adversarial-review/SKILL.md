---
name: adversarial-review
description: Run an adversarial code review via Codex that challenges design choices, assumptions, and failure modes. Use before committing to pressure-test changes.
argument-hint: "[--resume] [--fresh] [--background] [focus text ...]"
---

Run an adversarial review of uncommitted changes using the wrapper script.

Raw arguments:
`$ARGUMENTS`

## Parse arguments

Extract from `$ARGUMENTS`:
- **Flags**: `--resume`, `--fresh`, `--background` (all optional)
- **Focus text**: everything remaining after removing flags, or empty string if none

If both `--resume` and `--fresh` are given, prefer `--resume` and ignore `--fresh`.
If neither is given, default to `--fresh`.

## Execute

Run the wrapper script with the parsed flags and focus text:

```
${CLAUDE_SKILL_DIR}/run.sh <--fresh|--resume> [--background] [focus text]
```

The script handles context gathering, prompt template assembly, and Codex invocation internally.

## Background mode

If `--background` was included, the review runs in the background. Tell the user:
- `/codex:status` — check progress
- `/codex:result` — retrieve results when done
- `/codex:cancel` — cancel if needed

## Error handling

If the script fails (non-zero exit), report the error and suggest the user check that the codex plugin is installed.

## Output rules

- Return the command's stdout verbatim. Do not paraphrase, summarize, or add commentary.
- Do not fix any issues mentioned in the review — only report them.
