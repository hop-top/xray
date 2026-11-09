# Configuration Guide

Learn how to configure xray for your project using configuration files, lenses, and scopes.

## Why Use Configuration?

Configuration files are especially useful for:
- **Automation**: GitHub Actions and pre-commit hooks can regenerate xray maps automatically
- **Consistency**: Team members get the same analysis without remembering CLI flags
- **Multiple Views**: Define lenses for different analysis needs (quick overview, detailed analysis, etc.)
- **Personal Defaults**: Set global preferences that apply to all your projects
- **Team Standards**: Share project-level configs while respecting personal preferences

## Configuration Files

xray supports both **project-level** and **global** configuration files.

### Project Configuration

xray searches for project configuration by **walking up the directory tree** from the current directory. It checks for these files in order:

1. `.xrayrc` (JSON)
2. `.xrayrc.json`
3. `xray.config.json`
4. `package.json` (under `"xray"` field)

The search stops at the first config file found or at the filesystem root.

In `package.json` only the `xray` object is config; the manifest's own
top-level fields (`name`, `paths`, `output`, ...) never are. A `package.json`
without an `xray` object is skipped by the search:

```json
{
  "name": "my-app",
  "xray": { "paths": ["./src"], "output": "xray.md" }
}
```

Config is data: xray only parses JSON and never runs a config file as code.
`--config` refuses a `.js`, `.cjs` or `.mjs` path.

### Global Configuration

You can create a global configuration that applies to all projects. xray follows the **XDG Base Directory specification** and searches these locations:

1. `<config-dir>/config.json`, where
   `<config-dir>` is `$XDG_CONFIG_HOME/xray` when `XDG_CONFIG_HOME` is set,
   else the platform default (`~/.config/xray` on Linux,
   `~/Library/Preferences/xray` on macOS, `%APPDATA%\xray` on Windows).
   `xray paths` prints the resolved `config-dir`.
2. `~/.config/xray/config.json` (legacy location; still read on macOS
   and Windows so existing configs keep working)
3. `~/.xrayrc.json` (fallback)
4. `~/.xrayrc` (fallback)

### Config Merging

When both global and project configs exist, they are **deep merged** with project config taking precedence:

- **Top-level values** (paths, output, limit): Project overrides global
- **Nested objects** (features, telemetry): Properties are merged, project values win on conflicts
- **Arrays** (match, catch): Project config completely replaces global (no merging)

**Example:**

```json
// ~/.config/xray/config.json (global)
{
  "limit": 4096,
  "features": {
    "incs": true,
    "vars": false
  },
  "telemetry": {
    "enabled": true
  }
}

// ./project/.xrayrc.json (project)
{
  "limit": 8192,
  "features": {
    "vars": true
  }
}

// Merged result when running from ./project:
{
  "limit": 8192,           // from project
  "features": {
    "incs": true,          // from global
    "vars": true           // overridden by project
  },
  "telemetry": {
    "enabled": true        // from global
  }
}
```

### Explicit Config Path

You can bypass automatic resolution and merging with `--config <path>`:

```bash
xray map --config /path/to/custom-config.json
```

When using an explicit path, **no merging occurs** - only that config file is used.

### Relative Paths

Relative `paths`, `output`, `share` (a path string) and `queries` (local
paths, `.ext:path`; URLs are left alone), at the top level and in
`lenses.<name>` / `scopes.<name>`, resolve against the directory of the
config file that defines them (like `tsconfig.json` or ESLint), not the
directory you run xray from. A project `.xrayrc.json` with
`"paths": ["./src"]` scans the project's `src/` from any subdirectory,
and `"output": "xray.md"` writes next to the config; a relative path in
the global config resolves against the global config directory; with
`--config`, against that file's directory. Absolute paths are used as-is.
Values given on the command line (`--path`, `-o/--output`, `--share <path>`,
`--query`) stay relative to the current directory.

### Paths Stay Inside the Project

A config file cannot point a run outside its own project. The project is
the directory of the file that supplies the value (for `package.json`,
that directory; with `--config`, the directory of that file), with
symlinks resolved. A value that resolves elsewhere is a usage error
(exit 2) naming the file, the key and the resolved path, and nothing
runs or is written:

```
config /repo/.xrayrc.json: output resolves to /tmp/evil.sh, outside the project /repo; pass -o/--output on the command line to use it
```

| Key (top level, `lenses.<name>`, `scopes.<name>`) | Use | Checked |
|-----|-----|---------|
| `paths` | scan roots | resolved against the config file's directory, then confined |
| `output` | file written | resolved against the config file's directory, then confined |
| `share` (a path string) | file written | same as `output` |
| `queries` (local paths, `.ext:path`; URLs are not paths) | files read | resolved against the config file's directory, then confined |
| `anchor` | node name for ranking; no file is opened | not checked |
| `aliases`, `languages`, `telemetry`, `extensions`, other keys | not paths | not checked |

Only the values a run uses are checked: the top level, the selected
`--lens` or `--scope`, every scope under `--all-scopes`. A value given on
the command line (`--path`, a positional root, `-o`/`--output`,
`--share <path>`, `--query`) is yours, never checked, and replaces the
config value. `--all-scopes` takes no `-o/--output` or `--path` (see
below), so it checks every scope's values.

Your own global config (`<config-dir>/config.json`, `~/.xrayrc.json`,
`~/.xrayrc`) is exempt: it is your choice, and its paths may point
anywhere.

## Basic Configuration

