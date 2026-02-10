# Logging Implementation Review

**Date:** 2026-02-09
**Reviewer:** Code Analysis
**Files Reviewed:**
- `src/lib/logger.ts`
- All source files using console.* or Logger.*

## Executive Summary

The project has a custom `Logger` class that provides basic logging functionality with log levels and colored output. However, the implementation has **inconsistent adoption** across the codebase, with significant use of direct `console.*` calls bypassing the logging infrastructure.

**Overall Assessment:** ⚠️ IMPROVING (was: Needs standardization and enforcement)

### 📋 Progress Update (2026-02-09)

**Completed (Commit f8ac193):**
- ✅ Fixed console.warn usage in src/lib/strategy/detector.ts → Logger.warn
- ✅ Fixed console.warn usage in src/lib/parser/flow-analysis.ts → Logger.warn
- ✅ Added Logger import where missing
- ✅ Audited all console usage in src/lib/ - identified legitimate cases
- ✅ Core library now consistently uses Logger for all business logic

**Legitimate Console Usage (Intentional):**
- `src/lib/logger.ts` - Logger implementation itself
- `src/lib/telemetry-consent.ts` - Interactive user prompts
- `src/lib/events/async-emitter.ts` - Error handler recursion prevention
- JSDoc examples in error utility files

**Remaining Work:**
- ⚠️ Command files (src/commands/) still use direct console calls (~100+ instances)
- These are mostly for CLI output and may be intentional
- Need policy decision: Should commands use Logger or console?

---

## Current Logger Implementation

### Logger Design (`src/lib/logger.ts`)

```typescript
export class Logger {
  private static level: LogLevel = LogLevel.INFO;

  static debug(message: string, ...args: any[]): void
  static info(message: string): void
  static success(message: string): void
  static warn(message: string): void
  static error(message: string, error?: any): void
  static log(message: string): void
}
```

### ✅ Good Design Choices

1. **Log levels**: Proper severity hierarchy (SILENT, ERROR, WARN, INFO, DEBUG)
2. **Colored output**: Uses `chalk` for visual distinction
3. **Icons**: Clear visual markers (◆ ℹ ✔ ⚠ ✖)
4. **Configurable**: Can set level at runtime
5. **Static class**: Easy to use anywhere (import and call)

### ⚠️ Design Limitations

1. **Limited API**:
   - No structured logging (only strings, not objects)
   - `info()` doesn't accept `...args` like `debug()` does
   - No timestamp support
   - No logging context (file, function, line)
   - No log formatting options

2. **Testing challenges**:
   - Static class is hard to mock in tests
   - No way to capture logs for assertion
   - Directly writes to console (side effect)

3. **No log output control**:
   - Always writes to console
   - Can't redirect to file
   - Can't disable colors for CI/CD
   - No JSON output option

4. **Inconsistent signatures**:
   ```typescript
   debug(message: string, ...args: any[])  // Accepts extra args
   info(message: string)                    // Only accepts message
   error(message: string, error?: any)      // Accepts error object
   ```

---

## Adoption Analysis

### Files Using Logger ✅

**Command files:**
- `src/commands/generate.ts` - Good usage
- `src/commands/clear-cache.ts` - Good usage
- `src/lib/xray.ts` - Good usage

**Core library:**
- `src/lib/scanner.ts`
- `src/lib/query-resolver.ts`
- `src/lib/parser/language-registry.ts`
- `src/lib/parser/manager.ts`
- `src/lib/graph/ranker.ts`
- `src/lib/config.ts`

**Total:** ~10-15 files consistently use Logger

### Files Using Console Directly ❌

**High violation files** (10+ console calls each):
- `src/commands/strategy.ts` - **19 console calls**
- `src/commands/strategy-cmd.ts` - **45 console calls**
- `src/commands/explore.ts` - **17 console calls**
- `src/commands/alias.ts` - **11 console calls**
- `src/lib/telemetry-consent.ts` - **26 console calls**

**Medium violation files:**
- `src/commands/registration/strategies.ts` - 8 console calls
- `src/commands/registration/aliases.ts` - 7 console calls

**Low violation files:**
- `src/commands/completion.ts` - 1 console call (legitimate: outputs completion script)
- ✅ `src/lib/strategy/detector.ts` - FIXED (2 console.warn → Logger.warn)
- ✅ `src/lib/parser/flow-analysis.ts` - FIXED (1 console.warn → Logger.warn)
- `src/lib/events/async-emitter.ts` - 4 console.error calls (legitimate: error handler recursion prevention)

**Commented-out debug logs:**
- `src/lib/parser/manager.ts` - 2 commented console.log
- `src/lib/parser/graphs/go.ts` - 6 commented console.log

**Total:** ~100+ direct console calls across the codebase

---

## Critical Issues

### 🔴 Issue #1: Bypassing Log Levels

**Problem:** Direct `console.*` calls ignore the user's log level preference.

