#!/usr/bin/env bash
#
# Stops what scripts/start-mac.sh started: the web app, the API, and
# Postgres. See scripts/README.md.
#
# Usage: double-click this file in Finder, or run it from a terminal:
#   ./scripts/stop-mac.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"

# shellcheck source=lib/job_runner_health.sh
source "$SCRIPT_DIR/lib/job_runner_health.sh"

echo ""
echo "Web Design OS - stopping local development environment"
echo ""

# Stops whatever is actually listening on $PORT — not the pid recorded
# at start time. A dev server is often more than one process sharing the
# same listening socket (uvicorn --reload runs a reloader parent plus a
# worker child that both hold it; `next dev` is its own small tree) — the
# process(es) actually holding the socket are the reliable handle
# regardless of what wraps or accompanies them, and killing them was
# confirmed to cleanly take the rest of the tree down too. $MATCH guards
# against ever killing a *different* program that happens to be using the
# port right now.
stop_port() {
  local name="$1" port="$2" match="$3" pid_file="$4"

  local pids
  pids="$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null)"

  if [ -z "$pids" ]; then
    echo "-> $name: not running (nothing listening on port $port)"
    rm -f "$pid_file"
    return
  fi

  local pid matched=0
  for pid in $pids; do
    if ps -p "$pid" -o command= 2>/dev/null | grep -q "$match"; then
      kill "$pid" 2>/dev/null
      matched=1
    fi
  done

  if [ "$matched" -eq 0 ]; then
    echo "-> $name: something is listening on port $port, but it doesn't look like this app's process - leaving it alone"
    return
  fi

  local waited=0
  while lsof -ti ":$port" -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge 10 ]; then
      echo "-> $name: still running after 10s, forcing..."
      lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null
      break
    fi
  done
  rm -f "$pid_file"
  echo "[OK] $name stopped"
}

stop_port "API" 8000 "app.main:app" "$RUN_DIR/api.pid"
stop_port "Web app" 3000 "next" "$RUN_DIR/web.pid"

# The job runner is normally supervised by launchd (KeepAlive) — see
# start-mac.sh for why. It doesn't listen on a port, and plain `kill`
# won't stop a launchd-supervised one (launchd would just restart it),
# so that path is stopped with `launchctl bootout` instead.
#
# start-mac.sh also has an unsupervised fallback for when launchd
# itself won't stay alive (e.g. a Files-and-Folders privacy restriction
# on a repo under ~/Desktop/~/Documents/~/Downloads) — a plain
# background process with no launchd entry to bootout. That fallback
# used to be found via $JOBS_PID_FILE's recorded pid, which turned out
# unreliable: a `( cd ... && nohup cmd & echo $! )` subshell doesn't
# always hand back the exact pid `ps` later reports for the exec'd
# program (the venv python binary is a symlink chain `ps`/`pgrep`
# report resolved) — confirmed leaving a real fallback poller running
# after this script claimed everything was stopped. `pgrep -f` finds it
# by command line instead, regardless of what pid was ever recorded.
JOBS_PID_FILE="$RUN_DIR/jobs.pid"
JOBS_LABEL="com.webdesignos.jobrunner.$(printf '%s' "$REPO_ROOT" | shasum -a 256 | cut -c1-12)"
JOBS_DOMAIN="gui/$(id -u)"

stopped_anything=0

if launchctl print "$JOBS_DOMAIN/$JOBS_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$JOBS_DOMAIN/$JOBS_LABEL" 2>/dev/null
  waited=0
  while launchctl print "$JOBS_DOMAIN/$JOBS_LABEL" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -ge 10 ] && break
  done
  echo "[OK] Job runner (launchd) stopped"
  stopped_anything=1
fi

fallback_pids="$(pgrep -f "app\.jobs\.runner" 2>/dev/null)"
if [ -n "$fallback_pids" ]; then
  echo "$fallback_pids" | xargs -r kill 2>/dev/null
  waited=0
  while [ -n "$(pgrep -f "app\.jobs\.runner" 2>/dev/null)" ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge 10 ]; then
      echo "$fallback_pids" | xargs -r kill -9 2>/dev/null
      break
    fi
  done
  echo "[OK] Job runner (unsupervised fallback) stopped"
  stopped_anything=1
fi

[ "$stopped_anything" -eq 0 ] && echo "-> Job runner: not running"
rm -f "$JOBS_PID_FILE"

echo "-> Stopping Postgres..."
if ( cd "$REPO_ROOT" && docker compose stop postgres ) >/dev/null 2>&1; then
  echo "[OK] Postgres stopped"
else
  echo "[WARN] Couldn't stop Postgres (Docker may not be running, or it was already stopped)"
fi

echo ""
echo "[OK] Web Design OS stopped."
echo ""
