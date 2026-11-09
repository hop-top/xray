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
| `graph` | Generate CFG and DFG graphs |
| `query` | Query call graph |
| `strategy` | Manage strategies |
| `alias` | Manage command aliases |
| `explore` | Find files and search code (default) |
| `clear-cache` | Clear SQLite cache |
| `completion` | Generate shell completion |

`explore` is the default: bare `xray` (alone or with explore's own options,
such as `xray --stats`) runs it. Anything else must start with a command,
an alias or an existing path. A word that is none of these (`xray upgrade`,
`xray zzzqqq`) is a usage error (exit 2, with a did-you-mean suggestion when
one is close), not a file listing. Options other than the root's
(`--log-level`, `--config`, `--no-telemetry`, `-C`, `--quiet`, ...) go
after the command: `xray alias list --format json`, not
`xray --format json alias list` (exit 2).

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
| `--help-all` | Print every command with its flags (text) | `--help-all` |
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
4. NPM packages named `xray-strategy-*` or `@scope/xray-strategy-*` in the project's `node_modules`
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

A strategy name is lowercase letters, digits and hyphens, starting with a
letter or digit (`^[a-z0-9][a-z0-9-]*$`), at most 64 characters. Anything
else, including `/`, `..` and uppercase, is a usage error (exit 2); the
name is never rewritten. The default `.xray/strategies` directory must
resolve inside the project, so a symlinked `.xray` that leaves it is
refused.

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

### Installing a Strategy Package

`xray strategy install <source>` runs `npm install` in the current
directory and checks the result:

```bash
xray strategy install xray-strategy-custom          # registry name
xray strategy install xray-strategy-custom@1.2.0    # name@version
xray strategy install @acme/xray-strategy-custom    # scoped name
xray strategy install ./xray-strategy-custom-1.2.0.tgz   # tarball
xray strategy install ./path/to/package             # local directory
```

A path source starts with `/`, `./` or `../`. The source is passed to npm
as one argument (no shell), so it is never interpreted as a command or an
npm option. npm runs the package's install scripts, as with `npm install`.

The package must declare itself in `package.json`, and its entry must be
a file inside the package:

```json
{ "name": "xray-strategy-custom", "version": "1.2.0",
  "xray-strategy": { "name": "custom", "entry": "strategy.js" } }
```

- A YAML entry loads with no opt-in; the command prints the strategy name
  and version.
- A `.js` or `.ts` entry runs code. Without `XRAY_ALLOW_PROJECT_STRATEGIES=1`
  the command checks `package.json` only, loads nothing, prints the
  name and version, and says to set the variable. With it, the entry
  loads and the command prints the loaded name and version.
- A package with no `xray-strategy` declaration, no `name`, or an entry
  that is missing or points outside the package fails with a non-zero
  exit. The package is fetched without running its scripts and checked
  in a temporary directory before `npm install` runs, so a rejected
  package changes nothing: no `node_modules`, `package.json` or lockfile
  change, and no install script runs. A valid package at a different
  version than the installed one updates it, as `npm install` does.

xray discovers packages in the project as `node_modules/xray-strategy-*`
and `node_modules/@scope/xray-strategy-*`, with the same rules for both
(a code entry needs the opt-in, a YAML entry does not). The command warns
when the installed package has another name, since xray will not find it.
The command has no `--global` option: it always installs into the current
directory.

A local `.yml`, `.yaml`, `.js` or `.ts` file is read, not installed: the
command prints its name and version and states that nothing was copied.
Put the file in `.xray/strategies/` to use it. A `.js` or `.ts` file is
read only with `XRAY_ALLOW_PROJECT_STRATEGIES=1`.

### Removing a Strategy

`xray strategy remove <name>` (alias `uninstall`) takes a package name or
a strategy name:

```bash
xray strategy remove @acme/xray-strategy-custom --confirm=yes   # package name
xray strategy remove custom --confirm=yes                       # xray-strategy.name
```

- An installed strategy package is removed with `npm uninstall` in the
  current directory (no shell). The package is identified from its
  `package.json` alone, so a code strategy is removed without
  `XRAY_ALLOW_PROJECT_STRATEGIES=1` and nothing is run.
- A package that does not declare `xray-strategy` is refused and left
  untouched, so `xray strategy remove lodash --confirm=yes` removes nothing.
- A file named `<name>.yml`, `<name>.yaml`, `<name>.js` or `<name>.ts` in
  a strategy directory is deleted. If a package has the same name, only
  the file goes; the command says the package remains.
- A name that matches neither fails with a non-zero exit (3).

Removal deletes files or uninstalls a package, so xray asks first. At a
terminal it prompts; scripts, CI and agents have no terminal and must pass
`--confirm=yes`. `--confirm=no` (or no way to ask) refuses with exit 5 and
removes nothing. `--dry-run` shows what would go and asks nothing.

## Side Effects, Confirmation and `--dry-run`

Every command declares what it does, and `xray describe` reports it per
command (`sideEffect`, `idempotent`):

| Tier | Commands |
|------|----------|
| `read` | `query`, `impact`, `imports`, `explore`, `paths`, `describe`, `upgrade --check`, `completion`, `help`, `lang list`, `alias list`, `strategy list/detect/info/validate/path`, every strategy command (`react components`, ...), aliases |
| `write-local` | `map`, `graph` (write the analysis into the project), `alias set/remove`, `lang add/remove`, `strategy create/install` |
| `destructive-local` | `strategy remove`, `cache clear` (`clear-cache`) |
| `interactive` | `mcp` |

Caches xray rebuilds on its own in its cache dir (the parse cache, the
imports cache) do not change a command's tier.

A destructive command needs confirmation: a terminal prompt, or
`--confirm=yes` (`--confirm=no` refuses). The root `--dry-run` flag, given
before or after the command, prints the plan for a write or destructive
command (files, packages, config entries it would touch) and changes
nothing; `--format json` (or `--json`) on `map` and `graph` prints
it as JSON. A read command ignores `--dry-run` and runs; `mcp` is a live
session and refuses it.

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
3. Bash: install bash-completion v2

## Related Documentation

- [Strategy Development](../dev/strategy-development.md) - Creating custom strategies
- [Strategy API Reference](../dev/strategy-api.md) - Command handler API
- [Configuration](configuration.md) - Config files and environment variables
