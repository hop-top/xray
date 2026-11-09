# Getting Started: Your First xray Map (60 Seconds)

Welcome! Let's get you up and running.

## Installation (30 seconds)

### Option 1: NPM (Easiest)

```bash
npm install -g @hop-top/xray
xray lang add go typescript   # grammars are opt-in; pick your languages
```

Done! Move to the next section.

### Option 2: From Source

```bash
git clone https://github.com/hop-top/xray.git xray
cd xray
npm ci
npm run build
npm link
```

**Note**: Requires Node.js 22.12+. Grammars ship prebuilt native binaries for common platforms; C++ build tools (build-essential on Linux, Xcode on macOS) are only needed where no prebuild matches.

**C++ troubleshooting**:
```bash
CXXFLAGS="-std=c++20" npm install
```

### Verify Installation

```bash
xray --version
```

You should see a version number. If not, see [Troubleshooting](#troubleshooting).

---

## Your First Map (30 seconds)

```bash
# 1. Navigate to any project
cd /path/to/your/project

# 2. Run xray
xray map

# List the chunk files; xray also prints "Root chunk: <path>" - open that one
ls .xray_*.md
```

That's it! You now have a hierarchical map of your codebase.

### What You Just Generated

- **`.xray_root.md`** - Overview of root directory
- **`.xray_src.md`** - Overview of src/
- **`.xray_src_lib.md`** - Detailed view of src/lib/
- etc.

(A project with no files at its top level has no `.xray_root.md`; the first directory's chunk is the root.)

These files have **navigation links** so you can browse like a document.

---

## Understanding the Output

Here's what xray shows you:

```markdown
src/api/routes.ts (L1-L150):
│ [L5-L40] function setupRoutes
│       → used by: [server/index.ts:L15](L10-L25)
│ [L50-L90] function validateRequest
│       → used by: [middleware/auth.ts:L12](L8-L20)
│ [L95-L120] function errorHandler
```

**Translation**:
- **File and line range**: `src/api/routes.ts (L1-L150)` = file location and total size
- **Functions/classes**: `[L5-L40] function setupRoutes` = function at these lines
- **Who uses it**: `→ used by: [server/index.ts:L15]` = other files that call this function

This shows you:
- What's in each file
- How important each thing is (PageRank ranking)
- Who calls what (dependencies)

---

## Quick Examples

### Focus on One Directory

```bash
xray map --path ./src --depth 2
```

This shows just `src/` with only 2 directory levels. Faster, smaller output.

### Include Imports (Show Dependencies)

```bash
xray map --with incs
```

Adds a table showing external libraries and their usage.

### Focus on One File

```bash
xray map --anchor src/api/routes.ts --with incs
```

This uses Personalized PageRank to show what matters relative to `routes.ts`.

### Include Variables

```bash
xray map --with vars
```

Shows local variables and constants (helpful for understanding data structures).

### Combine Multiple Options

```bash
xray map \
  --anchor src/main.ts \
  --with incs \
  --with vars \
  --limit 4000
```

This gives a focused, detailed view of your entry point limited to 4000 tokens.

---

## What to Do With Your Map

### Share with AI Assistant

```bash
# Generate and copy
xray map --anchor src/main.ts --with incs --no-chunk
cat .xray.txt | xclip  # Linux
cat .xray.txt | pbcopy  # macOS

# Paste into Claude, GPT, etc. with your question
```

### Commit to Git

```bash
# Save to documentation
xray map --no-chunk --output docs/codebase-map.txt
git add docs/codebase-map.txt
git commit -m "docs: add codebase map"
```

### Understand the Architecture

Use the map as a roadmap:

```bash
# See top-level structure
xray map --depth 1

# Drill into one area
xray map --anchor src/services --with incs

# Understand dependencies
xray map --with incs
```

---

## Enable Shell Completion

Make typing xray commands faster:

### Bash

Requires bash-completion v2.

```bash
eval "$(xray completion bash)"

# To make permanent, add to ~/.bashrc or ~/.bash_profile
echo 'eval "$(xray completion bash)"' >> ~/.bashrc
```

### Zsh

```bash
eval "$(xray completion zsh)"

# To make permanent, add to ~/.zshrc
echo 'eval "$(xray completion zsh)"' >> ~/.zshrc
```

### Fish

```bash
xray completion fish > ~/.config/fish/completions/xray.fish
```

### PowerShell

```powershell
xray completion powershell | Out-String | Invoke-Expression
```

Now you can type `xray m<TAB>` and it autocompletes!

---

## Next Steps

### If You Want to Learn More

- **All commands**: [Commands Reference](commands.md)
- **Real workflows**: [Common Workflows](workflows.md)
- **Framework-specific**: [Strategies Guide](strategies.md)
- **Configuration**: [Config File Guide](configuration.md)

### If You Want to Automate

- **GitHub Actions**: [Automation Guide](automation.md)
- **Pre-commit hooks**: [Automation Guide](automation.md)

### If You're Stuck

- **Issues**: [Troubleshooting Guide](troubleshooting.md)
- **GitHub Issues**: [Report Problems](https://github.com/hop-top/xray/issues)

---

## Troubleshooting

### "Command not found: xray"

```bash
# Make sure npm's global bin is in your PATH
npm prefix -g   # binaries live in <prefix>/bin

# If not in PATH, add it:
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Or just use npx instead
npx @hop-top/xray map
```

### Installation fails with C++ errors

```bash
# Set C++ version explicitly
CXXFLAGS="-std=c++20" npm install

# On macOS, ensure Xcode tools installed
xcode-select --install

# On Linux, ensure build tools installed
sudo apt-get install build-essential
```

### Output file not created

```bash
# Check current directory
pwd

# Verify you're in a project directory
ls -la

# Try specifying output explicitly
xray map --no-chunk --output ./my-map.txt
cat my-map.txt
```

### Results seem stale

```bash
# Clear the cache
xray clear-cache --confirm=yes

# Regenerate
xray map
```

---

## Key Concepts in 3 Minutes

**xray map**: Your main command. Shows you what's in your codebase.

**Chunked output**: Large projects split into multiple files (one per directory level). Navigate like a book.

**PageRank**: Algorithm showing important files first. Not alphabetical, not random—truly important.

**Anchor**: Focus the analysis on one file. Shows what matters relative to that file.

**Strategies**: Pre-built analyzers. Ask framework-specific questions (React components, Express routes, etc).

**Configuration**: Set once in `.xrayrc.json`, use everywhere. No need to type long flag combinations.

---

## Common First Questions

**Q: How big are the output files?**
A: 2K-16K tokens typical. Configured by `--limit` flag. Perfect for AI context windows.

**Q: Will it work with my language?**
A: Probably! Supports 17 languages. See [Supported Languages](../../README.md#supported-languages).

**Q: Can I use this in CI/CD?**
A: Yes! GitHub Actions and pre-commit hooks included. See [Automation](automation.md).

**Q: How fast is it?**
A: First run: 10-30 sec. Cached runs: 1-5 sec. See [Best Practices](best-practices.md).

**Q: What's the difference between `xray map` and `xray explore`?**
A: `map` = structure overview. `explore` = framework-specific (React components, routes, etc). Both useful!

---

## You're Ready!

You now know enough to use xray effectively. The rest is exploring and adapting to your workflow.

**Quick command reference**:

```bash
xray map                              # Basic overview
xray map --anchor src/api --with incs # Focused with dependencies
xray map --path ./src --depth 2       # Shallow, quick overview
xray strategy detect                  # What frameworks here?
xray react components                 # List React components
xray express routes                   # List API routes
xray clear-cache --confirm=yes                      # Fix stale results
```

That's 90% of what you need daily.

**Next**: Pick a guide from the [User Manual Hub](README.md) based on your goal.
