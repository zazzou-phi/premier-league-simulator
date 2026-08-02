#!/bin/sh
set -e

DB_PATH="${DB_PATH:-/app/data/premier-league.db}"
PORT="${PORT:-2627}"
API_PORT="${API_PORT:-3123}"
SEED_FLAG=""

export NODE_ENV=production PORT API_PORT

if [ ! -f "$DB_PATH" ]; then
  echo "No database at $DB_PATH — seeding teams and fixtures."
  SEED_FLAG="--seed"
fi

# The engine owns SQLite; web/server.ts only proxies /api and /health to it.
cd /app/engine
./node_modules/.bin/tsx src/api/server.ts --port "$API_PORT" --db "$DB_PATH" $SEED_FLAG &
API_PID=$!

# Give seeding time to finish so the first page load does not hit a 503.
i=0
while [ "$i" -lt 60 ]; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "Engine API exited during startup." >&2
    wait "$API_PID"
    exit 1
  fi
  if node -e "fetch('http://127.0.0.1:${API_PORT}/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

cd /app/web
exec ./node_modules/.bin/tsx server.ts
