# Using xray Plugins

Plugins extend xray's functionality by hooking into the analysis pipeline. This guide shows you how to use existing plugins and understand what they do.

## What Are Plugins?

Plugins are code modules that listen to xray events and:
- **Filter** what gets analyzed (skip test files, private functions, etc.)
- **Transform** data during analysis (redact secrets, add metadata, etc.)
- **Track** progress and collect metrics
- **Customize** output format

## Using Built-in Plugins

xray comes with several ready-to-use plugins in the `examples/plugins/` directory.

### Progress Logger

Shows colored console output with progress bars during analysis.

```typescript
import { ProgressLoggerPlugin } from 'xray/examples/plugins/progress-logger';
import { Xray } from 'xray';

const xray = new Xray({ path: './src' });
await xray.use(new ProgressLoggerPlugin());
await xray.run();
```

**Output:**
```
🔍 Scanning...
✓ Found 127 files

📝 Parsing... ████████████████████ 100% (127/127)
✓ Parsing complete

📊 Building graph... ████████████████ 100% (127/127)
✓ Graph: 450 nodes, 892 edges

✍️  Rendering...
✓ Analysis complete: .xray_root.md
```

---

### Filter Private Functions

Removes underscore-prefixed (private) functions, classes, and variables from output.

```typescript
import { FilterPrivatePlugin } from 'xray/examples/plugins/filter-private';

const xray = new Xray({ path: './src' });
await xray.use(new FilterPrivatePlugin());
await xray.run();
```

**Effect:**
- `_helperFunction()` → **Excluded**
- `class _InternalService` → **Excluded**
- `const _PRIVATE_CONSTANT` → **Excluded**
- `publicFunction()` → **Included**

---

### Skip Test Files

Automatically skips test and spec files during analysis.

```typescript
import { SkipTestsPlugin } from 'xray/examples/plugins/skip-tests';

const xray = new Xray({ path: './src' });
await xray.use(new SkipTestsPlugin({
  patterns: ['*.test.*', '*.spec.*', '__tests__/**']
}));
await xray.run();
```

**Configuration:**
```typescript
new SkipTestsPlugin({
  patterns: [
    '*.test.ts',      // Unit tests
    '*.spec.ts',      // Spec tests
    '*.e2e.ts',       // E2E tests
    '__tests__/**',   // Jest test directory
    '__mocks__/**'    // Mock files
  ]
});
```

---

### Metrics Collector

Tracks comprehensive metrics about your analysis.

```typescript
import { MetricsCollectorPlugin } from 'xray/examples/plugins/metrics-collector';

const metricsPlugin = new MetricsCollectorPlugin();
const xray = new Xray({ path: './src' });

await xray.use(metricsPlugin);
await xray.run();

// Access metrics
const metrics = metricsPlugin.getMetrics();
console.log(metrics);
```

**Metrics Output:**
```json
{
  "timing": {
    "start": "2024-01-15T10:30:00.000Z",
    "end": "2024-01-15T10:30:15.234Z",
    "duration": 15234
  },
  "files": {
    "total": 127,
    "processed": 127,
    "skipped": 0
  },
  "cache": {
    "hits": 89,
    "misses": 38,
    "hitRate": 0.70
  },
  "parsing": {
    "successful": 127,
    "errors": 0
  },
  "graph": {
    "nodes": 450,
    "edges": 892
  },
  "output": {
    "chunks": 12,
    "filesWritten": 12
  }
}
```

---

### Sanitizer Plugin

Redacts sensitive information before analysis.

```typescript
import { SanitizerPlugin } from 'xray/examples/plugins/sanitizer';

const xray = new Xray({ path: './src' });
await xray.use(new SanitizerPlugin({
  patterns: [
    { pattern: /Bearer\s+\S+/g, replacement: 'Bearer [REDACTED]' },
    { pattern: /api_key\s*=\s*['"][^'"]+['"]/gi, replacement: 'api_key="[REDACTED]"' }
  ]
}));
await xray.run();
```

**Effect:**
```typescript
// Before
const token = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
const apiKey = "sk-1234567890abcdef";

// After (in xray output)
const token = "Bearer [REDACTED]";
const apiKey = "[REDACTED]";
```

---

## Using Multiple Plugins

You can use multiple plugins together:

```typescript
import { Xray } from 'xray';
import { ProgressLoggerPlugin } from 'xray/examples/plugins/progress-logger';
import { FilterPrivatePlugin } from 'xray/examples/plugins/filter-private';
import { SkipTestsPlugin } from 'xray/examples/plugins/skip-tests';
import { SanitizerPlugin } from 'xray/examples/plugins/sanitizer';

const xray = new Xray({ path: './src' });

// Add plugins in order of importance
await xray.use(new ProgressLoggerPlugin());          // Visual feedback
await xray.use(new SkipTestsPlugin());               // Filter files early
await xray.use(new SanitizerPlugin());               // Redact before parsing
await xray.use(new FilterPrivatePlugin());           // Filter after parsing

await xray.run();
```

**Plugin Order Matters:**
- Filters apply in registration order
- Later plugins see data modified by earlier plugins
- Use this for layered transformations

## Common Workflows

### Workflow 1: Clean Output for Sharing

