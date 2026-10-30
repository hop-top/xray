# Query System User Guide

The xray query system allows you to interactively explore your codebase's call graph using a simple, function-based query syntax.

## Table of Contents

- [Getting Started](#getting-started)
- [Basic Operations](#basic-operations)
- [Pattern Matching](#pattern-matching)
- [Output Formats](#output-formats)
- [Advanced Queries](#advanced-queries)
- [Examples](#examples)
- [Tips & Tricks](#tips--tricks)

## Getting Started

### Prerequisites

Before querying, you need a saved graph file. `xray map --format json`
writes exactly that: one JSON document (`metadata`, `nodes`, `edges`).

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
and exits 2 on a bad query, missing `--graph` or unknown `--format`/column, 3 if
the graph file is not found.

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

`line` is `0` when the graph has no line for the node. Empty results print
nothing on stdout (`No results found` on stderr).

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
(`nodes`, `edges`, `metadata`); `--cols` does not reshape it. `--format yaml`
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

Before refactoring `processData`, check what depends on it:

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

- Learn about [creating custom query adapters](../dev/query-architecture.md)
- Explore the [graph architecture](../dev/graph-api.md)
- Read about [performance optimization](../dev/performance.md)

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/your-org/xray/issues)
