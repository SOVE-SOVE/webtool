#!/usr/bin/env bash
#
# Job-runner liveness checks shared by start-mac.sh and stop-mac.sh.
# Extracted into its own file so job_runner_health.test.sh can exercise
# the actual logic in isolation (mocking launchctl/pgrep), independent
# of running the real start/stop scripts.
#
# The bug this guards against (see docs/07_SESSION_LOG.md 2026-09-19):
# `launchctl print "$domain/$label" >/dev/null 2>&1` succeeding only
# means launchd knows about the label — it stays true even while the
# job is crash-looping in launchd's own backoff ("spawn scheduled")
# state with zero actual uptime. start-mac.sh used exactly that as its
# only health check and reported "[OK] ... running" for a poller that
# had in fact never once executed a job, which is why the underlying
# "no job runner" problem went unnoticed for as long as it did.
#
# Callers must set JOBS_DOMAIN and JOBS_LABEL before calling any of
# these. JOB_RUNNER_ALIVE_CHECK_GAP (default 2 seconds) is overridable
# so tests can run this instantly without weakening the real check.

# A `pid = ` line only appears in `launchctl print`'s output while a
# real process is currently alive under launchd's supervision.
job_runner_pid() {
  launchctl print "$JOBS_DOMAIN/$JOBS_LABEL" 2>/dev/null \
    | awk -F'= ' '/^[[:space:]]*pid = [0-9]/{print $2}'
}

# A single `pid = ` sighting isn't enough: a tight crash-loop can still
# be *between* deaths at the instant of one poll (confirmed happening
# for real — caught a momentary pid from a process that was gone again
# a second later). Requiring the *same* pid on two checks a couple of
# seconds apart tells a genuinely running poller (same pid indefinitely)
# apart from a crash-loop (pid always changes, or vanishes, between
# respawns).
job_runner_alive() {
  local first second
  first="$(job_runner_pid)"
  [ -n "$first" ] || return 1
  sleep "${JOB_RUNNER_ALIVE_CHECK_GAP:-2}"
  second="$(job_runner_pid)"
  [ -n "$second" ] && [ "$first" = "$second" ]
}

# Checks for a still-alive plain (non-launchd) poller — either
# start-mac.sh's own unsupervised fallback for when launchd won't stay
# alive, or an even older pre-launchd version of this script that
# always ran the poller this way. Matched with `pgrep -f` rather than
# trusting a recorded pid file — a `( cd ... && nohup cmd & echo $! )`
# subshell doesn't always hand back the exact pid `ps` later shows for
# the exec'd program (the venv python binary is a symlink chain
# `ps`/`pgrep` report resolved), which was confirmed producing a false
# "not alive" that let a duplicate poller start, and the identical
# problem in stop-mac.sh confirmed leaking a live process after
# reporting "stopped". Excludes whatever pid launchd itself currently
# reports (if any) so a machine where launchd *is* working doesn't get
# that same process double-counted as "also running unsupervised".
fallback_pid_alive() {
  local launchd_pid candidates
  launchd_pid="$(job_runner_pid)"
  candidates="$(pgrep -f "app\.jobs\.runner" 2>/dev/null)"
  [ -n "$candidates" ] || return 1
  [ -z "$launchd_pid" ] && return 0
  printf '%s\n' "$candidates" | grep -vqx "$launchd_pid"
}
