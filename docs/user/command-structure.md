# Command Structure

xray uses a **space-separated command structure** with dynamic strategy registration.

## Command Hierarchy

```
xray [options] <command> [subcommand] [options]
```

### Core Commands

Built-in commands available in all installations:

| Command | Description |
|---------|-------------|
| `map` | Generate visual map of codebase |
| `scan` | Scan and discover files |
| `graph` | Generate CFG and DFG graphs |
| `query` | Query call graph |
| `strategy` | Manage strategies |
| `alias` | Manage command aliases |
| `explore` | Find files and search code (default) |
| `clear-cache` | Clear SQLite cache |
| `completion` | Generate shell completion |

### Strategy Commands

Dynamically loaded based on available strategies:

```
xray <strategy> <command> [options]
```

**Examples:**
```bash
xray react components
xray express routes
xray rest-api endpoints
```

**Discovery:**
```bash
# List all available strategies
xray strategy list

# Detect applicable strategies for current project
xray strategy detect

# Get help for a strategy
xray react --help

# Get help for a specific command
xray react components --help
```

## Command Syntax Change

**Previous (Alpha v0.0.1):**
```bash
xray react:components  # Colon syntax (deprecated)
```

**Current (Alpha v0.0.1+):**
```bash
xray react components  # Space-separated syntax
```

The colon syntax has been **removed** in favor of space-separated syntax, which:
- Feels more natural (like `docker compose` or `git remote`)
- Works natively with Commander.js subcommands
- Enables proper help text and completion
- Allows better command discovery

## Global Options

Available for all commands:

| Option | Description | Example |
|--------|-------------|---------|
| `-V, --verbose` | Increase verbosity (stackable; any count = debug) | `-V` |
| `--log-level <level>` | Set log level: silent, error, warn, info (default), debug; overrides `-V` | `--log-level warn` |
| `--quiet` | Errors only; beats `-V` and `--log-level` | `--quiet` |
| `--no-color` | Disable ANSI colour | `--no-color` |
| `--no-hints` | Suppress next-step hints | `--no-hints` |
| `--offline` | Disable network access | `--offline` |
| `--config <path>` | Path to config file | `--config .xrayrc.json` |
| `--no-telemetry` | Disable telemetry for this session | `--no-telemetry` |
| `-C, --chdir <path>` | Change to `<path>` before running | `-C ../repo` |
| `-h, --help` | Display help | `--help` |
| `--help-<group>` | Show one command group (`analyze`, `strategy`, `management`) | `--help-strategy` |
| `-v, --version` | Print version (`xray vX.Y.Z`) and exit | `-v` |

Flags work before or after the subcommand. Root `--help` lists commands
under ANALYZE, STRATEGY and MANAGEMENT.

## Strategy Command Options

Common options for strategy commands:

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --path <path>` | Project path to analyze | Current directory |

## Command Discovery

### List All Commands

```bash
xray --help
```

Output includes:
- Commands grouped as ANALYZE, STRATEGY (incl. registered strategy
  commands) and MANAGEMENT
- Global flags

### Strategy-Specific Commands

```bash
xray <strategy> --help
```

Shows all subcommands for that strategy.

### Command-Specific Help

```bash
xray <strategy> <command> --help
```

Shows detailed help including:
- Usage
- Description
- Flags

## Dynamic Registration

Strategy commands are **discovered at runtime**:

1. xray scans strategy directories
2. Loads strategy definitions
3. Registers commands automatically
4. Caches for performance

**Strategy Locations (in priority order):**
1. `XRAY_STRATEGIES_PATH` environment variable
2. `.xray/strategies/` in current project
3. `$XDG_DATA_HOME/xray/strategies/` (or platform equivalent)
4. NPM packages with `xray-strategy-` prefix in the project's `node_modules`
5. Built-in strategies

**Project code is opt-in.** A strategy is a program: loading one runs it.
From the current project (locations 2 and 4), xray loads only declarative
YAML strategies by default. `.js` and `.ts` strategies and
`xray-strategy-*` packages in the project are listed but not run, on every
command, including `--version` and `--help`. To load them, set
`XRAY_ALLOW_PROJECT_STRATEGIES=1` in your own environment, only for a repo
you trust. Repo files (`.xrayrc.json`, `package.json`, `.env`) cannot set
it. xray warns with the path of each project file it then loads. Built-in
strategies and the user-level locations (1 and 3) need no opt-in.

When the project has code strategies that did not load, `xray strategy
list`, `detect`, `info`, `validate`, `path`, and a command word that
matches no command say so and name the variable; other commands mention it
only with `--log-level debug`.

### Adding New Strategies

New strategies register without changes to xray. A declarative YAML
strategy loads with no opt-in:

```bash
xray strategy create my-rules --yaml   # writes .xray/strategies/my-rules.yml
```

A code strategy (`.ts`, `.js`, an npm package) also needs
`XRAY_ALLOW_PROJECT_STRATEGIES=1`:

```bash
# Install via NPM
npm install xray-strategy-custom

