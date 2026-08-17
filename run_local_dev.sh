#!/bin/bash
# Run backend + frontend locally (outside Docker) — needed for the
# "Claude Code (local CLI)" AI provider, which uses the `claude` binary
# on this machine. Docker containers can't reach it.
#
# Prereqs: backend/.venv exists, the dev Postgres container is running
# (marketing_ai_pg on port 5436), and redis is reachable.
#
# Usage: ./run_local_dev.sh   then open http://localhost:5173

set -e
cd "$(dirname "$0")"

export DATABASE_URL="${DATABASE_URL:-postgresql://marketing:marketing_dev_pw@localhost:5436/marketing_ai}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/5}"
export JWT_SECRET="${JWT_SECRET:-dev-only-change-me-before-production}"
BACKEND_PORT="${LOCAL_BACKEND_PORT:-8010}"

echo "Starting backend on :$BACKEND_PORT (schema auto-applies on startup)..."
(cd backend && .venv/bin/uvicorn api.main:app --host 127.0.0.1 --port "$BACKEND_PORT") &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null' EXIT

sleep 3
echo "Starting frontend dev server on :5173 (proxying /api to :$BACKEND_PORT)..."
VITE_BACKEND_URL="http://localhost:$BACKEND_PORT" npm run dev
