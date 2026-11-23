#!/bin/bash

################################################################################
# Isolated Suite Runner - Runs each test suite in a separate process
################################################################################
#
# WHY: Tree-sitter's native bindings maintain global state that gets corrupted
# when different language grammars load in the same Node process. Standard Jest
# isolation (maxWorkers=1, resetModules, beforeEach) cannot fix this because
# the corruption happens in native .node modules below Node's module system.
#
# SOLUTION: Spawn a separate `jest <file>` OS process for each test suite to
# guarantee clean native module state, while allowing bounded process-level
# parallelism (`XRAY_TEST_JOBS`) and CI sharding (`XRAY_TEST_SHARD`).
#
# MEMORY HYGIENE (see docs/dev/testing.md):
#   - machine-wide lock: concurrent runs (other worktrees/agents) queue
#   - each suite runs in its own session/process group, tagged with a unique
#     per-suite env marker; after it exits (pass, fail, timeout) the whole
#     group and any marker-tagged survivors are TERM/KILLed
#   - survivors are a FAILURE naming the suite, so leaks get fixed, not hidden
#   - per-suite wall-clock timeout and V8 heap cap
#   - high-RSS adversarial suites and wall-clock-sensitive / multi-core suites
#     run solo (1 at a time) so 2GB+ spikes and CPU contention never overlap
#   - per-suite peak RSS reported
#
# Usage: scripts/test-sequential.sh [test-file ...]   (default: all suites)
#
# Env:
#   XRAY_TEST_JOBS               concurrent isolated suite processes (default:
#                                min(cpus, 4); set 1 for strict serial)
#   XRAY_TEST_SHARD              1-based shard selector "<index>/<total>"
#                                (e.g. "1/2", "2/2") for CI matrix sharding
#   XRAY_TEST_MAX_OLD_SPACE_MB   V8 heap cap per suite process (default 2048)
#   XRAY_TEST_SUITE_TIMEOUT_S    wall-clock limit per suite (default 300)
#   XRAY_TEST_KILL_GRACE_S       TERM -> KILL grace (default 2)
#   XRAY_TEST_MEM_REPORT         top-N suites by peak RSS in summary (default 10; 0=off)
#   XRAY_TEST_NO_LOCK=1          skip the machine-wide lock
#   (lock/pressure knobs: see scripts/lib/test-lock.sh)
################################################################################

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
. "$script_dir/lib/test-lock.sh"

MAX_OLD_SPACE_MB=${XRAY_TEST_MAX_OLD_SPACE_MB:-2048}
SUITE_TIMEOUT_S=${XRAY_TEST_SUITE_TIMEOUT_S:-300}
KILL_GRACE_S=${XRAY_TEST_KILL_GRACE_S:-2}
MEM_REPORT_N=${XRAY_TEST_MEM_REPORT:-10}

detect_cpus() {
  local n
  if [ "$(uname)" = "Darwin" ]; then
    n=$(sysctl -n hw.ncpu 2>/dev/null)
  else
    n=$(nproc 2>/dev/null)
  fi
  echo "${n:-1}"
}

if [ -n "${XRAY_TEST_JOBS:-}" ]; then
  JOBS="$XRAY_TEST_JOBS"
else
  cpus=$(detect_cpus)
  if [ "$cpus" -ge 4 ] 2>/dev/null; then
    JOBS=4
  else
    JOBS="$cpus"
  fi
fi
if ! [ "$JOBS" -ge 1 ] 2>/dev/null; then
  echo "Invalid XRAY_TEST_JOBS='$JOBS' (expected positive integer)" >&2
  exit 2
fi

SHARD_INDEX=1
SHARD_TOTAL=1
if [ -n "${XRAY_TEST_SHARD:-}" ]; then
  if [[ "$XRAY_TEST_SHARD" =~ ^([0-9]+)/([0-9]+)$ ]]; then
    SHARD_INDEX="${BASH_REMATCH[1]}"
    SHARD_TOTAL="${BASH_REMATCH[2]}"
  else
    echo "Invalid XRAY_TEST_SHARD='$XRAY_TEST_SHARD' (expected '<index>/<total>', e.g. '1/2')" >&2
    exit 2
  fi
  if [ "$SHARD_TOTAL" -lt 1 ] || [ "$SHARD_INDEX" -lt 1 ] || [ "$SHARD_INDEX" -gt "$SHARD_TOTAL" ]; then
    echo "Invalid XRAY_TEST_SHARD='$XRAY_TEST_SHARD' (index must be between 1 and total)" >&2
    exit 2
  fi
