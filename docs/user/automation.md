# Xray Automation Guide

This guide covers automated xray map regeneration using GitHub Actions and pre-commit hooks.

## Overview

Keep your xray code maps automatically synchronized with your codebase changes using:

- **GitHub Action**: Auto-regenerates maps on pull requests
- **Pre-commit Hook**: Auto-regenerates maps before local commits
- **Configuration Files**: Define your xray settings once, use everywhere

## Quick Start

### 1. Configuration File

Create `.xrayrc.json` in your repository root:

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "limit": 8000,
  "features": {
    "vars": true,
    "incs": true
  },
  "match": ["*.ts", "*.tsx", "!*.test.ts"]
}
```

See the [Configuration](#configuration-reference) section for all options.

### 2. GitHub Action (CI/CD)

Create `.github/workflows/xray-regenerate.yml`:

```yaml
name: Regenerate Xray Maps

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - '**.ts'
      - '**.js'
      - '**.py'

jobs:
  regenerate-xray:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}

      - uses: hop-top/xray@xray/v0.1.0-rc.0
```

### 3. Pre-commit Hook (Local Development)

```bash
cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Configuration Reference

### File Locations

xray searches for configuration files in this order:

1. `.xrayrc` (JSON)
2. `.xrayrc.json`
3. `xray.config.json`
4. `package.json` (under `"xray"` field)

You can also specify `--config <path>` to use a custom location.

### Configuration Schema

```typescript
{
  // Paths to analyze (default: current directory)
  "paths": ["./src", "./lib"],

  // Output file path
  "output": "docs/codebase-map.txt",

  // Token limit for output
  "limit": 8000,

  // Features to enable
  "features": {
    "vars": true,    // Include variables
    "incs": true,    // Include imports
    "docs": false,   // Include docstrings
    "cost": false,   // Estimate cost (requires OPENAI_API_KEY)
    "cf": false,     // Control flow graph
    "df": false      // Data flow graph
  },

  // Focus file for Personalized PageRank
  "anchor": "src/main.ts",

  // Maximum depth of tree to render
  "depth": 5,

  // File patterns (glob; ! excludes), same as --match
  "match": ["*.ts", "*.tsx", "!*.test.ts"],

  // Function/class name patterns
  "catch": ["*Controller", "*Service"],

  // Output format: "txt", "csv", "xml"
  "format": "txt",

  // Custom Tree-sitter query paths
  "queries": ["./custom-queries"],

  // Output raw JSON graph
  "json": false,

  // Named lenses — config-file option overlays
  "lenses": {
    "quick": {
      "output": "docs/quick-map.txt",
      "limit": 4000,
      "depth": 3
    },
    "detailed": {
      "output": "docs/detailed-map.txt",
      "limit": 16000,
      "features": {
        "vars": true,
        "incs": true,
        "docs": true,
        "cf": true,
        "df": true
      }
    }
  }
}
```

### Using Lenses

Define multiple configurations for different scenarios:

```bash
# Apply the "quick" lens
xray map --lens quick

# Apply the "detailed" lens
xray map --lens detailed
```

### CLI Override

Command-line flags always override configuration:

```bash
# Config says output: "docs/map.txt"
# This overrides to stdout:
xray map

# Config says limit: 8000
# This overrides to 4000:
xray map -l 4000
```

## GitHub Action Details

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `config-path` | Custom config file path | Auto-detect |
| `xray-version` | xray version to install: `latest` or an exact version such as `1.2.3` or `1.2.3-rc.0`; ranges and dist-tags are rejected | `latest` |
| `commit-message` | Custom commit message | `chore: regenerate xray maps` |
| `skip-if-no-changes` | When regeneration changes nothing: `true` succeeds without committing, `false` fails the step. Changed maps are always committed. | `true` |
| `scope` | Run one scope from the config file (`xray map --scope <name>`); takes precedence over `all-scopes` | (none) |
| `all-scopes` | Run every scope defined in the config file (`xray map --all-scopes`) | `true` |

### What the action commits

The action commits only the files `xray map` created or changed during its
run. It records the working tree before and after `xray map` and stages the
difference, so this holds for any `output` path, per-scope output or default
format. Files already modified or untracked before the run (build output, a
leftover `.env`) and anything already staged are left out of the commit. The
push uses the credentials of the preceding `actions/checkout` step; the action
takes no token of its own.

### Advanced Examples

#### Custom Config Path

```yaml
- uses: hop-top/xray@xray/v0.1.0-rc.0
  with:
    config-path: './config/xray.json'
```

#### Custom Commit Message

```yaml
- uses: hop-top/xray@xray/v0.1.0-rc.0
  with:
    commit-message: |
      docs: update xray visualizations

      Auto-generated from latest code changes
```

#### Multiple Lenses

Run different configurations in parallel:

```yaml
jobs:
  regenerate-xray:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        lens: [quick, detailed, api]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g @hop-top/xray
      - run: xray map --lens ${{ matrix.lens }}
      - run: |
          git config --local user.email "actions@github.com"
          git config --local user.name "GitHub Actions"
          git add 'docs/*-map*'
          git commit -m "docs: update ${{ matrix.lens }} xray map" || exit 0
          git push
```

#### Trigger on Push to Main

```yaml
on:
  push:
    branches:
      - main
    paths:
      - 'src/**'
      - '.xrayrc*'
```

## Pre-commit Hook Details

### Installation Methods

#### Method 1: Direct Copy (Recommended)

```bash
cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

#### Method 2: Manual Creation

Create `.git/hooks/pre-commit`:

```bash
#!/bin/sh
# Check if xray config exists
if [ ! -f ".xrayrc" ] && [ ! -f ".xrayrc.json" ]; then
  exit 0
