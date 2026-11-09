# Use Cases

Concrete jobs xray does inside an agent session, one entry per job, all
in the same shape. Hook setup for every harness:
[Harness integration guide](harness-integration.md).

## Template

Copy this when adding a use case:

```markdown
## Use case: <name>

**Problem.** What goes wrong without xray.

**When it fires.** The harness event, and what in it triggers the hook.

**Command.** The exact xray command the hook (or the agent) runs.

**Hook.** Link to the shipped script(s).

**Sample output.** A real run, pasted, with the repo it ran on.

**Limits.** What it does not catch, and when not to trust it.
```

## Use case: Impact analysis

**Problem.** Before changing a function, an agent greps for its name. Text
search returns every string match (comments, same-named methods in other
packages, docs) and nothing about callers of callers. The agent either
reads a lot of noise or misses who breaks.

**When it fires.** A search on a plain identifier: Claude Code
`PreToolUse` on `Grep` or `Bash` (`grep`/`rg`), Gemini CLI `AfterTool` on
`grep_search` / `run_shell_command`, nerv `PreToolUse`. Once per symbol
per session; silent for regexes, paths and `xray …` commands.

**Command.**

```sh
xray impact <symbol> --graph .xray/graph.json --format brief --quiet
```

against the graph the session-start hook saved. The agent can also ask
directly: `xray impact <symbol> [--depth n] [--strict]`, or the `impact`
tool of [`xray mcp`](mcp.md).

**Hook.** [`hooks/harness/xray-impact-context`](../../hooks/harness/xray-impact-context)
(core), adapters for [Claude Code](../../hooks/harness/claude/README.md),
[nerv](../../hooks/harness/nerv/README.md),
[Gemini CLI](../../hooks/harness/gemini/README.md).

**Sample output.** xray's own repo, graph saved with
`xray --quiet map -p . --format json -o .xray/graph.json`, the agent runs
`rg -n loadConfig src`; the hook adds:

```
[xray impact] loadConfig (graph saved 0m ago)
loadConfig (function, src/lib/config.ts:L244) — 32 callers across 3 groups
  src: 23 callers — registerAliasCommand (src/commands/alias.ts:L43), resolveRunOptions (src/commands/generate.ts:L667), handleGenerateAction (src/commands/generate.ts:L686), …and 20 more
  __tests__: 8 callers — layered (__tests__/lib/config-precedence.test.ts:L140), build (__tests__/commands/alias-registration.test.ts:L36), names (__tests__/cache/cross-root-key.test.ts:L31), …and 5 more
  scripts: 1 caller — main (scripts/benchmark-clustering.ts:L47)
edges: EXTRACTED 31 · INFERRED 3
```

The full report, when the agent wants every caller and their depth:

```
$ xray impact computeImpact --graph .xray/graph.json --quiet
computeImpact (function, src/lib/query/impact.ts:L115) — 3 callers across 2 groups
  src: 1 caller — handleImpactAction (src/commands/impact.ts:L98)
  __tests__: 1 caller — brief (__tests__/commands/impact.test.ts:L235)
depth 2:
    src: 1 caller — runImpactCommand (src/commands/impact.ts:L116)
edges: EXTRACTED 3 · INFERRED 0
```

**Limits.**

- Callers are definitions that call the symbol, shown at their definition
  line; the graph stores no call-site positions.
- `INFERRED` edges match by name only; check them, or drop them with
  `--strict`. `EXTRACTED` edges are backed by same-file, same-directory
  or import evidence.
- The graph is as old as the `graph saved <N>m ago` marker: edits made
  during the session are not in it.
- Only plain identifiers trigger the hook; a regex (`load.*Config`) or a
  qualified name (`Config.load`) does not.
- The brief shows the top 3 callers per group and stops at 1200 chars;
  run `xray impact` without `--format brief` for the full list.

## Next candidates

Named, not written yet:

- **Dead-code check before delete:** `impact` reports zero callers before
  the agent removes a function.
- **Session orientation:** a map excerpt plus `strategy detect` at session
  start.
- **Diff reach at review time:** on Stop or pre-commit, `impact` for each
  changed symbol.
