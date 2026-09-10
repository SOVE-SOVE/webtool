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
JOBS_PID_FILE="$RUN_DIR/jobs.pid"
API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"
JOBS_LOG="$LOG_DIR/jobs.log"

# The commit each long-running process was last (re)started against, so a
# `git pull` / branch switch can be told apart from a plain restart. The
# web server's cache and the job poller both go stale on a code change
# but neither notices on its own — see sections 2b and 3.
JOBS_HEAD_FILE="$RUN_DIR/jobs-head"
WEB_HEAD_FILE="$RUN_DIR/web-head"
CURRENT_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"

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

url_up() { curl -fs -o /dev/null "$1" 2>/dev/null; }

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

# --- 1b. Database migrations -----------------------------------------
# Applied on every start so a `git pull` that brought new migrations
# can't leave the API pointed at a stale schema — the failure mode is a
# page 500ing with `relation "..." does not exist`. `alembic upgrade
# head` is a no-op when the DB is already current.
if [ -x "$API_DIR/.venv/bin/alembic" ]; then
  info "Applying database migrations..."
  ( cd "$API_DIR" && ./.venv/bin/alembic upgrade head ) \
    || fail "Database migrations failed ('alembic upgrade head' — see the output above)."
  ok "Database schema is up to date"
else
  info "Skipping migrations (apps/api/.venv not set up yet)"
fi

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

  wait_for 30 curl -fs -o /dev/null "$API_URL/health" \
    || fail "The API didn't respond at $API_URL/health within 30s." "$API_LOG"
  ok "API is ready at $API_URL"
fi

# --- 2b. Job runner ---------------------------------------------------------
# The automation pipeline (discovery -> research -> analysis -> scoring,
# outreach/follow-up drafting, website generation, QA — see
# apps/api/app/jobs/handlers.py) only actually runs while this poller
# process is alive; the API enqueues jobs either way, but nothing claims
# them without it. No health endpoint (it's not a server).
#
# Unlike the API, the poller has no --reload: a `git pull` that adds or
# changes a job handler leaves a still-running poller on stale code — the
# symptom is jobs failing with "No handler registered" while whatever
# queued them sits forever in its in-progress state. So restart it when
# HEAD has moved since it was last started.
#
# Liveness is read straight from the process table (`pgrep`), not the pid
# file — a recycled pid otherwise reads as "still up", and a partially
# stale environment can leave two pollers racing to claim the same jobs.
# The `[-]m` matches a literal "-m" while keeping the pattern from
# matching this pgrep itself.
runner_pids="$(pgrep -f "[-]m app.jobs.runner" 2>/dev/null || true)"
runner_n="$(printf '%s' "$runner_pids" | grep -c . || true)"

if [ "$runner_n" = "1" ] \
    && [ "$CURRENT_HEAD" = "$(cat "$JOBS_HEAD_FILE" 2>/dev/null || echo none)" ]; then
  ok "Job runner already running on current code - leaving it as is"
else
  if [ "$runner_n" != "0" ]; then
    info "Restarting the job runner (code changed since it started, or more than one was running)..."
    # shellcheck disable=SC2086
    kill $runner_pids 2>/dev/null
    sleep 1
  else
    info "Starting the job runner..."
  fi
  rm -f "$JOBS_PID_FILE"
  # `exec` so the recorded pid is the python process itself, not a
  # short-lived subshell wrapper that stop-mac.sh would fail to match.
  ( cd "$API_DIR" && exec nohup ./.venv/bin/python -m app.jobs.runner >"$JOBS_LOG" 2>&1 ) &
  echo $! >"$JOBS_PID_FILE"
  sleep 1
  if kill -0 "$(cat "$JOBS_PID_FILE" 2>/dev/null || echo 0)" 2>/dev/null; then
    echo "$CURRENT_HEAD" >"$JOBS_HEAD_FILE"
    ok "Job runner is running (log: $JOBS_LOG)"
  else
    echo "[WARN] Job runner didn't stay running - check $JOBS_LOG. The app still works; scheduled/background automation won't."
    rm -f "$JOBS_PID_FILE"
  fi
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

  # Turbopack builds its dev route table from a cache under .next, and it
  # doesn't reliably pick up route files that arrived via `git pull` or a
  # branch switch rather than an editor save — the symptom is a new page
  # 404ing even though its file is on disk. A leftover `next build` output
  # (BUILD_ID) in the same .next confuses routing too. So drop the cache
  # whenever HEAD has moved since the last web start, or a production
  # build is present. An unchanged HEAD (a plain restart, or local edits
  # only) keeps the cache — Turbopack handles live edits fine.
  NEXT_CACHE="$WEB_DIR/.next"
  if [ -d "$NEXT_CACHE" ] && { [ -f "$NEXT_CACHE/BUILD_ID" ] \
      || [ "$CURRENT_HEAD" != "$(cat "$WEB_HEAD_FILE" 2>/dev/null || echo none)" ]; }; then
    info "Clearing the Next.js cache (code changed since last start — prevents stale-route 404s)..."
    rm -rf "$NEXT_CACHE"
  fi

  info "Starting the web app..."
  # Calling the `next` binary directly (not `npm run dev`) so the pid we
  # capture is the real dev-server process, not an npm wrapper around it.
  ( cd "$WEB_DIR" && nohup ./node_modules/.bin/next dev --port "$WEB_PORT" >"$WEB_LOG" 2>&1 & echo $! >"$WEB_PID_FILE" )

  wait_for 60 curl -fs -o /dev/null "$WEB_URL" \
    || fail "The web app didn't respond at $WEB_URL within 60s." "$WEB_LOG"
  ok "Web app is ready at $WEB_URL"
  echo "$CURRENT_HEAD" >"$WEB_HEAD_FILE"
fi

# --- 4. Open the browser --------------------------------------------------
info "Opening $WEB_URL/login ..."
open "$WEB_URL/login"

echo ""
ok "Web Design OS is running."
echo "   API: $API_URL   (log: $API_LOG)"
echo "   Web: $WEB_URL   (log: $WEB_LOG)"
echo "   Job runner: background automation (log: $JOBS_LOG)"
echo "   Run scripts/stop-mac.sh to shut everything down."
echo ""
