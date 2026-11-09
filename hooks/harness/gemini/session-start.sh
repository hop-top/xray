#!/bin/sh
#
# Gemini CLI SessionStart hook: save the code graph in the background
# (for after-tool-impact.sh) and give the model a one-line orientation.
#
# Gemini requires JSON-only stdout, so the orientation goes out as
#   {"hookSpecificOutput":{"hookEventName":"SessionStart",
#                          "additionalContext":"[xray] …"}}
# (verified against the hooks reference shipped with Gemini CLI 0.64.0).
# Event (stdin): {session_id, cwd, hook_event_name: "SessionStart", source}
# Returns at once; the map runs detached. Graph: <cwd>/.xray/graph.json
# or $XRAY_GRAPH; add `.xray/` to your .gitignore. Silent outside a git
# work tree or without xray/jq on PATH. stderr kept empty (Gemini parses
# it when stdout is empty). Exit 0. Config: README.md.

exec 2>/dev/null
here=$(cd "$(dirname "$0")" && pwd) || exit 0
command -v jq >/dev/null 2>&1 || exit 0

cwd=$(jq -r '.cwd // empty')
line=$("$here/../lib/save-graph.sh" "${cwd:-.}")
[ -n "$line" ] || exit 0

jq -n --arg ctx "$line" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
exit 0
