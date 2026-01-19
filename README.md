# xray

> X-ray your codebase - Generate intelligent, AI-optimized code maps for deep understanding

[![npm version](https://img.shields.io/npm/v/xray.svg)](https://www.npmjs.com/package/xray)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**⚠️ ALPHA RELEASE** - Early alpha version. Features may be incomplete or subject to breaking changes.

## What is xray?

xray generates **intelligent, ranked, context-aware code maps** that fit within AI context windows while preserving the most important structural information. Perfect for AI-assisted development, code navigation, and understanding complex codebases.

**The Problem:** Sharing entire codebases with AI assistants hits context limits. Cherry-picking files misses critical relationships.

**The Solution:** xray uses AST parsing + PageRank to create compact, prioritized visualizations that show what matters most.

## Quick Start

```bash
# Install
npm install -g xray

# Generate your first code map
cd /path/to/your/project
xray map

# View the output
cat .xray
```

**That's it!** You now have a structured overview of your codebase.

## Key Features

- 🎯 **Intelligent Ranking** - PageRank algorithm surfaces the most important files and functions first
- 🤖 **AI-Optimized** - Token-efficient output designed for Claude, GPT, and other LLMs
- 📊 **Multi-Language** - Supports 19+ programming languages via tree-sitter
- 🔍 **Framework-Aware** - Built-in strategies for React, Express, Go CLI, and more
- ⚡ **Smart Caching** - SQLite cache for fast subsequent runs
- 🔗 **Dependency Tracking** - Shows imports, exports, and cross-file relationships
- ⚙️  **Automation Ready** - GitHub Actions and pre-commit hooks included

## Core Commands

### `xray map` - Generate Code Maps

```bash
# Basic usage
xray map

# Focused analysis
xray map --path ./src --with incs --with vars --output codebase-map.txt

# Focus on specific file
xray map --anchor src/main.ts --with incs
```

### `xray explore` - Framework-Specific Analysis

```bash
# React components
xray react:components

# Express routes
xray express:routes

# Go CLI commands
xray go-cli:commands

# Detect available strategies
xray strategy:detect
```

**Built-in Strategies:**
- **React** - Components, hooks, contexts
- **Express** - Routes, middleware, error handlers
- **REST API** - Cross-framework endpoint analysis (Node.js, Python, Go)
- **Go CLI** - Commands, flags, hierarchy (Cobra, urfave/cli)

[See all strategies →](docs/user/strategies.md)

### `xray scan` - File Discovery

```bash
xray scan --path ./src --match "*.ts" --match "!*.test.ts"
```

### `xray graph` - Control/Data Flow

```bash
xray graph --with cf --with df --output graphs.txt
```

## Common Use Cases

### For AI-Assisted Development

```bash
# Generate a focused map for your AI assistant
xray map --anchor src/api/routes.ts --with incs --output context.txt

# Share context.txt with Claude/GPT
# AI now understands your codebase structure and can provide accurate suggestions
```

**Before xray:** Paste 10 files, 50k tokens 😰
**After xray:** Share 2k token map showing entire structure ✨

### Automation

Keep maps up-to-date automatically:

**GitHub Action** (`.github/workflows/xray-regenerate.yml`):
```yaml
on:
  pull_request:
    types: [opened, synchronize]
jobs:
  xray:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
      - uses: IdeaCraftersLabs/oss-xray-codes@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

**Pre-commit Hook:**
```bash
cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

[Full automation guide →](docs/user/automation.md)

### Configuration

**Create `.xrayrc.json`:**
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

Now just run `xray map` - no flags needed!

[Configuration guide →](docs/user/configuration.md)

## Options & Flags

### Core Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --path <paths...>` | Directories to analyze | current directory |
| `-o, --output <path>` | Output file | `.xray` |
| `-l, --limit <number>` | Token limit | 4096 |

### Features (`--with`)

| Feature | Description |
|---------|-------------|
| `vars` | Include variables and constants |
| `incs` | Include imports and dependencies |
| `docs` | Include docstrings |
| `cost` | Estimate AI cost (requires `OPENAI_API_KEY`) |
| `cf` | Control Flow Graph |
| `df` | Data Flow Graph |

### Filtering

| Flag | Description |
|------|-------------|
| `-a, --anchor <path>` | Focus on specific file (Personalized PageRank) |
| `-d, --depth <number>` | Maximum tree depth |
| `-m, --match <patterns...>` | File patterns (`!` to exclude) |
| `-c, --catch <patterns...>` | Function/class patterns |

[Complete command reference →](docs/user/commands.md)

## Output Format

```
utils.ts (L5-L50):
│ [L5-L12] function helper
│       → used by: [main.ts:L15](L10-L25)
│ [L15-L20] function validate
│ [L25] const API_KEY

## External Dependencies
| Library | Used By |
|---------|---------|
| fs | main.ts, utils.ts |
```

- **Line ranges**: `[L5-L12]` for multi-line, `[L25]` for single-line
- **Cross-references**: Shows which files call each function
- **Dependency table**: Lists external libraries (with `--with incs`)

## Supported Languages

- Bash
- C
- C#
- C++
- Elixir
- Go
- Haskell
- Java
- JavaScript
- Kotlin
- PHP
- Python
- Ruby
- Rust
- Scala
- Swift
- TypeScript

**Note:** Dart and Lua currently unsupported due to tree-sitter version incompatibility ([#6](https://github.com/IdeaCraftersLabs/oss-xray-codes/issues/6))

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

**Requirements:**
- Node.js 20+
- C++ build tools (build-essential on Linux, Xcode on macOS)

**Troubleshooting:**
```bash
CXXFLAGS="-std=c++20" npm install --legacy-peer-deps
```

[Full installation guide →](docs/user/getting-started.md)

## Documentation

### User Documentation
- [Getting Started](docs/user/getting-started.md) - Installation and first steps
- [Commands Reference](docs/user/commands.md) - All commands and options
- [Configuration](docs/user/configuration.md) - Config files and presets
- [Strategies](docs/user/strategies.md) - Framework-specific analysis
- [Automation](docs/user/automation.md) - GitHub Actions and hooks
- [Troubleshooting](docs/user/troubleshooting.md) - Common issues

### Developer Documentation
- [Architecture](docs/dev/architecture.md) - System design and internals
- [Strategy Development](docs/dev/strategy-development.md) - Creating custom strategies
- [Strategy API](docs/dev/strategy-api.md) - Strategy command reference
- [Contributing](docs/dev/contributing.md) - Development setup and workflow

## Advanced Features

### Control Flow Graph (CFG)

Available for: C, C++, C#, Go, Java, Rust, Swift

```bash
xray graph --with cf --path ./src
```

Analyzes function entry/exit, conditional branches, loops, and try/catch blocks.

### Data Flow Graph (DFG)

Available for: C, C++, C#, Go, Java, Rust, Swift

```bash
xray graph --with df --path ./src
```

Tracks variable definitions, usage, data dependencies, and assignment flows.

### Custom Queries

Override default Tree-sitter queries:

```bash
xray map --query .ts:./custom-typescript.scm
```

### Shell Completion

```bash
# Bash
eval "$(xray completion bash)"

# Zsh
eval "$(xray completion zsh)"

# Fish
xray completion fish > ~/.config/fish/completions/xray.fish
```

## Examples

### Multi-Path Analysis
```bash
xray map --path ./src --path ./lib --path ./tests --output full-analysis.txt
```

### Feature-Rich Analysis
```bash
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
xray map --anchor src/index.ts --with incs --output focused.txt
```

### Cost Estimation
```bash
export OPENAI_API_KEY=your-key
xray map --with cost
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](docs/dev/contributing.md).

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Sponsors

Sponsored by [Idea Crafters LLC](https://ideacrafters.com)

**Support xray development!** If you find this tool valuable, consider [becoming a sponsor](https://github.com/sponsors/IdeaCraftersLabs).

See our [full list of sponsors](SPONSORS.md).

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- **GitHub:** https://github.com/IdeaCraftersLabs/oss-xray-codes
- **Issues:** https://github.com/IdeaCraftersLabs/oss-xray-codes/issues
- **NPM:** https://www.npmjs.com/package/xray

---

Made with ❤️ by the Idea Crafters team