fi

# Invoke local jest binary directly to avoid ~0.7s per-suite npx wrapper overhead.
if [ -x "./node_modules/.bin/jest" ]; then
  JEST_CMD=("./node_modules/.bin/jest")
else
  JEST_CMD=(npx jest)
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/xray-test.XXXXXX") || exit 1
mkdir -p "$work_dir/suites"

# Survivors of a suite: processes that (a) carry the unique per-suite env tag,
# (b) are in the suite's process group, or (c) were seen as descendants while it
# ran (tracked file; catches detached/setsid children and platform binaries like
# `sleep` whose env `ps` hides). Prints "pid<TAB>command". Excludes the probes.
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

# shellcheck disable=SC2329
cleanup() {
  local sdir pgid tag
  if [ -d "$work_dir/suites" ]; then
    for sdir in "$work_dir/suites"/s*; do
      [ -d "$sdir" ] || continue
      if [ -f "$sdir/pgid" ]; then
        pgid=$(cat "$sdir/pgid" 2>/dev/null)
        tag=$(cat "$sdir/tag" 2>/dev/null)
        [ -n "$pgid" ] && [ -n "$tag" ] && reap "$tag" "$pgid" "$sdir/tracked.txt"
      fi
    done
  fi
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
raw_files=()
if [ $# -gt 0 ]; then
  for f in "$@"; do
    raw_files+=("$f")
  done
else
  while IFS= read -r f; do
    [ -n "$f" ] && raw_files+=("$f")
  done < <(find __tests__ -name "*.test.ts" -type f | sort)
fi

# Classify suites:
# - solo_all:  high-RSS adversarial parser stress suites (>1GB) plus wall-clock
#              timing / multi-core-build suites (run solo in phase 2 so RAM
#              spikes and CPU contention never skew budgets). Ordered by cost
#              tier so round-robin sharding balances each tier evenly.
# - slow_all:  known long E2E suites scheduled first (LPT) so no straggler trails
# - fast_all:  all remaining suites
solo_tier() {
  case "$1" in
    *strategy-commands.test.ts|*go-cli/sandbox.test.ts) echo 1 ;;
    *adversarial-*.test.ts) echo 2 ;;
    *analyzer.perf.test.ts|*flow/budget.test.ts) echo 3 ;;
    *) echo 0 ;;
  esac
}

is_slow_suite() {
  case "$1" in
    *exit-code-contract.test.ts|\
    *harness-hooks.test.ts|\
    *all-scopes-options.test.ts|\
    *strategy-install.test.ts|\
    *project-strategies-opt-in.test.ts|\
    *config-confine.test.ts|\
    *extra-args.test.ts|\
    *flow/cli.test.ts|\
    *json-all-commands.test.ts|\
    *cli-golden.test.ts|\
    *commands/impact.test.ts|\
    *strategy-execution.test.ts|\
    *kit-delegation.test.ts|\
    *storage-xdg.test.ts|\
    *commands/imports.test.ts|\
    *strategy-command.test.ts|\
    *unknown-input.test.ts|\
    *completion.test.ts) return 0 ;;
    *) return 1 ;;
  esac
}

solo_t1=()
solo_t2=()
solo_t3=()
slow_all=()
fast_all=()
for f in "${raw_files[@]}"; do
  case "$(solo_tier "$f")" in
    1) solo_t1+=("$f") ;;
    2) solo_t2+=("$f") ;;
    3) solo_t3+=("$f") ;;
    *)
      if is_slow_suite "$f"; then
        slow_all+=("$f")
      else
        fast_all+=("$f")
      fi
      ;;
  esac
done

heavy_all=("${solo_t1[@]}" "${solo_t2[@]}" "${solo_t3[@]}")
normal_all=("${slow_all[@]}" "${fast_all[@]}")

