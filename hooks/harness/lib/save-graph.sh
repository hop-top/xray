#!/bin/sh
#
# save-graph.sh: start saving the project's code graph in the background
# and print a one-line orientation for the agent.
#
#   save-graph.sh [<project dir>]     # default: current directory
#
# Runs `xray --quiet map --format json` detached (stdin/stdout/stderr on
# /dev/null, so the harness does not wait for it) into a temp file next
# to the target, then renames it into place, so readers never see a
# half-written graph. One save at a time per target (mkdir lock).
#
# Target: $XRAY_GRAPH, else <project dir>/.xray/graph.json. Add `.xray/`
# to your .gitignore.
#
# Does nothing (prints nothing) outside a git work tree, so a session
# opened in $HOME does not map the whole home directory, or when xray is
# not on PATH. Always exits 0.
#
# Used by claude/session-start.sh and gemini/session-start.sh.

dir=${1:-.}
cd "$dir" 2>/dev/null || exit 0
command -v xray >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

graph=${XRAY_GRAPH:-.xray/graph.json}
case $graph in
  /*) ;;
  *) graph="$(pwd)/$graph" ;;
esac
out_dir=$(dirname "$graph")
mkdir -p "$out_dir" 2>/dev/null || exit 0

lock="$graph.lock"
# A lock older than 10 minutes is a crashed save: take it over.
if [ -d "$lock" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
  rmdir "$lock" 2>/dev/null
fi

if mkdir "$lock" 2>/dev/null; then
  # -o keeps a name ending in .json as is; the temp name ends in .json too.
  tmp="${graph%.json}.saving-$$.json"
  (
    trap 'rm -f "$tmp"; rmdir "$lock" 2>/dev/null' EXIT
    xray --quiet map --format json -o "$tmp" && mv -f "$tmp" "$graph"
  ) </dev/null >/dev/null 2>&1 &
fi

limit=
if command -v timeout >/dev/null 2>&1; then
  limit="timeout 3"
elif command -v gtimeout >/dev/null 2>&1; then
  limit="gtimeout 3"
fi
# shellcheck disable=SC2086  # $limit: empty, or "timeout 3"
strategies=$($limit xray --quiet strategy detect 2>/dev/null | awk '{print $1}' | paste -sd, - | sed 's/,/, /g')

line="[xray] code graph saving in the background to $graph"
[ -n "$strategies" ] && line="$line; strategies: $strategies"
line="$line. Callers of a function: xray impact <symbol> --graph $graph --format brief"
printf '%s\n' "$line"
exit 0