```typescript
const xray = new Xray({ path: './src' });

// Skip tests and private code
await xray.use(new SkipTestsPlugin());
await xray.use(new FilterPrivatePlugin());

// Sanitize secrets
await xray.use(new SanitizerPlugin());

await xray.run();
// Output: Clean, public API only, secrets redacted
```

---

### Workflow 2: Development Analysis

```typescript
const xray = new Xray({ path: './src' });

// Track everything
const metrics = new MetricsCollectorPlugin();
await xray.use(metrics);

// Visual progress
await xray.use(new ProgressLoggerPlugin());

await xray.run();

// Review metrics
console.log('Cache hit rate:', metrics.getMetrics().cache.hitRate);
console.log('Parse errors:', metrics.getMetrics().parsing.errors);
```

---

### Workflow 3: CI/CD Pipeline

```typescript
const xray = new Xray({ path: './src' });

// Skip tests (already tested elsewhere)
await xray.use(new SkipTestsPlugin());

// Collect metrics for monitoring
const metrics = new MetricsCollectorPlugin();
await xray.use(metrics);

await xray.run();

// Check quality thresholds
if (metrics.getMetrics().cache.hitRate < 0.5) {
  console.warn('Low cache hit rate - code changing frequently');
}

if (metrics.getMetrics().parsing.errors > 0) {
  throw new Error('Parsing errors detected');
}
```

---

## Understanding Plugin Behavior

### Sequential vs Parallel Events

Plugins listen to events that fire during analysis. Understanding event execution is key:

**Sequential Events (⚡):**
- Listeners run one-by-one
- Later listeners see modifications from earlier listeners
- Use for: filtering, transformations

**Example:**
```typescript
// Plugin A filters private tags
pluginA.on('parse:after', (event) => {
  event.tags = event.tags.filter(tag => !tag.name.startsWith('_'));
});

// Plugin B sees already-filtered tags
pluginB.on('parse:after', (event) => {
  console.log(`Processing ${event.tags.length} tags`); // Only public tags
});
```

**Parallel Events (🔀):**
- Listeners run concurrently
- Each receives original payload
- Use for: logging, metrics collection

**Example:**
```typescript
// Both run in parallel, neither affects the other
pluginA.on('scan:complete', (event) => {
  console.log(`Found ${event.files.length} files`);
});

pluginB.on('scan:complete', (event) => {
  metrics.totalFiles = event.files.length;
});
```

### Common Events for Users

| Event | When | What You Can Do |
|-------|------|-----------------|
| `scan:file` | Before each file | Skip files by pattern |
| `parse:after` | After parsing | Filter tags/imports |
| `graph:complete` | Graph built | Review structure |
| `render:complete` | Output written | Access results |
| `progress` | During work | Show progress |

## Creating Simple Plugins

For simple use cases, you don't need a full plugin file:

```typescript
import { Xray } from 'xray';

const xray = new Xray({ path: './src' });

// Inline plugin
xray.on('scan:file', (event) => {
  // Skip vendor directory
  if (event.file.startsWith('vendor/')) {
    event.skip = true;
  }
});

xray.on('progress', (event) => {
  // Custom progress display
  console.log(`${event.stage}: ${event.current}/${event.total}`);
});

await xray.run();
```

## Troubleshooting

### Plugin Not Working

**Check:**
1. Plugin registered before `xray.run()`
2. Using correct event name
3. Plugin actually installed/imported

```typescript
// ❌ Wrong - plugin registered after run
await xray.run();
await xray.use(plugin);

// ✅ Correct - plugin registered before run
await xray.use(plugin);
await xray.run();
```

### Modifications Not Applied

**Check:**
1. Event supports modification (check event docs)
2. Plugin registered early enough
3. No other plugin overwriting changes

```typescript
// Plugin order matters!

// ❌ Wrong - filter runs after sanitizer sees unsanitized content
await xray.use(new SanitizerPlugin());
await xray.use(new FilterPrivatePlugin());

// ✅ Correct - filter first, then sanitize what remains
await xray.use(new FilterPrivatePlugin());
await xray.use(new SanitizerPlugin());
```

### Performance Issues

**Check:**
1. Not doing heavy work in event listeners
2. Using appropriate events (parallel vs sequential)

```typescript
// ❌ Slow - heavy work on every file
xray.on('parse:after', (event) => {
  for (let i = 0; i < 1000000; i++) {
    heavyComputation();
  }
});

// ✅ Fast - defer heavy work until end
const queue = [];
xray.on('parse:after', (event) => queue.push(event.tags));
xray.on('render:complete', () => processQueue(queue));
```

## Available Plugins

Check `examples/plugins/` directory for:

- **ProgressLoggerPlugin** - Visual progress indicators
- **FilterPrivatePlugin** - Remove private symbols
- **SkipTestsPlugin** - Skip test files
- **MetricsCollectorPlugin** - Collect analysis metrics
- **SanitizerPlugin** - Redact sensitive data

## Next Steps

- **Want to create your own plugin?** See [Plugin Development (Developer)](../dev/plugins.md)
- **Want to understand events?** See [Event Reference (Developer)](../dev/events.md)
- **Want example code?** Check `examples/` directory

## See Also

- [Command Reference](commands.md) - xray CLI commands
- [Configuration Guide](configuration.md) - Config file options
- [Workflows](workflows.md) - Common usage patterns
