#!/bin/zsh
# Start everything the site needs: Colima VM, Postgres and search, Ollama (model loads on first use), and the site.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
colima status >/dev/null 2>&1 || colima start
docker compose -f ../docker-compose.yml up -d db search
# The model leaves memory after one idle minute.
pgrep -x ollama >/dev/null || (OLLAMA_KEEP_ALIVE=1m nohup ollama serve >/dev/null 2>&1 &)
if [[ "${1:-}" != "--no-site" ]] && ! pgrep -f "next start -H localhost -p 3000" >/dev/null; then
  nohup pnpm exec next start -H localhost -p 3000 >> "$HOME/Library/Logs/model-behavior-site.log" 2>&1 &
  echo "site: http://localhost:3000"
fi
