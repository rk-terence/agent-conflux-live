#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPANION="$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs"
TEMPLATE="$SCRIPT_DIR/prompt-template.md"

MODE="${1:---fresh}"
shift || true
FOCUS_TEXT="${*:-}"
BG_FLAG=""

# Extract --background if present in remaining args
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--background" ]]; then
    BG_FLAG="--background"
  else
    ARGS+=("$arg")
  fi
done
FOCUS_TEXT="${ARGS[*]:-}"

case "$MODE" in
  --resume-last|--resume)
    if [[ -z "$FOCUS_TEXT" ]]; then
      FOLLOW_UP="Previous issues have been addressed. Re-check the latest changes. Run git diff and git diff --cached to see current state."
    else
      FOLLOW_UP="$FOCUS_TEXT Run git diff and git diff --cached to see current state."
    fi
    echo "$FOLLOW_UP" | exec node "$COMPANION" task --resume-last $BG_FLAG
    ;;
  --fresh)
    # Gather context
    STAT_UNSTAGED="$(git diff --stat 2>/dev/null || true)"
    STAT_STAGED="$(git diff --stat --cached 2>/dev/null || true)"
    if [[ -z "$STAT_UNSTAGED" && -z "$STAT_STAGED" ]]; then
      echo "No uncommitted changes to review." >&2
      exit 1
    fi

    # Build target label
    TARGET="$(echo "$STAT_UNSTAGED$STAT_STAGED" | tail -1 | sed 's/^ *//')"

    # Build prompt from template
    PROMPT_BODY="$(cat "$TEMPLATE")"
    PROMPT_BODY="${PROMPT_BODY//\{\{TARGET_LABEL\}\}/$TARGET}"
    if [[ -n "$FOCUS_TEXT" ]]; then
      PROMPT_BODY="${PROMPT_BODY//\{\{USER_FOCUS\}\}/$FOCUS_TEXT}"
    else
      PROMPT_BODY="${PROMPT_BODY//\{\{USER_FOCUS\}\}/No extra focus provided.}"
    fi

    FULL_PROMPT="Review the uncommitted changes in this repository. Run \`git diff\` and \`git diff --cached\` to see the full changes. Then perform the adversarial review below.

$PROMPT_BODY"

    echo "$FULL_PROMPT" | exec node "$COMPANION" task --fresh $BG_FLAG
    ;;
  *)
    echo "Usage: run.sh [--fresh|--resume-last|--resume] [--background] [focus text ...]" >&2
    exit 1
    ;;
esac