# Apply round-robin sharding independently across heavy and normal lists
# so every shard receives balanced heavy, slow, and fast suites.
heavy_files=()
normal_files=()
if [ "$SHARD_TOTAL" -gt 1 ]; then
  i=0
  for f in "${heavy_all[@]}"; do
    if [ $((i % SHARD_TOTAL)) -eq $((SHARD_INDEX - 1)) ]; then
      heavy_files+=("$f")
    fi
    i=$((i + 1))
  done
  i=0
  for f in "${normal_all[@]}"; do
    if [ $((i % SHARD_TOTAL)) -eq $((SHARD_INDEX - 1)) ]; then
      normal_files+=("$f")
    fi
    i=$((i + 1))
  done
else
  heavy_files=("${heavy_all[@]}")
  normal_files=("${normal_all[@]}")
fi

shard_note=""
if [ "$SHARD_TOTAL" -gt 1 ]; then
  shard_note=", shard ${SHARD_INDEX}/${SHARD_TOTAL}"
fi
echo "Running $(( ${#normal_files[@]} + ${#heavy_files[@]} )) test suite(s) in isolated processes (jobs=${JOBS}, solo=${#heavy_files[@]}, heap cap ${MAX_OLD_SPACE_MB}MB, timeout ${SUITE_TIMEOUT_S}s${shard_note})..."
echo ""

# Pull "<n> <kind>" out of the jest "Tests:" line
count_of() { grep -E '^Tests:' "$1" | tail -1 | grep -oE "[0-9]+ $2" | grep -oE '^[0-9]+'; }

acquire_print_lock() {
  while ! mkdir "$work_dir/print.lock" 2>/dev/null; do
    sleep 0.05
  done
}

release_print_lock() {
  rmdir "$work_dir/print.lock" 2>/dev/null || true
}

run_one_suite() {
  local idx=$1 test_file=$2
  local padded sdir out timef flag tracked tag node_opts pid rc timed_out leaks rss
  local p_cnt f_cnt s_cnt tracker wd

  padded=$(printf '%04d' "$idx")
  sdir="$work_dir/suites/s${padded}"
  mkdir -p "$sdir"
  out="$sdir/out.txt"
  timef="$sdir/time.txt"
  flag="$sdir/timeout.flag"
  tracked="$sdir/tracked.txt"
  : > "$out"; : > "$timef"; : > "$tracked"

  # Fixed-width per-suite tag guarantees zero substring collisions across concurrent suites.
  tag="XRAY_TEST_RUN_ID=${run_id}.s${padded}"
  echo "$tag" > "$sdir/tag"
  node_opts="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$MAX_OLD_SPACE_MB"

  # New session => own process group (pgid == leader pid). exec keeps the pid.
  if [ -n "$TIME_BIN" ]; then
    env "$tag" XRAY_TEST_JOBS="$JOBS" NODE_OPTIONS="$node_opts" perl -MPOSIX -e 'setsid(); exec @ARGV' \
      "$TIME_BIN" "${time_flags[@]}" -o "$timef" "${JEST_CMD[@]}" "$test_file" --coverage=false >"$out" 2>&1 &
  else
    env "$tag" XRAY_TEST_JOBS="$JOBS" NODE_OPTIONS="$node_opts" perl -MPOSIX -e 'setsid(); exec @ARGV' \
      "${JEST_CMD[@]}" "$test_file" --coverage=false >"$out" 2>&1 &
  fi
  pid=$!
  echo "$pid" > "$sdir/pgid"

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
  rm -f "$sdir/pgid"

  rss=""
  [ -n "$TIME_BIN" ] && rss=$(peak_rss_mb "$timef")

  if [ $timed_out -eq 1 ]; then
    rc=1
  fi
  if [ -n "$leaks" ] && [ $timed_out -eq 0 ]; then
    rc=1
  fi

  p_cnt=$(count_of "$out" passed); p_cnt=${p_cnt:-0}
  f_cnt=$(count_of "$out" failed); f_cnt=${f_cnt:-0}
  s_cnt=$(count_of "$out" skipped); s_cnt=${s_cnt:-0}

  # Persist machine-readable summary for the parent aggregator.
  {
    printf 'FILE=%q\n' "$test_file"
    printf 'RC=%d\n' "$rc"
    printf 'TIMED_OUT=%d\n' "$timed_out"
    printf 'HAS_LEAKS=%d\n' "$([ -n "$leaks" ] && [ "$timed_out" -eq 0 ] && echo 1 || echo 0)"
    printf 'RSS=%q\n' "$rss"
    printf 'PASSED=%d\n' "$p_cnt"
    printf 'FAILED=%d\n' "$f_cnt"
    printf 'SKIPPED=%d\n' "$s_cnt"
  } > "$sdir/result.env"

  # Print buffered output atomically so concurrent suites never interleave lines.
  acquire_print_lock
  echo "========================================"
  echo "Running: $test_file"
  echo "========================================"
  cat "$out"
  [ -n "$rss" ] && echo "[peak RSS: ${rss}MB]"
  if [ $timed_out -eq 1 ]; then
    echo "[TIMEOUT] $test_file exceeded ${SUITE_TIMEOUT_S}s; process group killed"
  fi
  if [ -n "$leaks" ] && [ $timed_out -eq 0 ]; then
    echo "[LEAK] $test_file left processes running after exit (killed):"
    while IFS= read -r leak_line; do
      echo "    $leak_line"
    done <<< "$leaks"
  fi
  echo ""
  release_print_lock
}