fi

# Check if xray is installed
if ! command -v xray > /dev/null 2>&1; then
  echo "⚠️  Xray not installed. Run: npm install -g @hop-top/xray"
  exit 0
fi

# Get staged source files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | \
  grep -E '\.(ts|tsx|js|jsx|py|java|go|rs)$' || true)

# Skip if no source files
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "🔍 Regenerating xray maps..."
xray map

# Stage only the map files (match your config's "output")
git add -- 'docs/codebase-map*'
echo "✓ Xray maps updated and staged"

exit 0
```

Then: `chmod +x .git/hooks/pre-commit`

This simple form maps your working tree and stages only the files matching the
pattern, never your other changes. Method 1 (the shipped hook) maps exactly
what is staged and leaves the working tree untouched; prefer it.

#### Method 3: Using Husky

```bash
npm install -D husky
npx husky init
echo "xray map && git add -- 'docs/codebase-map*'" > .husky/pre-commit
```

#### Method 4: Using pre-commit Framework

Add to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: xray-regenerate
        name: Regenerate xray maps
        entry: bash -c "xray map && git add -- 'docs/codebase-map*'"
        language: system
        pass_filenames: false
        files: \.(ts|tsx|js|jsx|py|java|go|rs)$
```

### Behavior

The pre-commit hook:

1. Checks that an xray config is tracked or staged (skips, with a notice, if not)
2. Checks if xray is installed (warns and exits if not)
3. Checks for staged source files (exits if none)
4. Exports the index (the staged content) to a scratch directory under `.git/xray-precommit/`
5. Runs `xray map` there using your config
6. Copies back and stages only the files `xray` changed; nothing else is staged
7. Allows commit to proceed

Your working tree is not stashed or modified apart from those files. A killed
hook leaves nothing of yours behind; the scratch directory is emptied on the
next run. If a generated file has unstaged edits that differ from the new map,
the hook stops the commit and lists it: stage or discard those edits and commit
again. If `xray map` fails, the commit is aborted.

### Skipping the Hook

To skip the hook for a single commit:

```bash
git commit --no-verify -m "commit message"
```

## Example Configurations

### Basic Configuration

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "features": {
    "incs": true
  }
}
```

### Multi-Path Configuration

```json
{
  "paths": ["./src", "./lib", "./packages"],
  "output": "docs/full-map.txt",
  "limit": 16000,
  "features": {
    "vars": true,
    "incs": true
  }
}
```

### Scoped Configuration (Multiple Outputs)

**Best for automation** - define multiple independent xray outputs:

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
      "catch": ["*Controller", "*Service", "*Handler"]
    },
    "frontend": {
      "paths": ["./src/components"],
      "output": "docs/frontend-map.txt",
      "match": ["*.tsx", "*.jsx"],
      "catch": ["*Component", "*Page"]
    },
    "detailed": {
      "output": "docs/detailed-analysis.txt",
      "limit": 16000,
      "features": {
        "vars": true,
        "incs": true,
        "docs": true,
        "cf": true,
        "df": true
      }
    }
  }
}
```

**Usage:**

```bash
# Run a specific scope
xray map --scope api

# Run all scopes (default for automation)
xray map --all-scopes
```

### Language-Specific Configuration

```json
{
  "paths": ["./src"],
  "output": "docs/typescript-map.txt",
  "match": [
    "*.ts",
    "*.tsx",
    "!*.test.ts",
    "!*.spec.ts",
    "!*.d.ts"
  ],
  "features": {
    "vars": true,
    "incs": true
  }
}
```

## Troubleshooting

### GitHub Action Issues

**"No config file found"**
- Ensure `.xrayrc.json` or similar exists in repository root
- Check file is committed and pushed

**"Changes not being committed"**
- Verify workflow has `contents: write` permission
- Check `ref: ${{ github.head_ref }}` is set in checkout step

**"Action runs but maps don't update"**
- Run `xray map` locally to verify config
- Check action logs for error messages
- Verify output path is correct

### Pre-commit Hook Issues

**"Xray not installed"**
- Install globally: `npm install -g @hop-top/xray`
- Or use npx: modify hook to use `npx @hop-top/xray map`

**"Hook not running"**
- Check file exists: `ls -la .git/hooks/pre-commit`
- Check executable: `chmod +x .git/hooks/pre-commit`
- Verify the config file is tracked (or staged): the hook reads config from the index

**"Maps not being staged"**
- The hook stages only the files `xray` changed (outputs that git ignores are skipped)
- Check output path in config is correct
- Verify xray map command succeeds

## Best Practices

1. **Start with defaults**: Begin with a simple config, add features as needed
2. **Use lenses**: Define multiple views (quick, detailed, api-focused)
3. **Commit maps**: Check generated maps into version control
4. **Test locally**: Run `xray map` before pushing to verify config
5. **Use both hooks**: GitHub Action for CI, pre-commit for local development
6. **Ignore sensitive files**: Use `.match` patterns to exclude config/secrets
7. **Set appropriate limits**: Balance detail vs. token usage (4000-16000 range)
8. **Pin your action**: Use an exact tag such as `@xray/v0.1.0-rc.0` instead of `@main`; bump it by hand

## See Also

- [Configuration Guide](configuration.md) - Config file options
- [Getting Started](getting-started.md) - Installation and setup
- [Commands Reference](commands.md) - All available commands
- [Harness Integration](harness-integration.md) - Agent-session hooks; a pre-commit hook can refresh their `.xray/graph.json` with `hooks/harness/lib/save-graph.sh`

---

For questions or issues, please visit: https://github.com/hop-top/xray/issues
