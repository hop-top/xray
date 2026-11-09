# Workflow: Impact Analysis ("What breaks if I change X?")

Step-by-step protocol for finding every caller of a function or method
before you change its signature, behavior or name, and turning that list
into a change plan.

**Time:** 2-5 minutes of analysis
**Tokens:** 400-1500
**Outcome:** Callers grouped by package, each marked confirmed or
name-only, and a list of call sites to update together

## Prerequisites

- You know the function or method you plan to change (`RunHooks`,
  `createSession`, ...)
- You can run xray commands in the project (or have a `.xrayrc.json`
  lens covering several repos)

> **May arrive via hook.** With the harness hooks installed, an
> `[xray impact] <symbol> (graph saved <N>m ago)` block appears when you
> grep for the symbol: that is Step 1.1 already run, in `--format brief`
> against the session-start graph. Read it as described in
> [Pushed Context](../integration-protocol.md#pushed-context-harness-hooks),
> then continue from Phase 1 with the full report if you need every caller.

## Protocol Steps

### Phase 1: Blast Radius, One Root (Token Budget: 300)

#### Step 1.1: Run `impact`

```bash
xray impact <symbol> --depth 3
```

`--depth 3` is the default; lower it (`--depth 1`) when you only need
direct callers or the output is too long. The graph is built in memory;
nothing is written to disk. Real output on a Go repo
(`xray impact RunHooks --depth 2`):

```
ℹ coverage: 318 files parsed · skipped grammars: none
RunHooks (method, internal/dispatch/run.go:L108) — 35 callers across 2 groups
  internal: 10 callers — Dispatch (internal/dispatch/dispatch.go:L85), TestRunHooks_EmptyList (internal/dispatch/run_test.go:L48), …
    …and 5 more
  cmd: 2 callers — runReplay (cmd/nerv/cmd_replay.go:L52), testSingleEvent (cmd/nerv/cmd_testhook.go:L140)
depth 2:
    internal: 14 callers — TestDispatch_PublishesCrtxEmission (internal/dispatch/crtx_publish_test.go:L17), …
      …and 9 more
    cmd: 9 callers — TestReplayCmd_FlagsReachRunE (cmd/nerv/cmd_replay_test.go:L18), …
      …and 4 more
edges: EXTRACTED 35 · INFERRED 0
```

How to read it:

| Part | Meaning |
|------|---------|
| `RunHooks (method, internal/dispatch/run.go:L108)` | The definition that matched. `X (N definitions)` + a `defined:` line means the name matched several; all are included |
| `35 callers across 2 groups` | Distinct calling functions, all depths |
| `internal: 10 callers — …` | Depth 1 (direct callers), by top-level directory |
| `depth 2:` | Callers of those callers |
| `Dispatch (internal/dispatch/dispatch.go:L85)` | The calling function and its *definition* line, not the call line; ` (inferred)` after it marks a name-only caller |
| `edges: EXTRACTED 35 · INFERRED 0` | Call edges walked (not callers), by confidence |
| `ℹ coverage:` (stderr) | Files parsed (`served from cache (N files)` when every root hit the cache); a skipped grammar means callers in that language are missing |

**Success Criteria:**
- [ ] Header names the definition you meant (if not, use a full id:
  `xray impact internal/dispatch/run.go::RunHooks`)
- [ ] Depth 1 callers are known
- [ ] `coverage:` shows no skipped grammar for the languages involved

#### Step 1.2: Read Confidence

The text view suffixes name-only callers with ` (inferred)`. For one row
per caller with its confidence:

```bash
xray impact <symbol> --depth 1 --format table
```

```
name                        file                               line  depth  group     confidence
runReplay                   cmd/nerv/cmd_replay.go             52    1      cmd       EXTRACTED
testSingleEvent             cmd/nerv/cmd_testhook.go           140   1      cmd       EXTRACTED
TestRunHooks_ContextParsed  internal/dispatch/context_test.go  15    1      internal  EXTRACTED
Dispatch                    internal/dispatch/dispatch.go      86    1      internal  EXTRACTED
…
```

`table` shows editor lines; record formats (`csv`, `json`, `yaml`)
carry 1-based editor lines, as `table` does.

| Confidence | Meaning | Treat as |
|------------|---------|----------|
| `EXTRACTED` | Callee resolved by scope: same file, same directory, an imported file or Go package, or another root imported by module/package name | Confirmed caller: must be updated |
| `INFERRED` | Name match only; no scoped candidate | Possible caller: verify before editing |

**Success Criteria:**
- [ ] Know which callers are confirmed and which are name-only

#### Step 1.3: Decide on `--strict`

```bash
xray impact <symbol> --depth 3 --strict
```

`--strict` follows `EXTRACTED` edges only. Use it when:

- the name is common (`New`, `parse`, `run`, `get`) and `INFERRED` dominates
  the footer;
- you need a minimal, confirmed list (e.g. for a PR description).

Keep the non-strict run when you need the worst case (public API,
renames). Real example, `New` with 5 definitions:

```
xray impact New --depth 1            → 54 callers across 4 groups · edges: EXTRACTED 44 · INFERRED 10
xray impact New --depth 1 --strict   → 44 callers across 2 groups · edges: EXTRACTED 44 · INFERRED 0
```

If you are changing only one of several same-named definitions, pass its
full id instead of the bare name.

**Success Criteria:**
- [ ] Chose strict or non-strict and know why

### Phase 2: Blast Radius, Whole Workspace (Token Budget: 300)

Skip this phase if the symbol cannot be called from other repositories.

#### Step 2.1: Define a Lens Once

In the workspace root `.xrayrc.json` (paths are directories; relative
ones resolve against the directory you run xray from, so run it from the
workspace root; a missing path is skipped with a warning):

```json
{
  "lenses": {
    "workspace": {
      "paths": ["./poly-nerv", "./xray", "./kit"]
    }
  }
}
```

Several `-p` flags do the same without config:
`xray impact RunHooks -p ./poly-nerv -p ./xray`.

#### Step 2.2: Run `impact` Across Roots

```bash
xray impact <symbol> --lens workspace
```

Real output (two roots, labels `main` and `symbol-impact`; caller lists
cut after two):

```
ℹ cache: main hit · symbol-impact hit
ℹ coverage: served from cache (745 files) · skipped grammars: none
RunHooks (method, main/internal/dispatch/run.go:L109) — 57 callers across 2 groups
  main/cmd: 2 callers — runReplay (main/cmd/nerv/cmd_replay.go:L52), testSingleEvent (main/cmd/nerv/cmd_testhook.go:L140)
  main/internal: 11 callers — TestRunHooks_ContextParsed (main/internal/dispatch/context_test.go:L15), Dispatch (main/internal/dispatch/dispatch.go:L86), …
    …and 6 more
depth 2:
    main/cmd: 10 callers — TestReplayCmd_FlagsReachRunE (main/cmd/nerv/cmd_replay_test.go:L18), TestReplayCmd_NoFlagStillErrors (main/cmd/nerv/cmd_replay_test.go:L40), …
      …and 5 more
    main/internal: 17 callers — TestDispatch_ContextMergedAcrossHooks (main/internal/dispatch/context_test.go:L46), TestDispatch_ContextCapped (main/internal/dispatch/context_test.go:L79), …
      …and 12 more
depth 3:
    main/cmd: 17 callers — TestTestCmd_FlagsReachRunE (main/cmd/nerv/cmd_testhook_test.go:L25), TestTestCmd_AllFlagReachesRunE (main/cmd/nerv/cmd_testhook_test.go:L46), …
      …and 12 more
edges: EXTRACTED 57 · INFERRED 0
```

- Files and groups are prefixed with the root label (the path relative to
  the current directory with `/` → `-`; the basename for roots outside it).
- Callers are grouped by root then top-level directory (`main/cmd`,
  `main/internal`), so a group under another root label than the
  symbol's own is a cross-repo caller.
- `cache: <label> hit|miss`: the first run analyzes every root (`miss`);
  later runs reuse the current directory's cache db (`cache-db` in `xray paths`) for roots
  whose files did not change. Run from the same directory each time.
- Cross-root calls are `EXTRACTED` only through an import of that root's
  Go module path or npm package name. Anything else across roots is
  `INFERRED`, and often noise: merged with xray's sources, a TypeScript
  `program.parse()` shows up as an `INFERRED` caller of xray's `parse`
  methods (calls on builtins such as `JSON.parse` record no edge). Use `--strict` (or `--format table` and filter) before acting
  on cross-root `INFERRED` callers.

**Success Criteria:**
- [ ] Know whether any other repository calls the symbol
- [ ] Cross-root callers you plan to edit are `EXTRACTED` or verified

### Phase 3: Fall Back to Text Search (Token Budget: 200)

`impact` only sees function and method calls it could parse. Fall back to
`xray explore --search` when:

- the header says `0 callers` but you expect some (uses of types,
  constructors, constants and JSX components are not call edges, nor are
  functions passed as values or called through reflection);
- you get `<symbol>: no matching symbol in the graph` (wrong name, or the
  definition is in a skipped language);
- you need the exact call lines (impact gives the calling function's
  definition line).

```bash
xray explore --search RunHooks -t go
```

```
✔ Found matches in 5 file(s):

…/cmd/nerv/cmd_replay.go:
  117: [RunHooks] decisions := runner.RunHooks(

…/cmd/nerv/cmd_testhook.go:
  152: [RunHooks] decisions := runner.RunHooks(

…/internal/dispatch/dispatch.go:
  106: [RunHooks] decisions := d.runner.RunHooks(live, env, cc.Config)
…
```

The search is case-insensitive and also matches comments and
declarations; read each hit.

**Success Criteria:**
- [ ] Every caller from Phase 1 has a call line, or you know why not

### Phase 4: Turn the Output into a Change Plan (Token Budget: 200)

#### Step 4.1: List Callers per Package

```bash
xray impact RunHooks --depth 1 --strict --format json 2>/dev/null | jq -r '
  .nodes | group_by(.file | sub("/[^/]+$"; ""))[]
  | "\(.[0].file | sub("/[^/]+$"; "")) (\(length)): \(map("\(.name) \(.file):\(.line)") | join(", "))"'
```

```
cmd/nerv (2): runReplay cmd/nerv/cmd_replay.go:52, testSingleEvent cmd/nerv/cmd_testhook.go:140
internal/dispatch (10): Dispatch internal/dispatch/dispatch.go:85, TestRunHooks_EmptyList internal/dispatch/run_test.go:48, …
```

Use `--depth 1` for the call sites to edit. Deeper levels are what to
re-test, not what to edit (unless the change propagates, e.g. a new error
return that each caller must pass up).

#### Step 4.2: Write the Plan

```
CHANGE PLAN: (r *Runner) RunHooks(hooks, env, cfg) → RunHooks(ctx, hooks, env, cfg)
==========================================================

DEFINITION:
└─ internal/dispatch/run.go:108

UPDATE TOGETHER (depth 1, EXTRACTED):
├─ internal/dispatch (10): Dispatch dispatch.go:85, 9 tests in run_test.go
└─ cmd/nerv (2): runReplay cmd_replay.go:52, testSingleEvent cmd_testhook.go:140

VERIFY (INFERRED): none

RE-TEST (depth 2-3): 35 callers across cmd, internal
├─ go test ./internal/dispatch/... ./cmd/nerv/...

OTHER REPOS (--lens workspace): none
```

Rules:

- One commit per change that keeps every package compiling: the
  definition and all its `EXTRACTED` depth-1 callers change together.
- Callers in another root are a separate change in that repository;
  sequence it (compatible shim first, or release then update).
- `INFERRED` callers go in the plan only after you confirmed them with
  `explore --search` or by reading the file.

**Success Criteria:**
- [ ] Every depth-1 caller is in UPDATE TOGETHER or VERIFY
- [ ] Tests to run cover the deeper levels
- [ ] Cross-repo callers have their own step

## Validation: Ready to Change?

- [ ] Header matched the intended definition
- [ ] Confirmed (`EXTRACTED`) and name-only (`INFERRED`) callers separated
- [ ] Whole workspace checked if the symbol is exported across repos
- [ ] `explore --search` used for anything `impact` cannot see
- [ ] Change plan lists call sites per package

## Pitfalls to Avoid

**Pitfall 1: Trusting `0 callers` for a type or constructor**
- Only function and method calls are edges
- Fix: `xray explore --search <name>`

**Pitfall 2: Treating every caller as confirmed**
- Name-only callers carry only a ` (inferred)` suffix in the text view
- Fix: check each ` (inferred)` caller (or `--format table`), or `--strict`

**Pitfall 3: Common names**
- `New`, `parse`, `run` match many definitions; the header says `(N definitions)`
- Fix: pass the full id (`path/to/file.go::New`) or use `--strict`

**Pitfall 4: Editing at the definition line**
- `Dispatch (internal/dispatch/dispatch.go:L85)` is where `Dispatch`
  starts, not where it calls `RunHooks`
- Fix: `explore --search` for call lines

**Pitfall 5: Off-by-one lines in the saved graph**
- Every result format (text, tree, table, `json`, `yaml`, `csv`) is 1-based; the saved graph (`map --format json`) stores 0-based lines
- Fix: add 1 when reading the saved graph file directly

**Pitfall 6: Cold multi-root runs**
- The first `--lens` run analyzes every root; it is slower
- Fix: run from the same directory so its cache db is reused

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success, including `no matching symbol in the graph` | Check stdout before assuming callers exist |
| 2 | Bad arguments (missing symbol, bad `--depth`/`--format`, `--graph` with `-p`/`--lens`/`--scope`) | Fix the command |
| 3 | `--graph` file or `--path` root not found | Fix the path |

## Related Documentation

- [Refactoring](refactoring.md) - Full refactoring protocol
- [Code Review](code-review.md) - Reviewing a change's impact
- [Command Selection](../command-selection.md) - Choosing commands
- [Commands: `xray impact`](../../user/commands.md#xray-impact) - Flags and output reference
- [Query guide: impact analysis](../../user/query-guide.md#impact-analysis-with-xray-impact) - `impact` versus `callers()`

---

**Key Takeaway:** Run `xray impact X` first, split confirmed from
name-only callers, widen to the workspace with `--lens` when X crosses
repos, fall back to `explore --search` for what the call graph cannot
see, and plan the edit per package.
