# Telemetry Coverage

This document tracks which commands have telemetry integration.

## Commands with Telemetry ✅

### 1. `map` / `graph`
**File:** `src/commands/generate.ts`

**Tracked Events:**
- Command execution with options (format, chunked, etc.)
- Share summary requests and generation
- Command duration (via CLI-level span in `src/index.ts`)
- Execution time and memory stats

**What's Tracked:**
```typescript
telemetry.trackCommand('share_requested', {
  command: 'xray map',
  chunked: true,
  outputPath: '.xray'
});

telemetry.trackCommand('share_generated', {
  sharePath: '.xray/SUMMARY.md',
  chunked: false,
  chunks: 5
});
```

### 2. `explore`
**File:** `src/commands/explore.ts`

**Tracked Events:**
- Command execution with mode flags
- Execution time
- Memory usage delta
- Error events

**What's Tracked:**
```typescript
telemetry.trackCommand('explore', {
  hasQuery: false,
  hasMatch: true,
  hasSearch: false,
  hasStats: false,
  hasType: true
});

telemetry.trackStat('execution.time', 1234, { command: 'explore' });
telemetry.trackStat('memory.delta', 52428800, { command: 'explore' });
telemetry.trackError('ExploreError', error);
```

### 3. `query`
**File:** `src/commands/query.ts`

**Tracked Events:**
- Command execution (list-adapters vs query)
- Query format
- Query results count
- Execution time
- Error events

**What's Tracked:**
```typescript
telemetry.trackCommand('query', {
  hasQuery: true,
  format: 'table'
});

telemetry.trackStat('execution.time', 456, { command: 'query' });
telemetry.trackStat('query.results', 23, { command: 'query' });
telemetry.trackError('QueryError', error);
```

### 4. `clear-cache`
**File:** `src/commands/clear-cache.ts`

**Tracked Events:**
- Command execution (whether cache existed)
- Cache file size (when cleared)
- Error events

**What's Tracked:**
```typescript
telemetry.trackCommand('clear-cache', { cacheExists: true });
telemetry.trackStat('cache.size', 1048576, { unit: 'bytes', command: 'clear-cache' });
telemetry.trackError('ClearCacheError', error);
```

### 5. `strategy:list`
**File:** `src/commands/strategy.ts`

**Tracked Events:**
- Command execution
- Number of available strategies

**What's Tracked:**
```typescript
telemetry.trackCommand('strategy:list', {});
telemetry.trackStat('strategies.available', 5, { command: 'strategy:list' });
```

### 6. `strategy:detect`
**File:** `src/commands/strategy.ts`

**Tracked Events:**
- Command execution with detection results
- Execution time
- Number of detected strategies

**What's Tracked:**
```typescript
telemetry.trackCommand('strategy:detect', { detected: 2 });
telemetry.trackStat('execution.time', 789, { command: 'strategy:detect' });
telemetry.trackStat('strategies.detected', 2, { command: 'strategy:detect' });
```

### 7. `strategy:command` (e.g., `react:components`)
**File:** `src/commands/strategy.ts`

**Tracked Events:**
- Command execution with strategy and command names
- Files analyzed count
- Results count
- Execution time
- Codebase statistics

**What's Tracked:**
```typescript
telemetry.trackCommand('strategy:react:components', {
  strategy: 'react',
  command: 'components',
  filesAnalyzed: 42,
  resultCount: 15
});

telemetry.trackStat('execution.time', 2345, { command: 'react:components' });
telemetry.trackStat('codebase.files', 42, { strategy: 'react' });
telemetry.trackStat('strategy.results', 15, { strategy: 'react', command: 'components' });
```

## Commands WITHOUT Telemetry ❌

### 1. `alias` (list/set/remove)
**File:** `src/commands/alias.ts`

**Reason:** Configuration management command - low value for telemetry

**Recommendation:** Could add basic tracking for:
- Alias creation/update/deletion events
- Number of configured aliases

### 2. `completion` (bash/zsh/fish)
**File:** `src/commands/completion.ts`

**Reason:** Shell script generation - no runtime behavior to track

**Recommendation:** Not needed - this is a one-time setup command

## CLI-Level Telemetry ✅

**File:** `src/index.ts`

**Tracked Events:**
- Command name detection
- Command span (start/end)
- Uncaught exceptions
- Unhandled promise rejections

**What's Tracked:**
```typescript
const commandSpan = telemetry.startCommandSpan('generate');
// ... command executes ...
commandSpan.end();

// On errors
telemetry.trackError('UncaughtException', error);
telemetry.trackError('UnhandledRejection', error);
```

## Telemetry Data Points Summary

### Events Tracked
1. **Command Execution** - Every command logs its name and key options
2. **Error Events** - All errors captured with type, message, stack
3. **Performance Stats** - Timing, memory, and codebase metrics

### Metrics Collected

| Metric | Unit | Commands |
|--------|------|----------|
| `execution.time` | ms | All commands (via CLI span) |
| `memory.delta` | bytes | explore |
| `query.results` | count | query |
| `cache.size` | bytes | clear-cache |
| `strategies.available` | count | strategy:list |
| `strategies.detected` | count | strategy:detect |
| `codebase.files` | count | strategy:* |
| `strategy.results` | count | strategy:* |

### Resource Attributes (Auto-Added)

```typescript
{
  'service.name': 'xray-cli',
  'service.version': '0.0.1-alpha.1',
  'host.arch': 'arm64',
  'os.type': 'Darwin',
  'os.version': '24.6.0',
  'process.pid': 12345,
  'process.node_version': 'v20.10.0'
}
```

## Coverage Statistics

- **Total Commands:** 7 core + N strategy commands
- **Commands with Telemetry:** 7 (100% of tracked commands)
- **Commands without Telemetry:** 2 (configuration/utility only)
- **Coverage:** ~78% (7/9 commands)

## Testing Coverage

All telemetry functionality is covered by comprehensive tests:

**Test File:** `__tests__/lib/telemetry.test.ts`

- ✅ 17 tests passing
- ✅ 100% pass rate
- ✅ Covers opt-in, command tracking, errors, stats, spans, etc.

## Future Enhancements

### Short Term
- [ ] Add telemetry to `alias` commands (low priority)
- [ ] Track strategy detection patterns (which files trigger detection)
- [ ] Add file type distribution stats

### Long Term
- [ ] Aggregate telemetry across sessions
- [ ] Export to OpenTelemetry Collector
- [ ] Anomaly detection (performance regressions)
- [ ] User-facing analytics dashboard

## Related Documentation

- [User Guide](../user/telemetry.md) - How to enable and use telemetry
- [Developer Guide](telemetry.md) - Implementation details
- [Test Coverage](../../__tests__/lib/telemetry.test.ts) - Test suite
