# Command Aliases

Create shortcuts for frequently-used strategy commands.

## Quick Start

```bash
# Set an alias
xray alias set comp "react components"

# Use the alias
xray comp
```

## Managing Aliases

### List Aliases

```bash
xray alias list
```

**Example output:**
```
Configured Aliases:

  comp → react components
  routes → express routes

Total: 2 alias(es)
```

### Create Alias

```bash
xray alias set <name> "<strategy> <command>"

# Examples
xray alias set comp "react components"
xray alias set routes "express routes"
xray alias set api "rest-api endpoints"
```

**Note:** Target must include both strategy name and command name separated by a space.

### Remove Alias

```bash
xray alias remove <name>

# Example
xray alias remove comp
```

## Configuration File

Aliases are stored in `.xrayrc.json`:

```json
{
  "aliases": {
    "comp": "react components",
    "hooks": "react hooks",
    "routes": "express routes"
  }
}
```

You can edit this file directly or use the `xray alias` commands.

## Use Cases

### Personal Shortcuts

Developer frequently uses React strategy commands:

```json
{
  "aliases": {
    "c": "react components",
    "h": "react hooks",
    "ctx": "react contexts"
  }
}
```

Usage:
```bash
xray c           # → xray react components
xray h           # → xray react hooks
xray ctx         # → xray react contexts
```

### Team Conventions

Team agrees on standard shortcuts:

```json
{
  "aliases": {
    "comp": "react components",
    "routes": "express routes",
    "api": "rest-api endpoints",
    "cmds": "go-cli commands"
  }
}
```

Commit `.xrayrc.json` to share aliases with the team.

### Framework-Agnostic Aliases

Project uses Vue, but developer wants generic names:

```json
{
  "aliases": {
    "components": "vue components",
    "routes": "vue-router routes"
  }
}
```

## Restrictions

### Built-in Command Conflicts

Aliases cannot override built-in commands:

```bash
xray alias set map "react components"
# Error: Cannot create alias "map" - conflicts with built-in command
```

**Built-in commands:**
- `map`, `scan`, `graph`, `find`, `detect`
- `strategies`, `strategy`, `alias`, `lang`, `config`
- `save`, `load`, `snapshot`, `plugin`
- `clear-cache`, `completion`, `help`, `version`

### Invalid Formats

Target must include both strategy and command:

```bash
xray alias set bad "invalidformat"
# Error: Target must be in format "<strategy> <command>"
```

### Circular References

Aliases cannot reference other aliases:

```json
{
  "aliases": {
    "a": "b commands",
    "b": "a commands"
  }
}
```

This will be detected on startup and the aliases will be skipped with a warning.

## Best Practices

1. **Use short, memorable names** - `comp` instead of `components`
2. **Avoid conflicts** - Check built-in commands before creating aliases
3. **Document team aliases** - Add examples to your project's README
4. **Commit config** - Share `.xrayrc.json` with your team
5. **Restart after changes** - Aliases are loaded at startup

## Troubleshooting

### Alias not working

Restart xray after creating or modifying aliases:

```bash
# After running alias set/remove
xray alias set comp "react components"

# Restart is needed - aliases loaded at startup
xray comp
```

### Alias targets unknown strategy

```bash
xray alias set bad "unknown-strategy commands"
# Warning during startup: Alias "bad" targets unknown strategy "unknown-strategy"
```

Run `xray strategy list` to see available strategies.

### Configuration not found

If you see "No configuration file found":

```bash
# Create a basic .xrayrc.json
echo '{"paths": ["./src"]}' > .xrayrc.json

# Then add aliases
xray alias set comp "react components"
```

## Related Documentation

- [Strategies Guide](strategies.md) - Available strategies and commands
- [Configuration](configuration.md) - Full `.xrayrc.json` reference
- [Commands Reference](commands.md) - All xray commands
