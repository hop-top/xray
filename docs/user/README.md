# xray User Manual

Welcome to xray—the intelligent code mapping tool that makes your codebase legible to AI assistants.

## What is xray? (In One Sentence)

**xray generates AI-friendly code maps that show what matters most in your codebase, without drowning in details or burning through your token budget.**

## The Problem xray Solves

You're working with an AI assistant (Claude, GPT, etc.) and need to help it understand your codebase. What do you do?

- **Option A**: Paste entire files
  - Result: 50k tokens spent, context window maxed out, AI still confused about the big picture ❌

- **Option B**: Cherry-pick files
  - Result: AI understands those files, but misses critical relationships and context ❌

- **Option C**: Use xray
  - Result: 2k-4k token overview showing structure, dependencies, and what matters most ✅

## The xray Approach

Think of xray like Google Earth for your codebase:
- **Zoom out**: See the entire structure at once
- **Zoom in**: Drill down on specific areas
- **Smart priorities**: The algorithm shows important files first (using PageRank)
- **Context-aware**: Understands frameworks (React, Express, etc.)
- **Token-conscious**: Output designed to fit AI context windows

## Quick Navigation

### New to xray?
Start here: **[Getting Started Guide](getting-started.md)**
- 60-second installation
- Your first xray command
- Understanding the output

### Want to learn commands?
See: **[Command Reference](commands.md)**
- Decision tree: which command for what
- Quick reference table
- Detailed command guides

### Looking for workflows?
Check: **[Common Workflows](workflows.md)**
- Onboarding to a new codebase
- Debugging complex issues
- Planning refactors
- Prepping for AI assistance

### Using a coding agent?
See: **[Harness Integration Guide](harness-integration.md)**
- Skill / `AGENTS.md`, MCP server, or hooks that push `xray impact`
- Claude Code, nerv, Gemini CLI, Codex, Cursor
- [Use cases](use-cases.md) with real output

### Need specific help?
Try: **[Strategies Guide](strategies.md)** (framework-specific analysis)
or **[Troubleshooting](troubleshooting.md)** (solving problems)

## Core Concepts (5 Minutes to Understand)

### 1. xray map
Your main command. Generates a hierarchical view of your codebase showing:
- Files and functions/classes
- Which files call which (dependencies)
- Imports and exports
- Optional: variables, docstrings, control flow

Think of it as "table of contents + index" for your code.

```bash
xray map                    # Basic overview
xray map --anchor src/api.ts  # Focused analysis on one file
xray map --with incs --with vars  # Include imports and variables
```

### 2. Strategies
Pre-built analyzers that understand frameworks. Ask specific questions:
- React: "Show me all components"
- Express: "List all API routes"
- Go CLI: "What commands does this have?"

```bash
xray react components      # List all React components
xray express routes        # List all Express routes
xray strategy detect       # What frameworks are here?
```

### 3. Chunked Output
Large codebases are split into digestible chunks (one per directory level). Navigate between them:
- `.xray_root.md` - Root overview
- `.xray_src.md` - src/ directory
- `.xray_src_lib.md` - src/lib/ directory

Each chunk has navigation links. Perfect for AI assistants that work with one file at a time.

