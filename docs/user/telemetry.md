# Telemetry

Xray includes opt-in telemetry to help track command usage, performance metrics, and error patterns. This data is stored locally and never transmitted externally.

## Overview

The telemetry system uses OpenTelemetry SDK to collect:

- **Command Usage**: Which commands are run and with what options
- **Error Types**: What errors occur and their context
- **Performance Stats**: Execution time, memory usage, codebase size

All telemetry data is written to `.xray/telemetry.json` in JSONL format.

## First Run Consent

On first run (when no `.xrayrc.json` exists), xray will prompt you to enable telemetry:

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

All data is stored locally in .xray/telemetry.json
You can change this setting anytime in .xrayrc.json

Enable telemetry? [Y/n]:
```

### Skipping the Prompt

To skip the interactive prompt, use the `--no-telemetry` flag:

```bash
xray map --no-telemetry
```

Or in non-interactive environments (CI/CD), the prompt is automatically skipped and telemetry is disabled by default.

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

Add to your `.xrayrc.json`:

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

- Command name (e.g., `generate`, `explore`)
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
    "command.name": "generate",
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
  "name": "generate",
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
    "stat.context.command": "generate"
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

Telemetry data is stored in:
```
<project-root>/.xray/telemetry.json
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
rm .xray/telemetry.json
```

## Analyzing Telemetry Data

### View All Events

```bash
cat .xray/telemetry.json | jq '.'
```

### Count Commands

```bash
cat .xray/telemetry.json | jq 'select(.name == "command.execute") | .attributes["command.name"]' | sort | uniq -c
```

### View Errors

```bash
cat .xray/telemetry.json | jq 'select(.name == "error.occurred")'
```

### Average Execution Time

```bash
cat .xray/telemetry.json | jq 'select(.kind == "span") | .duration' | awk '{sum+=$1; n++} END {print sum/n}'
```

### Memory Usage Stats

```bash
cat .xray/telemetry.json | jq 'select(.attributes["stat.name"] == "memory.heap_used") | .attributes["stat.value"]'
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
cat .xray/telemetry.json | jq 'del(.attributes["error.stack"])' > sanitized.json

# Remove all context attributes
cat .xray/telemetry.json | jq 'del(.attributes["error.context"])' > sanitized.json
```

## Disabling Telemetry

### Temporary Disable

```bash
unset XRAY_TELEMETRY_ENABLED
xray map
```

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
cat .xray/telemetry.json | jq -r 'select(.kind == "span") | "\(.timestamp) \(.duration)"'
```

### Error Analysis

Identify common error patterns:

```bash
# Group errors by type
cat .xray/telemetry.json | jq -r 'select(.name == "error.occurred") | .attributes["error.type"]' | sort | uniq -c | sort -rn
```

### Usage Patterns

Understand which commands are used most:

```bash
# Command frequency
cat .xray/telemetry.json | jq -r 'select(.name == "command.execute") | .attributes["command.name"]' | sort | uniq -c | sort -rn
```

### Resource Usage

Monitor memory consumption:

```bash
# Peak memory usage
cat .xray/telemetry.json | jq 'select(.attributes["stat.name"] == "memory.heap_used") | .attributes["stat.value"]' | sort -n | tail -1
```

## Integration with Monitoring Tools

The JSONL format is compatible with many log analysis tools:

### Grafana Loki

```bash
# Stream telemetry to Loki
cat .xray/telemetry.json | promtail --stdin --server.url=http://localhost:3100
```

### Elasticsearch

```bash
# Bulk import to Elasticsearch
cat .xray/telemetry.json | jq -c '{index: {_index: "xray-telemetry"}} , .' | curl -X POST "localhost:9200/_bulk" -H 'Content-Type: application/x-ndjson' --data-binary @-
```

### Splunk

```bash
# Forward to Splunk
cat .xray/telemetry.json | splunk add oneshot -sourcetype _json
```

## Troubleshooting

### Telemetry Not Working

Check if enabled:
```bash
echo $XRAY_TELEMETRY_ENABLED
cat .xrayrc.json | jq '.telemetry'
```

Verify file is being created:
```bash
ls -la .xray/telemetry.json
```

### File Permission Errors

Ensure `.xray` directory is writable:
```bash
chmod 755 .xray
```

### Large Telemetry Files

Rotate logs periodically:
```bash
# Archive old telemetry
mv .xray/telemetry.json .xray/telemetry.$(date +%Y%m%d).json
gzip .xray/telemetry.*.json
```

## See Also

- [Configuration Guide](configuration.md) - Config file options
- [Commands Reference](commands.md) - Available commands
- [Troubleshooting](troubleshooting.md) - Common issues
