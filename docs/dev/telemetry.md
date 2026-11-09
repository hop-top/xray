# Telemetry Implementation

## Overview

Xray includes an opt-in telemetry system, modelled on OpenTelemetry traces, to collect observability data about command usage, performance metrics, and error patterns. This document explains the implementation, design decisions, and usage patterns for developers working on xray.

## Why OpenTelemetry?

### Standards-Based Approach

OpenTelemetry is the industry standard for observability instrumentation. Using it provides:

- **Vendor Neutrality**: Not locked into any specific vendor's telemetry format
- **Ecosystem Compatibility**: Works with popular observability platforms (Grafana, Prometheus, Datadog, etc.)
- **Rich Semantics**: Standard conventions for attributes, resources, and span kinds
- **Future-Proof**: Active CNCF project with strong community support

### Distributed Tracing Support

OpenTelemetry's trace/span model enables:

- **Nested Operations**: Parent-child span relationships for complex operations
- **Context Propagation**: Trace context flows through the call stack
- **Performance Analysis**: Detailed timing breakdowns of operations

### Resource Attributes

Automatic collection of contextual information:

- Service identification (name, version)
- Host information (architecture, OS)
- Process details (PID, Node.js version)

## Implementation

### Added Files

- `src/lib/telemetry.ts` - OpenTelemetry-based telemetry tracker
- `__tests__/lib/telemetry.test.ts` - Comprehensive test suite (17 tests)
- `docs/user/telemetry.md` - User documentation

### Modified Files

- `src/commands/generate.ts` - Integrated telemetry tracking
- `src/index.ts` - Initialize telemetry on CLI startup
- `src/types/xray-config.ts` - Added telemetry configuration
- `package.json` - Added OpenTelemetry dependencies

## Dependencies

None. The original implementation used the OpenTelemetry SDK; the current
event-based `TelemetryPlugin` (`src/lib/plugins/telemetry-plugin.ts`) keeps
the OTel trace/span model (trace ids, span ids, resource attributes) but
writes JSONL itself with `fs`, so no `@opentelemetry/*` packages are
installed. Re-add them only alongside a real OTLP exporter.

## Architecture

### Core Design

```typescript
// Initialize with opt-in
const telemetry = initializeTelemetry({
  enabled: config?.telemetry?.enabled,
  projectRoot: process.cwd()
});

// Track commands
telemetry.trackCommand('generate', { format: 'json', chunked: true });

// Track spans with duration
const span = telemetry.startCommandSpan('generate');
// ... work ...
span.end();

// Track errors with context
telemetry.trackError('ParserError', error, {
  file: '/path/to/file.ts',
  line: 42
});

// Track stats
telemetry.trackStat('execution.time', 1234, { command: 'generate' });
telemetry.trackStat('memory.heap_used', process.memoryUsage().heapUsed);
telemetry.trackStat('codebase.files', 150);
```

**Features:**
- ✅ OpenTelemetry standard (spans, traces, attributes)
- ✅ Automatic resource attributes (service, host, OS)
- ✅ Nested span support (parent-child relationships)
- ✅ Error tracking with stack traces and context
- ✅ Performance metrics (execution time, memory, codebase size)
- ✅ **Opt-in by default** (privacy-first design)
- ✅ Graceful degradation (no crashes if tracking fails)
- ✅ JSONL export format (easy to parse and process)

## Opt-In Strategy

**Default: Disabled**

Telemetry must be explicitly enabled via:

1. **Environment Variable:**
   ```bash
   export XRAY_TELEMETRY_ENABLED=true
   ```

2. **Config File:**
   ```json
   {
     "telemetry": {
       "enabled": true
     }
   }
   ```

3. **Per-Scope:**
   ```json
   {
     "scopes": {
       "production": {
         "telemetry": { "enabled": true }
       }
     }
   }
   ```

## Data Collected

### 1. Command Usage

**What:** Command name, options used
**Why:** Understand which commands are popular, which options are used
**Example:**
```json
{
  "name": "command.execute",
  "attributes": {
    "command.name": "generate",
    "command.options.format": "json",
    "command.options.chunked": true
  }
}
```

### 2. Error Types

