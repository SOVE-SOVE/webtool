#!/usr/bin/env bash
#
# Starts Web Design OS for local development on macOS: Postgres
# (via Docker), the API, and the web app — then opens the app in
# your default browser. See scripts/README.md.
#
# Usage: double-click this file in Finder (if .sh is set to open with
# Terminal), or run it from a terminal:
#   ./scripts/start-mac.sh
#
# Assumes the one-time setup in the repo README's "Local development"
# section has already been done (apps/api/.venv, apps/api/.env,
# apps/web/node_modules, apps/web/.env.local all exist) — this script
# starts services, it doesn't provision them.

set -uo pipefail
# Not `-e`: this script's whole job is to detect a failure at each step
# and report it clearly, not to vanish on the first non-zero exit.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"
LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

API_DIR="$REPO_ROOT/apps/api"
WEB_DIR="$REPO_ROOT/apps/web"
API_PORT=8000
WEB_PORT=3000
API_URL="http://localhost:$API_PORT"
WEB_URL="http://localhost:$WEB_PORT"

API_PID_FILE="$RUN_DIR/api.pid"
WEB_PID_FILE="$RUN_DIR/web.pid"
API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"

info() { echo "-> $1"; }
ok()   { echo "[OK] $1"; }

fail() {
  echo ""
  echo "[FAILED] $1"
  if [ -n "${2:-}" ] && [ -f "$2" ]; then
    echo "   Last lines of $2:"
    tail -n 20 "$2" | sed 's/^/   /'
  fi
  echo ""
  exit 1
}

# Polls a command every second until it succeeds or the timeout elapses.
wait_for() {
  local timeout="$1"; shift
  local waited=0
  until "$@" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -ge "$timeout" ] && return 1
  done
  return 0
}

url_up() { curl -fs --max-time 3 -o /dev/null "$1" 2>/dev/null; }

echo ""
echo "Web Design OS - starting local development environment"
echo ""

# --- 1. Docker + Postgres --------------------------------------------
info "Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker isn't installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and run this again."
fi

if ! docker info >/dev/null 2>&1; then
  info "Docker Desktop isn't running - starting it..."
  open -a Docker 2>/dev/null \
    || fail "Couldn't launch Docker Desktop automatically. Start it yourself, wait for it to finish starting, then run this again."
  wait_for 60 docker info \
    || fail "Docker Desktop didn't finish starting within 60s. Open it manually, wait for it to settle, then run this again."
fi
ok "Docker is running"

info "Starting Postgres..."
( cd "$REPO_ROOT" && docker compose up -d postgres ) \
  || fail "docker compose up -d postgres failed. See the output above."

wait_for 30 bash -c "cd '$REPO_ROOT' && docker compose exec -T postgres pg_isready -U webdesignos -d webdesignos" \
  || fail "Postgres didn't become ready within 30s."
ok "Postgres is ready"

# --- 2. API -------------------------------------------------------------
if url_up "$API_URL/health"; then
  ok "API already running at $API_URL - leaving it as is"
else
  [ -x "$API_DIR/.venv/bin/uvicorn" ] \
    || fail "apps/api isn't set up yet (no .venv). Follow the 'Local development' steps in the repo README first."
  [ -f "$API_DIR/.env" ] \
    || fail "apps/api/.env is missing. Copy apps/api/.env.example to apps/api/.env and fill it in first - see the repo README."
  if lsof -i ":$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Something else is already listening on port $API_PORT (and it didn't answer $API_URL/health, so it isn't this app's API). Stop it, or free the port, and try again."
  fi

  info "Starting the API..."
  ( cd "$API_DIR" && nohup ./.venv/bin/uvicorn app.main:app --reload --port "$API_PORT" >"$API_LOG" 2>&1 & echo $! >"$API_PID_FILE" )

  wait_for 30 curl -fs --max-time 3 -o /dev/null "$API_URL/health" \
    || fail "The API didn't respond at $API_URL/health within 30s." "$API_LOG"
  ok "API is ready at $API_URL"
fi

# --- 3. Web app -----------------------------------------------------------
if url_up "$WEB_URL"; then
  ok "Web app already running at $WEB_URL - leaving it as is"
else
  [ -x "$WEB_DIR/node_modules/.bin/next" ] \
    || fail "apps/web isn't set up yet (no node_modules). Run 'npm install' in apps/web first - see the repo README."
  [ -f "$WEB_DIR/.env.local" ] \
    || fail "apps/web/.env.local is missing. Copy apps/web/.env.local.example to apps/web/.env.local first - see the repo README."
  if lsof -i ":$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Something else is already listening on port $WEB_PORT. Stop it, or free the port, and try again."
  fi

  info "Starting the web app..."
  # Calling the `next` binary directly (not `npm run dev`) so the pid we
  # capture is the real dev-server process, not an npm wrapper around it.
  ( cd "$WEB_DIR" && nohup ./node_modules/.bin/next dev --port "$WEB_PORT" >"$WEB_LOG" 2>&1 & echo $! >"$WEB_PID_FILE" )

  wait_for 60 curl -fs --max-time 3 -o /dev/null "$WEB_URL" \
    || fail "The web app didn't respond at $WEB_URL within 60s." "$WEB_LOG"
  ok "Web app is ready at $WEB_URL"
fi

# --- 4. Open the browser --------------------------------------------------
info "Opening $WEB_URL/login ..."
open "$WEB_URL/login"

echo ""
ok "Web Design OS is running."
echo "   API: $API_URL   (log: $API_LOG)"
echo "   Web: $WEB_URL   (log: $WEB_LOG)"
echo "   Run scripts/stop-mac.sh to shut everything down."
echo ""
