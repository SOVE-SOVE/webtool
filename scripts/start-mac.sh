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

# shellcheck source=lib/job_runner_health.sh
source "$SCRIPT_DIR/lib/job_runner_health.sh"

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
# The job runner does not reload itself. A commit-only check misses local
# edits to settings, prompts, and .env, leaving it on the old AI model.
# Hash the files it runs so another start picks up those edits too.
JOBS_CODE_FINGERPRINT="$({
  printf '%s\n' "$CURRENT_HEAD"
  find "$API_DIR/app" -type f \( -name '*.py' -o -name '*.md' \) -print0 \
    | sort -z | xargs -0 shasum -a 256
  shasum -a 256 "$API_DIR/.env" 2>/dev/null || true
  shasum -a 256 "$SCRIPT_DIR/start-mac.sh"
} | shasum -a 256 | cut -d ' ' -f 1)"

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
# Supervised by launchd (a per-user LaunchAgent) rather than a plain
# nohup'd process, so a poller crash mid-session gets restarted
# automatically instead of silently sitting dead until the next
# start-mac.sh run — see docs/02_ARCHITECTURE.md and scripts/README.md.
#
# The label is scoped to this checkout's path (not a fixed name) so two
# different clones/worktrees of this repo on the same machine — e.g. a
# feature worktree under .claude/worktrees/ — each get their own
# LaunchAgent instead of silently taking over each other's.
JOBS_LABEL="com.webdesignos.jobrunner.$(printf '%s' "$REPO_ROOT" | shasum -a 256 | cut -c1-12)"
JOBS_PLIST="$HOME/Library/LaunchAgents/$JOBS_LABEL.plist"
JOBS_DOMAIN="gui/$(id -u)"

# job_runner_pid / job_runner_alive / fallback_pid_alive are defined in
# lib/job_runner_health.sh (sourced above) — shared with stop-mac.sh and
# covered by lib/job_runner_health.test.sh.

# The recorded PID can belong to the shell that launched a fallback worker,
# while the Python child keeps running. Find the actual workers belonging to
# this checkout before deciding whether to keep or stop them.
local_runner_pids() {
  local pid launchd_pid
  launchd_pid="$(job_runner_pid)"
  while IFS= read -r pid; do
    [ -n "$pid" ] && [ "$pid" != "$launchd_pid" ] || continue
    if lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -Fxq "n$API_DIR"; then
      printf '%s\n' "$pid"
    fi
  done < <(pgrep -f 'app[.]jobs[.]runner' 2>/dev/null || true)
}

# Already running our own unsupervised fallback on current code? Leave
# it alone rather than killing and respawning it every single run —
# same "leave it as is" precedent as the API/web checks above, and
# critically avoids interrupting whatever job it might be mid-way
# through. This intentionally does NOT retry launchd on every run once
# it's known not to work here; scripts/README.md covers re-running this
# script after fixing the underlying TCC/permissions issue to pick
# launchd supervision back up.
if [ -n "$(local_runner_pids)" ] && [ "$JOBS_CODE_FINGERPRINT" = "$(cat "$JOBS_HEAD_FILE" 2>/dev/null || echo none)" ]; then
  ok "Job runner already running (unsupervised fallback) on current code - leaving it as is"
else
  # Stop any stale poller before (re)starting — an old-code fallback
  # process, or an older pre-launchd version of this script that always
  # ran the poller this way. If one of those is still alive, launchd
  # wouldn't know about it and we'd end up with two pollers racing to
  # claim the same jobs.
  if [ -n "$(local_runner_pids)" ]; then
    info "Stopping the old unsupervised job runner process before (re)starting it..."
    local_runner_pids | xargs -r kill 2>/dev/null
    for _ in 1 2 3 4 5; do
      [ -z "$(local_runner_pids)" ] && break
      sleep 1
    done
    [ -z "$(local_runner_pids)" ] \
      || fail "The old job runner is still running; stopping here to avoid two workers claiming the same jobs."
  fi
  rm -f "$JOBS_PID_FILE"

mkdir -p "$HOME/Library/LaunchAgents"
cat >"$JOBS_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$JOBS_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$API_DIR/.venv/bin/python</string>
    <string>-m</string>
    <string>app.jobs.runner</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$API_DIR</string>
  <key>StandardOutPath</key>
  <string>$JOBS_LOG</string>
  <key>StandardErrorPath</key>
  <string>$JOBS_LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST

if job_runner_alive && [ "$JOBS_CODE_FINGERPRINT" = "$(cat "$JOBS_HEAD_FILE" 2>/dev/null || echo none)" ]; then
  ok "Job runner already running on current code - leaving it as is"
else
  if launchctl print "$JOBS_DOMAIN/$JOBS_LABEL" >/dev/null 2>&1; then
    info "Restarting the job runner (code changed since it started, or it wasn't actually alive)..."
    launchctl kickstart -k "$JOBS_DOMAIN/$JOBS_LABEL" 2>/dev/null \
      || fail "Couldn't restart the job runner via launchctl kickstart." "$JOBS_LOG"
  else
    info "Starting the job runner (supervised by launchd)..."
    launchctl bootstrap "$JOBS_DOMAIN" "$JOBS_PLIST" 2>/dev/null \
      || fail "Couldn't load the job runner LaunchAgent ($JOBS_PLIST) via launchctl bootstrap." "$JOBS_LOG"
  fi

  # Give launchd a few real rounds to actually spawn and settle it
  # before judging success/failure — each `job_runner_alive` call
  # already waits out one same-pid confirmation window on its own.
  runner_confirmed=false
  for _ in 1 2 3; do
    if job_runner_alive; then
      runner_confirmed=true
      break
    fi
  done

  if [ "$runner_confirmed" = true ]; then
    echo "$JOBS_CODE_FINGERPRINT" >"$JOBS_HEAD_FILE"
    ok "Job runner is running, supervised by launchd (log: $JOBS_LOG)"
  else
    echo "[WARN] The launchd-supervised job runner isn't actually staying alive"
    echo "   ('launchctl print $JOBS_DOMAIN/$JOBS_LABEL' shows no live pid — check $JOBS_LOG"
    echo "   and its 'last exit code' for why). A common cause: this repo lives under"
    echo "   ~/Desktop, ~/Documents, or ~/Downloads, and macOS's Files-and-Folders privacy"
    echo "   protection silently blocks a background LaunchAgent (which has no window to"
    echo "   show a permission prompt) from running there, even though an interactive"
    echo "   Terminal-launched process works fine. Grant Full Disk Access to your terminal"
    echo "   app in System Settings > Privacy & Security to fix launchd supervision."
    echo "   Falling back to an unsupervised background process so analysis still works"
    echo "   this session — it won't auto-restart if it crashes; re-run this script if"
    echo "   background analysis stops completing again."
    launchctl bootout "$JOBS_DOMAIN/$JOBS_LABEL" 2>/dev/null
    ( cd "$API_DIR" && nohup ./.venv/bin/python -m app.jobs.runner >"$JOBS_LOG" 2>&1 & echo $! >"$JOBS_PID_FILE" )
    sleep 1
    if kill -0 "$(cat "$JOBS_PID_FILE" 2>/dev/null || echo 0)" 2>/dev/null; then
      echo "$JOBS_CODE_FINGERPRINT" >"$JOBS_HEAD_FILE"
      ok "Job runner is running, unsupervised (log: $JOBS_LOG)"
    else
      fail "Job runner didn't start at all (tried both launchd and a plain background process)." "$JOBS_LOG"
    fi
  fi
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