**What:** Error type, message, stack trace, context
**Why:** Identify common errors, improve error handling
**Example:**
```json
{
  "name": "error.occurred",
  "attributes": {
    "error.type": "ParserError",
    "error.message": "Failed to parse file",
    "error.stack": "...",
    "error.context.file": "/path/to/file.ts"
  }
}
```

### 3. Performance Stats

**What:** Execution time, memory usage, codebase metrics
**Why:** Monitor performance, identify bottlenecks, track usage patterns
**Example:**
```json
{
  "name": "stat.recorded",
  "attributes": {
    "stat.name": "execution.time",
    "stat.value": 1234,
    "stat.unit": "ms"
  }
}
```

### 4. Resource Attributes

**What:** Service info, host info, OS details
**Why:** Context for all events, debugging environment-specific issues
**Example:**
```json
{
  "resource": {
    "service.name": "xray-cli",
    "service.version": "0.0.1-alpha.1",
    "host.arch": "arm64",
    "os.type": "Darwin",
    "os.version": "24.6.0",
    "process.pid": 12345,
    "process.node_version": "v20.10.0"
  }
}
```

## Privacy Guarantees

### What's NOT Tracked

- ❌ Source code content
- ❌ File paths (except in error context)
- ❌ User identity (no PII)
- ❌ Network transmission (all local)

### What IS Tracked

- ✅ Command names and options
- ✅ Error types and messages
- ✅ Performance metrics
- ✅ System information

## Testing

### Test Coverage

17 comprehensive tests covering:

1. **Opt-in mechanism** (3 tests)
   - Disabled by default
   - Environment variable
   - Config file

2. **Command tracking** (2 tests)
   - Command execution logging
   - Span-based duration tracking

3. **Error tracking** (2 tests)
   - Error events
   - Stack trace capture

4. **Stats tracking** (3 tests)
   - Execution time
   - Memory usage
   - Codebase size

5. **Resource attributes** (2 tests)
   - Service information
   - Host information

6. **File export** (2 tests)
   - JSONL format
   - Directory creation

7. **Context propagation** (1 test)
   - Nested spans (parent-child)

8. **Graceful degradation** (2 tests)
   - No crashes on failures
   - Safe shutdown

### Run Tests

```bash
npm test -- __tests__/lib/telemetry.test.ts
```

All tests pass ✅

## First-Run Consent Flow

### How It Works

On first interactive use (no decision in project or global config), xray prompts the user for telemetry consent:

```typescript
// In src/index.ts
const telemetryEnabled = await handleFirstRunConsent(process.argv);
```

The consent flow:

1. **Check for --no-telemetry flag** - Skip if present
2. **Check for existing decision** - Skip if project/`--config` or the global user config has a `telemetry` setting (project wins)
3. **Check for interactive mode** - Skip in CI/CD or piped I/O
4. **Prompt user** - Show informative message and ask Y/n; no answer within 15 s, or end of input, counts as no
5. **Save decision** - Write to the global user config (`config.json` in the kit XDG config dir); never the cwd or project files. Non-interactive runs persist nothing

### Non-Interactive Detection

The consent prompt is automatically skipped in:

- **CI/CD environments** - Detects `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, etc.
- **Piped input/output** - When stdin or stdout is not a TTY
- **Explicit flag** - When `--no-telemetry` is passed

In non-interactive mode, telemetry defaults to **disabled**.

### Flag Precedence

The `--no-telemetry` flag takes precedence over all other settings:

```bash
# Disables telemetry even if config says enabled
xray map --no-telemetry
```

## Usage Guide

### For Users

**Telemetry is disabled by default** unless you consent during first run.

To enable after initial setup:
```bash
export XRAY_TELEMETRY_ENABLED=true
```

or edit the global `config.json` (or a project's `.xrayrc.json`):
```json
{
  "telemetry": {
    "enabled": true
  }
}
```

### For Developers

#### Adding Telemetry to Commands

```typescript
import { getTelemetryTracker } from '../lib/telemetry';

// Get the global tracker instance (may be null if disabled)
const telemetry = getTelemetryTracker();

