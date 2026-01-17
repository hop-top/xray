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
xray map --path ./src --with incs --with vars --output codebase-map.txt
```

### Configuration & Automation

Set up xray once and keep your codebase maps always up-to-date:

**1. Create a config file (`.xrayrc.json`):**

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "limit": 8000,
  "features": {
    "vars": true,
    "incs": true
  }
}
```

**2. Add GitHub Action** (automatically updates maps on PRs):

Create `.github/workflows/xray-regenerate.yml`:

```yaml
name: Regenerate Xray Maps
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  xray:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
      - uses: IdeaCraftersLabs/oss-xray-codes@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

**3. Add pre-commit hook** (updates maps before each commit):

```bash
cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

See [Configuration](#configuration) and [Automation](#automation) sections for detailed setup.

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

### `xray clear-cache`

Clear the SQLite cache used for parsed AST data.

```bash
xray clear-cache
```

### `xray completion`

Generate shell completion scripts for bash, zsh, or fish.

```bash
# For bash - add to ~/.bashrc or ~/.bash_profile
eval "$(xray completion bash)"

# For zsh - add to ~/.zshrc
eval "$(xray completion zsh)"

# For fish - save to completions directory
xray completion fish > ~/.config/fish/completions/xray.fish
```

After enabling completions, you can press Tab to autocomplete:
- Commands: `map`, `scan`, `graph`, `clear-cache`, etc.
- Options: `--path`, `--output`, `--with`, etc.
- Feature values: `vars`, `incs`, `docs`, `cost`, `cf`, `df`
- File paths for options like `--path`, `--output`, `--anchor`

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
  - `--txt` → `mymap.txt`
  - `--csv` → `mymap.csv`
  - `--xml` → `mymap.xml`
  - `--json` → `mymap.json`

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

xray supports configuration files to define default settings for your project. This is especially useful for:
- **Automation**: GitHub Actions and pre-commit hooks can regenerate xray maps automatically
- **Consistency**: Team members get the same analysis without remembering CLI flags
- **Multiple Views**: Define presets for different analysis needs (quick overview, detailed analysis, etc.)

### Configuration Files

xray searches for configuration in this order:

1. `.xrayrc` (JSON)
2. `.xrayrc.json`
3. `.xrayrc.js` (CommonJS module)
4. `xray.config.json`
5. `xray.config.js` (CommonJS module)
6. `package.json` (under `"xray"` field)

You can also specify a custom config file with `--config <path>`.

### Configuration Format

**JSON Example (.xrayrc.json):**

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "limit": 8000,
  "features": {
    "vars": true,
    "incs": true,
    "docs": false,
    "cf": false,
    "df": false
  },
  "depth": 5,
  "match": ["*.ts", "*.tsx", "!*.test.ts"],
  "format": "txt",
  "diagram": "mermaid"
}
```

**JavaScript Example (xray.config.js):**

```javascript
module.exports = {
  paths: ['./src'],
  output: 'docs/codebase-map.txt',
  limit: 8000,
  features: {
    vars: true,
    incs: true,
  },
  presets: {
    quick: {
      limit: 4000,
      depth: 3,
    },
    detailed: {
      limit: 16000,
      features: {
        vars: true,
        incs: true,
        docs: true,
        cf: true,
        df: true,
      },
    },
  },
};
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `paths` | `string[]` | Default paths to analyze |
| `output` | `string` | Default output file path |
| `limit` | `number` | Token limit for output |
| `features` | `object` | Features to enable: `vars`, `incs`, `docs`, `cost`, `cf`, `df` |
| `anchor` | `string` | Focus file for Personalized PageRank |
| `depth` | `number` | Maximum depth of tree to render |
| `match` | `string[]` | File name patterns (glob) |
| `catch` | `string[]` | Function/class name patterns |
| `format` | `'txt' \| 'csv' \| 'xml'` | Output format |
| `diagram` | `'mermaid' \| 'dot'` | Diagram type |
| `queries` | `string[]` | Custom Tree-sitter query paths/URLs |
| `json` | `boolean` | Output raw JSON graph |
| `scopes` | `object` | Named scoped xray configurations (multiple independent outputs) |
| `presets` | `object` | Named configuration presets (legacy) |

### Using Scoped Configurations

**Scopes** allow you to define multiple independent xray configurations that generate different outputs. This is perfect for:
- Generating different views of your codebase (overview, API, frontend, etc.)
- Creating focused maps for different teams or purposes
- Running multiple analyses in a single command

**Example:**

```json
{
  "paths": ["./src"],
  "limit": 8000,
  "features": {
    "incs": true
  },
  "scopes": {
    "overview": {
      "output": "docs/overview.txt",
      "limit": 4000,
      "depth": 3
    },
    "api": {
      "paths": ["./src/api"],
      "anchor": "src/api/index.ts",
      "output": "docs/api-map.txt",
      "features": {
        "vars": true,
        "incs": true
      },
      "catch": ["*Controller", "*Service"]
    },
    "frontend": {
      "paths": ["./src/components"],
      "output": "docs/frontend-map.txt",
      "match": ["*.tsx", "*.jsx"]
    }
  }
}
```

**Usage:**

```bash
# Run a specific scope
xray map --scope api

# Run all scopes
xray map --all-scopes

# Scopes inherit base config but can override any setting
```

### Using Presets (Legacy)

Presets are similar to scopes but run with CLI options:

```json
{
  "paths": ["./src"],
  "limit": 8000,
  "presets": {
    "quick": {
      "output": "docs/quick-map.txt",
      "limit": 4000,
      "depth": 3
    }
  }
}
```

