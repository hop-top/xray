# Commands Reference

Complete guide to every xray command and option. Start with the decision tree to find what you need, then dive into details.

## Quick Decision Tree

**What do you want to do?**

- **Understand your codebase structure** → [`xray map`](#xray-map)
- **Find something specific (components, routes, functions)** → [`xray explore` / Strategies](#xray-explore)
- **Scan for files matching a pattern** → [`xray scan`](#xray-scan)
- **See control flow or data flow** → [`xray graph`](#xray-graph)
- **Detect what frameworks are used** → [`xray strategy:detect`](#xray-strategydetect)
- **See all available strategies** → [`xray strategy:list`](#xray-strategylist)
- **Create command shortcuts** → [`xray alias`](#xray-alias)
- **Fix stale results** → [`xray clear-cache`](#xray-clear-cache)
- **Enable shell completion** → [`xray completion`](#xray-completion)

---

## Core Commands

### `xray map`

Generate a visual map of your codebase structure and dependencies.

```bash
xray map [options]
```

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
xray scan [options]
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
xray graph [options]
```

**Examples:**
```bash
# Generate both CFG and DFG
xray graph --with cf --with df --output graphs.txt

# Focus on specific directory
xray graph --path ./src/services --with cf --with df
```

### `xray explore`

Run framework-specific exploration commands via strategies.

```bash
xray explore <strategy>:<command> [options]
```

**Examples:**
```bash
# List React components
xray explore react:components

# List Express routes
xray explore express:routes

# Shorthand (explore is default)
xray react:components
xray express:routes
```

See [Strategies Guide](strategies.md) for all available strategy commands.

### `xray strategy:detect`

Detect which strategies apply to your project.

```bash
xray strategy:detect
```

### `xray strategy:list`

List all available strategies.

```bash
xray strategy:list
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

Clear the SQLite cache used for parsed AST data.

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
| `-o, --output <path>` | Output file path | `.xray` |
| `-l, --limit <number>` | Token limit for output | 4096 |

**Output File Behavior:**
- **No output specified**: Writes to `.xray` in current directory
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
keep the raw import list). Load with any CSV tool, e.g.
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
- No links between roots are invented: edges are only those each root's own
  analysis produced. `rank` values are per-root.
- `xray query` works unchanged: a bare name (`calls(main)`) matches that
  function in every root; a full id (`calls(web/src/main.ts::main)`) picks one.

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

`query`, `explore`, `paths`, `alias list`, `strategy list` and the strategy
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
| `explore` | `type`, `path` |
| `explore -m` | `path` |
| `explore -s` | `file`, `line`, `keyword`, `content` (every match; the text view caps 5 per file) |
| `explore --stats` | `type`, `files`, `lines` |
| `paths` | one record: `projectRoot`, `projectConfig`, `globalConfig`, `cacheDb`, `cacheDbExists`, `configDir`, `dataDir`, `cacheDir`, `stateDir` |
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