# Or create locally
mkdir -p .xray/strategies
cat > .xray/strategies/custom.ts << EOF
export default class CustomStrategy {
  name = 'custom';
  version = '1.0.0';

  commands = {
    analyze: {
      description: 'Run custom analysis',
      handler: async (ctx) => {
        // Your logic here
        return [];
      }
    }
  };

  async detect(ctx) {
    return ctx.hasFiles('custom.config.js');
  }

  async analyze(file, ctx) {
    return { tags: [] };
  }
}
EOF

# Available once you opt in
XRAY_ALLOW_PROJECT_STRATEGIES=1 xray custom analyze
```

## Shell Completion

Completion scripts ask xray for candidates on each tab
(`xray __complete ...`), so dynamic strategy commands and aliases are
always current:

```bash
# Generate for your shell
eval "$(xray completion bash)"   # Bash (needs bash-completion v2)
eval "$(xray completion zsh)"    # Zsh
xray completion fish > ~/.config/fish/completions/xray.fish  # Fish
xray completion powershell | Out-String | Invoke-Expression  # PowerShell
```

After installing new strategies:
- No need to regenerate completion
- New commands appear immediately

## Best Practices

### Discovery First

Before running commands, discover what's available:

```bash
# See all commands
xray --help

# See strategy-specific commands
xray react --help

# Detect applicable strategies
xray strategy detect
```

### Use Explicit Paths

For scripts and automation:

```bash
xray react components --path ./my-project
```

Not:
```bash
cd my-project && xray react components
```

### Check Strategy Availability

In CI/CD or scripts:

```bash
if xray strategy list | grep -q "react"; then
  xray react components
else
  echo "React strategy not available"
fi
```

## Troubleshooting

### Command Not Found

**Problem:** `xray: command not found`

**Solution:**
```bash
npm install -g @hop-top/xray
# or
npm link  # if installed from source
```

### Strategy Not Available

**Problem:** `error: unknown command 'mystrategy'`

**Solutions:**
1. Check available strategies: `xray strategy list` (it names project
   code strategies that were not loaded)
2. Install missing strategy: `npm install xray-strategy-mystrategy`, then
   set `XRAY_ALLOW_PROJECT_STRATEGIES=1` to load it from the project
3. Verify strategy detection: `xray strategy detect`

### Completion Not Working

**Problem:** Tab completion doesn't show strategy commands

**Solutions:**
1. Check what xray offers: `xray __complete ""` (one candidate per line)
2. Check strategies loaded: `xray strategy list`
3. Bash: install bash-completion v2; scripts generated by xray before
   the switch to `__complete` must be regenerated once

### Old Colon Syntax

**Problem:** `xray react:components` no longer works

**Solution:** Use space-separated syntax:
```bash
xray react components
```

## Related Documentation

- [Strategy Development](../dev/strategy-development.md) - Creating custom strategies
- [Strategy API Reference](../dev/strategy-api.md) - Command handler API
- [Configuration](configuration.md) - Config files and environment variables
