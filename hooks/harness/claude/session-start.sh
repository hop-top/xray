#!/bin/sh
#
# Claude Code SessionStart hook: save the code graph in the background
# (for pretooluse-impact.sh) and print a one-line orientation. On
# SessionStart, Claude Code adds plain stdout to the model's context.
#
# Event (stdin): {session_id, cwd, hook_event_name: "SessionStart", source}
# Output: one line starting `[xray] `, or nothing. Returns at once; the
# map runs detached. Graph: <cwd>/.xray/graph.json or $XRAY_GRAPH; add
# `.xray/` to your .gitignore. Silent outside a git work tree or without
# xray on PATH. Exit 0. Config: README.md.

here=$(cd "$(dirname "$0")" && pwd) || exit 0

input=$(cat)
cwd=
if command -v jq >/dev/null 2>&1; then
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
fi

"$here/../lib/save-graph.sh" "${cwd:-.}"
exit 0
