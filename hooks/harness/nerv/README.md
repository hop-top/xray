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

## Requirements

- `xray` on `PATH`, `jq`, `bash`; `timeout` (coreutils) optional.
- A saved graph at `<project>/.xray/graph.json` (or `$XRAY_GRAPH`). The
  `xray-save-graph` handler (`xray-save-graph.sh`, `SessionStart`) writes
  it in the background and returns a one-line `[xray]` orientation as
  `context`; or run `xray --quiet map --format json -o .xray/graph.json`
  yourself. Nothing is saved outside a git work tree.
- Add `.xray/` to the project's `.gitignore`.

## Install

```sh
git clone --depth 1 https://github.com/xray-codes/xray.git ~/.local/share/xray
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
