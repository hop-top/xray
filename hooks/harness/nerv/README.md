# xray hook for nerv

`xray-impact.sh` is a nerv `PreToolUse` handler: when the agent searches
for a plain identifier (`Grep` pattern, or `grep`/`rg` in a `Bash`
command), it answers

```
{"action":"allow","context":"[xray impact] <symbol> (graph saved 3m ago)\n…"}
```

and `{"action":"allow"}` otherwise, always exit 0. nerv maps `context` to
the host's model-context channel (Claude Code: `additionalContext`).

**nerv version:** the handler relies on the decision `context` field
(`spec/handler-contract.md`, "Context"). nerv releases without it drop
the field, so the hook is a harmless allow until then.

Rules: silent (bare allow) for the `{}` lint probe, other events,
regexes, paths, `xray …` commands, no match, zero callers or no saved
graph; each symbol once per session (state file
`${TMPDIR:-/tmp}/xray-hook-<session.id>`).

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

- `xray` on `PATH`, `jq`, `git`, `sha256sum` or `shasum`, `bash`;
  `timeout` (coreutils) optional.
- A saved graph at `<project>/.xray/graph.json` (or `$XRAY_GRAPH`). The
  `xray-save-graph` handler (`xray-save-graph.sh`, `SessionStart`) writes
  it in the background and returns a one-line `[xray]` orientation as
  `context`; or run `hooks/harness/lib/save-graph.sh <project>` yourself
  (a graph written by plain `xray map` has no sidecar and is ignored).
  Nothing is saved outside a git work tree.
- Add `.xray/` to the project's `.gitignore`.

## Install

```sh
git clone --depth 1 https://github.com/hop-top/xray.git ~/.local/share/xray
```

Add to `hooks.yaml`, with absolute paths (nerv runs `run` through `sh -c`,
but `nerv lint` does not expand `$HOME` or `~`):

```yaml
version: "1.0-draft"
hooks:
  - name: xray-save-graph
    on: SessionStart
    run: /home/you/.local/share/xray/hooks/harness/nerv/xray-save-graph.sh
    timeout: 10

  - name: xray-impact
    on: PreToolUse
    match: '^(Bash|Grep)$'
    run: /home/you/.local/share/xray/hooks/harness/nerv/xray-impact.sh
    timeout: 8
```

## Check it

```sh
nerv lint
bash ~/.local/share/xray/hooks/harness/nerv/test-xray-impact.sh
```
