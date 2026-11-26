#!/bin/zsh
# Run by launchd every 10 minutes. When nothing has used the database for two checks in a row (about 20 minutes)
# and no job is running, stop the Colima VM (Postgres, search) and Ollama so they stop using memory.
# Bring everything back with `pnpm up` (scripts/up.sh). The 3:15 daily job starts them on its own.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
STATE="$HOME/Library/Caches/model-behavior-idle"
LOG="$HOME/Library/Logs/model-behavior-idle.log"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
busy() { log "busy: $*"; rm -f "$STATE"; exit 0; }

colima status >/dev/null 2>&1 || { rm -f "$STATE"; exit 0; }   # already stopped

# Any tsx/node script (imports, archive, analyze, tests in other projects) or a build counts as work.
pgrep -f "tsx|next build|archive-then-prune|daily.sh" >/dev/null && busy "script running"
# A model loaded in Ollama means a job is mid-run.
[[ -n "$(ollama ps 2>/dev/null | sed 1d)" ]] && busy "model loaded"
# Any container doing real work (including other projects in the same VM).
docker stats --no-stream --format '{{.CPUPerc}}' 2>/dev/null | tr -d '%' | awk '$1>5{f=1} END{exit !f}' && busy "container cpu"

# Database activity: compare the commit counter with the last check. Our own query adds one.
N=$(docker exec model-behavior-db-1 psql -U mb -d model_behavior -Atc "select sum(xact_commit) from pg_stat_database" 2>/dev/null)
[[ -z "$N" ]] && exit 0
if [[ -f "$STATE" ]]; then
  read PREV COUNT < "$STATE"
  if (( N - PREV <= 3 )); then COUNT=$((COUNT + 1)); else COUNT=0; fi
else COUNT=0; fi
echo "$N $COUNT" > "$STATE"
(( COUNT < 2 )) && exit 0

log "idle for two checks; stopping site, Ollama and Colima"
pkill -f "next start -H localhost -p 3010" 2>/dev/null
pkill -x ollama 2>/dev/null
colima stop >> "$LOG" 2>&1
rm -f "$STATE"
