#!/bin/bash

################################################################################
# Sequential Test Runner - Runs each test suite in a separate process
################################################################################
#
# WHY: Tree-sitter's native bindings maintain global state that gets corrupted
# when different language grammars load in the same Node process. Standard Jest
# isolation (maxWorkers=1, resetModules, beforeEach) cannot fix this because
# the corruption happens in native .node modules below Node's module system.
#
# SOLUTION: Spawn separate `jest <file>` processes for each test suite to
# ensure clean native module state.
#
# MEMORY HYGIENE (see docs/dev/testing.md):
#   - machine-wide lock: concurrent runs (other worktrees/agents) queue
#   - each suite runs in its own session/process group, tagged with an env
#     marker; after it exits (pass, fail, timeout) the whole group and any
#     marker-tagged survivors are TERM/KILLed
#   - survivors are a FAILURE naming the suite, so leaks get fixed, not hidden
#   - per-suite wall-clock timeout and V8 heap cap
#   - per-suite peak RSS reported
#
# Usage: scripts/test-sequential.sh [test-file ...]   (default: all suites)
#
# Env:
#   XRAY_TEST_MAX_OLD_SPACE_MB   V8 heap cap per suite process (default 2048)
#   XRAY_TEST_SUITE_TIMEOUT_S    wall-clock limit per suite (default 300)
#   XRAY_TEST_KILL_GRACE_S       TERM -> KILL grace (default 2)
#   XRAY_TEST_MEM_REPORT         top-N suites by peak RSS in summary (default 10; 0=off)
#   XRAY_TEST_NO_LOCK=1          skip the machine-wide lock
#   (lock/pressure knobs: see scripts/lib/test-lock.sh)
################################################################################

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/test-lock.sh
. "$script_dir/lib/test-lock.sh"

MAX_OLD_SPACE_MB=${XRAY_TEST_MAX_OLD_SPACE_MB:-2048}
SUITE_TIMEOUT_S=${XRAY_TEST_SUITE_TIMEOUT_S:-300}
KILL_GRACE_S=${XRAY_TEST_KILL_GRACE_S:-2}
MEM_REPORT_N=${XRAY_TEST_MEM_REPORT:-10}

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/xray-test.XXXXXX") || exit 1
cur_pgid=""

# Survivors of a suite: processes that (a) carry the env tag, (b) are in the
# suite's process group, or (c) were seen as descendants while it ran (tracked
# file; catches detached/setsid children and platform binaries like `sleep`
# whose env `ps` hides). Prints "pid<TAB>command". Excludes the probes.
survivors() {
  local tag=$1 pgid=$2 tracked=$3
  [ -f "$tracked" ] || : > "$tracked"
  ps -axeww -o pid= -o pgid= -o lstart= -o command= | awk -v tag="$tag" -v pgid="$pgid" -v self="$$" -v tracked="$tracked" '
    BEGIN { while ((getline l < tracked) > 0) t[l] = 1 }
    $1 == self { next }
    {
      ls = $3 " " $4 " " $5 " " $6 " " $7
      cmd = $0; sub(/^ *[0-9]+ +[0-9]+ +[A-Za-z]+ +[A-Za-z]+ +[0-9]+ +[0-9:]+ +[0-9]+ +/, "", cmd)
      split(cmd, w, " "); n = split(w[1], b, "/"); base = b[n]
      if (base == "ps" || base == "awk") next
      if (index($0, tag) > 0 || $2 == pgid || ($1 "|" ls) in t) {
        sub(/ [A-Za-z_][A-Za-z0-9_]*=.*$/, "", cmd)   # strip env tail from `ps e`
        printf "%s\t%s\n", $1, substr(cmd, 1, 160)
      }
    }'
}

# TERM, grace, KILL for group + tagged survivors. Echo-free; returns nothing.
reap() {
  local tag=$1 pgid=$2 tracked=$3 pids p i
  [ -n "$pgid" ] && kill -TERM -- "-$pgid" 2>/dev/null
  pids=$(survivors "$tag" "$pgid" "$tracked" | cut -f1)
  for p in $pids; do kill -TERM "$p" 2>/dev/null; done
  for ((i = 0; i < KILL_GRACE_S * 5; i++)); do
    [ -z "$(survivors "$tag" "$pgid" "$tracked")" ] && return 0
    sleep 0.2
  done
  [ -n "$pgid" ] && kill -KILL -- "-$pgid" 2>/dev/null
  for p in $(survivors "$tag" "$pgid" "$tracked" | cut -f1); do kill -KILL "$p" 2>/dev/null; done
}

