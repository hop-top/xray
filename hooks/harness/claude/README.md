# xray hooks for Claude Code

Two hooks push `xray impact` into the session, so the agent sees who calls
a function the moment it greps for it:

| Hook | Script | Does |
|---|---|---|
| `SessionStart` | `session-start.sh` | Saves the code graph to `.xray/graph.json` in the background; prints a one-line `[xray]` orientation (plain stdout becomes context). |
| `PreToolUse` (`Grep`, `Bash`) | `pretooluse-impact.sh` | For a `Grep` pattern or `grep`/`rg` command on a plain identifier, adds `[xray impact] <symbol> …` as `additionalContext`. Never blocks or changes the tool call. |

Rules: always exit 0; silent on regexes, paths, `xray …` commands, no
match, zero callers or no saved graph; each symbol once per session
(state file `${TMPDIR:-/tmp}/xray-hook-<session_id>`).

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

Get the scripts (they ship in the repo, not the npm package):

```sh
git clone --depth 1 https://github.com/hop-top/xray.git ~/.local/share/xray
```

Merge into `~/.claude/settings.json` (all projects) or
`.claude/settings.json` (one project):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.local/share/xray/hooks/harness/claude/session-start.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.local/share/xray/hooks/harness/claude/pretooluse-impact.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## Check it

```sh
cd your-project
echo '{"session_id":"t","cwd":"'"$PWD"'","hook_event_name":"SessionStart"}' \
  | ~/.local/share/xray/hooks/harness/claude/session-start.sh
# wait for .xray/graph.json, then:
echo '{"session_id":"t","cwd":"'"$PWD"'","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"grep -rn SomeFunction ."}}' \
  | ~/.local/share/xray/hooks/harness/claude/pretooluse-impact.sh
```

`XRAY_GRAPH=/path/graph.json` overrides the graph location for both hooks;
it must resolve inside the project's git work tree (see Trust model).
