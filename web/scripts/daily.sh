#!/bin/zsh
# Daily refresh, run on this Mac by launchd (no GitHub Actions needed). Each step logs and continues if one fails.
# Install: a LaunchAgent in ~/Library/LaunchAgents that runs this script with a daily StartCalendarInterval, loaded with
# `launchctl load`. launchd runs a missed job when the Mac wakes.
set -u
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG="$HOME/Library/Logs/model-behavior-daily.log"
step() { echo "== $(date '+%F %T') $*" >> "$LOG"; "$@" >> "$LOG" 2>&1 || echo "!! failed: $*" >> "$LOG"; }

# The database must be up; the site itself can be down.
step ./scripts/up.sh --no-site   # Colima VM, db, Ollama (the idle watcher stops them later)
# FEC first, on its own: on DEMO_KEY the day's ~10 api.data.gov calls go to the resumable donor backfill (committee
# scans are skipped on DEMO_KEY). It stops cleanly at the daily cap and exits 0; once every donor is done it makes no calls.
step npx tsx scripts/importers/fec.ts
step pnpm run import --skip=fec # LDA, Congress, Regulations.gov, blogs, Bluesky, state lobbying
step pnpm run sources       # re-check new sources and quotes (only unchecked URLs)
step pnpm run analyze         # label new or changed quotes with the local model
step pnpm run index           # rebuild the search table (Postgres full-text search)
echo "== $(date '+%F %T') done" >> "$LOG"