cleanup() {
  [ -n "$cur_pgid" ] && reap "XRAY_TEST_RUN_ID=$run_id" "$cur_pgid" "$work_dir/tracked.txt"
  rm -rf "$work_dir"
  _xray_release_lock
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

acquire_test_lock || exit 1
run_id="$$.$(date +%s)"

# Peak RSS in MB from `time` output (BSD -l: bytes; GNU -v: kB)
TIME_BIN=/usr/bin/time
peak_rss_mb() {
  local f=$1
  if [ "$(uname)" = "Darwin" ]; then
    awk '/maximum resident set size/ { printf "%d", $1 / 1048576 }' "$f"
  else
    awk -F: '/Maximum resident set size/ { printf "%d", $2 / 1024 }' "$f"
  fi
}
if [ -x "$TIME_BIN" ]; then
  if [ "$(uname)" = "Darwin" ]; then time_flags=(-l); else time_flags=(-v); fi
else
  TIME_BIN=""
fi

# Test files
if [ $# -gt 0 ]; then
  test_files="$*"
else
  test_files=$(find __tests__ -name "*.test.ts" -type f | sort)
fi

echo "Running test suites sequentially (heap cap ${MAX_OLD_SPACE_MB}MB, timeout ${SUITE_TIMEOUT_S}s)..."
echo ""

total_suites=0; passed_suites=0; failed_suites=0
total_tests=0; passed_tests=0; failed_tests=0; skipped_tests=0
leaked_suites=""; timed_out_suites=""
rss_log="$work_dir/rss.txt"; : > "$rss_log"
suite_start_all=$(date +%s)

# Pull "<n> <kind>" out of the jest "Tests:" line
count_of() { grep -E '^Tests:' "$1" | tail -1 | grep -oE "[0-9]+ $2" | grep -oE '^[0-9]+'; }

for test_file in $test_files; do
  echo "========================================"
  echo "Running: $test_file"
  echo "========================================"

  out="$work_dir/out.txt"; timef="$work_dir/time.txt"; flag="$work_dir/timeout.flag"
  : > "$out"; : > "$timef"; rm -f "$flag"
  tag="XRAY_TEST_RUN_ID=$run_id"
  node_opts="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$MAX_OLD_SPACE_MB"

  # New session => own process group (pgid == leader pid). exec keeps the pid.
  if [ -n "$TIME_BIN" ]; then
    env "$tag" NODE_OPTIONS="$node_opts" perl -MPOSIX -e 'setsid(); exec @ARGV' \
      "$TIME_BIN" "${time_flags[@]}" -o "$timef" npx jest "$test_file" --coverage=false >"$out" 2>&1 &
  else
    env "$tag" NODE_OPTIONS="$node_opts" perl -MPOSIX -e 'setsid(); exec @ARGV' \
      npx jest "$test_file" --coverage=false >"$out" 2>&1 &
  fi
  pid=$!
  cur_pgid=$pid

  tracked="$work_dir/tracked.txt"; : > "$tracked"
  perl "$script_dir/lib/track-descendants.pl" "$pid" "$tracked" </dev/null >/dev/null 2>&1 &
  tracker=$!

  # Watchdog: kill the whole group on wall-clock timeout
  # (single process so `kill $wd` leaves no orphaned sleep holding our stdout)
  perl -e 'sleep($ARGV[0]); open(F, ">", $ARGV[1]); close(F); kill("TERM", -$ARGV[2])' \
    "$SUITE_TIMEOUT_S" "$flag" "$pid" </dev/null >/dev/null 2>&1 &
  wd=$!
  wait "$pid"; rc=$?
  kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null

  timed_out=0
  [ -e "$flag" ] && timed_out=1

  # Leak check BEFORE reaping, so survivors are attributable to this suite
  leaks=$(survivors "$tag" "$pid" "$tracked")
  reap "$tag" "$pid" "$tracked"
  kill "$tracker" 2>/dev/null; wait "$tracker" 2>/dev/null
  cur_pgid=""

  cat "$out"
  rss=""; [ -n "$TIME_BIN" ] && rss=$(peak_rss_mb "$timef")
  [ -n "$rss" ] && echo "$rss $test_file" >> "$rss_log"
  [ -n "$rss" ] && echo "[peak RSS: ${rss}MB]"

  if [ $timed_out -eq 1 ]; then
    echo "[TIMEOUT] $test_file exceeded ${SUITE_TIMEOUT_S}s; process group killed"
    timed_out_suites="$timed_out_suites $test_file"
    rc=1
  fi
  if [ -n "$leaks" ] && [ $timed_out -eq 0 ]; then
    echo "[LEAK] $test_file left processes running after exit (killed):"
    echo "$leaks" | sed 's/^/    /'
    leaked_suites="$leaked_suites $test_file"
  fi

  if [ $rc -eq 0 ]; then
    ((passed_suites++))
  else
    ((failed_suites++))
  fi
  for kind in passed failed skipped; do
    n=$(count_of "$out" "$kind"); n=${n:-0}
    case $kind in
      passed)  ((passed_tests += n)) ;;
      failed)  ((failed_tests += n)) ;;
      skipped) ((skipped_tests += n)) ;;
    esac
    ((total_tests += n))
  done

  ((total_suites++))
  echo ""
done

# Print consolidated summary
echo "========================================"
echo "CONSOLIDATED TEST RESULTS"
echo "========================================"
echo "Test Suites: $passed_suites passed, $failed_suites failed, $total_suites total"
echo "Tests:       $passed_tests passed, $failed_tests failed, $skipped_tests skipped, $total_tests total"
echo "Wall time:   $(( $(date +%s) - suite_start_all ))s"
echo ""

if [ "$MEM_REPORT_N" -gt 0 ] 2>/dev/null && [ -s "$rss_log" ]; then
  echo "Top $MEM_REPORT_N suites by peak RSS (largest single process):"
  sort -rn "$rss_log" | head -n "$MEM_REPORT_N" | awk '{ printf "  %6d MB  %s\n", $1, $2 }'
  echo ""
fi

status=0
[ $failed_suites -gt 0 ] && status=1
if [ -n "$timed_out_suites" ]; then
  echo "TIMED OUT suites (killed):$timed_out_suites"
  status=1
fi
if [ -n "$leaked_suites" ]; then
  echo "LEAKED PROCESSES in suites (fix the test; leaked processes were killed):"
  for s in $leaked_suites; do echo "  $s"; done
  status=1
fi
exit $status
