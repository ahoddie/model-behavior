#!/bin/zsh -l
# Archive every source URL on the Wayback Machine, retry failures after a pause, then delete rows that still have no copy
# (rule 1). The prune step stops without deleting if any table would lose more than 20% of its rows.
set -u
cd "$(dirname "$0")/.."
echo "== pass 1 $(date)"; pnpm -s archive; pnpm -s money:archive
echo "== waiting 2h before retrying failures $(date)"; sleep 7200
echo "== pass 2 $(date)"; pnpm -s archive; pnpm -s money:archive
echo "== prune $(date)"; npx tsx scripts/prune-unarchived.ts
echo "== done $(date)"
