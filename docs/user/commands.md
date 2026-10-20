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

Generate shell completion scripts.

```bash
# For bash
eval "$(xray completion bash)"

# For zsh
eval "$(xray completion zsh)"

# For fish
xray completion fish > ~/.config/fish/completions/xray.fish
```

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
- `csv` - CSV format
- `xml` - XML format
- `json` - Raw JSON graph: one valid JSON document (`metadata`, `nodes`,
  `edges`; the shape `xray query --graph` reads), written to `-o` (default
  `.xray`; `-o name` becomes `name.json`). Chunking does not apply: the
  file is identical with or without `--no-chunk`. One `--path` only.

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