Use presets with the `--preset` flag:

```bash
xray map --preset quick
```

**Scopes vs Presets:**
- **Scopes**: Multiple independent outputs, can run all at once with `--all-scopes`
- **Presets**: Single output, used for quick CLI shortcuts

### CLI Precedence

Command-line flags always override configuration file settings:

```bash
# Config specifies output: "docs/map.txt"
# This command overrides it:
xray map --output custom-output.txt
```

## Automation

### GitHub Action

Automatically regenerate xray maps when code changes in pull requests.

**Quick Setup:**

1. Create `.xrayrc.json` in your repository root (see [Configuration](#configuration))

2. Create `.github/workflows/xray-regenerate.yml`:

```yaml
name: Regenerate Xray Maps

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - '**.ts'
      - '**.js'
      - '**.py'
      # Add other source file extensions

jobs:
  regenerate-xray:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}

      - uses: IdeaCraftersLabs/oss-xray-codes@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

**Action Inputs:**

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for commits | `${{ github.token }}` |
| `config-path` | Custom config file path | Auto-detect |
| `xray-version` | xray version to install | `latest` |
| `commit-message` | Custom commit message | `chore: regenerate xray maps` |

**What it does:**
- ✅ Triggers on PR creation and updates
- ✅ Auto-detects xray configuration files
- ✅ Regenerates xray maps based on your config
- ✅ Only commits when maps actually change
- ✅ Works with presets and multiple configurations

**Example workflow template:** `.github/workflows/xray-example.yml.template`

**Full documentation:** [GitHub Action Guide](docs/github-action.md)

### Pre-commit Hook

Ensure xray maps are always up-to-date before committing locally.

**Installation:**

```bash
# Copy the pre-commit hook to your .git/hooks directory
cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**Pre-commit hook source:** [`hooks/pre-commit`](hooks/pre-commit)

**What it does:**
- ✅ Runs automatically before each commit
- ✅ Only runs if a configuration file exists
- ✅ Only triggers when source files are staged
- ✅ Regenerates xray maps based on your config
- ✅ Automatically stages updated maps
- ✅ Gracefully skips if xray is not installed

**Manual Installation:**

If you prefer to manually create the hook, save this to `.git/hooks/pre-commit`:

```bash
#!/bin/sh
# Xray pre-commit hook - regenerates xray maps before committing

# Check if xray config exists
if [ ! -f ".xrayrc" ] && [ ! -f ".xrayrc.json" ] && \
   [ ! -f "xray.config.json" ] && [ ! -f "xray.config.js" ]; then
  exit 0
fi

# Check if xray is installed
if ! command -v xray &> /dev/null; then
  echo "⚠️  Xray not installed. Run: npm install -g xray"
  exit 0
fi

# Get staged source files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | \
  grep -E '\.(ts|tsx|js|jsx|py|java|go|rs|rb|php|swift|kt|cs|cpp|c|h|lua|dart|ex|hs|scala)$' || true)

# Skip if no source files
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "🔍 Regenerating xray maps..."
xray map

# Stage any changes
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  echo "✓ Xray maps updated and staged"
fi

exit 0
```

Then make it executable: `chmod +x .git/hooks/pre-commit`

**Using with Husky:**

If you use [Husky](https://typicode.github.io/husky/) for git hooks:

```bash
# Install husky
npm install -D husky
npx husky init

# Add xray to pre-commit hook
echo "npx xray map && git add -A" > .husky/pre-commit
```

**Using with pre-commit framework:**

For the [pre-commit](https://pre-commit.com/) framework, add to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: xray-regenerate
        name: Regenerate xray maps
        entry: bash -c 'xray map && git add -A'
        language: system
        pass_filenames: false
        files: \.(ts|tsx|js|jsx|py|java|go|rs)$
```

**Complete automation guide:** [Automation Documentation](docs/automation.md)

### Custom Queries

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
xray map --output analysis.txt
```

### Multi-Path Analysis

```bash
# Analyze multiple directories
xray map --path ./src --path ./lib --path ./tests --output full-analysis.txt
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
  --path ./src \
  --anchor src/main.ts \
  --with vars --with incs --with cf --with df \
  --match "*.ts" --match "!*.test.ts" \
  --depth 5 \
  --output detailed-map.txt
```

### Focus Analysis

```bash
# Focus on specific entry point
xray map --anchor src/index.ts --with incs --output focused.txt

# Analyze only shallow structure
xray map --depth 2 --output shallow.txt
```

### Cost Estimation

```bash
# Estimate LLM token cost
export OPENAI_API_KEY=your-key
xray map --with cost
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
xray map --anchor src/api/routes.ts --with incs --output context.txt

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
- Use `--anchor` to focus on your current work area
- Include `--with incs` to show dependencies
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
xray graph --with cf --path ./src
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
xray graph --with df --path ./src
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
xray map --limit 10000

# Or reduce scope
xray map --depth 3 --match "!*.test.ts"
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

**Support xray development!** If you find this tool valuable, consider [becoming a sponsor](https://github.com/sponsors/IdeaCraftersLabs) to help us maintain and improve it. Your sponsorship enables us to dedicate more time to new features, bug fixes, and community support.

See our [full list of sponsors](SPONSORS.md) and sponsorship tiers.

## Links

- **GitHub:** https://github.com/IdeaCraftersLabs/oss-xray-codes
- **Issues:** https://github.com/IdeaCraftersLabs/oss-xray-codes/issues
- **NPM:** https://www.npmjs.com/package/xray

---

Made with ❤️ by the Idea Crafters team
