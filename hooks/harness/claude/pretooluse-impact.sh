#!/bin/sh
#
# Claude Code PreToolUse hook: when the agent greps for a function or
# method name, add `xray impact` (who calls it) to the model's context.
#
# Event (stdin): {session_id, cwd, hook_event_name: "PreToolUse",
#   tool_name: "Grep"|"Bash", tool_input: {pattern | command, …}}
# Output (stdout), only when there is something to say:
#   {"hookSpecificOutput":{"hookEventName":"PreToolUse",
#                          "additionalContext":"[xray impact] …"}}
# No permissionDecision: the tool call always runs unchanged. Exit 0.
#
# Silent for regexes, paths, `xray …` commands, other tools, no match,
# zero callers, a symbol already reported this session, or no saved
# graph (<cwd>/.xray/graph.json or $XRAY_GRAPH; see session-start.sh), or
# one the core does not trust (committed, symlinked, outside the work
# tree, or not saved by lib/save-graph.sh; see ../xray-impact-context).
# Add `.xray/` to your .gitignore. Needs jq. Config: README.md.

here=$(cd "$(dirname "$0")" && pwd) || exit 0
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
field() {
  printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
}

case $(field .tool_name) in
  Grep) sym=$("$here/../lib/extract-symbol.sh" pattern "$(field .tool_input.pattern)") ;;
  Bash) sym=$("$here/../lib/extract-symbol.sh" command "$(field .tool_input.command)") ;;
  *) exit 0 ;;
esac
[ -n "$sym" ] || exit 0

cwd=$(field .cwd)
if [ -n "$cwd" ]; then
  cd "$cwd" 2>/dev/null || exit 0
fi

ctx=$(XRAY_HOOK_SESSION=$(field .session_id) "$here/../xray-impact-context" "$sym")
[ -n "$ctx" ] || exit 0

jq -n --arg ctx "$ctx" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}' 2>/dev/null
exit 0
