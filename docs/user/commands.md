# Commands Reference

Complete guide to every xray command and option. Start with the decision tree to find what you need, then dive into details.

## Quick Decision Tree

**What do you want to do?**

- **Understand your codebase structure** → [`xray map`](#xray-map)
- **Find something specific (components, routes, functions)** → [`xray <strategy> <command>`](#xray-strategy-command)
- **Find files matching a pattern** → [`xray explore`](#xray-explore)
- **See control flow or data flow** → [`xray graph`](#xray-graph)
- **See what breaks if you change a function** → [`xray impact`](#xray-impact)
- **List every file's imports as a stable JSON contract** → [`xray imports`](#xray-imports)
- **Detect what frameworks are used** → [`xray strategy detect`](#xray-strategy-detect)
- **See all available strategies** → [`xray strategy list`](#xray-strategy-list)
- **Create command shortcuts** → [`xray alias`](#xray-alias)
- **Fix stale results** → [`xray clear-cache --confirm=yes`](#xray-clear-cache)
- **Enable shell completion** → [`xray completion`](#xray-completion)

---

## Core Commands

### `xray map`

Generate a visual map of your codebase structure and dependencies.

```bash
xray map [paths...] [options]
```

`[paths...]` are root directories, exactly like `--path`: `xray map src` is
`xray map --path src`. Giving both is a usage error (exit 2); a root that
does not exist fails as a missing `--path` does. The same applies to
`xray graph`.

**Examples:**
```bash
# Basic map of current directory
xray map

# Specify custom path and output
xray map --path ./src --output codebase-map.txt

# Focus on specific file with extended features
xray map --anchor src/main.ts --with vars --with incs --with cost

# Multiple paths with depth limit
xray map --path ./src --path ./lib --depth 3 --output analysis.txt
```

### `xray explore`

Find files by pattern, search code for keywords, or show codebase
statistics. Prints to stdout; writes nothing.

```bash
xray explore [options]
```

`explore` takes no query: use `--match` to find files and `--search` to
search code (`xray explore foo` is a usage error, exit 2). The default
command, bare `xray <existing-path>`, scans that path as the root. A file as
the path (`xray src/a.ts`, `--path <file>`) is that one file, if the
scanner would list it: a supported extension, not git-ignored, never under
`.git`. Otherwise it is skipped with a warning saying why. `--search` needs
a non-empty keyword. Over MCP, `explore`'s `path` must be a directory.

| Option | Description |
|--------|-------------|
| `-p, --path <path>` | Root directory to explore (repeatable; default: current directory) |
| `-m, --match <pattern>` | Find files matching a pattern, e.g. `"*.ts"` (repeatable) |
| `-t, --type <ext>` | Filter by file extension (repeatable) |
| `-s, --search <keyword>` | Search for a keyword in code (repeatable) |
| `--stats` | Show codebase statistics |
| `--format <fmt>` | `text` (default), `json`, `yaml`, `table`, `csv` |

Patterns are globs matched against the path under the explore root (each
`--path` is its own root), case-insensitively. `*` stays within one path
segment, `**` crosses `/`, and `.` is literal. A pattern without `/` matches
the file name at any depth (`*.ts`); one with `/` matches from the root
(`src/**/*.ts`; a trailing `/` means everything under that directory).
Repeated `--match` patterns combine with OR. A `!` pattern excludes and wins
over every other pattern; with only `!` patterns, every file but those is
listed. More than 256 patterns, a pattern over 1024 characters, or more than 4096
characters across all patterns is a usage
error (exit 2); the same limits apply to `match` in the config file, which
must be an array of strings.

`--match` and `--type` narrow the file set. On their own they list the
files; with `--search` or `--stats` those modes run on the narrowed set only
(keyword hits and statistics for the matching files). `--search` and
`--stats` do not combine: pick one (usage error, exit 2).

**Examples:**
```bash
# List files under a directory
xray explore --path ./src

# Find files by pattern
xray explore --match "*.test.ts" --match "*.spec.ts"

# TypeScript files except tests
xray explore --path ./src --match "*.ts" --match "!*.test.ts"

# Everything under src/api except tests
xray explore --match "src/api/**" --match "!*.test.ts"

# Search keywords only in non-test TypeScript files
xray explore --match "*.ts" --match "!*.test.ts" --search TODO

# Statistics for the files under src/api
xray explore --match "src/api/**" --stats
```

### `xray graph`

`map` with control flow (CFG) and data flow (DFG) graphs: one of each per
function and method, printed under the function in the map (or as `cfg` /
`dfg` fields on its node with `--format json`).

```bash
xray graph [paths...] [options]
```

**Support today:** TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`;
the same builder with a JavaScript table, also wired for `.mjs` / `.cjs`),
Python (`.py`), Go (`.go`). For any other language (Java, C#, Rust, Swift, C,
C++...) the run still succeeds, prints one stderr notice and its functions
carry no graphs:

```text
⚠ cf/df: no flow graphs for rust (1 file) yet; its functions carry none. Supported: typescript, javascript, python, go
```

**Flags:** `graph` turns `cf` and `df` on. Naming either under `--with`
narrows to those (`--with cf`, `--with df`), whatever `features.cf` / `features.df`
say in the config (an explicit `--with` wins for cf/df); other `--with` features
add to the default and to config. `xray map --with cf` / `--with df` produce the same graphs on a
plain map; plain `map` is unchanged and does no flow work. Flow has no CSV
form: `--format csv` with `graph`, `--with cf|df` or config cf/df exits 2 and
says so, never a csv without flow; plain `xray map --format csv` is unchanged
and writes the csv tables. `--format xml` carries it as
`<cfg>` / `<dfg>` children of the function's `<node>`.

```bash
xray graph --path ./src --no-chunk --output flow.txt
xray graph --with cf --path ./src
xray graph --format json --output graph.json
```

Output of the first command for a small function:

```text
a.ts (L1-L8):
│ [L1-L8] function sum(xs: number[], limit: number) : number
│   cfg
│     n0 entry L1 → n2
│     n1 exit L8
│     n2 stmt L2 let total = 0 → n3
│     n3 loop L3 for (const x of xs) → n4:true n7:false
│     n4 cond L4 x > limit → n5:true n6:false
│     n5 break L4 break → n7
│     n6 stmt L5 total += x → n3
│     n7 return L7 return total → n1
│   dfg
│     d0 xs param L1 → n3
│     d1 limit param L1 → n4
│     d2 total decl L2 → n6 n7
│     d3 x loop L3 → n4 n6
│     d4 total update L5 → n6 n7
```

The same shapes for the other languages. Python (`for` ... `else`: the `else`
runs when the loop ends by its iterator, a `break` would skip it; `counts[w] += 1`
is a weak `member` definition of `counts`):

```python
def tally(words):
    counts = {}
    for w in words:
        if w in counts:
            counts[w] += 1
            continue
        counts[w] = 1
    else:
        counts["<done>"] = len(counts)
    return counts
```

```text
a.py (L1-L10):
│ [L1-L10] function tally()
│   cfg
│     n0 entry L1 → n2
│     n1 exit L10
│     n2 stmt L2 counts = {} → n3
│     n3 loop L3 for w in words → n4:true n8:false
│     n4 cond L4 w in counts → n5:true n7:false
│     n5 stmt L5 counts[w] += 1 → n6
│     n6 continue L6 continue → n3
│     n7 stmt L7 counts[w] = 1 → n3
│     n8 stmt L9 counts["<done>"] = len(counts) → n9
│     n9 return L10 return counts → n1
│   dfg
│     d0 words param L1 → n3
│     d1 counts assign L2 → n4 n5 n7 n8 n9
│     d2 w loop L3 → n4 n5 n7
│     d3 counts member L5 weak → n4 n5 n7 n8 n9
│     d4 counts member L7 weak → n4 n5 n7 n8 n9
│     d5 counts member L9 weak → n9
```

Go (`defer` on a panic and on `return`; the deferred literal calls `recover`, so
a panic may end with the function returning normally, `n7`, or go on, `n8`;
named results are read at the exit node `n1`):

```go
func Sum(xs []int) (n int, err error) {
	defer func() { err = wrap(recover()) }()
	for _, x := range xs {
		if x < 0 {
			panic("negative")
		}
		n += x
	}
	return n, nil
}
```

```text
a.go (L3-L12):
│ [L3-L12] function Sum(xs []int)
│   cfg
│     n0 entry L3 → n2
│     n1 exit L12
│     n2 stmt L4 defer func() { err = wrap(recover()) }() → n3
│     n3 loop L5 for _, x := range xs → n4:true n10:false
│     n4 cond L6 x < 0 → n5:true n9:false
│     n5 throw L7 panic("negative") → n6:throw
│     n6 stmt L4 deferred func() { err = wrap(recover()) }() → n7 n8
│     n7 stmt L12 recovered → n1
│     n8 rethrow L12 rethrow → n1:throw
│     n9 stmt L9 n += x → n3
│     n10 return L11 return n, nil → n11
│     n11 stmt L4 deferred func() { err = wrap(recover()) }() → n1
│   closure <anonymous> L4
│     cfg
│       n0 entry L4 → n2
│       n1 exit L4
│       n2 stmt L4 err = wrap(recover()) → n1
│   dfg
│     d0 xs param L3 → n3
│     d1 n decl L3 → n1 n9 n10
│     d2 err decl L3 captured → n1 n2
│     d3 x loop L5 → n4 n9
│     d4 n update L9 → n1 n9 n10
│     d5 n assign L11 → n1
│     d6 err assign L11 captured → n1
│   closure <anonymous> L4
│     dfg
```

JavaScript (`return` inside `try` has a `throw` edge into the `catch`; the
`throw` at the end leaves the function by a `throw` edge):

```javascript
export function retry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn(i);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
```

```text
a.js (L1-L11):
│ [L1-L11] function retry(fn, attempts = 3)
│   cfg
│     n0 entry L1 → n2
│     n1 exit L11
│     n2 stmt L2 let last → n3
│     n3 stmt L3 let i = 0 → n4
│     n4 loop L3 i < attempts → n5:true n9:false
│     n5 return L5 return fn(i) → n1 n6:throw
│     n6 catch L6 catch (e) → n7
│     n7 stmt L7 last = e → n8
│     n8 stmt L3 i++ → n4
│     n9 throw L10 throw last → n1:throw
│   dfg
│     d0 fn param L1 → n5
│     d1 attempts param L1 → n4
│     d2 last decl L2 → n9
│     d3 i decl L3 → n4 n5 n8
│     d4 e catch L6 → n7
│     d5 last assign L7 → n9
│     d6 i update L3 → n4 n5 n8
```

**Reading it.** One line per CFG node: `<id> <kind> L<line> <source> → <successors>`;
a successor `n4:true` is an edge labelled `true`, `false` or `throw`. Kinds:
`entry`, `exit` (always `n1`), `stmt`, `expr` (an operand on one branch),
`cond` (an `if` / ternary / `&&` `||` `??` operand), `loop` (a loop test or
`for-of`/`for-in` head), `switch`, `case`, `return`, `throw`, `break`,
`continue`, `goto`, `catch`, `rethrow` (where an exception leaves a `finally` copy;
its one edge is `throw`). Source text is one line, capped at 60 characters.

One line per definition in the DFG: `<id> <name> <kind> L<line> → <reading CFG nodes>`.
Definition kinds: `param`, `decl`, `assign`, `update` (`++`, `+=`), `loop`
(`for-of` / `for-in` / `range` variable), `catch`, `function`, `class`, `member` (`o.p = v`, weak),
`maybe` (`||=` `&&=` `??=`, and the names a Python `match` pattern binds; weak). A weak definition adds itself without
replacing earlier ones. `captured` marks a variable a nested function
references. With `--with df` alone, the reading nodes are listed first
(`n6 L5 total += x`) so the output stands on its own.

JSON fields (optional; absent without cf/df and on non-functions):

```json
"cfg": { "nodes": [{ "id": "n2", "kind": "stmt", "label": "let total = 0", "line": 1 }],
         "edges": [{ "from": "n3", "to": "n4", "label": "true" }],
         "closures": [{ "name": "inc", "line": 2, "nodes": [], "edges": [] }],
         "truncated": { "nodes": 812, "limit": 500 } },
"dfg": { "nodes": [{ "id": "d0", "name": "xs", "kind": "param", "line": 0, "at": "n0" }],
         "edges": [{ "from": "d0", "to": "n3" }],
         "sites": [{ "id": "n3", "line": 2, "label": "for (const x of xs)" }] }
```

Lines are 0-based like every line the saved graph stores (`query` and
`impact` results are 1-based). Saved graphs with or
without these fields work with `query --graph` and `impact --graph`.

**Limits** (what the graphs do not know):

- Per function; calls are listed per node (`calls` in JSON), not followed.
  Nested functions and closures have their own graphs (`closures`).
- A function with more than 500 CFG nodes keeps its first 500 and says so
  (`truncated` / `(truncated: 500 of 812 nodes)`).
- Work is bounded whatever the source: building a function stops after
  1000 nodes were created (copies of `finally` / `with` exits / deferred calls
  count), and the graph is the first 500 with `(truncated: 500 of 1000+ nodes)`;
  a data flow keeps at most 2000 definitions and 20000 edges; a function with
  more than 256 KB of source, syntax nested deeper than the stack allows, or
  a file whose functions together built 50000 nodes gets no graph for the
  function, and one stderr line counts them (`cf/df: skipped 2 functions
  (nested too deeply); no graphs for them`). A node keeps at most 500 reads
  and 200 callee names.
- Only `throw`, calls, `new` and `await` are known to throw. A `try` body
  with none of them keeps its `catch` anyway: every statement of the body
  gets a `throw` edge into it (anything may throw: getters, stack overflow),
  so the catch and its variable are never missing. An empty `try` body has no
  such edge. A `finally` is copied once per way into it (normal, `return`,
  `break`/`continue`, exception); the exception copy ends in a `rethrow`
  node, whose `throw` edge leaves the function or reaches the outer `catch`.
- Code after `return`, `throw`, `break` or `continue` is unreachable and
  omitted. `?.` optional chaining is not a branch. A `ternary` or `&&` inside
  a nested function belongs to that function's graph.
- Data flow is variable rebinding only. A call never defines anything: a
  call that mutates its argument or receiver (`xs.push(1)`) changes nothing
  in the DFG, and `o.p = v` is a weak definition of `o` (aliases are not
  tracked). Reads and writes of a captured variable inside a closure are not
  tracked; the variable is flagged `captured`, and the closure counts as a
  read of it where it is created. Hoisted function declarations are defined
  at entry. Globals and imports have no definition (no edge).

**Per language** (on top of the limits above):

- JavaScript: a class field holding an arrow function (`push = (x) => {}`) is
  a field, not a function: no graph of its own (the field's value is not
  analysed as a closure of anything). `.mjs` and `.cjs` files are not scanned
  by `map` at all today, so they never reach the flow builder; JSX tags are
  ordinary reads of the tag identifier. `for await` is a plain loop head.
- Python: anything that reads a name may raise, so inside a `try` or `with`
  every node that reads a variable has a `throw` edge (a node of literals,
  `x = 1`, has none). A `with` exit runs once per way out like a `finally`
  (`end with ...` nodes, then `rethrow`); a context manager that swallows
  the exception (`suppress`, `__exit__` returning true) is not modelled: the
  exception is assumed to continue. `except` clauses are tried in order
  (`true` / `false` edges); an exception no clause takes continues through a
  `rethrow` node. `match`: one `case` node per case (a `true` / `false` pair),
  guards are `cond` nodes, the names a pattern binds are weak (`maybe`)
  definitions at the test, `case _` and a bare name take everything left.
  Comprehensions and generator expressions are one node: their variables are
  their own scope, not tracked, and the tests inside them do not branch.
  `yield` may raise (the caller can throw into it) but a generator's
  suspension is not modelled. `del x` is a read, not a kill. A `def` binds its
  name and reads what it captures at the `def` node; decorators and defaults
  run there too. Class bodies are one node; names bound in a class body are
  not visible to its methods. `global x` has no definition here (globals are
  free), `nonlocal x` marks the outer variable captured. Chained comparisons
  (`a < b < c`) are one test. `exec`, `eval`, `globals()` and `setattr` are
  not modelled.
- Go: `defer` is a node where it is registered and a `deferred ...` node on
  every way out that comes after it in the source (each `return`, the end of
  the function, a panic), last registered first; a `defer` in a branch or
  loop counts as registered for every exit that follows it in the source, and
  a loop registers once. Only calls and an explicit `panic(...)` panic:
  index out of range, a nil dereference or a division by zero are not
  modelled. A deferred function literal that calls `recover()` adds a
  `recovered` node (the function returns normally) next to the `rethrow`; a
  `recover()` in something that literal calls is not seen. `os.Exit`,
  `log.Fatal` and `runtime.Goexit` are ordinary calls here. Named results are
  defined at entry, assigned by `return a, b` and read at the exit node (the
  exit node's reads show which assignments reach the caller); writes to them
  from a deferred closure are not tracked (`captured`). `go f(x)` is one node:
  its arguments are read there, the call is not part of this graph; a
  function literal is a closure with its own graph. `select` enters exactly
  one communication (an edge from the `select` node to each, no condition);
  `select {}` and `for {}` without `break` leave the exit with no incoming
  edge. `goto` links to the first node of its label; each `case` list is one
  test. In a type switch the alias is defined at the switch node. `range`
  defines its variables at the loop head, so an empty range still counts as
  having assigned them; range over a function is an ordinary range. A struct
  literal key (`T{name: v}`) is a field name, not a read; a map literal key
  is. A write through a pointer (`*p = v`) reads `p`.

### `xray impact`

List the transitive callers of a function or method ("what breaks if I
change X?"), grouped by area.

```bash
xray impact <symbol> [--depth N] [--strict] [--format <fmt>] [--cols <list>] [-o <file>]
                     [-p <path>... | --lens <name> | --scope <name> | --graph <file>]
```

`<symbol>` is a name or glob, matched like `xray query` (`RunHooks`,
`'New*'`, or a full id such as `internal/dispatch/run.go::RunHooks`).
Every definition that matches is a starting point. xray walks inbound
`calls` edges breadth-first and reports each caller once, at its shortest
distance from the symbol.

| Flag | Effect | Default |
|------|--------|---------|
| `--depth <n>` | Caller levels to follow (positive integer) | `3` |
| `--strict` | Follow `EXTRACTED` call edges only (drop `INFERRED`) | off |
| `--graph <file>` | Read a saved graph (`map --format json`) instead of building one; cannot be combined with `-p`, `--lens` or `--scope` | build in memory |
| `-p, --path <path>` | Root to analyze (repeatable; two or more roots are merged) | config `paths` or cwd |
| `--lens <name>` / `--scope <name>` | Pick roots and options from the config file | none |
| `--lang <list>` | Languages to parse | all detected |
| `--format <fmt>` | `text` (default), `brief`, `tree`, `json`, `yaml`, `table`, `csv` | `text` |
| `--cols <list>` | `table`/`csv` columns: `name`, `kind`, `file`, `line`, `depth`, `group`, `confidence`, `id` | `name,file,line,depth,group,confidence` |
| `-o, --output <path>` | Write the result to a file; the format follows its extension unless `--format` is given | stdout |

Without `--graph`, the graph is built in memory for the resolved roots
(same config, lens and scope resolution as `map --format json`). No map
file is written, and stderr gets one coverage line:
`ℹ coverage: 318 files parsed · skipped grammars: none`, or
`ℹ coverage: served from cache (715 files) · …` when every root of a
multi-root run was served from the cache. When the config sets `match`,
stderr also gets a `note:` line naming the patterns: `impact` has no
`--match`, so results in other files are not reported. `--quiet` silences
both lines; a saved `--graph` is never narrowed by config.

**Text output** (`xray impact RunHooks --depth 2 -p ../poly-nerv`):

```
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

- **Header**: the symbol with kind and location (`file:L108`, the same
  form as callers), then total callers and groups. When several definitions match, the header reads
  `New (5 definitions)` and a `defined:` line lists them (first 5).
- **Depth 1** lines come first, unlabeled; deeper levels follow under
  `depth N:`. Each group line lists up to 5 callers, then `…and N more`.
- **Callers** are the calling *functions*, shown with their definition
  line (`file:L52`). A caller that is not `EXTRACTED` is suffixed
  ` (inferred)`, as in `map` "used by" lines (text and tree). The graph stores no call-site positions; use
  `xray explore --search <name>` for the exact call lines.
- **Groups**: the first path segment under the root
  (`internal/dispatch/run.go` → `internal`; `.` for files at the root).
  On a merged multi-root graph, the root label then that segment, as one
  flat key (`alpha/internal`; the label alone for a root's top-level
  files); `json` `groups[].name` uses the same key.
- **Footer** (`edges: EXTRACTED 35 · INFERRED 0`): the number of `calls`
  edges walked (shortest-path edges only), by confidence. It counts
  edges, not callers.
- Results are 1-based in every format (text, tree, table, `json`, `yaml`,
  `csv`), as `xray query` shows them (`line: 108` for `run.go:L108`); the
  saved graph stores 0-based lines.

**Brief output** (`--format brief`): the text summary cut down for hook
scripts and other size-bounded consumers. The same header, one line per
group (most callers first) naming its first 3 callers (shallowest first,
` (inferred)` kept), and the `edges:` footer; at most 1200 characters,
cut at a line end with a final `…` line. It prints **nothing** (exit 0)
when no symbol matches or nothing calls it, so a script can forward the
output as is. Combine with root `--quiet` and a saved graph for an
empty stderr and no rebuild:

```bash
xray --quiet impact RunHooks --graph graph.json --depth 2 --format brief
```

```
RunHooks (method, internal/dispatch/run.go:L108) — 35 callers across 2 groups
  internal: 24 callers — Dispatch (internal/dispatch/dispatch.go:L85), TestRunHooks_EmptyList (internal/dispatch/run_test.go:L48), TestRunHooks_AllowHandler (internal/dispatch/run_test.go:L56), …and 21 more
  cmd: 11 callers — runReplay (cmd/nerv/cmd_replay.go:L52), testSingleEvent (cmd/nerv/cmd_testhook.go:L140), TestReplayCmd_FlagsReachRunE (cmd/nerv/cmd_replay_test.go:L18), …and 8 more
edges: EXTRACTED 35 · INFERRED 0
```

**Record formats.** `table` and `csv` have one row per caller with the
columns `name`, `file`, `line`, `depth`, `group`, `confidence` (`kind`
and `id` are available through `--cols=`); `-o <file>` writes the result
to a file, picking the format from its extension
([structured output](#structured-output-record-commands)). `json`/`yaml` emit
`{symbol, nodes, edges, groups, counts}`: `symbol.matches` lists the
matched definitions, every node has `depth`, `group` and `confidence`,
every edge has `from` (caller), `to` (callee) and `confidence`, and
`counts` holds `callers`, `groups`, `byDepth` and the edge counts
`EXTRACTED`, `INFERRED`, `AMBIGUOUS`.

**Confidence.** Every `calls` edge carries one:

| Value | Meaning |
|-------|---------|
| `EXTRACTED` | Resolved by scope: the callee is in the caller's file, its directory, a file it imports, a Go package it imports, or (merged graphs) a root it imports by Go module path or npm package name |
| `INFERRED` | Matched by name only: no scoped candidate, so every same-named definition in the language is a candidate |

Member calls (`recv.Name()`) resolve against methods only. A caller counts
as `EXTRACTED` when some shortest path from it to the symbol is
`EXTRACTED` end to end. `--strict` drops `INFERRED` edges before the walk,
so name-only matches never pull in further callers. Example: `New` in
poly-nerv has 5 definitions; `--depth 1` finds 54 callers
(`edges: EXTRACTED 44 · INFERRED 10`), `--depth 1 --strict` finds 44.

**Several roots.** Pass several `-p` roots, or a lens whose config sets
`paths`, to analyze them as one
[merged graph](#merged-multi-root-graphs): ids and files are prefixed with
the root label, callers are grouped by root then top-level directory,
and calls across roots are linked. Two Go modules, `beta` importing
`alpha` (`xray impact Hello -p alpha -p beta`):

```
ℹ cache: alpha miss · beta miss
ℹ coverage: 4 files parsed · skipped grammars: none
Hello (function, alpha/greet/greet.go:L3) — 4 callers across 3 groups
  alpha/internal: 2 callers — Start (alpha/internal/run/run.go:L5), Again (alpha/internal/run/run.go:L7)
  alpha/cmd: 1 caller — main (alpha/cmd/app/main.go:L5)
  beta/pkg: 1 caller — Use (beta/pkg/use/use.go:L5)
edges: EXTRACTED 4 · INFERRED 0
```

Multi-root runs cache per-root and merged graphs in the current
directory's cache db (user cache dir, `cache-db` in `xray paths`) and print one line per root on stderr:

```
ℹ cache: main miss · symbol-impact miss     # first run
ℹ coverage: 715 files parsed · skipped grammars: none
ℹ cache: main hit · symbol-impact hit       # nothing changed since
ℹ coverage: served from cache (715 files) · skipped grammars: none
```

A root is re-analyzed only when its scanned files (path, mtime, size),
`package.json` or `go.mod`/`go.work` changed.

**Exit codes.** `0` on success, including `<symbol>: no matching symbol in
the graph` (stdout). `2` on bad arguments: missing `<symbol>`, a
`--depth` that is not a positive integer, an unknown `--format`, or
`--graph` with `-p`/`--lens`/`--scope`. `3` when the `--graph` file or a
`--path` root does not exist.

**Examples:**
```bash
xray impact createSession                    # 3 levels, current project
xray impact 'New*' --depth 1 --strict        # direct, scope-resolved callers only
xray impact RunHooks --format table          # one row per caller, with confidence
xray impact RunHooks -p ./svc-a -p ./svc-b   # across two roots
xray map --format json -o graph && xray impact Run --graph graph.json --format json
```

See the [query guide](query-guide.md#impact-analysis-with-xray-impact) for
how `impact` relates to `callers()`.

### `xray imports`

Every file's imports as the [`xray.imports/v1`](imports-contract.md)
document: 1-based line/column (UTF-16 columns), module as written and
normalized, package, locality, plus parse errors and constructs xray cannot
follow (`complete: false` on the file). For tools that use imports as
evidence; parses only (no graph, no strategies).

```bash
xray imports [paths...] [-p <root>] [--lang <list>] [--format <fmt>] [--cols <list>] [-o <file>] [--no-ignore] [--no-cache]
```

| Option | Meaning |
|--------|---------|
| `[paths...]` | Narrow to these files/directories (relative to the current directory; each must be inside the root) |
| `-p, --path <root>` | Root; every `path` in the document is relative to it, and `root` echoes it as given. Default: current directory. One root per document |
| `--lang <list>` | Contract languages to include: `python`, `go`, `rust`, `typescript` (`ts`), `javascript` (`js`), `php`; comma-separated, repeatable |
| `--format` | `json` (default) or `yaml`: the whole document. `table`, `csv`: one row per import (`file`, `line`, `column`, `kind`, `form`, `module`, `normalized`, `locality`; `--cols` adds `language`, `endLine`, `endColumn`, `package`, `alias`, `typeOnly`, `confidence`, `evidence`). `text`: per-file summary |
| `--no-ignore` | List every source under the root: git-ignored files, nested repos and vendored dirs (`node_modules`, `dist`, `build`) included; only `.git` is skipped, directory symlinks are not followed. Languages outside the contract show as `unsupported-language`. `package.json` files under `node_modules` are not read for resolution |
| `--no-cache` | Parse every file; neither read nor write the per-file cache. The cache is keyed per file, so runs with and without `--no-ignore` share it safely |

Files are listed as `xray explore` lists them (`git ls-files`, else the
root's `.gitignore`), plus `.mjs`/`.cjs`/`.mts`/`.cts`. `--lang` and
`[paths...]` select the files reported; manifests (`go.mod`, `go.work`,
every `package.json`, `Cargo.toml`) anywhere under the root (not
gitignored) are always read for module resolution and never listed in
`files`. Output goes to
stdout (or `-o`); nothing is written into the scanned tree. Unchanged
files come from a per-file cache in xray's cache directory
(`cache-dir/imports`, see [Caching](imports-contract.md#caching)); output
is the same with `--no-cache`. Two runs on the same input are
byte-identical.

**Exit codes.** `0` whenever a document is produced: parse errors and
unsupported constructs are data, not failures. `2` on usage errors (unknown
`--lang` or `--format`, a path outside the root). `3` when the root or a
path does not exist.

**Text output** (`xray imports go/raw-string python/relative --format text`
in `__tests__/fixtures/imports`):

```
go/raw-string/main.go (go, ok)
  3:1  static import  github.com/example/raw  [unknown]
  6:2  static import  example.com/é/v2  [unknown]
  7:2  static import  example.com/interp  [unknown]
python/relative/app/__init__.py (python, ok)
python/relative/app/pkg/__init__.py (python, ok)
python/relative/app/pkg/mod.py (python, ok)
  1:1  static from  .  [unknown]
  2:1  static from  .sibling  [unknown]
  3:1  static from  ..pkg.mod  [unknown]
  4:1  static from  ..  [unknown]
  5:1  static from  .star  [unknown]
  6:1  static from  ...  [unknown]
4 files, 4 complete · 9 imports · 0 unsupported · 0 parse errors
```

**Examples:**
```bash
xray imports                                 # current directory, JSON document
xray imports -p ../svc --lang go,rust        # one root, two languages
xray imports src/api --format table          # one row per import under src/api
xray imports -o imports.json                 # write the document to a file
```

`xray describe` lists the command with its schema id and file
(`output.schema`, `output.path`); the MCP server exposes it as the
[`imports` tool](mcp.md#tools).

### `xray <strategy> <command>`

Run framework-specific commands provided by strategies.

```bash
xray <strategy> <command> [options]
```

**Examples:**
```bash
# List React components
xray react components

# List Express routes
xray express routes
```

See [Strategies Guide](strategies.md) for all available strategy commands.

**`xray build run --target <name>`**: prints the command for the target
(`make build`, `npm run test`, `just ...`, `task ...`) and runs nothing.

**`xray build exec <target>`**: runs the target. The tool is spawned
directly with an argument list (no shell), in the project root, with
inherited stdio. The target must be one of the detected targets (unknown:
exit 3, nothing runs; names starting with `-` are refused). Exit status is
the child's; a child killed by a signal exits 1 with a message; a build
tool missing from `PATH` exits 3. Nothing else is printed on stdout, so
`--format` has no effect.

It executes the repo's own recipe, so it is a `destructive-local`,
non-idempotent command: without `--confirm=yes` (or an answer at a
terminal prompt) it is refused with exit 5 and runs nothing. A root
`--dry-run` prints the plan (the command that would run) and runs nothing.
The MCP server does not expose it.

```bash
xray --confirm=yes build exec test
xray --dry-run build exec test
```

### `xray strategy detect`

Detect which strategies apply to your project.

```bash
xray strategy detect
```

### `xray strategy list`

List all available strategies.

```bash
xray strategy list
```

### `xray alias`

Manage command aliases - create shortcuts for frequently-used strategy commands.

```bash
# List all configured aliases
xray alias list

# Create a new alias
xray alias set <name> "<strategy> <command>"

# Remove an alias
xray alias remove <name>
```

**Examples:**
```bash
# Create shortcuts
xray alias set comp "react components"
xray alias set routes "express routes"
xray alias set api "rest-api endpoints"

# List configured aliases
xray alias list

# Use the alias (restart xray after creating)
xray comp

# Remove an alias
xray alias remove comp
```

**Notes:**
- Aliases are stored in `.xrayrc.json`
- Target must include both strategy and command name
- Cannot override built-in commands
- Requires restart after creating/modifying aliases

See [Command Aliases Guide](aliases.md) for detailed documentation.

### `xray clear-cache`

Clear the SQLite cache used for parsed AST data, for the project in the current directory (other projects' caches stay). `xray cache clear --confirm=yes` is the same command (the `cache` group is what `xray --help` lists).

```bash
xray clear-cache --confirm=yes
```

This is a destructive command: in a terminal it asks first; scripts and agents (no terminal) must pass `--confirm=yes` or it exits 5.

### `xray upgrade --check`

Report whether a newer release exists. `--check` is the only mode; bare `xray upgrade` is a usage error (exit 2) that points at `--check` and at the install command, `npm i -g @hop-top/xray`. Nothing is installed.

```bash
xray upgrade --check
xray upgrade --check --format json
```

A newer release is a normal answer: exit 0, with `update available: vA → vB` and the release URL (JSON: `updateAvailable: true`, `latest`, `url`). Up to date is exit 0 too (`updateAvailable: false`, `latest: null`). A failed lookup, or `--offline`, exits 6 (transient). The lookup is never served from the startup-notice cache.

### `xray completion`

Generate shell completion scripts: `bash`, `zsh`, `fish`, `powershell`.

```bash
# For bash (needs bash-completion v2)
eval "$(xray completion bash)"

# For zsh
eval "$(xray completion zsh)"

# For fish
xray completion fish > ~/.config/fish/completions/xray.fish

# For PowerShell
xray completion powershell | Out-String | Invoke-Expression
```

Scripts call back into `xray __complete` on each tab, so strategy
commands, aliases, flags and flag values (`--format`, `--log-level`,
`--lang`, paths) always match the installed xray. `--no-descriptions`
omits descriptions. A missing or unknown shell exits 2.

## Flags & Options

### Core Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --path <paths...>` | Root directories to analyze (repeatable) | current directory |
| `-o, --output <path>` | Output file path | `.xray` (see below) |
| `-l, --limit <number>` | Token limit for output | 4096 |

**Output File Behavior:**
- **No output specified**: Writes to the current directory. `.xray/` is a directory (user strategies), so single files never use that bare name: text chunks `.xray_*.md`; `--no-chunk` text `.xray.txt`; `--format json` `.xray.json`; `--format xml` `.xray.xml`; `--format csv` `.xray.nodes.csv` + `.xray.edges.csv`
- **Output with dot prefix** (e.g., `.myoutput`): Used as-is, no extension added
- **Output with extension** (e.g., `analysis.txt`): Used as-is
- **Output without extension** (e.g., `mymap`): Auto-appends format extension

**Note:** Multiple paths are analyzed separately and compacted together with clear separators.

### Features (`-w, --with`)

Enable additional analysis features (repeatable):

| Feature | Description |
|---------|-------------|
| `vars` | Include local variables and constants |
| `incs` | Include imports and dependency table |
| `docs` | Include docstrings |
| `cost` | Estimate and display cost (requires `OPENAI_API_KEY`) |
| `cf` | Control Flow Graph per function (TypeScript, JavaScript, Python, Go; see [`xray graph`](#xray-graph)) |
| `df` | Data Flow Graph per function (TypeScript, JavaScript, Python, Go; see [`xray graph`](#xray-graph)) |

**Example:**
```bash
xray map --with vars --with incs --with cost
```

### Filtering

| Flag | Description |
|------|-------------|
| `-a, --anchor <path>` | Focus analysis on a specific file (Personalized PageRank) |
| `-d, --depth <number>` | Maximum depth of the tree to render |
| `-m, --match <pattern>` | Analyze only files matching a pattern (`!` to exclude; repeatable) |
| `-c, --catch <patterns...>` | Match function/class names (prefix with `!` to negate) |

`--match` takes the same patterns, with the same rules, as
[`explore --match`](#xray-explore) (globs on the path under each root; OR;
`!` excludes and wins), so both commands agree on the file set. It applies
to `map` and `graph` in every format. The `match` list in the config file
(top level, a lens or a scope) is the same list; `--match` on the command
line replaces it. When no file matches, a warning on stderr says so and the
output is empty.

**Examples:**
```bash
# Filter files
xray map --match "*.ts" --match "*.tsx" --match "!*.test.ts"

# Filter by function names
xray map --catch "User*" --catch "!UserTest"
```

### Output Formats

Select the output with `--format <fmt>` (available on `map` and `graph`):

**Formats** (`--format txt|csv|xml|json`, one at a time):
- `txt` - Text format (default)
- `json`, `csv`, `xml` - the *graph formats*: the analysed graph as data.
  All three carry the same nodes and edges, are written once (chunking does
  not apply; identical with or without `--no-chunk`), are sorted
  deterministically (nodes by `id`; edges by `source`, `target`, `type`),
  and accept several `--path` roots (merged, see below).
  `map` and `graph` run the same analysis, so their graph outputs
  are identical.

| Format | Files written (`-o <out>`) |
|--------|----------------------------|
| `json` | `<out>` (`-o name` becomes `name.json`): one `{metadata, nodes, edges}` document, the shape `xray query --graph` reads |
| `xml` | `<out>` (`-o name` becomes `name.xml`): one document, shape below |
| `csv` | two RFC 4180 tables, `<out>.nodes.csv` and `<out>.edges.csv` (a trailing `.csv` on `-o` is not doubled; `-o name` gives `name.nodes.csv`) |

CSV columns (fixed order, header row; empty = absent):

- `<out>.nodes.csv`: `id,type,label,kind,file,line,endLine,signature,doc,rank,root`
- `<out>.edges.csv`: `source,target,type,confidence,community`

`root` is the root label for merged graphs and empty for a single root.
File imports are not a column: they are the `imports` edges (JSON/XML also
keep the raw import list). Every saved-graph `line` is 0-based (`query` and `impact` results are 1-based), the raw
`imports[].line` included (`import os` on the first line is `line: 0`);
the [`xray imports`](imports-contract.md#line-numbers) contract is 1-based
(lines and UTF-16 columns). Load with any CSV tool, e.g.
`duckdb -c "select * from 'g.edges.csv'"`.

XML shape (text is escaped; control characters illegal in XML 1.0 become
U+FFFD):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<graph>
  <metadata version="1.0" timestamp="..." projectPath="..." nodeCount="8" edgeCount="9">
    <roots><root label="api" path="/abs/api"/></roots>   <!-- merged graphs only -->
  </metadata>
  <nodes>
    <node id="api/a.ts::f" type="tag" label="f" kind="function" file="api/a.ts" line="1" endLine="3" signature="()" rank="0.1" root="api">
      <doc>...</doc>                                     <!-- only if present -->
      <imports><import file="..." source="..." text="..."/></imports>  <!-- file nodes -->
    </node>
  </nodes>
  <edges>
    <edge source="..." target="..." type="calls" confidence="EXTRACTED" community="..."/>
  </edges>
</graph>
```

#### Merged multi-root graphs

With more than one distinct `--path`, the graph formats write ONE graph: the
union of every root's nodes and edges.

- Every node `id` and `file` (and import `file`) gets a root-label prefix,
  `<label>/<id>` (e.g. `api/src/main.ts::main`), so equal root-relative ids
  from different roots cannot collide. A single root is never prefixed and
  its output is unchanged.
- Label = the root's path relative to the current directory with `/` turned
  into `-` (`packages/api` becomes `packages-api`); roots outside the current
  directory use their basename. Duplicate labels get `-2`, `-3`, ... in
  argument order. Labels never contain `/`.
- `metadata.roots` lists `{label, path}` (absolute path) per root;
  `metadata.projectPath` is the roots' common ancestor.
- Each root is analyzed on its own; afterwards one cross-root pass resolves
  the calls that found no definition in their own root against the other
  roots. A call through an import that maps to another root (a Go import
  path under that root's `go.mod` module path; an npm specifier equal to, or
  under, that root's `package.json` `name`) links `EXTRACTED`; otherwise a
  same-named definition in the same language is `INFERRED`. Member calls
  (`x.run()`) only reach methods; Go qualified calls (`pkg.Run()`) only reach
  the imported package. These `calls` edges carry `crossRoot: true` (JSON).
  `rank` values are per-root.
  Same-named definitions in an unrelated root are a common source of
  `INFERRED` noise: merge a TypeScript project with xray's own sources and
  its `program.parse()` links `INFERRED` to each `parse` method in xray.
  `xray impact --strict` ignores such edges. Calls on builtin receivers
  (`JSON.parse`, `fmt.Println`, `std::fs::read`) record no edge at all.
- `xray query` works unchanged: a bare name (`calls(main)`) matches that
  function in every root; a full id (`calls(web/src/main.ts::main)`) picks one.
- `xray impact` on several roots (several `-p`, or `--lens <name>` with
  `lenses.<name>.paths`) builds the same merged graph in memory and groups
  callers by root then top-level directory (`api/internal`). It caches each root's graph and the merged graph
  in the current directory's cache db (`cache-db` in `xray paths`) and reports
  `cache: <label> hit|miss` per root on stderr; see
  [`xray impact`](#xray-impact).

The per-format flags `--txt`, `--csv`, `--xml`, `--json` remain as aliases
(`--json` = `--format json`). `--format` wins over an alias; two different
aliases (`--json --csv`) is a usage error (exit 2), as is an unknown
`--format` value (the error lists the valid ones). `xray lang list`
takes `--format text|json` too (`--json` alias). Machine formats
(`json`, `csv`, `xml`) keep advisory INFO hints on stderr quiet unless
verbose.

### Query

```bash
xray query "calls(main)"                                # builds the graph in memory (-p, --lens, --scope as for impact)
xray map --format json -o graph
xray query --graph graph.json "calls(main)"             # read a saved graph instead
xray query --graph graph.json --format json "callers(helper)"
```

Results go to stdout (`--format table|tree|json|yaml|csv`); diagnostics go to
stderr. Exit 2: bad query or missing query / `--graph` with `-p`, `--lens` or
`--scope` / unknown format or column; exit 3: graph file or root not found. See the [query guide](query-guide.md).

### Structured output (record commands)

`query`, `impact`, `imports`, `explore`, `paths`, `alias list`, `strategy list` and the strategy
commands (`express routes`, `react components`, `rest-api endpoints`, ...)
render their results through one output layer:

| Flag | Effect |
|------|--------|
| `--format <fmt>` | `text` (default; the human view) or `json`, `yaml`, `table`, `csv`. `query`: `table` (default), `json`, `yaml`, `csv`, `tree` |
| `--cols=a,b` | Pick and order columns of `table` and `csv` only. With `json`, `yaml` or `xml` it is ignored with one stderr warning (silenced by `--quiet`) and stdout stays the whole document. Unknown column: exit 2 |
| `-o, --output <path>` | Write to a file; without `--format` the extension picks the format |
| `--format-opt k=v` | Per-format option (`indent=4`, `delimiter=;`, `no-header`) |
| `--format-help [fmt]` | List formats and their options |

Records per command:

| Command | Columns |
|---------|---------|
| `impact` | `name`, `file`, `line`, `depth`, `group`, `confidence` (also `kind`, `id`) |
| `imports` | `file`, `line`, `column`, `kind`, `form`, `module`, `normalized`, `locality` (also `language`, `endLine`, `endColumn`, `package`, `alias`, `typeOnly`, `confidence`, `evidence`); default format `json` (the whole document) |
| `explore` | `type`, `path` |
| `explore -m` | `path` |
| `explore -s` | `file`, `line`, `keyword`, `content` (every match; the text view caps 5 per file) |
| `explore --stats` | `type`, `files`, `lines` |
| `paths` | one record: `projectRoot`, `projectConfig`, `globalConfig`, `cacheDb`, `cacheDbExists`, `telemetry`, `configDir`, `dataDir`, `cacheDir`, `stateDir` |
| `alias list` | `alias`, `target` |
| `strategy list` | `name`, `version`, `commands` |
| strategy commands | the fields each command returns (union across records); nested values render as JSON in `table`/`csv` |

Use `--cols=a,b` (with `=`) on commands that take a positional argument: the
space form takes every following word as a column. Graph strategy commands
(`build graph`, `cicd graph`, `infrastructure graph`) also accept
`--format dot`. `go-cli commands` keeps its own `--format text|json`.
`map`/`graph` keep their own `--format`/`-o` (above).

### Advanced

| Flag | Description |
|------|-------------|
| `-q, --query <items...>` | Override default Tree-sitter queries |
| `--config <path>` | Custom config file path |
| `--lens <name>` | Use named lens (config-file option overlay) |
| `--scope <name>` | Run specific scope from config |
| `--all-scopes` | Run all scopes from config; exclusive with `-o/--output`, `--path` and `--lens` (usage error) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for `-w cost` feature |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Not found: a `--path` root, a `--graph` file, a strategy, an alias or a build target does not exist |
| 4 | Conflict: the name or file already exists (`alias set` on a reserved name, `strategy create` over an existing file) |
| 5 | Unauthorized / permission denied, or a destructive command refused without `--confirm=yes` |
| 6 | Transient failure; a retry may clear it |
| 7 | Consent refused |

Codes follow `@hop-top/kit`. `xray describe` lists, per command, the codes it can produce.

### Errors as JSON

Every command accepts `--format json` (except `help` and `completion`,
whose output is text by nature), also written `--format=json`, or `--json`
where a command has it. A succeeding command then prints one JSON document
on stdout (state-changing commands: a small result object such as
`{"alias":"x","target":"a b","action":"created"}`), and a failing command
writes one error object to stderr and nothing to
stdout; the exit code is the table above. The object is `@hop-top/kit`'s
error envelope:

```json
{
  "code": "NOT_FOUND",
  "message": "Target \"nope\" not found in any build file",
  "exit_code": 3,
  "transience": "permanent"
}
```

| Field | Meaning |
|-------|---------|
| `code` | `GENERIC` (1), `USAGE` (2), `NOT_FOUND` (3), `CONFLICT` (4), `UNAUTHORIZED` (5), `TRANSIENT` (6), `CONSENT_REFUSED` (7) |
| `message` | What failed; never a stack trace |
| `exit_code` | The process exit code |
| `transience` | `transient`, `permanent` or `unknown` |
| `suggested_fix`, `cause`, `alternatives` | Only when the failure carries them (kit's refusals do) |

Usage errors from the parser (unknown option, surplus argument, unknown
command) use the same object. Other formats (`txt`, `csv`, `xml`) and text
mode print `✖ <message>`. `xray imports` defaults to JSON output, so its
errors are JSON without a flag; an explicit `--format text|table|csv|yaml`
keeps the `✖ <message>` line. Add `--quiet` to keep log lines off stderr.
`xray describe` lists the shape under `errors`.

## Output Format

### Tree Structure

```
utils.ts (L5-L50):
│ [L5-L12] function helper
│ [L15-L20] function validate
│ [L25] const API_KEY
```

**Format:**
- File headers show line ranges: `file.ts (L1-L100):`
- Tags show exact locations: `[L5-L12]` or `[L25]` for single-line
- Line numbers are 1-indexed

### Cross-File References

```
helper.ts (L5-L20):
│ [L5-L12] function formatData
│       → used by: [main.ts:L15](L10-L25)
│       → used by: [router.ts:L8](L5-L18)
```

- Shows which files call each function
- Format: `[file:L#](L#-L#)` where first `L#` is call location, range is calling function extent
- Only cross-file references shown (max 3 per function)

### External Dependencies Table

When using `-w incs`:

```
## External Dependencies
| Library | Used By |
|---------|---------|
| fs | main.ts, utils.ts |
| express | server.ts |
```

## Custom Queries

Override default Tree-sitter queries for any language:

```bash
# Explicit mapping
xray map --query .ts:./custom-typescript.scm

# Auto-detect from filename (infers .py)
xray map --query ./python.scm

# Scan directory for queries
xray map --query ./my-queries-dir

# Remote URL (infers .ts from filename)
xray map --query https://example.com/typescript.scm

# Combine multiple
xray map --query .ts:./ts.scm --query ./python.scm
```

**Query Format:** Tree-sitter S-expression patterns
```scheme
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class
```

> **⚠️ Security Note:** Tree-sitter queries are pattern-matching expressions and cannot access your file system or network. However, ensure you trust the source of remote queries.

## See Also

- [Configuration](configuration.md) - Set up config files
- [Strategies](strategies.md) - Framework-specific commands
- [Troubleshooting](troubleshooting.md) - Common issues
