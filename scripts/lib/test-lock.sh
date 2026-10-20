#!/bin/bash
# Machine-wide test lock: serializes full test runs across worktrees/agents.
# Source this file, call acquire_test_lock, and call _xray_release_lock from your
# own EXIT trap (this lib sets no traps so callers keep theirs).
#
# Atomic `mkdir` lock (macOS has no flock). Holder PID is recorded; a lock whose
# PID is dead is stale and gets reclaimed.
#
# Env:
#   XRAY_TEST_NO_LOCK=1          skip locking
#   XRAY_TEST_LOCK_DIR           lock dir (default ${TMPDIR:-/tmp}/xray-test.lock)
#   XRAY_TEST_LOCK_TIMEOUT_S     give up waiting after N s (default 3600; 0=forever)
#   XRAY_TEST_PRESSURE_WAIT_S    max wait while macOS memory pressure is critical
#                                (default 300; 0 disables the check)

_XRAY_LOCK_OWNED=""

_xray_lock_dir() { echo "${XRAY_TEST_LOCK_DIR:-${TMPDIR:-/tmp}/xray-test.lock}"; }

_xray_release_lock() {
  local dir; dir=$(_xray_lock_dir)
  if [ -n "$_XRAY_LOCK_OWNED" ] && [ "$(cat "$dir/pid" 2>/dev/null)" = "$$" ]; then
    rm -rf "$dir"
  fi
  _XRAY_LOCK_OWNED=""
}

# macOS: kern.memorystatus_vm_pressure_level 1=normal 2=warn 4=critical
_xray_wait_for_memory() {
  local max=${XRAY_TEST_PRESSURE_WAIT_S:-300} waited=0 level
  [ "$max" -gt 0 ] 2>/dev/null || return 0
  [ "$(uname)" = "Darwin" ] || return 0
  while level=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null) && [ "${level:-1}" -ge 4 ]; do
    if [ "$waited" -ge "$max" ]; then
      echo "[xray-test] memory pressure still critical after ${max}s; proceeding" >&2
      return 0
    fi
    [ $((waited % 15)) -eq 0 ] && echo "[xray-test] memory pressure critical; waiting (${waited}s/${max}s)" >&2
    sleep 5; waited=$((waited + 5))
  done
}

acquire_test_lock() {
  [ "${XRAY_TEST_NO_LOCK:-}" = "1" ] && return 0
  [ -n "${XRAY_TEST_LOCK_HELD:-}" ] && return 0   # nested under a holder
  local dir; dir=$(_xray_lock_dir)
  local timeout=${XRAY_TEST_LOCK_TIMEOUT_S:-3600} waited=0 holder
  while ! mkdir "$dir" 2>/dev/null; do
    holder=$(cat "$dir/pid" 2>/dev/null)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      # Stale. Rename first (atomic) so only one contender reclaims it.
      if mv "$dir" "$dir.stale.$$" 2>/dev/null; then
        echo "[xray-test] reclaiming stale lock (dead pid $holder)" >&2
        rm -rf "$dir.stale.$$"
      fi
      continue
    fi
    if [ -z "$holder" ] && [ -d "$dir" ]; then
      # Holder between mkdir and pid write; give it a moment.
      sleep 0.2; waited=$((waited + 1)); continue
    fi
    if [ "$timeout" -gt 0 ] && [ "$waited" -ge "$timeout" ]; then
      echo "[xray-test] lock wait timed out after ${timeout}s (holder pid $holder, $(cat "$dir/cwd" 2>/dev/null)); set XRAY_TEST_NO_LOCK=1 to bypass" >&2
      return 1
    fi
    [ $((waited % 10)) -eq 0 ] && echo "[xray-test] another test run holds the lock (pid $holder, $(cat "$dir/cwd" 2>/dev/null)); waiting ${waited}s" >&2
    sleep 2; waited=$((waited + 2))
  done
  echo $$ > "$dir/pid"
  pwd > "$dir/cwd"
  _XRAY_LOCK_OWNED=1
  export XRAY_TEST_LOCK_HELD=$$
  _xray_wait_for_memory
}
