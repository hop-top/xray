# xray.codes

![npm version](https://img.shields.io/npm/v/xray.svg) ![build status](https://img.shields.io/github/actions/workflow/status/yourusername/xray/build.yml) ![license](https://img.shields.io/npm/l/xray)

**⚠️ ALPHA RELEASE** - This is an early alpha version of xray. Features may be incomplete, unstable, or subject to breaking changes.

Code mapping for codebases.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install --legacy-peer-deps
   ```
   *Note: The `--legacy-peer-deps` flag is required due to a peer dependency conflict with `tree-sitter`.*

   *This also requires a C++ compiler environment (like build-essential on Linux or Xcode on macOS) because `tree-sitter` and `better-sqlite3` are native modules. If you encounter C++ compilation errors, try:*

   ```bash
   CXXFLAGS="-std=c++20" npm install --legacy-peer-deps
   ```

2. **Build**:
   ```bash
   npm run build
   ```

## Usage

**Generate an X-ray**:
```bash
# Run directly with ts-node
npm run dev -- generate --root ./path/to/your/repo --output .xray

# Or build and run
node dist/cli.js generate --root .
```

### Options

- `-r, --root <path>`: Root directory of the repository (default: current directory).
- `-o, --output <path>`: Output file path. If not specified, prints to stdout.
- `-t, --tokens <number>`: Token limit for the output (default: 4096).
- `--include-variables`: Include local variables and constants in the output (default: false).
- `--include-imports`: Include imports and dependency table in the output (default: false).
- `--doc <config>`: Include docstrings. Values: `all`, `none`, or a comma-separated list of kinds (e.g., `class,function,method`). Default: `none`.
- `--focus <path>`: Focus the map on a specific file (Personalized PageRank).
- `--with-cost`: Estimate and display the cost of the generated output (requires `OPENAI_API_KEY`).

### Custom Queries

You can override the default Tree-sitter queries for any language using the `--query` (or `-q`) flag. This allows you to customize exactly what gets extracted (e.g., only classes, specific function patterns, etc.).

You can provide:
- **Explicit Mapping**: `.ext:path` (e.g., `.ts:./custom.scm`)
- **File Path**: Language inferred from filename (e.g., `python.scm` -> `.py`)
- **Directory**: Scans for `.scm` files and infers language
- **URL**: Fetches query from URL (inferred from filename)
- **Comma-Separated List**: Combine multiple queries

```bash
# Explicit mapping
xray generate --root . --query .ts:./my-custom-tags.scm

# Auto-detect from filename (infers .py)
xray generate --root . --query ./python.scm

# Scan directory for queries
xray generate --root . --query ./my-queries-dir

# Remote URL (infers .ts)
xray generate --root . --query https://example.com/typescript.scm

# Combine multiple
xray generate --root . --query .ts:./ts.scm,./python.scm
```

> [!WARNING]
> **Security Note**: Tree-sitter queries are pattern-matching expressions and are generally safe to execute. They cannot access your file system or network. However, a malformed or extremely complex query could theoretically cause performance issues (DoS) during parsing. Ensure you trust the source of remote queries.

### Output Format
- `--json`: Output raw JSON graph instead of the tree representation.

**Clear Cache**:
```bash
npm run dev -- clear-cache
```

## Supported Languages

Xray currently supports parsing and analysis for the following languages:

- **Bash** (`.sh`, `.bash`)
- **C** (`.c`, `.h`)
- **C#** (`.cs`)
- **C++** (`.cpp`, `.hpp`)
- **Dart** (`.dart`)
- **Elixir** (`.ex`, `.exs`)
- **Go** (`.go`)
- **Haskell** (`.hs`)
- **Java** (`.java`)
- **JavaScript** (`.js`, `.jsx`)
- **Kotlin** (`.kt`)
- **Lua** (`.lua`)
- **PHP** (`.php`)
- **Python** (`.py`)
- **Ruby** (`.rb`)
- **Rust** (`.rs`)
- **Scala** (`.scala`)
- **Swift** (`.swift`)
- **TypeScript** (`.ts`, `.tsx`)

## Features

### Control Flow and Data Flow Analysis

Xray includes built-in support for Control Flow Graph (CFG) and Data Flow Graph (DFG) generation for functions and methods. This analysis is performed using Tree-sitter AST parsing and is available for:

- **C** - Functions, if/else, loops, returns
- **C++** - Functions, if/else, loops, returns, try/catch
- **C#** - Methods, if/else, loops, returns, try/catch, foreach
- **Go** - Functions, if/else, for loops (all variants), defer, returns
- **Java** - Methods, if/else, loops (for/while/foreach), returns, try/catch
- **Rust** - Functions, if/match expressions, loops (for/while/loop), returns
- **Swift** - Functions, if/guard statements, loops (for/while/repeat), returns

CFG and DFG information is automatically attached to function/method tags during parsing and can be used for advanced code analysis and visualization.

#### Architecture

The CFG/DFG system uses a multi-strategy architecture that allows for different generation approaches:

- **Internal Strategy** (default): Uses Tree-sitter AST parsing for fast, language-aware graph generation
- **External Strategy** (extensible): Framework ready for integration with external analysis tools

All graph generators are async and context-aware, receiving the full source code and file path for comprehensive analysis.

### Map Output Features

#### Line Range Display

The map output includes precise line ranges for both files and code elements, making it easy to locate and extract specific code:

```
utils.ts (L5-L50):
│ [L5-L12] function helper
│ [L15-L20] function validate
│ [L25] const API_KEY
```

- **File headers** show the range of lines covered by displayed tags: `file.ts (L1-L100):`
- **Tags** show their exact line ranges: `[L5-L12]` or `[L25]` for single-line items
- Line numbers are 1-indexed for easy navigation in editors

#### Cross-File Reference Tracking

Xray automatically extracts and displays function call relationships across files:

```
helper.ts (L5-L20):
│ [L5-L12] function formatData
│       → used by: [main.ts:L15](L10-L25)
│       → used by: [router.ts:L8](L5-L18)
```

**How it works:**
- During parsing, Tree-sitter extracts `call_expression` nodes from function bodies
- Function names are matched across the codebase to build a call graph
- References are stored in SQLite cache for fast reuse
- Only **cross-file references** are shown to reduce noise
- Up to **3 callers** displayed per function

**Format:** `→ used by: [file:L#](L#-L#)`
- First `L#` is the call location
- Range `(L#-L#)` shows the entire calling function's extent

This makes it easy to understand dependencies and extract the exact code context for any reference.


## Extensibility

To add more languages:
1. `npm install tree-sitter-yourlang`.
2. Update `src/parser/language-registry.ts`.
3. Add the corresponding `.scm` query file in `src/parser/queries/`.