// Always check if telemetry is enabled before tracking
if (telemetry) {
  // Track command execution
  telemetry.trackCommand('share_requested', {
    command: 'generate',
    chunked: true
  });
}
```

#### Tracking Command Duration

```typescript
const telemetry = getTelemetryTracker();
if (telemetry) {
  const span = telemetry.startCommandSpan('generate');

  try {
    // Do work...
  } finally {
    span.end();
  }
}
```

#### Tracking Errors

```typescript
const telemetry = getTelemetryTracker();
if (telemetry) {
  try {
    // Risky operation...
  } catch (error) {
    telemetry.trackError('ParserError', error, {
      file: filePath,
      line: lineNumber
    });
    throw error;
  }
}
```

#### Tracking Performance Stats

```typescript
const telemetry = getTelemetryTracker();
if (telemetry) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  // Do work...

  const duration = Date.now() - startTime;
  const memoryUsed = process.memoryUsage().heapUsed - startMemory;

  telemetry.trackStat('execution.time', duration, { command: 'generate' });
  telemetry.trackStat('memory.delta', memoryUsed);
  telemetry.trackStat('codebase.files', fileCount);
}
```

**Key Patterns:**

1. Always check if telemetry exists (it may be null if disabled)
2. Use non-blocking tracking (don't await or throw on errors)
3. Add context to make data more useful (command name, file path, etc.)
4. Track both success and failure paths

## Future Enhancements

### Short Term

- [ ] Add CLI command to view telemetry stats: `xray telemetry:stats`
- [ ] Add CLI command to clear telemetry: `xray telemetry:clear`
- [ ] Add telemetry rotation (max file size)

### Long Term

- [ ] Export to OpenTelemetry Collector (OTLP)
- [ ] Integration with Grafana/Prometheus
- [ ] Anomaly detection (performance regressions)
- [ ] Automatic error reporting (with user consent)

## Implementation Files

```
src/lib/telemetry.ts                      - Core telemetry implementation
src/lib/telemetry-consent.ts              - First-run consent flow
src/index.ts                               - Telemetry initialization on CLI startup
src/commands/generate.ts                   - Command-specific telemetry tracking
src/commands/common.ts                     - --no-telemetry flag
src/types/xray-config.ts                   - Telemetry configuration types
__tests__/lib/telemetry.test.ts            - Core telemetry test suite (17 tests)
__tests__/lib/telemetry-consent.test.ts    - Consent flow tests (19 tests)
docs/user/telemetry.md                     - User-facing documentation
docs/dev/telemetry.md                      - This developer documentation
.xrayrc.example.json                       - Example configuration with telemetry
```

## Testing

### Run Tests

```bash
# Core telemetry tests
npm test -- __tests__/lib/telemetry.test.ts

# Consent flow tests
npm test -- __tests__/lib/telemetry-consent.test.ts
```

**Coverage:**

**Core Telemetry** (17 tests):
- Opt-in mechanism (disabled by default, env var, config)
- Command tracking (execution logging, span-based duration)
- Error tracking (events, stack traces)
- Stats tracking (time, memory, codebase metrics)
- Resource attributes (service info, host info)
- File export (JSONL format, directory creation)
- Context propagation (nested spans)
- Graceful degradation (no crashes on failures)

**Consent Flow** (19 tests passing, 1 skipped):
- Consent decision detection
- --no-telemetry flag handling
- Consent saving to config
- Non-interactive mode detection (CI/CD, piped I/O)
- Flag precedence
- Various CI environment variables

### Build Verification

```bash
npm run build
```

Ensures TypeScript compilation succeeds with all telemetry code.

### Type Checking

```bash
npx tsc --noEmit
```

Validates all type annotations and interfaces.

## Design Principles

The telemetry implementation follows these core principles:

1. **Privacy First**: Disabled by default, explicit opt-in required
2. **Non-Intrusive**: Never blocks or crashes the main application
3. **Standards-Based**: Uses OpenTelemetry for vendor neutrality
4. **Locally Stored**: No external transmission, all data stays on disk
5. **Easy to Analyze**: JSONL format works with standard tools
6. **Comprehensive**: Covers commands, errors, and performance
7. **Well-Tested**: High test coverage for reliability

This provides observability into xray usage patterns while respecting user privacy and maintaining system reliability.