suite_start_all=$(date +%s)
next_idx=1

# Phase 1: run normal suites with up to $JOBS concurrent isolated processes.
if [ "${#normal_files[@]}" -gt 0 ]; then
  if [ "$JOBS" -le 1 ]; then
    for test_file in "${normal_files[@]}"; do
      _xray_wait_for_memory
      run_one_suite "$next_idx" "$test_file"
      next_idx=$((next_idx + 1))
    done
  else
    active_pids=()
    for test_file in "${normal_files[@]}"; do
      while [ "${#active_pids[@]}" -ge "$JOBS" ]; do
        sleep 0.1
        still_running=()
        for p in "${active_pids[@]}"; do
          if kill -0 "$p" 2>/dev/null; then
            still_running+=("$p")
          else
            wait "$p" 2>/dev/null || true
          fi
        done
        active_pids=("${still_running[@]}")
      done
      _xray_wait_for_memory
      run_one_suite "$next_idx" "$test_file" &
      active_pids+=("$!")
      next_idx=$((next_idx + 1))
    done
    for p in "${active_pids[@]}"; do
      wait "$p" 2>/dev/null || true
    done
  fi
fi

# Phase 2: run high-RSS adversarial suites solo so 2GB+ spikes never overlap.
for test_file in "${heavy_files[@]}"; do
  _xray_wait_for_memory
  run_one_suite "$next_idx" "$test_file"
  next_idx=$((next_idx + 1))
done

# Aggregate results in deterministic index order.
total_suites=0; passed_suites=0; failed_suites=0
total_tests=0; passed_tests=0; failed_tests=0; skipped_tests=0
leaked_suites=""; timed_out_suites=""
rss_log="$work_dir/rss.txt"; : > "$rss_log"

for res in "$work_dir/suites"/s*/result.env; do
  [ -f "$res" ] || continue
  FILE=""; RC=1; TIMED_OUT=0; HAS_LEAKS=0; RSS=""; PASSED=0; FAILED=0; SKIPPED=0
  # shellcheck disable=SC1090
  . "$res"
  total_suites=$((total_suites + 1))
  if [ "$RC" -eq 0 ]; then
    passed_suites=$((passed_suites + 1))
  else
    failed_suites=$((failed_suites + 1))
  fi
  [ "$TIMED_OUT" -eq 1 ] && timed_out_suites="$timed_out_suites $FILE"
  [ "$HAS_LEAKS" -eq 1 ] && leaked_suites="$leaked_suites $FILE"
  [ -n "$RSS" ] && echo "$RSS $FILE" >> "$rss_log"
  passed_tests=$((passed_tests + PASSED))
  failed_tests=$((failed_tests + FAILED))
  skipped_tests=$((skipped_tests + SKIPPED))
  total_tests=$((total_tests + PASSED + FAILED + SKIPPED))
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
[ "$failed_suites" -gt 0 ] && status=1
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
