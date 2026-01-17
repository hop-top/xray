# xray

> X-ray your codebase - Generate AST, CFG, and DFG visualizations for deep code understanding

[![npm version](https://img.shields.io/npm/v/xray.svg)](https://www.npmjs.com/package/xray)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**⚠️ ALPHA RELEASE** - This is an early alpha version. Features may be incomplete, unstable, or subject to breaking changes.

## Quick Start

```bash
# Install globally
npm install -g xray

# Generate a visual map of your codebase
xray map

# Focus on specific directory with imports and variables
xray map -p ./src -w incs -w vars -o codebase-map.txt
```

## What is xray?

xray is a powerful static analysis tool that generates structured visualizations of your codebase using AST (Abstract Syntax Tree), CFG (Control Flow Graph), and DFG (Data Flow Graph) analysis. It creates compact, token-optimized representations that are perfect for both human understanding and AI assistant consumption across 19+ programming languages.

**Why xray exists:**

Traditional code exploration methods fail at scale. Sharing entire codebases with AI assistants hits context limits, while cherry-picking files misses critical relationships. xray solves this by generating **intelligent, ranked, context-aware code maps** that fit within AI context windows while preserving the most important structural information.

**Perfect for:**
- 🤖 **AI-Assisted Development** - Give Claude, GPT, or other LLMs a complete codebase overview that fits in their context window
- 🎯 **Intelligent Code Navigation** - PageRank algorithm surfaces the most important files and functions first
- 📊 **Structured Documentation** - Generate up-to-date codebase documentation automatically
- 🔗 **Dependency Analysis** - See imports, exports, and cross-file relationships at a glance
- 🧠 **Cognitive Offloading** - Let AI assistants understand your codebase structure without reading every file
- 📈 **Complexity Visualization** - CFG/DFG analysis reveals hidden complexity patterns

### For AI Assistants

xray output is specifically designed for AI consumption:

**Token Efficiency:**
- Ranked by importance using PageRank + heuristics
- Only includes semantically relevant code elements
- Configurable token limits to fit any context window
- Strips boilerplate while preserving structure

**Structured Context:**
- Hierarchical tree format for easy parsing
- Precise line numbers for file navigation
- Cross-file reference tracking shows relationships
- Dependency tables reveal external connections

**Actionable Information:**
AI assistants reading xray maps can:
- Navigate directly to relevant code (`file.ts:L15`)
- Understand call hierarchies without reading implementations
- Identify architectural patterns and anti-patterns
- Suggest refactorings based on coupling/cohesion metrics
- Generate accurate code modifications with full context

## Installation

### NPM (Recommended)

```bash
npm install -g xray
```

### From Source

```bash
git clone https://github.com/IdeaCraftersLabs/oss-xray-codes.git xray
cd xray
npm install --legacy-peer-deps
npm run build
npm link
```

**Note:** The `--legacy-peer-deps` flag is required due to tree-sitter peer dependencies. Requires C++ build tools (build-essential on Linux, Xcode on macOS).

**Troubleshooting C++ compilation:**
```bash
CXXFLAGS="-std=c++20" npm install --legacy-peer-deps
```

## Commands

### `xray map` (Most Common)

Generate a visual map of your codebase structure and dependencies.

```bash
xray map [options]
```

**Examples:**
```bash
# Basic map of current directory
xray map

# Specify custom path and output
xray map -p ./src -o codebase-map.txt

# Focus on specific file with extended features
xray map -a src/main.ts -w vars -w incs -w cost

# Multiple paths with depth limit
xray map -p ./src -p ./lib -d 3 -o analysis.txt
```

### `xray scan`

Scan and discover files in your codebase.

```bash
xray scan [options]
```

**Examples:**
```bash
# Scan specific directory
xray scan -p ./src

# Filter by file patterns
xray scan -p ./src -m "*.ts" -m "!*.test.ts"
```

### `xray graph`

Generate control flow (CFG) and data flow graphs (DFG).

```bash
xray graph [options]
```

**Examples:**
```bash
# Generate both CFG and DFG
xray graph -w cf -w df -o graphs.txt

# Focus on specific directory
xray graph -p ./src/services -w cf -w df
```

### `xray clear-cache`

Clear the SQLite cache used for parsed AST data.

```bash
xray clear-cache
```

## Flags & Options

### Core Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --path <paths...>` | Root directories to analyze (repeatable) | current directory |
| `-o, --output <path>` | Output file path | stdout |
| `-l, --limit <number>` | Token limit for output | 4096 |

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
xray map -w vars -w incs -w cost
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
xray map -m "*.ts" -m "*.tsx" -m "!*.test.ts"

# Filter by function names
xray map -c "User*" -c "!UserTest"
```

### Output Formats

**Formats** (mutually exclusive):
- `--txt` - Text format (default)
- `--csv` - CSV format
- `--xml` - XML format
- `--json` - JSON graph format

**Diagrams** (mutually exclusive):
- `--mermaid` - Mermaid diagram (default)
- `--dot` - DOT/Graphviz diagram

### Advanced

| Flag | Description |
|------|-------------|
| `-q, --query <items...>` | Override default Tree-sitter queries |

## Configuration

### Custom Queries

Override default Tree-sitter queries for any language:

```bash
# Explicit mapping
xray map -q .ts:./custom-typescript.scm

# Auto-detect from filename (infers .py)
xray map -q ./python.scm

# Scan directory for queries
xray map -q ./my-queries-dir

# Remote URL (infers .ts from filename)
xray map -q https://example.com/typescript.scm

# Combine multiple
xray map -q .ts:./ts.scm,./python.scm
```

**Query Format:** Tree-sitter S-expression patterns
```scheme
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class
```

> **⚠️ Security Note:** Tree-sitter queries are pattern-matching expressions and cannot access your file system or network. However, ensure you trust the source of remote queries.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for `-w cost` feature |

### Cache

xray caches parsed AST data in `.xray_cache.db` (SQLite) for faster subsequent runs. Clear with `xray clear-cache`.

## Supported Languages

xray supports 19 programming languages:

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

### Adding New Languages

1. Install tree-sitter parser: `npm install tree-sitter-<language>`
2. Update `src/parser/language-registry.ts`
3. Add `.scm` query file in `src/parser/queries/`

## Examples

### Basic Analysis

```bash
# Analyze current directory
xray map

# Save to file
xray map -o analysis.txt
```

### Multi-Path Analysis

```bash
# Analyze multiple directories
xray map -p ./src -p ./lib -p ./tests -o full-analysis.txt
```

Output:
```
================================================================================
Path: /project/src
================================================================================
[analysis results for src]

================================================================================
Path: /project/lib
================================================================================
[analysis results for lib]
```

### Feature-Rich Analysis

```bash
# Complete analysis with all features
xray map \
  -p ./src \
  -a src/main.ts \
  -w vars -w incs -w cf -w df \
  -m "*.ts" -m "!*.test.ts" \
  -d 5 \
  -o detailed-map.txt
```

### Focus Analysis

```bash
# Focus on specific entry point
xray map -a src/index.ts -w incs -o focused.txt

# Analyze only shallow structure
xray map -d 2 -o shallow.txt
```

### Cost Estimation

```bash
# Estimate LLM token cost
export OPENAI_API_KEY=your-key
xray map -w cost
```

Output:
```
Analyzing repo at: /project
Found 42 files.
Estimated cost: $0.001234
```

### Working with AI Assistants

**Workflow Example:**

```bash
# 1. Generate a focused map for your current task
xray map -a src/api/routes.ts -w incs -o context.txt

# 2. Share context.txt with your AI assistant
# "Here's a map of my codebase. I need to add authentication to the API routes."

# 3. AI reads the map and understands:
#    - Where routes.ts is in the architecture
#    - What other files import/use routes.ts
#    - What external dependencies are involved
#    - Which functions are central to the API

# 4. AI provides accurate, context-aware suggestions
```

**Before xray:**
```
You: "Can you help me add auth to my API?"
AI: "Sure! I'll need to see your route handler code, middleware setup,
authentication logic, database models, and configuration files..."
You: *pastes 10 files totaling 50k tokens* 😰
```

**After xray:**
```
You: "Here's my codebase map. Add auth to the API routes."
AI: *reads 2k token map showing entire structure*
AI: "I can see routes.ts imports middleware.ts and auth.ts doesn't exist yet.
     I'll create auth.ts in the same pattern as your validation.ts middleware,
     and add it to routes.ts:L15 where other middleware is registered..." ✨
```

**Pro Tips:**
- Use `-a` to focus on your current work area
- Include `-w incs` to show dependencies
- Keep maps under 10k tokens for best AI performance
- Regenerate maps when architecture changes significantly

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

## Advanced Features

### Control Flow Graph (CFG)

Available for: C, C++, C#, Go, Java, Rust, Swift

```bash
xray graph -w cf -p ./src
```

Generates flow analysis for:
- Function entry/exit points
- Conditional branches (if/else, switch)
- Loops (for, while, foreach)
- Try/catch blocks
- Return statements

### Data Flow Graph (DFG)

Available for: C, C++, C#, Go, Java, Rust, Swift

```bash
xray graph -w df -p ./src
```

Tracks:
- Variable definitions
- Variable usage
- Data dependencies
- Assignment flows

### Architecture

- **Internal Strategy** (default): Tree-sitter AST parsing for fast, language-aware analysis
- **External Strategy** (extensible): Framework ready for external analysis tool integration

## Troubleshooting

### Installation Issues

**C++ compilation errors:**
```bash
# Set C++ standard explicitly
CXXFLAGS="-std=c++20" npm install --legacy-peer-deps

# On macOS, ensure Xcode Command Line Tools installed
xcode-select --install

# On Linux, ensure build-essential installed
sudo apt-get install build-essential
```

**Peer dependency conflicts:**
```bash
# Use --legacy-peer-deps flag
npm install --legacy-peer-deps
```

### Runtime Issues

**"Command not found":**
```bash
# Ensure global install path is in PATH
npm bin -g

# Or use npx
npx xray map
```

**Cache issues:**
```bash
# Clear cache if analysis seems stale
xray clear-cache
```

**Token limit errors:**
```bash
# Increase token limit
xray map -l 10000

# Or reduce scope
xray map -d 3 -m "!*.test.ts"
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Sponsors

Sponsored by [Idea Crafters LLC](https://ideacrafters.com)

## Links

- **GitHub:** https://github.com/IdeaCraftersLabs/oss-xray-codes
- **Issues:** https://github.com/IdeaCraftersLabs/oss-xray-codes/issues
- **NPM:** https://www.npmjs.com/package/xray

---

Made with ❤️ by the Idea Crafters team
