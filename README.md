# xray

> X-ray your codebase - Generate intelligent, AI-optimized code maps for deep understanding

[![npm version](https://img.shields.io/npm/v/@hop-top/xray.svg)](https://www.npmjs.com/package/@hop-top/xray)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is xray?

xray generates **intelligent, ranked, context-aware code maps** that fit within AI context windows while preserving the most important structural information. Perfect for AI-assisted development, code navigation, and understanding complex codebases.

**The Problem:** Sharing entire codebases with AI assistants hits context limits. Cherry-picking files misses critical relationships.

**The Solution:** xray uses AST parsing + PageRank to create compact, prioritized visualizations that show what matters most.

## Quick Start

```bash
# Install
npm install -g @hop-top/xray
xray lang add go typescript   # grammars are opt-in; pick your languages

# Generate your first code map
cd /path/to/your/project
xray map

# List the chunk files; xray also prints "Root chunk: <path>" - open that one
ls .xray_*.md
```

**That's it!** You now have a structured overview of your codebase.

## Key Features

- 🎯 **Intelligent Ranking** - PageRank algorithm surfaces the most important files and functions first
- 🤖 **AI-Optimized** - Token-efficient output designed for Claude, GPT, and other LLMs
- 📦 **Chunked Output** - Automatically splits large codebases into navigable chunks (NEW!)
- 📊 **Multi-Language** - 17 languages via opt-in tree-sitter packs (`xray lang add`)
- 🔍 **Framework-Aware** - Built-in strategies for React, Express, Go CLI, and more
- ⚡ **Smart Caching** - SQLite cache for fast subsequent runs
- 🔗 **Dependency Tracking** - Shows imports, exports, and cross-file relationships
- 💥 **Impact Analysis** - `xray impact <symbol>` answers "what breaks if I change this?" with AST-resolved callers, grouped by package, across one repo or your whole workspace
- ⚙️  **Automation Ready** - GitHub Actions and pre-commit hooks included
- 🔌 **Custom Strategies** - Add framework-specific analysis and commands with `@hop-top/xray/strategy`; see [docs/dev/strategy-development.md](docs/dev/strategy-development.md)
- 🧭 **Logical Clustering** - Group chunks by graph community with `--group community` (NEW!)
- 🎛️ **Plugin Presets** - Apply curated plugin bundles via `--preset insights|onboarding|exploration`, or load your own from a local path / npm package. See [docs/user/presets.md](docs/user/presets.md). (NEW!)

## Core Commands

### `xray map` - Generate Code Maps

```bash
# Basic usage (generates chunked output by default)
xray map

# Focused analysis
xray map --path ./src --with incs --with vars --output codebase-map.txt

# Single file output (disable chunking)
xray map --no-chunk --output single-file.txt

# Focus on specific file with custom token limit
xray map --anchor src/main.ts --with incs --limit 8192
```

**NEW: Chunked Output**

By default, xray generates multiple files organized by directory structure:
- `.xray_root.md` - Root directory
- `.xray_src.md` - src/ directory
- `.xray_src_lib.md` - src/lib/ directory
- etc.

Each chunk includes parent ↔ child navigation links. Use `--no-chunk` for single-file output.

[Learn more about chunked output →](docs/user/README.md#3-chunked-output)

**NEW: Community grouping (`--group community`)**

Pass `--group community` to group chunks by graph community (Louvain over the `calls`
subgraph) instead of by directory. Communities capture functional cohesion independent of
the filesystem layout. Default grouping is unchanged.

```bash
xray map --group community
```

[Learn more about logical clustering →](docs/user/clustering.md)

### Strategy Commands - Framework-Specific Analysis

xray includes **dynamic strategy commands** that provide framework-specific insights:

```bash
# React - List components, hooks, contexts
xray react components
xray react hooks
xray react contexts

# Express - Analyze routes and middleware
xray express routes
xray express middleware
xray express error-handlers

# REST API - Cross-framework endpoint analysis
xray rest-api endpoints
xray rest-api methods

# See all available strategies
xray strategy list

# Detect applicable strategies for current project
xray strategy detect
```

**Built-in Strategies:**
- **React** - Components, hooks, contexts
- **Express** - Routes, routers, middleware, error handlers
- **REST API** - Cross-framework endpoint analysis (Node.js, Python, Go)
- **Go CLI** - Command tree and flags (Cobra)
- **Next.js** - Pages, API routes, components
- **Build** - Makefile, Justfile, Taskfile, npm scripts
- **CI/CD** - GitHub Actions, GitLab CI, CircleCI
- **Config** - Configuration file analysis (JSON, YAML, TOML, env)
- **Container** - Dockerfile and Docker Compose analysis
- **Infrastructure** - Terraform, Kubernetes, Helm, CloudFormation
- **Markdown** - Table of contents and structure analysis
- **Package Manager** - npm, pip, Go modules dependency analysis

Built-in strategy commands register automatically. Strategies in a project (`.xray/strategies/`, `xray-strategy-*` packages) load only if declarative YAML, or if you set `XRAY_ALLOW_PROJECT_STRATEGIES=1` for code you trust.

[See all strategies →](docs/user/strategies.md)

### `xray explore` - File Discovery

```bash
xray explore --path ./src --match "*.ts" --match "!*.test.ts"
```

### `xray graph` - Control/Data Flow

`graph` is `map` with control flow (`cf`) and data flow (`df`) on: one CFG and
one DFG per function and method, under the function. TypeScript, JavaScript,
Python and Go; other languages get one stderr notice and no graphs.

```bash
xray graph --path ./src --no-chunk --output flow.txt
```

```text
a.ts (L1-L8):
│ [L1-L8] function sum(xs: number[], limit: number) : number
│   cfg
│     n0 entry L1 → n2
│     n1 exit L8
│     n2 stmt L2 let total = 0 → n3
│     n3 loop L3 for (const x of xs) → n4:true n7:false
│     n4 cond L4 x > limit → n5:true n6:false
│     n5 break L4 break → n7
│     n6 stmt L5 total += x → n3
│     n7 return L7 return total → n1
│   dfg
│     d0 xs param L1 → n3
│     d1 limit param L1 → n4
│     d2 total decl L2 → n6 n7
│     d3 x loop L3 → n4 n6
│     d4 total update L5 → n6 n7
```

`--with cf` or `--with df` narrows to that one. `map --with cf` gives the same
graphs on a plain map. See [`docs/user/commands.md`](docs/user/commands.md#xray-graph)
for the format, a Python and a Go example, and each language's limits.

### `xray impact` - What breaks if I change this?

Before touching a signature, ask xray who calls it. Callers come from the
resolved call graph (same file, same package, imported packages), not from a
text search, so a method named `Run` in another package doesn't count.

```bash
xray impact RunHooks --depth 2
```

```
coverage: 318 files parsed · skipped grammars: none
RunHooks (method, internal/dispatch/run.go:L108) — 35 callers across 2 groups
  internal: 10 callers — Dispatch (internal/dispatch/dispatch.go:L85), TestRunHooks_EmptyList (internal/dispatch/run_test.go:L48), …
    …and 5 more
  cmd: 2 callers — runReplay (cmd/nerv/cmd_replay.go:L52), testSingleEvent (cmd/nerv/cmd_testhook.go:L140)
depth 2:
    internal: 14 callers — TestDispatch_PublishesCrtxEmission (internal/dispatch/crtx_publish_test.go:L17), …
    cmd: 9 callers — TestReplayCmd_FlagsReachRunE (cmd/nerv/cmd_replay_test.go:L18), runTest (cmd/nerv/cmd_testhook.go:L53), …
edges: EXTRACTED 35 · INFERRED 0
```

`EXTRACTED` edges are backed by file, package or import evidence; `INFERRED`
ones are name-only matches — drop them with `--strict`. Point it at several
repos (`-p a -p b`, or a `--lens` from `.xrayrc.json`) and callers are grouped
per repo, with a merged-graph cache so repeat runs are instant. `--format
json|tree|table` for machines; also available as the `impact` tool of
`xray mcp`.

[Agent workflow: impact analysis →](docs/agent/workflows/impact-analysis.md) ·
[Use case: impact analysis in agent sessions →](docs/user/use-cases.md#use-case-impact-analysis)

## Common Use Cases

### For AI-Assisted Development

```bash
# Generate a focused map for your AI assistant
xray map --anchor src/api/routes.ts --with incs --no-chunk --output context.txt

# Share context.txt with Claude/GPT
# AI now understands your codebase structure and can provide accurate suggestions
```

**Before xray:** Paste 10 files, 50k tokens 😰
**After xray:** Share 2k token map showing entire structure ✨

Coding agents can also get xray without you pasting anything: as
instructions (skill, `AGENTS.md`), pulled over MCP (`xray mcp`), or pushed
by harness hooks that answer "who calls this?" the moment the agent greps
for a function (Claude Code, nerv, Gemini CLI).

[Harness integration guide →](docs/user/harness-integration.md)

### Claude Code Skill

xray ships with a [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) that gives Claude direct access to xray commands for codebase analysis, onboarding, and framework-specific insights.

**Install the skill globally:**

```bash
# Copy the skill to your Claude Code skills directory
mkdir -p ~/.claude/skills
cp -r skills/xray-cli ~/.claude/skills/
```

Once installed, Claude Code can use xray to:
- Onboard to new codebases (`xray strategy detect`, `xray map`)
- Scan framework surfaces (`xray react components`, `xray express routes`)
- Trace dependencies and data flow (`xray map --anchor <file> --with incs`)
- Analyze infrastructure (`xray infrastructure resources`, `xray cicd workflows`)
- Understand build systems (`xray build targets`, `xray package-manager list-dependencies`)

The skill is one short file, [`skills/xray-cli/SKILL.md`](skills/xray-cli/SKILL.md): when to reach for which command, and what `--help` does not say.

The skill only helps when Claude decides to use it. For tool access, add
the MCP server (`claude mcp add xray -- xray -C /path/to/project mcp`,
see [MCP server](docs/user/mcp.md)); to have `xray impact` arrive by itself
when Claude greps for a function, install the hooks in
[`hooks/harness/claude/`](hooks/harness/claude/README.md)
([guide](docs/user/harness-integration.md#claude-code)).

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
      - uses: hop-top/xray@xray/v0.1.0-rc.0
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

## Presets and Strategies

### Presets

`--preset` wires a curated bundle of analysis plugins into `xray map`:

```bash
xray map --preset insights
xray map --preset onboarding --preset exploration   # repeatable; plugins already applied are skipped
```

| Preset | Adds |
|--------|------|
| `insights` | confidence, clustering, surprise, questions |
| `onboarding` | confidence, clustering, questions |
| `exploration` | confidence, surprise |

`--preset ./my-preset.js` or `--preset @scope/pkg` loads your own preset
from a local path or npm package; it runs as code in the xray process, so
load only what you trust.

[Presets guide →](docs/user/presets.md)

### Extending with strategies

Strategies are the extension route: a strategy detects a framework or
file convention, tags files during analysis and adds its own
`xray <strategy> <noun>` commands. Put one in `.xray/strategies/` (or
ship it as an npm package) and type it from the public entry:

```typescript
import type { Strategy, StrategyContext, FileMetadata } from '@hop-top/xray/strategy';

export default class VueStrategy implements Strategy {
  name = 'vue';
  version = '1.0.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    return ctx.hasDependency('vue');
  }

  fileTypes(): string[] {
    return ['.vue'];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    return { tags: content.includes('<template>') ? ['vue:component'] : [], metadata: {} };
  }
}
```

Strategy code in a project loads only with `XRAY_ALLOW_PROJECT_STRATEGIES=1`;
declarative YAML strategies always load.

**Learn more:**
- [Strategy Development Guide](docs/dev/strategy-development.md) - Interface, context, commands, testing
- [Strategies guide](docs/user/strategies.md) - Using and configuring strategies

## Options & Flags

### Core Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --path <paths...>` | Directories to analyze | current directory |
| `-o, --output <path>` | Output file (base name for chunks), or `-` for stdout | `.xray` |
| `-l, --limit <number>` | Token limit per chunk | 4096 |
| `--no-chunk` | Disable chunked output | false (chunking enabled) |
| `-d, --depth <number>` | Maximum directory depth | unlimited |

### Features (`--with`)

| Feature | Description |
|---------|-------------|
| `vars` | Include variables and constants |
| `incs` | Include imports and dependencies |
| `docs` | Include docstrings |
| `cost` | Estimate AI cost (requires `OPENAI_API_KEY`) |
| `cf` | Control Flow Graph per function (TypeScript, JavaScript, Python, Go) |
| `df` | Data Flow Graph per function (TypeScript, JavaScript, Python, Go) |

### Filtering

| Flag | Description |
|------|-------------|
| `-a, --anchor <path>` | Focus on specific file (Personalized PageRank) |
| `-d, --depth <number>` | Maximum tree depth |
| `-m, --match <pattern>` | Analyze only files matching a pattern (`!` to exclude; repeatable; same patterns as `explore --match`) |
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

Bash, C, C#, C++, Elixir, Go, Haskell, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Scala, Swift, TypeScript.

Grammars are optional **language packs**: install only what you use.

```bash
xray lang list                  # installed / missing, plus what your repo needs
xray lang add go typescript     # or a bundle: web, go, systems, jvm, scripting, full
```

Missing grammars never fail a scan; xray warns once per language and continues.
Pin languages with `"languages": ["go", "typescript"]` in `.xrayrc.json`.
[Language packs guide →](docs/user/language-packs.md)

## Installation

### NPM (Recommended)

```bash
npm install -g @hop-top/xray
xray lang add go typescript   # choose your language packs
```

### From Source

```bash
git clone https://github.com/hop-top/xray.git
cd xray
npm ci
npm run build
npm link
```

**Requirements:**
- Node.js 22.12+
- Plain `npm ci`, no flags (`package.json` `overrides` reconciles the grammars' stale `tree-sitter` peer ranges)
- Grammars ship prebuilt native binaries for common platforms; C++ build tools (build-essential on Linux, Xcode on macOS) are only needed where no prebuild matches

**Troubleshooting:**
```bash
CXXFLAGS="-std=c++20" npm install
```

[Full installation guide →](docs/user/getting-started.md)

### Shell Completion (Optional)

Enable tab completion for commands, strategies, and options:

**Bash:**
```bash
# Add to ~/.bashrc or ~/.bash_profile
eval "$(xray completion bash)"
```

**Zsh:**
```bash
# Add to ~/.zshrc
eval "$(xray completion zsh)"
```

**Fish:**
```bash
# Save to completions directory
xray completion fish > ~/.config/fish/completions/xray.fish
```

**PowerShell:**
```powershell
xray completion powershell | Out-String | Invoke-Expression
```

Bash needs bash-completion v2. Scripts call back into `xray __complete` on each tab, so built-in and user-installed strategy commands, aliases and flag values always match the installed xray; no regeneration needed. Tab never executes project-local code (cwd strategies), even with `XRAY_ALLOW_PROJECT_STRATEGIES=1`. Scripts generated by xray 0.1.0 must be regenerated once. `--no-descriptions` omits descriptions.

## Documentation

### User Documentation
- [Getting Started](docs/user/getting-started.md) - Installation and first steps
- [Chunked Output Guide](docs/user/README.md#3-chunked-output) - **NEW:** Multi-file output system
- [Commands Reference](docs/user/commands.md) - All commands and options
- [Configuration](docs/user/configuration.md) - Config files and lenses
- [Strategies](docs/user/strategies.md) - Framework-specific analysis
- [Automation](docs/user/automation.md) - GitHub Actions and hooks
- [Harness Integration](docs/user/harness-integration.md) - Skill, MCP and hooks for coding agents
- [Use Cases](docs/user/use-cases.md) - What xray does inside an agent session
- [Troubleshooting](docs/user/troubleshooting.md) - Common issues

### Developer Documentation
- [Architecture](docs/dev/architecture.md) - System design and internals
- [Extension System](docs/dev/extensions.md) - Extension contract and runtime overrides
- [Event Reference](docs/dev/events.md) - **NEW:** Complete lifecycle event documentation
- [Strategy Development](docs/dev/strategy-development.md) - Creating custom strategies
- [Strategy API](docs/dev/strategy-api.md) - Strategy command reference
- [Contributing](docs/dev/contributing.md) - Development setup and workflow

## Advanced Features

### Control and Data Flow Graphs (CFG, DFG)

Available for: TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`), Python
(`.py`), Go (`.go`). Other languages (Java, C#, Rust, Swift, C, C++...) produce no
graphs and say so on stderr.

```bash
xray graph --path ./src            # both
xray graph --with cf --path ./src  # control flow only
xray graph --with df --path ./src  # data flow only
xray graph --format json -o g.json # cfg / dfg fields on each function node
```

Intra-procedural, per function and method: branches, loops, `switch`,
`try`/`catch`/`finally`, labelled `break`/`continue`, short-circuit operators
and ternaries; Python's `with`, `match` and `for`/`else`; Go's `defer`, `select`,
`goto` and type switches; definitions reaching each use, across branches and loops,
with scoping and destructuring. Nested functions get their own graphs.

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

# PowerShell
xray completion powershell | Out-String | Invoke-Expression
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

- **GitHub:** https://github.com/hop-top/xray
- **Issues:** https://github.com/hop-top/xray/issues
- **NPM:** https://www.npmjs.com/package/@hop-top/xray

---

Made with ❤️ by the Idea Crafters team
