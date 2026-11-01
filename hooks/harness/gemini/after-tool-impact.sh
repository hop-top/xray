#!/bin/sh
#
# Gemini CLI AfterTool hook: when the agent searched for a function or
# method name, append `xray impact` (who calls it) to the tool result.
#
# Why AfterTool: Gemini's BeforeTool has no model-context channel;
# AfterTool's hookSpecificOutput.additionalContext is appended to the
# tool result the model reads.
#
# Verified against the hooks reference shipped with Gemini CLI 0.64.0
# (docs/hooks/reference.md, docs/reference/tools.md) and its hook runner:
#   tools: grep_search (legacy alias search_file_content) with
#          tool_input.pattern; run_shell_command with tool_input.command
#   event (stdin): {session_id, cwd, hook_event_name: "AfterTool",
#          tool_name, tool_input, tool_response, …}
#   output: {"hookSpecificOutput":{"hookEventName":"AfterTool",
#            "additionalContext":"[xray impact] …"}}, exit 0
# Gemini parses stderr when stdout is empty, so this script keeps stderr
# empty on every path.
#
# Silent for regexes, paths, `xray …` commands, other tools, no match,
# zero callers, a symbol already reported this session, or no saved
# graph (<cwd>/.xray/graph.json or $XRAY_GRAPH; see session-start.sh), or
# one the core does not trust (committed, symlinked, outside the work
# tree, or not saved by lib/save-graph.sh; see ../xray-impact-context).
# Add `.xray/` to your .gitignore. Needs jq. Config: README.md.

exec 2>/dev/null
here=$(cd "$(dirname "$0")" && pwd) || exit 0
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
field() {
  printf '%s' "$input" | jq -r "$1 // empty"
}

case $(field .tool_name) in
  grep_search|search_file_content)
    sym=$("$here/../lib/extract-symbol.sh" pattern "$(field .tool_input.pattern)") ;;
  run_shell_command)
    sym=$("$here/../lib/extract-symbol.sh" command "$(field .tool_input.command)") ;;
  *) exit 0 ;;
esac
[ -n "$sym" ] || exit 0

cwd=$(field .cwd)
if [ -n "$cwd" ]; then
  cd "$cwd" || exit 0
fi

ctx=$(XRAY_HOOK_SESSION=$(field .session_id) "$here/../xray-impact-context" "$sym")
[ -n "$ctx" ] || exit 0

jq -n --arg ctx "$ctx" \
  '{hookSpecificOutput: {hookEventName: "AfterTool", additionalContext: $ctx}}'
exit 0
