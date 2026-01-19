# Configuration Guide

Learn how to configure xray for your project using configuration files, presets, and scopes.

## Why Use Configuration?

Configuration files are especially useful for:
- **Automation**: GitHub Actions and pre-commit hooks can regenerate xray maps automatically
- **Consistency**: Team members get the same analysis without remembering CLI flags
- **Multiple Views**: Define presets for different analysis needs (quick overview, detailed analysis, etc.)

## Configuration Files

xray searches for configuration in this order:

1. `.xrayrc` (JSON)
2. `.xrayrc.json`
3. `.xrayrc.js` (CommonJS module)
4. `xray.config.json`
5. `xray.config.js` (CommonJS module)
6. `package.json` (under `"xray"` field)

You can also specify a custom config file with `--config <path>`.

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
  "diagram": "mermaid"
}
```

### JavaScript Example (xray.config.js)

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

## Configuration Options

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

## Using Presets (Legacy)

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
3. **Commit config**: Check configuration into version control
4. **Test locally**: Run `xray map` before pushing to verify config
5. **Set appropriate limits**: Balance detail vs. token usage (4000-16000 range)
6. **Ignore sensitive files**: Use `match` patterns to exclude config/secrets

## See Also

- [Automation](automation.md) - Set up automatic map regeneration
- [Commands Reference](commands.md) - All available options
- [Getting Started](getting-started.md) - Quick start guide
