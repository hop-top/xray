# xray hooks for Gemini CLI

| Hook | Script | Does |
|---|---|---|
| `SessionStart` | `session-start.sh` | Saves the code graph to `.xray/graph.json` in the background; one-line `[xray]` orientation as `additionalContext`. |
| `AfterTool` (`grep_search`, `search_file_content`, `run_shell_command`) | `after-tool-impact.sh` | For a search on a plain identifier, appends `[xray impact] <symbol> …` to the tool result via `hookSpecificOutput.additionalContext`. |

Why `AfterTool`, not `BeforeTool`: Gemini's `BeforeTool` has no
model-context channel; `AfterTool`'s `additionalContext` is appended to
the result the model reads. Checked against the hooks reference shipped
with Gemini CLI 0.64.0.

Rules: always exit 0, stderr always empty (Gemini reads stderr when
stdout is empty); silent on regexes, paths, `xray …` commands, no match,
zero callers or no saved graph; each symbol once per session (state file
`${TMPDIR:-/tmp}/xray-hook-<session_id>`).

## Requirements

- `xray` on `PATH`, `jq`, a POSIX `sh`; `timeout` (coreutils) optional.
- The project is a git work tree (the graph is not saved elsewhere).
- Add `.xray/` to the project's `.gitignore`.

## Install

```sh
git clone --depth 1 https://github.com/xray-codes/xray.git ~/.local/share/xray
```

Merge into `~/.gemini/settings.json` (all projects) or
`.gemini/settings.json` (one project). `timeout` is in milliseconds:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "name": "xray-save-graph",
            "type": "command",
            "command": "$HOME/.local/share/xray/hooks/harness/gemini/session-start.sh",
            "timeout": 10000
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "grep_search|search_file_content|run_shell_command",
        "hooks": [
          {
            "name": "xray-impact",
            "type": "command",
            "command": "$HOME/.local/share/xray/hooks/harness/gemini/after-tool-impact.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

`XRAY_GRAPH=/path/graph.json` overrides the graph location for both hooks.