**Example:**
```typescript
// In src/commands/strategy-cmd.ts
console.log(chalk.cyan(`  ${strategy.name}`));  // Always prints
```

**Impact:**
- User sets `--verbose=silent` but still sees output
- Can't suppress verbose command output
- Breaks CI/CD scripts expecting quiet mode

**Expected behavior:**
```typescript
Logger.info(chalk.cyan(`  ${strategy.name}`));  // Respects log level
```

### ✅ Issue #2: Inconsistent Error Reporting [PARTIALLY FIXED]

**Status:** Core library files cleaned up (Commit f8ac193 - 2026-02-09)

**Fixed Files:**
- ✅ `src/lib/strategy/detector.ts` - console.warn → Logger.warn
- ✅ `src/lib/parser/flow-analysis.ts` - console.warn → Logger.warn

**Remaining (Legitimate):**
- `src/lib/events/async-emitter.ts:72-79` - console.error for error handler recursion (intentional)
- `src/lib/telemetry-consent.ts` - console.log for interactive prompts (intentional)
- `src/lib/logger.ts` - console.* calls (Logger implementation itself)

**Problem:**
- ✅ Core library now consistently uses Logger
- ⚠️ Command files still use direct console calls
- ✅ Legitimate console usage identified and documented

### 🔴 Issue #3: Interactive Output Complexity

**File:** `src/lib/telemetry-consent.ts:37-72`

26 console calls for interactive prompt:
```typescript
console.log('');
console.log(chalk.bold.cyan('Welcome to Xray!'));
console.log('');
console.log(chalk.gray('Xray can collect anonymous usage data...'));
// ... 22 more lines
```

**Problem:**
- Complex multi-line output hard to manage
- No abstraction for "prompt" or "banner" output
- Can't easily test or suppress
- Mixing presentation logic with business logic

**Better approach:**
```typescript
Logger.banner([
  'Welcome to Xray!',
  '',
  'Xray can collect anonymous usage data...',
  // ...
]);
```

---

## Categories of Console Usage

### 1. Legitimate Uses ✅

These are acceptable uses where Logger would be inappropriate:

**Completion script output** (`src/commands/completion.ts:31`):
```typescript
console.log(generator());  // ✅ Outputs shell script, not a log message
```

**JSON output** (some commands):
```typescript
console.log(JSON.stringify(result, null, 2));  // ✅ Structured data output
```

**Error handler fallback** (`src/lib/events/async-emitter.ts`):
```typescript
console.error('Error in error handler (not re-emitting):', error);
// ✅ Last resort when logging system itself fails
```

### 2. Should Use Logger ⚠️

**Status messages:**
```typescript
// ❌ Current
console.log(chalk.green(`✓ Created alias "${name}"`));

// ✅ Should be
Logger.success(`Created alias "${name}" → "${target}"`);
```

**Informational output:**
```typescript
// ❌ Current
console.log(chalk.cyan('\nConfigured Aliases:\n'));

// ✅ Should be
Logger.info('\nConfigured Aliases:\n');
```

**Warnings:**
```typescript
// ❌ Current
console.warn(`Strategy detection failed for ${strategy.name}:`, error);

// ✅ Should be
Logger.warn(`Strategy detection failed for ${strategy.name}`, error);
```

### 3. Needs New Logger Method 🔧

**List/table output:**
```typescript
// Current: Manual formatting
console.log(chalk.cyan('\nConfigured Aliases:\n'));
aliases.forEach(([alias, target]) => {
  console.log(`  ${chalk.bold(alias)} → ${chalk.gray(target)}`);
});
console.log(`\nTotal: ${aliases.size} alias(es)\n`);

// Better: Structured method
Logger.list('Configured Aliases', aliases, {
  format: (alias, target) => `${alias} → ${target}`,
  footer: (count) => `Total: ${count} alias(es)`
});
```

**Multi-line blocks:**
```typescript
// Current: Multiple console calls
console.log('');
console.log(chalk.bold('What data is collected:'));
console.log('  • Command usage');
console.log('  • Performance metrics');

// Better: Block method
Logger.block('What data is collected', [
  'Command usage',
  'Performance metrics'
]);
```

---

## Recommendations

### 1. Enforce Logger Usage

**Priority:** High

Create eslint rule to prevent direct console usage:

```javascript
// .eslintrc.js
rules: {
  'no-console': ['error', {
    allow: [] // No exceptions - use Logger instead
  }]
}
```

**Exceptions file** for legitimate cases:
```javascript
// src/commands/completion.ts - eslint-disable-next-line no-console
console.log(generator()); // Outputs shell script
```

### 2. Extend Logger API

**Priority:** High

Add missing methods:

```typescript
export class Logger {
  // Existing methods...

  // New methods for common patterns
  static list(title: string, items: Array<[string, string]>, options?: ListOptions): void
  static table(headers: string[], rows: string[][]): void
  static block(title: string, lines: string[]): void
  static json(data: any): void
  static raw(message: string): void  // Bypass formatting for special cases
}
```