### JSON Example (.xrayrc.json)

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
  "aliases": {
    "comp": "react components",
    "routes": "express routes"
  }
}
```

### Lenses Example (.xrayrc.json)

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "limit": 8000,
  "features": {
    "vars": true,
    "incs": true
  },
  "lenses": {
    "quick": {
      "limit": 4000,
      "depth": 3
    },
    "detailed": {
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

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `paths` | `string[]` | Default paths to analyze (relative to the config file's directory) |
| `output` | `string` | Default output file path (relative to the config file's directory) |
| `limit` | `number` | Token limit for output |
| `features` | `object` | Features to enable: `vars`, `incs`, `docs`, `cost`, `cf`, `df` |
| `anchor` | `string` | Focus file for Personalized PageRank |
| `depth` | `number` | Maximum depth of tree to render |
| `match` | `string[]` | File patterns for `map` and `graph`, the same as `--match` (`!` excludes; `--match` replaces the list) |
| `catch` | `string[]` | Function/class name patterns |
| `format` | `'txt' \| 'csv' \| 'xml'` | Output format |
| `queries` | `string[]` | Custom Tree-sitter query paths/URLs |
| `json` | `boolean` | Output raw JSON graph |
| `aliases` | `object` | Command aliases - shortcuts for strategy commands |
| `scopes` | `object` | Named scoped xray configurations (multiple independent outputs) |
| `lenses` | `object` | Named lenses — config-file option overlays selected via `--lens <name>` |

## Global Configuration Use Cases

Global configuration is useful for personal preferences that should apply across all projects:

### Personal Token Limits

```json
// ~/.config/xray/config.json (recommended)
// or ~/.xrayrc.json (legacy)
{
  "limit": 8000
}
```

### Default Features

```json
// ~/.config/xray/config.json
{
  "features": {
    "incs": true,
    "vars": true
  }
}
```

### Telemetry Preferences

```json
// ~/.config/xray/config.json
{
  "telemetry": {
    "enabled": false
  }
}
```

### Personal Aliases

```json
// ~/.config/xray/config.json
{
  "aliases": {
    "comp": "react components",
    "hooks": "react hooks"
  }
}
```

**Benefits:**
- Set once, applies to all projects
- Project configs can still override when needed
- Keep personal preferences out of team repositories

## Using Command Aliases

**Aliases** let you create shortcuts for frequently-used strategy commands.

### Example Configuration

```json
{
  "paths": ["./src"],
  "aliases": {
    "comp": "react components",
    "hooks": "react hooks",
    "routes": "express routes",
    "api": "rest-api endpoints"
  }
}
```

### Using Aliases

```bash
# Instead of typing the full command
xray react components

# Use your alias
xray comp
```

**Benefits:**
- **Save typing** - `xray comp` instead of `xray react components`
- **Team consistency** - Share aliases via `.xrayrc.json`
- **Framework-agnostic** - Name aliases however makes sense for your team

**Restrictions:**
- Cannot override built-in commands (map, graph, etc.)
- Must include both strategy and command name
- Requires restart after creating/modifying

See [Command Aliases Guide](aliases.md) for complete documentation.

## Using Scoped Configurations

**Scopes** allow you to define multiple independent xray configurations that generate different outputs. This is perfect for:
- Generating different views of your codebase (overview, API, frontend, etc.)
- Creating focused maps for different teams or purposes
- Running multiple analyses in a single command

### Example Configuration with Scopes

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

### Using Scopes

```bash
# Run a specific scope
xray map --scope api

# Run all scopes
xray map --all-scopes

# Scopes inherit base config but can override any setting
```

## Using Lenses

Lenses are named config-file overlays — a curated set of CLI option
defaults you can recall with one flag. Think of them as different
angles on the same project.

```json
{
  "paths": ["./src"],
  "limit": 8000,
  "lenses": {
    "quick": {
      "output": "docs/quick-map.txt",
      "limit": 4000,
      "depth": 3
    }
  }
}
```

Apply a lens with the `--lens` flag:

```bash
xray map --lens quick
```

An unknown lens name (or `--lens` with no config file) is a usage error:
exit 2, naming the config file consulted and the lenses it defines.
`--lens` cannot be combined with `--scope` or `--all-scopes` (a scope
replaces the base config the lens would overlay): usage error, exit 2.
`--all-scopes` cannot be combined with `-o/--output` or `--path` either:
each scope writes its own `output` from its own `paths`, so one value for
all of them is a usage error (exit 2; a JSON error object on stderr with
`--format json`).

**Scopes vs Lenses:**
- **Scopes**: Multiple independent outputs, can run all at once with `--all-scopes`
- **Lenses**: Single output, used as a quick CLI shortcut to preset flag combinations

**Lens vs `--preset`:** `--lens` loads option defaults from your config
file. `--preset` loads runtime plugin bundles — see
[Plugin presets](presets.md). The two are orthogonal and can be
combined on the same command.

## CLI Precedence

Command-line flags always override configuration file settings:

```bash
# Config specifies output: "docs/map.txt"
# This command overrides it:
xray map --output custom-output.txt
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

### Complete Multi-Scope Configuration

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

## Best Practices

1. **Start with defaults**: Begin with a simple config, add features as needed
2. **Use scopes**: Define multiple views (quick, detailed, api-focused)
3. **Commit config**: Check project configuration into version control
4. **Test locally**: Run `xray map` before pushing to verify config
5. **Set appropriate limits**: Balance detail vs. token usage (4000-16000 range)
6. **Ignore sensitive files**: Use `match` patterns to exclude config/secrets
7. **Global vs. Project**:
   - **Global**: Personal preferences (token limits, telemetry, personal aliases)
   - **Project**: Team standards (paths, output locations, scopes, team aliases)
8. **Config walking**: Place config at repository root to work from any subdirectory

## See Also

- [Automation](automation.md) - Set up automatic map regeneration
- [Commands Reference](commands.md) - All available options
- [Getting Started](getting-started.md) - Quick start guide
