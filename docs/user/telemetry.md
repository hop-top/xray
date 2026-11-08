# Telemetry

Xray includes opt-in telemetry to help track command usage, performance metrics, and error patterns. This data is stored locally and never transmitted externally.

## Overview

The telemetry system uses OpenTelemetry SDK to collect:

- **Command Usage**: Which commands are run and with what options
- **Error Types**: What errors occur and their context
- **Performance Stats**: Execution time, memory usage, codebase size

All telemetry data is written, in JSONL format, to a per-project file in the xray state directory, never into the project. `xray paths` prints it (`telemetry`).

## First Run Consent

The first time you use xray interactively, it prompts you to enable telemetry. The answer is stored once, per user, in your global config (`config.json` in the config dir shown by `xray paths`); it is not asked again in other projects, and nothing is written into the project. No answer within 15 seconds, or end of input (Ctrl-D), counts as "no": telemetry is saved as off and you are not asked again. Delete the global config to be asked again.

```
Welcome to Xray!

Xray can collect anonymous usage data to help improve the tool.

What data is collected:
  • Command usage (which commands you run)
  • Performance metrics (execution time, memory usage)
  • Error types (what errors occur)
  • System info (OS, architecture, Node version)

What is NOT collected:
  • Your source code or file contents
  • File paths (except in error context)
  • Personal information
  • Network activity (data stays local)

All data is stored locally in the xray state directory (see `xray paths`)
You are asked once; no answer within 15s means no.
Change it later: set XRAY_TELEMETRY_ENABLED=true, or "telemetry" in your user config
(xray paths shows where) or per project in .xrayrc.json.

Enable telemetry? [Y/n]:
```

### When Telemetry Is Off

Telemetry only records when a person runs xray at a terminal. Any of these turns it off for the run, **whatever consent was saved** (global or project config, `XRAY_TELEMETRY_ENABLED`):