### 3. Standardize Method Signatures

**Priority:** Medium

Make all methods accept optional args:

```typescript
// Current inconsistency:
static debug(message: string, ...args: any[]): void
static info(message: string): void  // ❌ No args

// Proposed:
static debug(message: string, ...args: any[]): void
static info(message: string, ...args: any[]): void   // ✅ Consistent
static success(message: string, ...args: any[]): void
static warn(message: string, ...args: any[]): void
static error(message: string, error?: any, ...args: any[]): void
```

### 4. Add Structured Logging

**Priority:** Medium

Support object logging for better debugging:

```typescript
Logger.debug('Processing file', {
  path: filePath,
  size: stats.size,
  duration: elapsed
});

// Output: ◆ Processing file path=/src/index.ts size=1234 duration=45ms
```

### 5. Add Testing Support

**Priority:** Medium

Make Logger testable:

```typescript
export class Logger {
  private static sink: LogSink = new ConsoleSink();

  static setSink(sink: LogSink): void {
    this.sink = sink;
  }

  static info(message: string): void {
    if (this.level >= LogLevel.INFO) {
      this.sink.write(LogLevel.INFO, message);
    }
  }
}

// In tests:
const testSink = new TestLogSink();
Logger.setSink(testSink);
// ... run code ...
expect(testSink.logs).toContain('Expected log message');
```

### 6. Add Configuration Options

**Priority:** Low

Support different output formats:

```typescript
interface LoggerConfig {
  level: LogLevel;
  colors: boolean;      // Disable in CI
  timestamps: boolean;  // Add timestamps
  format: 'text' | 'json';  // JSON for log aggregation
  output: 'console' | 'file' | 'both';
  filePath?: string;
}

Logger.configure(config);
```

---

## Migration Plan

### Phase 1: Extend Logger (Week 1)
- [ ] Add `list()`, `table()`, `block()` methods
- [ ] Standardize method signatures
- [ ] Add structured logging support
- [ ] Add testing infrastructure

### Phase 2: Migrate High-Impact Files (Week 2)
- [ ] `src/commands/strategy-cmd.ts` (45 console calls)
- [ ] `src/lib/telemetry-consent.ts` (26 console calls)
- [ ] `src/commands/strategy.ts` (19 console calls)
- [ ] `src/commands/explore.ts` (17 console calls)

### Phase 3: Migrate Remaining Files (Week 3)
- [ ] All other command files
- [ ] Library files with console usage
- [ ] Add eslint rule to prevent regression

### Phase 4: Polish (Week 4)
- [ ] Add configuration support
- [ ] Improve documentation
- [ ] Add examples to CONTRIBUTING.md
- [ ] Performance optimization

---

## Example Refactoring

### Before: `src/commands/alias.ts:27-36`

```typescript
if (aliases.size === 0) {
  console.log('No aliases configured.');
  console.log('\nTo add aliases, use: xray alias set <name> <target>');
  return;
}

console.log(chalk.cyan('\nConfigured Aliases:\n'));
aliases.forEach(([alias, target]) => {
  console.log(`  ${chalk.bold(alias)} → ${chalk.gray(target)}`);
});
console.log(`\nTotal: ${aliases.size} alias(es)\n`);
```

### After:

```typescript
if (aliases.size === 0) {
  Logger.info('No aliases configured.');
  Logger.info('To add aliases, use: xray alias set <name> <target>');
  return;
}

Logger.list('Configured Aliases',
  Array.from(aliases.entries()).map(([alias, target]) => ({
    label: alias,
    value: target
  })),
  {
    footer: `Total: ${aliases.size} alias(es)`
  }
);
```

---

## Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Files using Logger | ~15 | All (~50+) |
| Files using console | ~20 | ~3 (exceptions only) |
| Direct console calls | ~100+ | ~5 (documented exceptions) |
| Logger methods | 6 | ~12 (extended API) |
| Test coverage for logging | 0% | 80% |

---

## Related Issues

This logging inconsistency relates to other quality issues:

1. **Testing**: Hard to test commands that use console.log directly
2. **CI/CD**: Can't suppress output reliably in automated environments
3. **Debugging**: No way to enable verbose logging selectively
4. **Error handling**: Error messages scattered across console.error and Logger.error

---

## Conclusion

The Logger implementation is functional but **underutilized**. The codebase has ~100+ direct console calls that bypass logging infrastructure, breaking log level control and making testing difficult.

**Critical Actions:**
1. Extend Logger with missing methods (list, table, block)
2. Migrate high-impact files (strategy-cmd.ts, telemetry-consent.ts)
3. Enforce Logger usage with eslint rule

**Estimated Effort:**
- Logger extensions: 4-6 hours
- High-impact migrations: 6-8 hours
- Remaining migrations: 8-12 hours
- Testing/documentation: 4-6 hours

**Total:** ~3-4 days of focused work to standardize logging across the codebase.