See **[Best Practices: Token Budget Management](best-practices.md#token-budget-management)** for details.

### 4. Configuration
Set once, run anywhere. Define your xray settings in `.xrayrc.json` and never type long flag combinations again.

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "features": { "incs": true, "vars": true }
}
```

Then just run: `xray map`

See **[Configuration Guide](configuration.md)** for all options.

## The xray Workflow

### For Solo Developers
1. `xray map` - understand your codebase structure
2. Share output with your AI assistant
3. Ask questions with full context
4. Use `xray explore` to drill down on specific areas

### For Teams
1. Commit `.xrayrc.json` to the repo
2. Set up GitHub Action (auto-updates on pull requests)
3. Everyone runs `xray map` for consistent analysis
4. Use strategies to document API, components, etc.

### For AI-Assisted Development
1. Generate focused map: `xray map --anchor src/api --with incs`
2. Share with Claude/GPT
3. Get AI help with full codebase context
4. Run `xray map` again after changes
5. Share updated context with AI

With a coding agent (Claude Code, Gemini CLI, …), let hooks do steps 1–2:
see [Harness Integration](harness-integration.md).

## Key Features at a Glance

| Feature | Why It Matters |
|---------|---|
| **Intelligent Ranking** | Most important files float to top (PageRank algorithm) |
| **Framework-Aware** | Understands React, Express, Go CLI, REST APIs |
| **Token-Efficient** | Output fits AI context windows (4K-16K tokens) |
| **Chunked Output** | Break large maps into chapters for AI assistants |
| **Smart Caching** | Second runs are fast (SQLite cache) |
| **Multi-Language** | 19+ languages (JS, TS, Python, Go, Java, Rust, etc.) |
| **Dependency Tracking** | See who calls who in your codebase |
| **Automation Ready** | GitHub Actions + pre-commit hooks |

## Common Questions

### Q: How much does it cost?
**A:** xray is free and open-source. You control output size via token limits, so you control AI API costs.

### Q: What languages does it support?
**A:** JavaScript, TypeScript, Python, Go, Java, C, C++, C#, Rust, Swift, Kotlin, Scala, Haskell, Elixir, Ruby, PHP, Bash, and more. See [Supported Languages](../../README.md#supported-languages).

### Q: Can I use it in CI/CD?
**A:** Yes! Use GitHub Actions or pre-commit hooks to auto-regenerate maps. See [Automation Guide](automation.md).

### Q: Does it work with AI assistants?
**A:** That's the whole point! Output is designed for Claude, GPT, and other LLMs. Fits context windows, organized for understanding, tested with real AI workflows.

### Q: How long does it take?
**A:** First run: 10-30 seconds (AST parsing). Subsequent runs: 1-5 seconds (cached).

### Q: Can I customize the output?
**A:** Absolutely. Configure paths, token limits, features, file filters, focus points, output formats, and more.

## Getting Started

Choose your path:

### "I want to understand my codebase"
→ **[Getting Started Guide](getting-started.md)**

### "I want to prep code for AI analysis"
→ **[Common Workflows - AI Assistance](workflows.md#workflow-preparing-code-for-ai-analysis)**

### "I want to learn all the commands"
→ **[Command Reference](commands.md)**

### "I want my team to use xray"
→ **[Configuration Guide](configuration.md)** + **[Automation Guide](automation.md)**

### "I'm stuck or something's broken"
→ **[Troubleshooting Guide](troubleshooting.md)**

## Real-World Examples

### "I just joined this project, where do I start?"
```bash
# Step 1: What frameworks are here?
xray strategy detect

# Step 2: List main components/routes
xray react components    # or xray express routes

# Step 3: Get detailed map of src/
xray map --path ./src

# Step 4: Drill into specific file
xray map --anchor src/api/routes.ts --with incs
```

### "I'm debugging a weird dependency issue"
```bash
# What imports this file?
xray map --anchor src/utils/helper.ts --with incs

# Get everything with dependency info
xray map --with incs --with vars

# Focus on specific subsystem
xray map --path ./src/services --with incs
```

### "What breaks if I change this function?"
```bash
# Transitive callers, grouped by area (see Command Reference: xray impact)
xray impact createSession
```
In an agent session the same answer can arrive by hook: [Use cases](use-cases.md#use-case-impact-analysis).

### "I need to document this for AI"
```bash
# Generate map focused on public API
xray map --anchor src/api/index.ts --with incs --with docs --no-chunk

# Share the output file with Claude/GPT
cat .xray.txt | xclip  # or copy to clipboard
```

## Next Steps

1. **Install**: `npm install -g @hop-top/xray`
2. **Run**: `xray map` in your project
3. **View**: open the `Root chunk:` file xray prints (see `.xray_*.md`) in an editor
4. **Learn**: Pick a guide from above based on your need

## Resources

- **Full Docs**: [README](../../README.md)
- **Getting Started**: [Installation & First Steps](getting-started.md)
- **All Commands**: [Commands Reference](commands.md)
- **Framework Analysis**: [Strategies Guide](strategies.md)
- **Configuration**: [Config File Guide](configuration.md)
- **Automation**: [GitHub Actions & Hooks](automation.md)
- **Coding agents**: [Harness Integration](harness-integration.md) · [MCP Server](mcp.md) · [Use Cases](use-cases.md)
- **Workflows**: [Common Tasks](workflows.md)
- **Help**: [Troubleshooting](troubleshooting.md)

## Still Have Questions?

- Check [Troubleshooting Guide](troubleshooting.md) for common issues
- Visit [GitHub Issues](https://github.com/hop-top/xray/issues)
- Search existing issues for solutions

## Core Insight

xray exists because sharing entire codebases with AI is inefficient and expensive. By showing the algorithm what matters most and respecting token budgets, you get better AI assistance with less cost.

It's like having a senior developer write a "here's what you need to know" summary instead of drowning the AI in source files.

**Start with `xray map`. Your AI assistant will thank you.**
