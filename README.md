# RepoMap TS

A TypeScript implementation of Aider-style repository mapping.

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

**Generate a Map**:
```bash
# Run directly with ts-node
npm run dev -- generate --root ./path/to/your/repo --output map.txt

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

RepoMap currently supports parsing and mapping for the following languages:

- **TypeScript** (`.ts`, `.tsx`)
- **JavaScript** (`.js`, `.jsx`)
- **Python** (`.py`)
- **Java** (`.java`)
- **C#** (`.cs`)
- **C++** (`.cpp`, `.hpp`)
- **C** (`.c`, `.h`)
- **Go** (`.go`)
- **Rust** (`.rs`)
- **PHP** (`.php`)
- **Ruby** (`.rb`)
- **Bash** (`.sh`, `.bash`)
- **Swift** (`.swift`)
- **Kotlin** (`.kt`)
- **Scala** (`.scala`)
- **Dart** (`.dart`)
- **Lua** (`.lua`)
- **Elixir** (`.ex`, `.exs`)
- **Haskell** (`.hs`)

## Extensibility

To add more languages:
1. `npm install tree-sitter-yourlang`.
2. Update `src/parser/language-registry.ts`.
3. Add the corresponding `.scm` query file in `src/parser/queries/`.
