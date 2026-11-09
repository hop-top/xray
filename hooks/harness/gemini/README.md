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

## Trust model

The impact text comes from the graph (file paths, symbol names, kinds)
and goes straight into the model's context, so the hooks only read a
graph this user's `lib/save-graph.sh` wrote. A cloned repo that ships,
or plants, a crafted `.xray/graph.json` is ignored. The impact hook is
silent unless:

- the graph and its directory (`.xray/`) are not symlinks, and the graph
  resolves inside the project's git work tree (also for `$XRAY_GRAPH`);
- neither the graph nor any other file in its directory is tracked by
  git (keep `.xray/` in `.gitignore`, never commit it);
- its sha256 matches the sidecar the save recorded:
  `${XDG_STATE_HOME:-~/.local/state}/xray/hooks/<sha256 of the graph's
  absolute path>` (directory mode 700, file 600). A graph changed after
  the save, or written by hand with `xray map`, has no matching sidecar.

The save refuses (writes nothing) when `.xray/`, the graph or its lock is
a symlink or the target resolves outside the work tree. Control
characters and ANSI escapes are stripped from the impact text. Without
`sha256sum` or `shasum` no sidecar is written, so the impact hook stays
silent.

## Requirements

- `xray` on `PATH`, `jq`, `git`, `sha256sum` or `shasum`, a POSIX `sh`;
  `timeout` (coreutils) optional.
- The project is a git work tree (the graph is not saved elsewhere).
- Add `.xray/` to the project's `.gitignore`.

## Install

```sh
git clone --depth 1 https://github.com/hop-top/xray.git ~/.local/share/xray
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

`XRAY_GRAPH=/path/graph.json` overrides the graph location for both hooks;
it must resolve inside the project's git work tree (see Trust model).
