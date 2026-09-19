#!/usr/bin/env bash
#
# Regression tests for job_runner_health.sh — no framework, no new
# dependency: plain bash assertions against mocked launchctl/pgrep, so
# these exercise the actual liveness logic without touching real
# launchd state or processes. Run directly:
#   ./scripts/lib/job_runner_health.test.sh
#
# Covers the exact bug from docs/07_SESSION_LOG.md 2026-09-19: a
# crash-looping launchd job (known to launchd, but never actually
# alive) being reported "running" by the old, insufficient health
# check, which silently masked "no job runner" for a full day.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=job_runner_health.sh
source "$SCRIPT_DIR/job_runner_health.sh"

JOBS_DOMAIN="gui/501"
JOBS_LABEL="com.example.test"
JOB_RUNNER_ALIVE_CHECK_GAP=0

FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT
export PATH="$FAKE_BIN:$PATH"

pass=0
fail=0
assert() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok - $desc"
    pass=$((pass + 1))
  else
    echo "NOT OK - $desc (expected '$expected', got '$actual')"
    fail=$((fail + 1))
  fi
}

alive_result() {
  if job_runner_alive; then echo alive; else echo dead; fi
}

fallback_result() {
  if fallback_pid_alive; then echo alive; else echo dead; fi
}

# --- The actual bug: launchd job crash-looping ------------------------
# `launchctl print` succeeds (label known) but reports no live pid —
# the exact "spawn scheduled"/EX_CONFIG state confirmed happening for
# real. Before this fix, only checking `launchctl print`'s exit status
# (ignoring its content) reported this as "running".
cat >"$FAKE_BIN/launchctl" <<'EOF'
#!/usr/bin/env bash
echo "	state = spawn scheduled"
exit 0
EOF
chmod +x "$FAKE_BIN/launchctl"
assert "crash-looping launchd job (known but no live pid) is reported dead" "dead" "$(alive_result)"

# --- A genuinely running launchd job -----------------------------------
cat >"$FAKE_BIN/launchctl" <<'EOF'
#!/usr/bin/env bash
echo "	pid = 4242"
echo "	state = running"
exit 0
EOF
chmod +x "$FAKE_BIN/launchctl"
assert "a stable pid across both checks is reported alive" "alive" "$(alive_result)"

# --- A pid that changes between the two checks --------------------------
# Still a crash-loop — this poll just happened to land between one
# death and the next respawn, catching a momentary pid each time.
CALLCOUNT_FILE="$(mktemp)"
echo 0 >"$CALLCOUNT_FILE"
cat >"$FAKE_BIN/launchctl" <<EOF
#!/usr/bin/env bash
n=\$(cat "$CALLCOUNT_FILE")
n=\$((n + 1))
echo "\$n" >"$CALLCOUNT_FILE"
if [ "\$n" -eq 1 ]; then echo "	pid = 1111"; else echo "	pid = 2222"; fi
exit 0
EOF
chmod +x "$FAKE_BIN/launchctl"
assert "a pid that changes between checks is reported dead, not alive" "dead" "$(alive_result)"
rm -f "$CALLCOUNT_FILE"

# --- Unsupervised fallback process alive, no launchd pid at all --------
cat >"$FAKE_BIN/launchctl" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$FAKE_BIN/launchctl"
cat >"$FAKE_BIN/pgrep" <<'EOF'
#!/usr/bin/env bash
echo "9999"
EOF
chmod +x "$FAKE_BIN/pgrep"
assert "an unsupervised fallback process is detected via pgrep" "alive" "$(fallback_result)"

# --- Nothing running at all ----------------------------------------------
cat >"$FAKE_BIN/pgrep" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$FAKE_BIN/pgrep"
assert "no matching process at all is reported dead" "dead" "$(fallback_result)"

# --- The pgrep hit IS the launchd-supervised process itself -------------
# Must not be double-counted as "also running unsupervised".
cat >"$FAKE_BIN/launchctl" <<'EOF'
#!/usr/bin/env bash
echo "	pid = 5555"
exit 0
EOF
chmod +x "$FAKE_BIN/launchctl"
cat >"$FAKE_BIN/pgrep" <<'EOF'
#!/usr/bin/env bash
echo "5555"
EOF
chmod +x "$FAKE_BIN/pgrep"
assert "a pgrep hit matching launchd's own pid is not double-counted as a fallback" "dead" "$(fallback_result)"

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
