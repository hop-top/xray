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
| `-v, --verbose <level>` | Set verbosity: silent, error, warn, info, debug | `-v debug` |
| `-h, --help` | Display help | `--help` |
| `-V, --version` | Display version | `--version` |

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
- Core commands
- All registered strategy commands
- Global options

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
- Description
- Options
- Examples

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
4. NPM packages with `xray-strategy-` prefix
5. Built-in strategies

### Adding New Strategies

New strategies auto-register without code changes:

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

# Immediately available
xray custom analyze
```

## Shell Completion

Completion scripts include dynamic strategy commands:

```bash
# Generate for your shell
eval "$(xray completion bash)"   # Bash
eval "$(xray completion zsh)"    # Zsh
xray completion fish > ~/.config/fish/completions/xray.fish  # Fish
```

After installing new strategies:
- No need to regenerate completion manually
- Completion script loads strategies dynamically
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
npm install -g xray
# or
npm link  # if installed from source
```

### Strategy Not Available

**Problem:** `error: unknown command 'mystrategy'`

**Solutions:**
1. Check available strategies: `xray strategy list`
2. Install missing strategy: `npm install xray-strategy-mystrategy`
3. Verify strategy detection: `xray strategy detect`

### Completion Not Working

**Problem:** Tab completion doesn't show strategy commands

**Solutions:**
1. Regenerate completion: `eval "$(xray completion bash)"`
2. Check strategies loaded: `xray strategy list`
3. Verify shell syntax (bash/zsh/fish)

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
