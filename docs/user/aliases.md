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
# ✖ Cannot create alias "map" - conflicts with an existing command; choose another name
```

Reserved names are derived from the commands xray registers (core
commands such as `map`, `cache`, `paths`, `describe`, `mcp`, `alias`,
`completion`, hidden ones such as `clear-cache`, strategy commands, and
`help`). Run `xray --help` to see them. `alias set` rejects a reserved
name with a conflict error (exit 4). A reserved name already in a config is
skipped with a warning at startup.

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
5. **Run again after changes** - Aliases are loaded at startup, so a new alias works from the next xray run

## Troubleshooting

### Alias not working

Aliases are loaded when xray starts; a new or changed alias works from the next run, not the current one:

```bash
# After running alias set/remove
xray alias set comp "react components"

# Works on the next run
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
