#!/bin/zsh
# Daily refresh, run on this Mac by launchd (no GitHub Actions needed). Each step logs and continues if one fails.
# Install: see PLAN.md, "Keeping it updated".
set -u
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG="$HOME/Library/Logs/model-behavior-daily.log"
step() { echo "== $(date '+%F %T') $*" >> "$LOG"; "$@" >> "$LOG" 2>&1 || echo "!! failed: $*" >> "$LOG"; }

# The database and search must be up; the site itself can be down.
step ./scripts/up.sh --no-site   # Colima VM, db, search, Ollama (the idle watcher stops them later)
step pnpm import            # FEC, LDA, Congress, Regulations.gov, blogs, Bluesky, state lobbying
step pnpm run sources       # re-check new sources and quotes (only unchecked URLs)
step pnpm analyze           # label new or changed quotes with the local model
step pnpm index             # rebuild search
echo "== $(date '+%F %T') done" >> "$LOG"
