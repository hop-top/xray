#!/usr/bin/env bash
# Smoke tests for xray-impact.sh (nerv envelope/decision contract).
# Run: bash hooks/harness/nerv/test-xray-impact.sh
# Needs jq and git; the known-symbol cases also need xray on PATH and
# sha256sum or shasum (skipped otherwise). Uses a fixture graph in a
# private git work tree, a private TMPDIR and XDG_STATE_HOME.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
HOOK="$here/xray-impact.sh"
PASS=0; FAIL=0; SKIP=0

TMP=$(mktemp -d)
trap 'cd / && /bin/rm -rf "$TMP"' EXIT
export TMPDIR="$TMP" XRAY_GRAPH="$TMP/graph.json" XDG_STATE_HOME="$TMP/state"
git -C "$TMP" init -q

cat >"$XRAY_GRAPH" <<'EOF'
{"metadata":{"version":"1.0","timestamp":"2026-01-01T00:00:00.000Z","projectPath":"/p","nodeCount":2,"edgeCount":1},
 "nodes":[
  {"id":"run.go::RunHooks","type":"tag","label":"RunHooks","kind":"method","file":"run.go","line":108},
  {"id":"dispatch.go::Dispatch","type":"tag","label":"Dispatch","kind":"function","file":"dispatch.go","line":85}],
 "edges":[{"source":"dispatch.go::Dispatch","target":"run.go::RunHooks","type":"calls","confidence":"EXTRACTED"}]}
EOF

# Record the fixture as self-written, as lib/save-graph.sh does after a
# save; the core ignores graphs without a matching sidecar.
# shellcheck source=hooks/harness/lib/graph-trust.sh
. "$here/../lib/graph-trust.sh"
TRUSTED=0
if abs=$(cd "$TMP" && xray_graph_abs graph.json) && sha=$(xray_sha256 <"$abs") \
  && xray_record "$abs" "$sha"; then
  TRUSTED=1
fi

envelope() {
  local event="$1" tool="$2" key="$3" value="$4"
  jq -nc --arg e "$event" --arg t "$tool" --arg k "$key" --arg v "$value" --arg cwd "$TMP" \
    '{event:$e, session:{id:"test-sess", cwd:$cwd},
      payload:{tool_name:$t, tool_input:{($k):$v}}}'
}

# assert <desc> <jq predicate on the decision> <payload>
assert() {
  local desc="$1" pred="$2" payload="$3" out rc=0
  out=$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null) || rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | jq -e "$pred" >/dev/null 2>&1; then
    printf "  PASS: %s\n" "$desc"; PASS=$((PASS+1))
  else
    printf "  FAIL: %s (exit %d, out %s)\n" "$desc" "$rc" "$out"
    FAIL=$((FAIL+1))
  fi
}

BARE='. == {"action":"allow"}'
CTX='.action == "allow" and (.context | startswith("[xray impact] RunHooks (graph saved"))'

echo "=== xray-impact ==="

assert "lint probe {} allows" "$BARE" '{}'
assert "other event allows" "$BARE" "$(envelope PostToolUse Grep pattern RunHooks)"
assert "regex pattern allows" "$BARE" "$(envelope PreToolUse Grep pattern 'Run.*')"
assert "xray command allows" "$BARE" "$(envelope PreToolUse Bash command 'xray impact RunHooks')"

if command -v xray >/dev/null 2>&1 && [ "$TRUSTED" -eq 1 ]; then
  assert "known symbol adds context" "$CTX" "$(envelope PreToolUse Bash command 'grep -rn RunHooks .')"
  if grep -qx RunHooks "$TMP/xray-hook-test-sess" 2>/dev/null; then
    assert "repeat in session is silent" "$BARE" "$(envelope PreToolUse Grep pattern RunHooks)"
  else
    printf "  FAIL: symbol not recorded for the session\n"; FAIL=$((FAIL+1))
  fi
else
  printf "  SKIP: known symbol / repeat (no xray on PATH or no sha256 tool)\n"; SKIP=$((SKIP+2))
fi

echo "---"; echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ]
