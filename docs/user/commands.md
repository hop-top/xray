# Commands Reference

Complete guide to every xray command and option. Start with the decision tree to find what you need, then dive into details.

## Quick Decision Tree

**What do you want to do?**

- **Understand your codebase structure** → [`xray map`](#xray-map)
- **Find something specific (components, routes, functions)** → [`xray <strategy> <command>`](#xray-strategy-command)
- **Scan for files matching a pattern** → [`xray scan`](#xray-scan)
- **See control flow or data flow** → [`xray graph`](#xray-graph)
- **See what breaks if you change a function** → [`xray impact`](#xray-impact)
- **List every file's imports as a stable JSON contract** → [`xray imports`](#xray-imports)
- **Detect what frameworks are used** → [`xray strategy detect`](#xray-strategy-detect)
- **See all available strategies** → [`xray strategy list`](#xray-strategy-list)
- **Create command shortcuts** → [`xray alias`](#xray-alias)
- **Fix stale results** → [`xray clear-cache`](#xray-clear-cache)
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
`xray scan` and `xray graph`.

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

### `xray scan`

Scan and discover files in your codebase.

```bash
xray scan [paths...] [options]
```

**Examples:**
```bash
# Scan specific directory
xray scan --path ./src

# Filter by file patterns
xray scan --path ./src --match "*.ts" --match "!*.test.ts"
```

### `xray graph`

Generate control flow (CFG) and data flow graphs (DFG).

```bash
xray graph [paths...] [options]
```

**Examples:**
```bash
# Generate both CFG and DFG
xray graph --with cf --with df --output graphs.txt

# Focus on specific directory
xray graph --path ./src/services --with cf --with df
```

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
multi-root run was served from the cache.

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
- Text, tree and table show 1-based editor lines, as `xray query` does.
  `json`, `yaml` and `csv` carry the raw 0-based graph value (`line: 107`
  for `run.go:L108`).

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

Files are listed as `xray scan` lists them (`git ls-files`, else the
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

Clear the SQLite cache used for parsed AST data, for the project in the current directory (other projects' caches stay). `xray cache clear` is the same command (the `cache` group is what `xray --help` lists).

```bash
xray clear-cache
```

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
- **No output specified**: Writes to the current directory. `.xray/` is a directory (strategy detection state), so single files never use that bare name: text chunks `.xray_*.md`; `--no-chunk` text `.xray.txt`; `--format json` `.xray.json`; `--format xml` `.xray.xml`; `--format csv` `.xray.nodes.csv` + `.xray.edges.csv`
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
| `cf` | Enable Control Flow Graph (CFG) |
| `df` | Enable Data Flow Graph (DFG) |

**Example:**
```bash
xray map --with vars --with incs --with cost
```

### Filtering

| Flag | Description |
|------|-------------|
| `-a, --anchor <path>` | Focus analysis on a specific file (Personalized PageRank) |
| `-d, --depth <number>` | Maximum depth of the tree to render |
| `-m, --match <patterns...>` | Match filename patterns (prefix with `!` to negate) |
| `-c, --catch <patterns...>` | Match function/class names (prefix with `!` to negate) |

**Examples:**
```bash
# Filter files
xray map --match "*.ts" --match "*.tsx" --match "!*.test.ts"

# Filter by function names
xray map --catch "User*" --catch "!UserTest"
```

### Output Formats

Select the output with `--format <fmt>` (available on `map`, `scan`, `graph`):

**Formats** (`--format txt|csv|xml|json`, one at a time):
- `txt` - Text format (default)
- `json`, `csv`, `xml` - the *graph formats*: the analysed graph as data.
  All three carry the same nodes and edges, are written once (chunking does
  not apply; identical with or without `--no-chunk`), are sorted
  deterministically (nodes by `id`; edges by `source`, `target`, `type`),
  and accept several `--path` roots (merged, see below).
  `map`, `scan` and `graph` run the same analysis, so their graph outputs
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
keep the raw import list). Every graph `line` is 0-based, the raw
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

**Diagrams** (`--format mermaid|dot`, one at a time; combine with a format):
- `mermaid` - Mermaid diagram (default)
- `dot` - DOT/Graphviz diagram

The per-format flags `--txt`, `--csv`, `--xml`, `--json`, `--mermaid`, `--dot`
remain as aliases (`--json` = `--format json`). `--format` wins over an alias
on the same axis; two different aliases on one axis (`--json --csv`) is a
usage error (exit 2), as is an unknown `--format` value. `xray lang list`
takes `--format text|json` too (`--json` alias). Machine formats
(`json`, `csv`, `xml`) keep advisory INFO hints on stderr quiet unless
verbose.

### Query

```bash
xray map --format json -o graph
xray query --graph graph.json "calls(main)"             # table (default)
xray query --graph graph.json --format json "callers(helper)"
```

Results go to stdout (`--format table|tree|json|yaml|csv`); diagnostics go to
stderr. Exit 2: bad query / missing `--graph` or query / unknown format or
column; exit 3: graph file not found. See the [query guide](query-guide.md).

### Structured output (record commands)

`query`, `impact`, `imports`, `explore`, `paths`, `alias list`, `strategy list` and the strategy
commands (`express routes`, `react components`, `rest-api endpoints`, ...)
render their results through one output layer:

| Flag | Effect |
|------|--------|
| `--format <fmt>` | `text` (default; the human view) or `json`, `yaml`, `table`, `csv`. `query`: `table` (default), `json`, `yaml`, `csv`, `tree` |
| `--cols=a,b` | Pick and order columns (`table`, `csv`; `json`/`yaml` too, except `query`). Unknown column: exit 2 |
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
`map`/`scan`/`graph` keep their own `--format`/`-o` (above).

### Advanced

| Flag | Description |
|------|-------------|
| `-q, --query <items...>` | Override default Tree-sitter queries |
| `--config <path>` | Custom config file path |
| `--lens <name>` | Use named lens (config-file option overlay) |
| `--scope <name>` | Run specific scope from config |
| `--all-scopes` | Run all scopes from config |

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
| 3 | Not found: a `--path` root or a `--graph` file does not exist |

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