| Rule | Example |
|------|---------|
| `--no-telemetry` flag | `xray map --no-telemetry` |
| `XRAY_NO_TELEMETRY` set (any value but empty, `0`, `false`) | `XRAY_NO_TELEMETRY=1 xray map` |
| `DO_NOT_TRACK` set ([consoledonottrack.com](https://consoledonottrack.com)), same values | `DO_NOT_TRACK=1 xray map` |
| stdout is not a TTY (subprocess, pipe, redirect, hook) | `xray query x \| jq`, a tool running xray |
| machine-readable format, any command | `--format json\|yaml\|csv\|xml`, `--json`, `--csv`, `--xml` |
| command whose default output is machine-readable, unless `--format text\|table\|txt` | `xray imports`, `xray describe` |
| CI environment | `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, ... |
| `xray mcp` (MCP server) | always off |

No prompt is shown and nothing is stored on those runs, so the saved decision still applies to your next interactive run. `xray describe` publishes these rules under `telemetry` so a tool driving xray can check them:

```json
"telemetry": {
  "defaultOff": ["non-tty", "machine-format", "ci", "mcp"],
  "env": ["XRAY_NO_TELEMETRY", "DO_NOT_TRACK"],
  "flag": "--no-telemetry"
}
```

## Enabling Telemetry

Telemetry is **disabled by default** unless you consent during first run.

### Option 1: During First Run

Simply answer "Y" when prompted on first run.

### Option 2: Environment Variable

```bash
export XRAY_TELEMETRY_ENABLED=true
xray map
```

### Option 3: Configuration File

Add to your global config (`config.json` in the config dir shown by `xray paths`) for all projects, or to a project's `.xrayrc.json` to override it for that project:

```json
{
  "telemetry": {
    "enabled": true
  }
}
```

### Option 4: Per-Scope Configuration

Enable telemetry for specific scopes:

```json
{
  "scopes": {
    "production": {
      "telemetry": {
        "enabled": true
      }
    }
  }
}
```

## What's Tracked

### Command Execution

Every command invocation is tracked with:

- Command name (e.g., `map`, `explore`)
- Options used (e.g., `format: 'json'`, `chunked: true`)
- Timestamp
- Service information (name, version)
- Host information (architecture, OS)

Example:
```json
{
  "name": "command.execute",
  "timestamp": 1707512400000,
  "attributes": {
    "command.name": "map",
    "command.options.format": "json",
    "command.options.chunked": true
  },
  "resource": {
    "service.name": "xray-cli",
    "service.version": "0.0.1-alpha.1",
    "host.arch": "arm64",
    "os.type": "Darwin"
  }
}
```

### Command Duration

Command execution time is tracked using spans:

```json
{
  "name": "map",
  "timestamp": 1707512400000,
  "kind": "span",
  "spanId": "abc123def456",
  "traceId": "xyz789uvw012",
  "duration": 1234,
  "attributes": {
    "span.kind": "command"
  }
}
```

### Error Events

Errors are tracked with full context:

```json
{
  "name": "error.occurred",
  "timestamp": 1707512400000,
  "attributes": {
    "error.type": "ParserError",
    "error.message": "Failed to parse file",
    "error.stack": "Error: Failed to parse...",
    "error.context.file": "/path/to/file.ts",
    "error.context.line": 42
  }
}
```

### Performance Statistics

Various metrics are tracked:

```json
{
  "name": "stat.recorded",
  "timestamp": 1707512400000,
  "attributes": {
    "stat.name": "execution.time",
    "stat.value": 1234,
    "stat.unit": "ms",
    "stat.context.command": "map"
  }
}
```

Common stats tracked:
- `execution.time` - Total command execution time (ms)
- `memory.heap_used` - Memory used during execution (bytes)
- `codebase.files` - Number of files analyzed (count)
- `codebase.lines` - Total lines of code (count)

## Data Storage

### Location

Telemetry data is stored in the xray state directory, one file per project, keyed by the project root (two projects with the same name never share a file):
```
<state-dir>/telemetry/<project-key>/telemetry.json
```

`<state-dir>` is `$XDG_STATE_HOME/xray` when set, else the platform default. Print the exact path:
```bash
xray paths --format json | jq -r .telemetry
```

The commands below assume:
```bash
TELEMETRY_FILE="$(xray paths --format json | jq -r .telemetry)"
```

### Format

Data is stored in JSONL (JSON Lines) format:
- One event per line
- Each line is a complete JSON object
- Easy to parse and process with standard tools

### Retention

Telemetry data is **append-only**. Old data is never automatically deleted.

To clear telemetry data:
```bash
rm "$TELEMETRY_FILE"
```

## Analyzing Telemetry Data

### View All Events

```bash
cat "$TELEMETRY_FILE" | jq '.'
```

### Count Commands

```bash
cat "$TELEMETRY_FILE" | jq 'select(.name == "command.execute") | .attributes["command.name"]' | sort | uniq -c
```

### View Errors

```bash
cat "$TELEMETRY_FILE" | jq 'select(.name == "error.occurred")'
```

### Average Execution Time

```bash
cat "$TELEMETRY_FILE" | jq 'select(.kind == "span") | .duration' | awk '{sum+=$1; n++} END {print sum/n}'
```

### Memory Usage Stats

```bash
cat "$TELEMETRY_FILE" | jq 'select(.attributes["stat.name"] == "memory.heap_used") | .attributes["stat.value"]'
```

## Privacy & Security

### What's NOT Tracked

- **No Code Content**: Your source code is never included
- **No File Paths**: Only relative indicators (e.g., file count)
- **No User Identity**: No usernames, emails, or PII
- **No Network Transmission**: All data stays local

### What IS Tracked

- Command names and options
- Error types and messages (no sensitive data)
- Performance metrics (timing, memory)
- System information (OS, architecture)

### Sensitive Data

If error messages or command options contain sensitive data, they will be included. Be cautious when sharing telemetry files.

To sanitize before sharing:
```bash
# Remove error stacks (may contain file paths)
cat "$TELEMETRY_FILE" | jq 'del(.attributes["error.stack"])' > sanitized.json

# Remove all context attributes
cat "$TELEMETRY_FILE" | jq 'del(.attributes["error.context"])' > sanitized.json
```

## Disabling Telemetry

### Temporary Disable

```bash
xray map --no-telemetry
# or, for every run in this shell
export XRAY_NO_TELEMETRY=1   # or DO_NOT_TRACK=1
```

See [When Telemetry Is Off](#when-telemetry-is-off) for the runs that never record.

### Permanent Disable

Remove from config:
```json
{
  "telemetry": {
    "enabled": false
  }
}
```

Or simply omit the `telemetry` section (disabled by default).

## Use Cases

### Performance Monitoring

Track how command performance changes over time:

```bash
# Extract execution times with timestamps
cat "$TELEMETRY_FILE" | jq -r 'select(.kind == "span") | "\(.timestamp) \(.duration)"'
```

### Error Analysis

Identify common error patterns:

```bash
# Group errors by type
cat "$TELEMETRY_FILE" | jq -r 'select(.name == "error.occurred") | .attributes["error.type"]' | sort | uniq -c | sort -rn
```

### Usage Patterns

Understand which commands are used most:

```bash
# Command frequency
cat "$TELEMETRY_FILE" | jq -r 'select(.name == "command.execute") | .attributes["command.name"]' | sort | uniq -c | sort -rn
```

### Resource Usage

Monitor memory consumption:

```bash
# Peak memory usage
cat "$TELEMETRY_FILE" | jq 'select(.attributes["stat.name"] == "memory.heap_used") | .attributes["stat.value"]' | sort -n | tail -1
```

## Integration with Monitoring Tools

The JSONL format is compatible with many log analysis tools:

### Grafana Loki

```bash
# Stream telemetry to Loki
cat "$TELEMETRY_FILE" | promtail --stdin --server.url=http://localhost:3100
```

### Elasticsearch

```bash
# Bulk import to Elasticsearch
cat "$TELEMETRY_FILE" | jq -c '{index: {_index: "xray-telemetry"}} , .' | curl -X POST "localhost:9200/_bulk" -H 'Content-Type: application/x-ndjson' --data-binary @-
```

### Splunk

```bash
# Forward to Splunk
cat "$TELEMETRY_FILE" | splunk add oneshot -sourcetype _json
```

## Troubleshooting

### Telemetry Not Working

Check if enabled:
```bash
echo $XRAY_TELEMETRY_ENABLED
cat .xrayrc.json | jq '.telemetry'   # project override
xray paths   # shows the global config dir
```

Verify file is being created:
```bash
ls -la "$TELEMETRY_FILE"
```

### File Permission Errors

Ensure the state directory is writable:
```bash
xray paths | grep state-dir
```

### Large Telemetry Files

Rotate logs periodically:
```bash
# Archive old telemetry
mv "$TELEMETRY_FILE" "${TELEMETRY_FILE%.json}.$(date +%Y%m%d).json"
gzip "${TELEMETRY_FILE%.json}".*.json
```

## See Also

- [Configuration Guide](configuration.md) - Config file options
- [Commands Reference](commands.md) - Available commands
- [Troubleshooting](troubleshooting.md) - Common issues
