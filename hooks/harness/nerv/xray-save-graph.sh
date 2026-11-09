#!/usr/bin/env bash
# xray-save-graph.sh — nerv SessionStart handler: start saving the code
# graph in the background (for xray-impact.sh) and give the model a
# one-line orientation via the decision's `context` field.
#
# Decision (stdout), always exit 0:
#   {"action":"allow","context":"[xray] code graph saving …"}  on SessionStart
#   {"action":"allow"}                                         everything else
#
# Only a SessionStart envelope triggers the save, so the `{}` lint probe
# (and any other event) has no side effects. Graph:
# <session.cwd>/.xray/graph.json or $XRAY_GRAPH; add `.xray/` to your
# .gitignore. Nothing is saved outside a git work tree. Needs jq.
# Config: README.md.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
allow() { echo '{"action":"allow"}'; exit 0; }

command -v jq >/dev/null 2>&1 || allow

PAYLOAD=$(cat)
field() { printf '%s' "$PAYLOAD" | jq -r "$1 // empty" 2>/dev/null || true; }

[ "$(field .event)" = "SessionStart" ] || allow

CWD=$(field '.session.cwd // .payload.cwd')
LINE=$("$here/../lib/save-graph.sh" "${CWD:-.}" 2>/dev/null || true)
[ -n "$LINE" ] || allow

jq -nc --arg ctx "$LINE" '{action: "allow", context: $ctx}' 2>/dev/null || allow
exit 0
