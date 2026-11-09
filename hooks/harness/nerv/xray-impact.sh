#!/usr/bin/env bash
# xray-impact.sh — nerv PreToolUse handler: when the agent searches for a
# function or method name, put `xray impact` (who calls it) in the
# model's context via the decision's `context` field.
#
# Envelope (stdin): {event, session:{id,cwd},
#   payload:{tool_name, tool_input:{command|pattern}}}
# Decision (stdout), always exit 0:
#   {"action":"allow","context":"[xray impact] …"}   symbol with callers
#   {"action":"allow"}                               everything else
#
# Assumes nerv's `context` decision field (spec/handler-contract.md
# "Context"); nerv releases without it ignore the field, so the hook is
# then a harmless allow.
#
# Silent (bare allow) for the `{}` lint probe, other events, regexes,
# paths, `xray …` commands, other tools, no match, zero callers, a symbol
# already reported this session, or no saved graph
# (<session.cwd>/.xray/graph.json or $XRAY_GRAPH, saved by
# xray-save-graph.sh / ../lib/save-graph.sh), or one the core does not
# trust (committed, symlinked, outside the work tree, or not self-saved;
# see ../xray-impact-context). Add `.xray/` to your .gitignore. Needs jq. Config: README.md.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
allow() { echo '{"action":"allow"}'; exit 0; }

command -v jq >/dev/null 2>&1 || allow

PAYLOAD=$(cat)
field() { printf '%s' "$PAYLOAD" | jq -r "$1 // empty" 2>/dev/null || true; }

EVENT=$(field .event)
[ "$EVENT" = "PreToolUse" ] || allow

TOOL=$(field .payload.tool_name)
case "$TOOL" in
  Grep|grep_search|search_file_content)
    SYM=$("$here/../lib/extract-symbol.sh" pattern "$(field .payload.tool_input.pattern)") ;;
  Bash|run_shell_command)
    SYM=$("$here/../lib/extract-symbol.sh" command "$(field .payload.tool_input.command)") ;;
  *) allow ;;
esac
[ -n "$SYM" ] || allow

CWD=$(field '.session.cwd // .payload.cwd')
if [ -n "$CWD" ]; then
  cd "$CWD" 2>/dev/null || allow
fi

SESSION_ID=$(field '.session.id // .payload.session_id')
CTX=$(XRAY_HOOK_SESSION="$SESSION_ID" "$here/../xray-impact-context" "$SYM" || true)
[ -n "$CTX" ] || allow

jq -nc --arg ctx "$CTX" '{action: "allow", context: $ctx}' 2>/dev/null || allow
exit 0
