# xray.codes

Code mapping for codebases.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```
   *Note: This requires a C++ compiler environment (like build-essential on Linux or Xcode on macOS) because `tree-sitter` and `better-sqlite3` are native modules.*

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
- `--doc <config>`: Include docstrings. Values: `all`, `none`, or a comma-separated list of kinds (e.g., `class,function,method`). Default: `none`.
- `--focus <path>`: Focus the map on a specific file (Personalized PageRank).
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


## Extensibility

To add more languages:
1. `npm install tree-sitter-yourlang`.
2. Update `src/parser/language-registry.ts`.
3. Add the corresponding `.scm` query file in `src/parser/queries/`.
