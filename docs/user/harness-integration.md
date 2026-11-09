# Harness Integration Guide

How to get xray's answers into a coding agent's session: Claude Code,
nerv, Gemini CLI, Codex, Cursor, or any harness that runs a command on an
event.

## Contents

- [Three ways in](#three-ways-in)
- [Events and commands](#events-and-commands)
- [Hook rules](#hook-rules)
- [Install the hook scripts](#install-the-hook-scripts)
- [Claude Code](#claude-code)
- [nerv](#nerv)
- [Gemini CLI](#gemini-cli)
- [Codex](#codex)
- [Cursor](#cursor)
- [Any harness](#any-harness)
- [Trust model](#trust-model)
- [Troubleshooting](#troubleshooting)
- [See also](#see-also)

## Three ways in

| Way | What it is | Setup | Reliability | Token cost |
|---|---|---|---|---|
| **Instructions** | Tell the agent xray exists: the [Claude Code skill](../../skills/xray-cli/SKILL.md), a project [`AGENTS.md`](../../AGENTS.md), or a [system prompt template](../agent/prompts/system-prompts.md) | Copy a file | Agent must remember to call xray; it often reaches for `grep` first | Instructions only, until the agent runs a command |
| **Pull (MCP)** | `xray mcp` serves map / search / query / impact as MCP tools ([MCP server](mcp.md)) | One client config entry | Agent must decide to call the tool | Tool list per session, then what it asks for |
| **Push (hooks)** | Harness hooks run xray on an event and put the answer in the model's context ([below](#events-and-commands)) | Two hook entries + `jq` | Fires whether or not the agent thinks of xray | ≤ ~1300 chars per new symbol, nothing otherwise |

They stack: instructions and MCP let the agent ask; hooks answer the
question it was about to answer with `grep`.

## Events and commands

| Event | Command | Status |
|---|---|---|
| Session start | `xray --quiet map --format json -o .xray/graph.json` in the background, plus a one-line `[xray]` orientation (`strategy detect`) | ✅ shipped |
| Before / after a search tool, on a plain identifier (`Grep` pattern, `grep`/`rg` in a shell command) | `xray impact <symbol> --graph .xray/graph.json --format brief --quiet` | ✅ shipped |
| Prompt submit (prompt names a symbol) | same `impact` call | optional, not shipped |
| After an edit (`PostToolUse` on Edit) | `impact` for the edited symbol | future |

Use-case write-ups with sample output: [Use cases](use-cases.md).

## Hook rules

Every shipped adapter follows the same rules, and so should any hook you
write:

- **stdin** is the harness's event JSON; **stdout** is the context text
  (wrapped in the harness's JSON shape) or nothing.
- **Always exit 0.** A hook never blocks or rewrites the tool call.
- **Budget:** `xray impact` runs under `timeout 5` (or `gtimeout 5`) when
  available; on timeout the hook prints nothing. Set the harness timeout
  above that (the snippets use 8–10 s).
- **Once per symbol per session:** state file
  `${TMPDIR:-/tmp}/xray-hook-<session_id>`.
- **Silent** on regexes, paths, words under 3 chars, commands that start
  with `xray`, no saved graph, no `xray` on `PATH`, no match, zero callers.
- **Output** starts `[xray impact] <symbol> (graph saved <N>m ago)`; the
  body is `--format brief` (≤ 1200 chars: header, one line per group with
  the top 3 callers, `edges:` footer).

**Why a saved graph.** Without `--graph`, `xray impact` builds the graph
for the configured roots on every call, and for a single-root project
there is no merged-graph cache, so the cost grows with the repo. The
session-start hook saves `.xray/graph.json` once, in the background
(written to a temp file and renamed, so a reader never sees half a
graph); each search then only loads JSON (about 0.3 s on xray's own
repo). The graph is saved only inside a git work tree, so a session
opened in `$HOME` does not map your home directory. Add `.xray/` to the
project's `.gitignore`. To refresh it mid-session (for example from a
[pre-commit hook](automation.md#pre-commit-hook-details)), run
`hooks/harness/lib/save-graph.sh <project dir>`, not a bare `xray map`:
see [trust model](#trust-model).

## Install the hook scripts

The scripts live in the repo under [`hooks/harness/`](../../hooks/harness/),
not in the npm package. Pin a release tag:

```sh
git clone --depth 1 --branch v<version> https://github.com/hop-top/xray.git ~/.local/share/xray
```

or, from an existing checkout, copy `hooks/harness/` anywhere and point
the configs below at it. Requirements: `xray` on `PATH`, `jq`, a POSIX
`sh` (`bash` for nerv); `timeout` from coreutils is optional.

| Path | Role |
|---|---|
| `hooks/harness/xray-impact-context` | Harness-agnostic core: `<symbol>` in, marker + brief out |
| `hooks/harness/lib/extract-symbol.sh` | Identifier from a search pattern or a `grep`/`rg` command |
| `hooks/harness/lib/save-graph.sh` | Background graph save + orientation line |
| `hooks/harness/claude/`, `nerv/`, `gemini/` | Thin adapters, one README each with the full config |

## Claude Code

Full config and checks: [`hooks/harness/claude/README.md`](../../hooks/harness/claude/README.md).
Merge into `~/.claude/settings.json` or the project's
`.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "$HOME/.local/share/xray/hooks/harness/claude/session-start.sh", "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "Grep|Bash", "hooks": [{ "type": "command", "command": "$HOME/.local/share/xray/hooks/harness/claude/pretooluse-impact.sh", "timeout": 10 }] }
    ]
  }
}
```

`SessionStart` prints one plain line, which Claude Code adds to the
context:

```
[xray] code graph saving in the background to /path/to/project/.xray/graph.json; strategies: build, config, express, go-cli, infrastructure, markdown, package-manager, react. Callers of a function: xray impact <symbol> --graph /path/to/project/.xray/graph.json --format brief
```

A `PreToolUse` event for `grep -rn recordEvent src`, run in xray's own
repo:

```sh
echo '{"session_id":"doc1","cwd":"'"$PWD"'","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"grep -rn recordEvent src"}}' \
  | ~/.local/share/xray/hooks/harness/claude/pretooluse-impact.sh
```

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[xray impact] recordEvent (graph saved 0m ago)\nrecordEvent (method, src/lib/plugins/telemetry-plugin.ts:L283) — 19 callers across 2 groups\n  src: 17 callers — apply (src/lib/plugins/telemetry-plugin.ts:L124), handleCommandStart (src/lib/plugins/telemetry-plugin.ts:L146), handleCommandComplete (src/lib/plugins/telemetry-plugin.ts:L179), …and 14 more\n  __tests__: 2 callers — makeFakeHost (__tests__/plugins/presets/apply.test.ts:L21) (inferred), makeFakeHost (__tests__/plugins/presets/regression.test.ts:L23) (inferred)\nedges: EXTRACTED 15 · INFERRED 4"
  }
}
```

The same event again prints nothing (already reported this session), and
so does a regex search such as `record.*Event`. No `permissionDecision`
is ever set: the grep runs unchanged.

## nerv

Full config and checks: [`hooks/harness/nerv/README.md`](../../hooks/harness/nerv/README.md).
`hooks.yaml`, with absolute paths (`nerv lint` does not expand `$HOME`):

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

The handler answers with a decision carrying a `context` field:

```json
{"action":"allow","context":"[xray impact] loadConfig (graph saved 0m ago)\nloadConfig (function, src/lib/config.ts:L244) — 32 callers across 3 groups\n  src: 23 callers — registerAliasCommand (src/commands/alias.ts:L43), resolveRunOptions (src/commands/generate.ts:L667), handleGenerateAction (src/commands/generate.ts:L686), …and 20 more\n  __tests__: 8 callers — layered (__tests__/lib/config-precedence.test.ts:L140), build (__tests__/commands/alias-registration.test.ts:L36), names (__tests__/cache/cross-root-key.test.ts:L31), …and 5 more\n  scripts: 1 caller — main (scripts/benchmark-clustering.ts:L47)\nedges: EXTRACTED 31 · INFERRED 3"}
```

and `{"action":"allow"}` for everything else (including the `{}` lint
probe). **nerv version:** the `context` decision field is implemented in
nerv upstream but not released yet; released nerv (0.17 and earlier)
drops it, so until a release carries it the handler is a harmless allow.
`bash hooks/harness/nerv/test-xray-impact.sh` checks the handler on its
own (6 cases: probe, other event, regex, `xray` command, known symbol,
repeat).

## Gemini CLI

Full config: [`hooks/harness/gemini/README.md`](../../hooks/harness/gemini/README.md).
Checked against the hooks reference shipped with Gemini CLI 0.64.0:

- The search tools are `grep_search` (legacy alias `search_file_content`)
  and `run_shell_command`.
- `BeforeTool` has no model-context channel, so the impact hook runs on
  **`AfterTool`**: its `hookSpecificOutput.additionalContext` is appended
  to the tool result the model reads. `SessionStart` takes the same field.
- Timeouts are in **milliseconds**; stdout must be JSON only, and stderr
  must stay empty (Gemini reads stderr when stdout is empty). Both
  scripts redirect stderr to `/dev/null`.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "name": "xray-save-graph", "type": "command", "command": "$HOME/.local/share/xray/hooks/harness/gemini/session-start.sh", "timeout": 10000 }] }
    ],
    "AfterTool": [
      { "matcher": "grep_search|search_file_content|run_shell_command", "hooks": [{ "name": "xray-impact", "type": "command", "command": "$HOME/.local/share/xray/hooks/harness/gemini/after-tool-impact.sh", "timeout": 10000 }] }
    ]
  }
}
```

Output shape: `{"hookSpecificOutput":{"hookEventName":"AfterTool","additionalContext":"[xray impact] …"}}`.

## Codex

No push: xray ships no Codex hook adapter. Codex CLI has hooks of its
own, but no xray adapter has been written or tested against them.
Use instructions plus MCP:

- **Instructions:** Codex reads `AGENTS.md`. Add a short block such as
  "Before changing a function's signature, run `xray impact <symbol>`;
  for structure, `xray map`." Longer templates:
  [system prompts](../agent/prompts/system-prompts.md).
- **MCP:** register the server (writes `~/.codex/config.toml`):

```sh
codex mcp add xray -- xray -C /path/to/project mcp
```

```toml
[mcp_servers.xray]
command = "xray"
args = ["-C", "/path/to/project", "mcp"]
```

## Cursor

- **Instructions:** a project rule (`.cursor/rules/`) with the same short
  block as for Codex.
- **MCP:** `.cursor/mcp.json`, see [MCP server: Cursor](mcp.md#cursor).
- **Hooks: not verified.** Cursor's hooks reference documents
  `additional_context` on `sessionStart` and `postToolUse` (config in
  `.cursor/hooks.json`), which would fit the same pattern as the Gemini
  `AfterTool` adapter. xray ships no Cursor adapter and none has been run
  against Cursor; the [any harness](#any-harness) wrapper is the starting
  point.

## Any harness

If your harness runs a command on an event and can put its stdout in the
model's context, wrap the core in three lines. This wrapper takes the
shell command and the session id as arguments:

```sh
#!/bin/sh
sym=$(/path/to/xray/hooks/harness/lib/extract-symbol.sh command "$1")
[ -n "$sym" ] && XRAY_HOOK_SESSION="$2" /path/to/xray/hooks/harness/xray-impact-context "$sym"
exit 0
```

Run from the project root (where `.xray/graph.json` lives, or set
`XRAY_GRAPH`):

```
$ ./my-hook.sh 'rg -n loadConfig src' s1
[xray impact] loadConfig (graph saved 0m ago)
loadConfig (function, src/lib/config.ts:L244) — 32 callers across 3 groups
  src: 23 callers — registerAliasCommand (src/commands/alias.ts:L43), resolveRunOptions (src/commands/generate.ts:L667), handleGenerateAction (src/commands/generate.ts:L686), …and 20 more
  __tests__: 8 callers — layered (__tests__/lib/config-precedence.test.ts:L140), build (__tests__/commands/alias-registration.test.ts:L36), names (__tests__/cache/cross-root-key.test.ts:L31), …and 5 more
  scripts: 1 caller — main (scripts/benchmark-clustering.ts:L47)
edges: EXTRACTED 31 · INFERRED 3
$ ./my-hook.sh 'rg -n loadConfig src' s1     # same session: silent
$ ./my-hook.sh 'ls -la' s1                    # not a search: silent
```

Use `extract-symbol.sh pattern "<pattern>"` for a search tool that takes
a pattern instead of a command. Save the graph at session start with
`hooks/harness/lib/save-graph.sh <project dir>`.

## Trust model

The hooks read a graph file from the project and print text into the
model's context, so the core only trusts a graph that `save-graph.sh`
wrote for this user:

- The graph must not be tracked by git, and no other file in its
  directory may be tracked either (unless that directory is the work-tree
  root). Neither the graph nor its directory may be a symlink, and the
  graph must resolve inside the project's work tree. This applies to an
  `XRAY_GRAPH` override too, so point it at an untracked directory such as
  `.xray/`.
- Its sha256 must match a per-user sidecar that `save-graph.sh` records
  under `${XDG_STATE_HOME:-~/.local/state}/xray/hooks/`. A graph that was
  committed, checked out, or edited by hand is ignored (the hook stays
  silent) until the next session-start save.
- Control characters are stripped from the output before it reaches the
  harness.

So a cloned repository cannot ship a crafted `.xray/graph.json` that
puts text into your agent's context. Hooks run with your user's
permissions and only run `xray`, `git`, `jq` and standard POSIX utilities.

Hook and subprocess runs never record telemetry: xray turns it off when
stdout is not a TTY, for machine-readable formats and for `xray mcp`,
even if you once consented. See
[Telemetry](telemetry.md#when-telemetry-is-off); `xray describe` lists the
rules under `telemetry`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Hook never says anything | No graph yet: the session-start save runs in the background; check `.xray/graph.json` exists. Not a git work tree: nothing is saved. `xray` or `jq` not on the harness's `PATH`. The search was a regex or path, not an identifier. |
| Callers look out of date | The graph is from session start (`graph saved <N>m ago`). Start a new session, or refresh it with `hooks/harness/lib/save-graph.sh .` (a graph written any other way is not trusted, see [trust model](#trust-model)). |
| Callers from the wrong tree, or "no matching symbol" for a function you can see | The save runs plain `xray map`, so a project `.xrayrc.json` with `paths` decides what is mapped (for example another checkout). Check `jq .metadata.projectPath .xray/graph.json`; fix `paths`, then re-run `hooks/harness/lib/save-graph.sh .` or start a new session. |
| Silent after a hand-made graph | See [trust model](#trust-model): only graphs written by `save-graph.sh` are read. |
| Slow searches | Install coreutils `timeout` so the 5 s budget applies; measured 0.48 s per event on a 318-file Go repo. Without a saved graph there is nothing to run. |
| `jq: command not found` | The adapters need `jq` and stay silent without it. The [any-harness](#any-harness) wrapper does not. |
| Context cut off | `--format brief` caps the body at 1200 chars, well under Claude Code's hook-context limit; long reports get there only if you switch the core to `--format text`. |
| Same symbol twice, no second report | By design: once per symbol per session. Delete `${TMPDIR:-/tmp}/xray-hook-<session_id>` to reset. |
| nerv hook allows but adds nothing | Released nerv drops the `context` field ([nerv](#nerv)). |

Check a hook by hand by piping a sample event into it, as in the
[Claude Code](#claude-code) example; the Claude and nerv READMEs have a
"Check it" section.

## See also

- [Use cases](use-cases.md): what each hook is for, with real output
- [MCP server](mcp.md): pull-side reference
- [`xray impact`](commands.md#xray-impact): command reference
- [Pushed context, for agents](../agent/integration-protocol.md#pushed-context-harness-hooks): how an agent should read an `[xray impact]` block
- [Automation](automation.md): pre-commit and CI
