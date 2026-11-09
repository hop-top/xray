# Query System User Guide

The xray query system allows you to interactively explore your codebase's call graph using a simple, function-based query syntax.

## Table of Contents

- [Getting Started](#getting-started)
- [Basic Operations](#basic-operations)
- [Pattern Matching](#pattern-matching)
- [Output Formats](#output-formats)
- [Advanced Queries](#advanced-queries)
- [Impact analysis with `xray impact`](#impact-analysis-with-xray-impact)
- [Examples](#examples)
- [Tips & Tricks](#tips--tricks)

## Getting Started

### Prerequisites

`xray query` needs no setup: without `--graph` it builds the graph in
memory for the configured roots (`-p/--path`, `--lens`, `--scope`, `--lang`;
the same resolution as `xray impact` and `map --format json`) and writes no
file.

```bash
xray query "calls(main)"
xray query -p ./api "callers(validateInput)"
```

To query one graph repeatedly, save it with `xray map --format json` and
read it back with `--graph` (it cannot be combined with `-p`, `--lens` or
`--scope`):

```bash
# Write the graph (no extension on -o => ".json" is appended)
xray map --format json -o graph

# Query it
xray query --graph graph.json "calls(main)"
```

Pass several `-p/--path` roots to query across projects at once: the roots
merge into one graph, with every node id prefixed by a root label
(`api/src/main.ts::main`, `web/src/main.ts::main`). See
[Merged graphs](commands.md#merged-multi-root-graphs).

`xray query` prints its result to stdout (`--format table|tree|json|yaml|csv`)
and exits 2 on a bad query, `--graph` combined with `-p`/`--lens`/`--scope`, or unknown `--format`/column, 3 if
the graph file or a root is not found.

### Basic Query Syntax

All queries follow the pattern: `operation(target, options)`

```bash
xray query --graph graph.json "calls(functionName)"
```

## Basic Operations

### calls() - What does X call?

Find all functions called by a specific function.

**Direct calls only:**
```bash
xray query --graph graph.json "calls(processData)"
```

**Recursive calls (traverse entire call tree):**
```bash
xray query --graph graph.json "calls(main, recursive=true)"
```

**Limit recursion depth:**
```bash
xray query --graph graph.json "calls(main, recursive=true, depth=3)"
```

### callers() - Who calls X?

Find all functions that call a specific function.

**Direct callers:**
```bash
xray query --graph graph.json "callers(validateInput)"
```

**Recursive callers (trace back to entry points):**
```bash
xray query --graph graph.json "callers(checkSchema, recursive=true)"
```

### path() - Find path between functions

Discover execution paths between two functions.

```bash
xray query --graph graph.json "path(main, to=validateData)"
```

This shows the shortest call chain from `main` to `validateData`.

### hotspots() - Find frequently called functions

Identify the most important functions in your codebase.

**By call count (how many times called):**
```bash
xray query --graph graph.json "hotspots(metric=calls, limit=10)"
```

**By fanout (how many functions it calls):**
```bash
xray query --graph graph.json "hotspots(metric=fanout, limit=10)"
```

**By PageRank (overall importance):**
```bash
xray query --graph graph.json "hotspots(metric=pagerank, limit=10)"
```

## Pattern Matching

Use wildcards to match multiple functions at once.

### Wildcards

- `*` - Matches any characters except `/` (within same directory/module)
- `**` - Matches any characters including `/` (across directories)
- `?` - Matches single character

### Examples

**Match function names:**
```bash
# All functions starting with "process"
xray query --graph graph.json "calls(process*)"

# All "validate" functions
xray query --graph graph.json "callers(*validate*)"
```

**Match by file path:**
```bash
# All functions in src/api/ directory
xray query --graph graph.json "calls(src/api/**::*)"

# All functions in utils.ts
xray query --graph graph.json "callers(src/utils.ts::*)"
```

**Exact matching with special characters:**
```bash
# Functions with parentheses in name
xray query --graph graph.json "calls(func(args))"
```

## Output Formats

### Table Format (Default)

One row per result node. Default columns: `name`, `kind`, `file`, `line`.

```bash
xray query --graph graph.json "calls(main)" --format table
```

**Output:**
```
name           kind      file          line
processData    function  src/api.ts    10
validateInput  function  src/utils.ts  20
checkSchema    function  src/utils.ts  30
```

Results are 1-based in every format (`table`, `tree`, `csv`, `json`,
`yaml`), as `map` and `impact` show them; the saved graph stores 0-based
lines. `line` is blank when the graph has no line for the
node. Empty results print nothing on stdout (`No results found` on stderr).

### Columns, CSV and files

`--cols` picks and orders columns for `table` and `csv` from `name`, `kind`,
`file`, `line`, `depth`, `score`, `id`. Write it as `--cols=a,b` (or put the
query before it): the space form takes every following word as a column.

```bash
xray query --graph graph.json --cols=name,file,depth "calls(main)"
xray query --graph graph.json --format csv --cols=id,name "callers(helper)"
xray query --graph graph.json "calls(main)" -o calls.csv   # format from extension
```

`-o <path>` writes the result to a file; without `--format`, the extension
picks it (`.json`, `.yaml`/`.yml`, `.csv`). `--format-help` lists formats and
their options (`--format-opt indent=4`, `--format-opt delimiter=;`, ...).

### JSON / YAML Format

Structured document for programmatic processing: the whole result
(`nodes`, `edges`, `metadata`); `--cols` does not reshape it (one stderr warning; `--quiet` silences it). `--format yaml`
emits the same document as YAML.

```bash
xray query --graph graph.json "calls(main)" --format json
```

**Output:**
```json
{
  "nodes": [
    {
      "id": "src/api.ts::processData",
      "name": "processData",
      "file": "src/api.ts",
      "line": 10,
      "kind": "function",
      "depth": 1
    }
  ],
  "edges": [
    {
      "from": "src/main.ts::main",
      "to": "src/api.ts::processData",
      "type": "calls"
    }
  ],
  "metadata": {
    "syntax": "function",
    "queryType": "calls",
    "executionTime": 15,
    "resultCount": 3
  }
}
```

### Tree Format

Visual tree representation showing call hierarchy.

```bash
xray query --graph graph.json "calls(main, recursive=true)" --format tree
```

**Output:**
```
Call Tree:

main (src/main.ts:L5)
└─→ processData (src/api.ts:L10)
    ├─→ validateInput (src/utils.ts:L20)
    │   └─→ checkSchema (src/utils.ts:L30)
    └─→ transformData (src/utils.ts:L40)
        └─→ mapFields (src/utils.ts:L50)
```

## Advanced Queries

### Combining Operations

While the query system doesn't support chaining yet, you can combine operations using shell scripting:

```bash
# Find all callers of hotspots
xray query --graph graph.json "hotspots(limit=5)" --format json | \
  jq -r '.nodes[].name' | \
  xargs -I {} xray query --graph graph.json "callers({})"
```

### Performance Analysis

**Find most complex functions (high fanout):**
```bash
xray query --graph graph.json "hotspots(metric=fanout, limit=10)"
```

**Find bottlenecks (most called):**
```bash
xray query --graph graph.json "hotspots(metric=calls, limit=10)"
```

**Find entry points (functions with no callers):**
```bash
# Use jq to filter functions with no incoming calls
xray query --graph graph.json "hotspots(limit=100)" --format json | \
  jq '.nodes[] | select(.depth == 0)'
```

### Code Architecture Analysis

**Find long call chains:**
```bash
xray query --graph graph.json "calls(main, recursive=true, depth=10)" --format tree
```

**Identify tightly coupled modules:**
```bash
# Find all calls between two modules
xray query --graph graph.json "calls(src/moduleA/**::*)" --format json | \
  jq '.edges[] | select(.to | startswith("src/moduleB"))'
```

## Impact analysis with `xray impact`

`callers(X, recursive=true)` answers "who calls X?" one path at a time.
`xray impact X` answers "what breaks if I change X?": every transitive
caller once, at its shortest depth, grouped by area, with the confidence
of each call edge. It needs no saved graph: without `--graph` it builds
one in memory for the current project (or `-p`, `--lens`, `--scope`).

```bash
xray impact RunHooks --depth 2
```

```
ℹ coverage: 318 files parsed · skipped grammars: none        (stderr)
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

The same answer as a call tree, rooted at the symbol:

```bash
xray impact RunHooks --depth 1 --format tree
```

```
Call Tree:

└─→ RunHooks (internal/dispatch/run.go:L108)
    ├─→ runReplay (cmd/nerv/cmd_replay.go:L52)
    ├─→ testSingleEvent (cmd/nerv/cmd_testhook.go:L140)
    ├─→ Dispatch (internal/dispatch/dispatch.go:L85)
    ├─→ TestRunHooks_EmptyList (internal/dispatch/run_test.go:L48)
    …
    └─→ TestRunHooks_Timeout (internal/dispatch/run_test.go:L221)
```

Or one row per caller, with confidence (editor lines, as in the text):

```bash
xray impact RunHooks --depth 1 --format table
```

```
name                        file                               line  depth  group     confidence
runReplay                   cmd/nerv/cmd_replay.go             52    1      cmd       EXTRACTED
testSingleEvent             cmd/nerv/cmd_testhook.go           140   1      cmd       EXTRACTED
TestRunHooks_ContextParsed  internal/dispatch/context_test.go  15    1      internal  EXTRACTED
Dispatch                    internal/dispatch/dispatch.go      86    1      internal  EXTRACTED
…
```

Or the size-bounded `brief` view for hook scripts: one line per group,
top 3 callers each, at most 1200 characters, and nothing at all when the
symbol has no callers or no match:

```bash
xray --quiet impact RunHooks --depth 2 --graph graph.json --format brief
```

```
RunHooks (method, internal/dispatch/run.go:L108) — 35 callers across 2 groups
  internal: 24 callers — Dispatch (internal/dispatch/dispatch.go:L85), TestRunHooks_EmptyList (internal/dispatch/run_test.go:L48), TestRunHooks_AllowHandler (internal/dispatch/run_test.go:L56), …and 21 more
  cmd: 11 callers — runReplay (cmd/nerv/cmd_replay.go:L52), testSingleEvent (cmd/nerv/cmd_testhook.go:L140), TestReplayCmd_FlagsReachRunE (cmd/nerv/cmd_replay_test.go:L18), …and 8 more
edges: EXTRACTED 35 · INFERRED 0
```

### Confidence and `--strict`

`calls` edges are `EXTRACTED` when xray resolved the callee by scope (same
file, same directory, an imported file or Go package, or another root
imported by module/package name) and `INFERRED` when it only matched the
name. Name-only matches overstate impact when a common name is defined in
several places:

```bash
xray impact New --depth 1            # New (5 definitions) — 54 callers across 4 groups
                                     # edges: EXTRACTED 44 · INFERRED 10
xray impact New --depth 1 --strict   # New (5 definitions) — 44 callers across 2 groups
                                     # edges: EXTRACTED 44 · INFERRED 0
```

`--strict` drops `INFERRED` edges before walking, so they pull in no
further callers. Start without it to see the full possible blast radius;
add it when the result is dominated by `INFERRED` edges.

### Several roots

With several roots (`-p` repeated, or a lens with `paths`) callers are
grouped by root, then by top-level directory inside it, as flat
`root/dir` keys (also the `groups[].name` of `--format json`). Two Go
modules, `beta` importing `alpha`:

```bash
xray impact Hello -p alpha -p beta
```

```
ℹ cache: alpha miss · beta miss                               (stderr)
ℹ coverage: 4 files parsed · skipped grammars: none           (stderr)
Hello (function, alpha/greet/greet.go:L3) — 4 callers across 3 groups
  alpha/internal: 2 callers — Start (alpha/internal/run/run.go:L5), Again (alpha/internal/run/run.go:L7)
  alpha/cmd: 1 caller — main (alpha/cmd/app/main.go:L5)
  beta/pkg: 1 caller — Use (beta/pkg/use/use.go:L5)
edges: EXTRACTED 4 · INFERRED 0
```

### `impact` versus `callers()`

| | `query "callers(X, recursive=true)"` | `impact X` |
|---|---|---|
| Graph | saved file (`--graph`) | built in memory, or `--graph` |
| Depth per caller | depth-first: first path found, not always the shortest | shortest path |
| Grouping | none | by top-level directory; root/directory on several roots |
| Confidence | not shown | per edge and per caller; `--strict` |
| Several definitions of X | all, merged | all, listed in `defined:` |

Flags, output anatomy, multi-root caching and exit codes:
[Commands: `xray impact`](commands.md#xray-impact).

## Examples

### Example 1: Understanding a Bug

You have a bug in `validateEmail` and need to find where it's called from:

```bash
# Find all callers
xray query --graph graph.json "callers(validateEmail, recursive=true)" --format tree

# Output shows the full call chain:
# main
# └─→ processUser
#     └─→ createAccount
#         └─→ validateEmail
```

### Example 2: Refactoring Impact Analysis

Before refactoring `processData`, check what depends on it
(`xray impact processData` gives the same, grouped and transitive; see
[Impact analysis](#impact-analysis-with-xray-impact)):

```bash
# Find all callers
xray query --graph graph.json "callers(processData)" --format table

# Check what it calls
xray query --graph graph.json "calls(processData)" --format table
```

### Example 3: Finding Dead Code

Find functions that are never called:

```bash
# Get all functions
xray query --graph graph.json "hotspots(metric=calls, limit=1000)" --format json > all.json

# Filter for 0 calls
jq '.nodes[] | select(.score == 0) | .name' all.json
```

### Example 4: API Surface Analysis

Find all public API functions (assuming they start with "api"):

```bash
xray query --graph graph.json "calls(api*)" --format tree
```

### Example 5: Cyclic Dependency Detection

Check if there's a path from A back to A:

```bash
xray query --graph graph.json "path(moduleA::init, to=moduleA::init)"

# If path exists, you have a cycle
```

## Tips & Tricks

### 1. Use Shell Aliases

Add to your `.bashrc` or `.zshrc`:

```bash
alias xq='xray query --graph graph.json'
alias xqt='xray query --graph graph.json --format tree'
alias xqj='xray query --graph graph.json --format json'
```

Usage:
```bash
xq "calls(main)"
xqt "calls(main, recursive=true)"
```

### 2. Combine with jq for Filtering

```bash
# Find functions in specific file
xray query --graph graph.json "hotspots(limit=100)" --format json | \
  jq '.nodes[] | select(.file == "src/api.ts")'
```

### 3. Save Common Queries

Create a script for frequently used queries:

```bash
#!/bin/bash
# queries.sh

case $1 in
  "hotspots")
    xray query --graph graph.json "hotspots(metric=calls, limit=10)"
    ;;
  "entry-points")
    xray query --graph graph.json "hotspots(limit=100)" --format json | \
      jq '.nodes[] | select(.depth == 0)'
    ;;
esac
```

### 4. Use Pattern Matching Carefully

Pattern matching is powerful but can be expensive on large graphs:

```bash
# Good: Specific pattern
xray query --graph graph.json "calls(src/api/user.ts::*)"

# Slow: Very broad pattern
xray query --graph graph.json "calls(**::*)"
```

### 5. List Available Adapters

Check what query syntaxes are available:

```bash
xray query --list-adapters
```

## Troubleshooting

### "No query adapter found"

Make sure your query syntax is correct:
- Use parentheses: `calls(main)` not `calls main`
- Quote the query: `"calls(main)"` not `calls(main)`

### "Graph file not found"

Ensure the graph file exists and path is correct:
```bash
ls -la graph.json
xray query --graph ./graph.json "calls(main)"
```

### "Pattern too complex"

Your wildcard pattern is too broad. Simplify it:
```bash
# Too complex (rejected)
xray query --graph graph.json "calls(**::*::*::*::*)"

# Better
xray query --graph graph.json "calls(src/api/**::*)"
```

### Empty Results

- Check if the function name is correct (case-sensitive)
- Try using a pattern: `calls(func*)`
- Verify the graph contains the function you're looking for

## Next Steps

- Learn about [creating custom query adapters](../dev/architecture.md)
- Explore the [graph architecture](../dev/architecture.md#4-graph-builder)
- Read about [performance optimization](../dev/architecture.md#performance-optimizations)

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/your-org/xray/issues)
