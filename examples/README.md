# Xray Plugin Examples

This directory contains example plugins demonstrating xray's event-driven architecture.

## Available Plugins

### ProgressLoggerPlugin

Provides colored console output with progress bars and timing information.

**Features:**
- Scan start/complete logging
- Real-time progress bars during parsing
- Graph build metrics with timing
- Total analysis duration

**Usage:**
```typescript
import { Xray } from '../src/lib/xray';
import { ProgressLoggerPlugin } from './plugins/progress-logger';

const xray = new Xray({ path: './src' });
await xray.use(new ProgressLoggerPlugin());
await xray.run();
```

**Output:**
```
🔍 Scanning ./src...
✓ Found 42 files
████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░ 50% - Parsing files
████████████████████████████████████████████████ 100% - Done
✓ Built graph: 128 nodes, 215 edges (1.23s)
✓ Analysis complete: ./xray.txt (2.45s total)
```

---

### FilterPrivatePlugin

Filters out private functions/methods (those starting with underscore).

**Features:**
- Removes private tags from analysis
- Tracks and reports filtered count
- Works on all tag types (functions, classes, methods, etc.)

**Usage:**
```typescript
import { Xray } from '../src/lib/xray';
import { FilterPrivatePlugin } from './plugins/filter-private';

const xray = new Xray({ path: './src' });
await xray.use(new FilterPrivatePlugin());
await xray.run();
```

**Example:**
```typescript
// Before filtering
function publicAPI() { }
function _privateHelper() { }
class _InternalClass { }

// After filtering (only publicAPI remains in analysis)
```

---

### SkipTestsPlugin

Skips test files during scanning using glob patterns.

**Features:**
- Glob pattern matching with wildcards (* and ?)
- Default patterns for common test conventions
- Custom pattern support

**Default Patterns:**
- `*.test.*` - Files like `app.test.ts`, `utils.test.js`
- `*.spec.*` - Files like `component.spec.tsx`
- `__tests__/**` - Files in `__tests__` directory

**Usage:**
```typescript
import { Xray } from '../src/lib/xray';
import { SkipTestsPlugin } from './plugins/skip-tests';

// Use default patterns
const xray = new Xray({ path: './src' });
await xray.use(new SkipTestsPlugin());

// Or custom patterns
await xray.use(new SkipTestsPlugin([
  '*.test.*',
  '*.mock.*',
  'fixtures/**'
]));

await xray.run();
```

---

### MetricsCollectorPlugin

Collects comprehensive metrics across the entire analysis pipeline.

**Tracked Metrics:**
- Files: scanned, skipped
- Cache: hits, misses, hit rate
- Parse: tags extracted, errors
- Graph: edges
- Duration: total analysis time

**Usage:**
```typescript
import { Xray } from '../src/lib/xray';
import { MetricsCollectorPlugin } from './plugins/metrics-collector';

const xray = new Xray({ path: './src' });
const metrics = new MetricsCollectorPlugin();
await xray.use(metrics);
await xray.run();

// Access metrics programmatically
const stats = metrics.getMetrics();
console.log(`Cache hit rate: ${(stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100).toFixed(1)}%`);
```

**Output:**
```
📊 Metrics Summary:
  Files: 38 scanned, 4 skipped
  Cache: 25 hits, 13 misses (66% hit rate)
  Parse: 142 tags extracted, 0 errors
  Graph: 215 edges
  Duration: 2.45s
```

---

### SanitizerPlugin

Redacts sensitive information from code and docstrings before analysis.

**Default Patterns:**
- Bearer tokens: `Bearer abc123` → `Bearer [REDACTED]`
- API keys: `api_key: "sk_live_..."` → `api_key: "[REDACTED]"`
- Passwords: `password: "secret"` → `password: "[REDACTED]"`

**Usage:**
```typescript
import { Xray } from '../src/lib/xray';
import { SanitizerPlugin } from './plugins/sanitizer';

const xray = new Xray({ path: './src' });

// Use default patterns
await xray.use(new SanitizerPlugin());

// Or custom patterns
await xray.use(new SanitizerPlugin([
  {
    pattern: /SECRET_[A-Z_]+/g,
    replacement: 'SECRET_[HIDDEN]'
  },
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
    replacement: 'SSN: [REDACTED]'
  }
]));

await xray.run();
```

---

## Basic Usage Examples

### Example 1: Simple Event Listening

```typescript
import { Xray } from '../src/lib/xray';

const xray = new Xray({ path: './src' });

// Count files
let fileCount = 0;
xray.on('scan:file', () => {
  fileCount++;
});

// Log completion
xray.on('scan:complete', (event) => {
  console.log(`Processed ${fileCount} files`);
});

await xray.run();
```

### Example 2: Data Transformation

```typescript
import { Xray } from '../src/lib/xray';

const xray = new Xray({ path: './src' });

// Filter only exported functions
xray.on('parse:after', (event) => {
  event.tags = event.tags.filter(tag =>
    tag.kind === 'function' && tag.exported
  );
});

// Add custom metadata
xray.on('graph:add-node', (event) => {
  if (event.attrs.type === 'tag') {
    event.attrs.analyzed = new Date().toISOString();
  }
});

await xray.run();
```

### Example 3: Conditional File Skipping

```typescript
import { Xray } from '../src/lib/xray';

const xray = new Xray({ path: './src' });

// Skip based on multiple conditions
xray.on('scan:file', (event) => {
  // Skip generated files
  if (event.file.includes('.generated.')) {
    event.skip = true;
    return;
  }

  // Skip vendored code
  if (event.file.startsWith('vendor/')) {
    event.skip = true;
    return;
  }

  // Skip large files (would need file size check)
  // This is just an example pattern
});

await xray.run();
```

### Example 4: Multiple Plugins Working Together

```typescript
import { Xray } from '../src/lib/xray';
import { SkipTestsPlugin } from './plugins/skip-tests';
import { FilterPrivatePlugin } from './plugins/filter-private';
import { MetricsCollectorPlugin } from './plugins/metrics-collector';
import { ProgressLoggerPlugin } from './plugins/progress-logger';

const xray = new Xray({ path: './src' });

// Plugins execute in registration order
await xray.use(new SkipTestsPlugin());        // Skip test files first
await xray.use(new FilterPrivatePlugin());     // Then filter private symbols
await xray.use(new MetricsCollectorPlugin());  // Collect metrics on filtered data
await xray.use(new ProgressLoggerPlugin());    // Show progress

await xray.run();
```

### Example 5: Environment-Based Configuration

```typescript
import { Xray } from '../src/lib/xray';
import { ProgressLoggerPlugin } from './plugins/progress-logger';
import { MetricsCollectorPlugin } from './plugins/metrics-collector';
import { SanitizerPlugin } from './plugins/sanitizer';

const xray = new Xray({ path: './src' });

// Development: verbose output
if (process.env.NODE_ENV === 'development') {
  await xray.use(new ProgressLoggerPlugin());
  await xray.use(new MetricsCollectorPlugin());
}

// Production: sanitize secrets
if (process.env.NODE_ENV === 'production') {
  await xray.use(new SanitizerPlugin());
}

await xray.run();
```

### Example 6: Custom Plugin with Configuration

```typescript
import { XrayPlugin } from '../src/lib/events/plugin';
import { Xray } from '../src/lib/xray';

class CustomLoggerPlugin implements XrayPlugin {
  name = 'custom-logger';
  version = '1.0.0';

  constructor(
    private prefix: string = '[XRAY]',
    private verbose: boolean = false
  ) {}

  apply(xray: Xray): void {
    xray.on('scan:start', (event) => {
      console.log(`${this.prefix} Starting scan of ${event.path}`);
    });

    if (this.verbose) {
      xray.on('parse:after', (event) => {
        console.log(`${this.prefix} Parsed ${event.file}: ${event.tags.length} tags`);
      });
    }

    xray.on('render:complete', (event) => {
      console.log(`${this.prefix} Complete: ${event.outputPath}`);
    });
  }
}

// Usage
const xray = new Xray({ path: './src' });
await xray.use(new CustomLoggerPlugin('[MY-APP]', true));
await xray.run();
```

### Example 7: Error Handling

```typescript
import { Xray } from '../src/lib/xray';

const xray = new Xray({ path: './src' });

const errorFiles: string[] = [];

xray.on('parse:error', (event) => {
  errorFiles.push(event.file);
  console.error(`Failed to parse ${event.file}: ${event.error.message}`);
});

xray.on('render:complete', () => {
  if (errorFiles.length > 0) {
    console.warn(`⚠️  ${errorFiles.length} files failed to parse:`);
    errorFiles.forEach(file => console.warn(`  - ${file}`));
  }
});

await xray.run();
```

### Example 8: Async Event Handlers

```typescript
import { Xray } from '../src/lib/xray';
import fetch from 'node-fetch';

const xray = new Xray({ path: './src' });

// Fetch remote configuration
xray.on('scan:start', async (event) => {
  const response = await fetch('https://api.example.com/xray-config');
  const config = await response.json();
  console.log('Loaded remote config:', config);
});

// Report metrics to remote service
xray.on('render:complete', async (event) => {
  await fetch('https://api.example.com/analytics', {
    method: 'POST',
    body: JSON.stringify({
      filesWritten: event.filesWritten,
      timestamp: new Date().toISOString()
    })
  });
});

await xray.run();
```

## Advanced Patterns

### Pattern: Validation Plugin

Ensures data quality at each stage:

```typescript
class ValidationPlugin implements XrayPlugin {
  name = 'validator';

  apply(xray: Xray): void {
    // Validate parsed tags
    xray.on('parse:after', (event) => {
      for (const tag of event.tags) {
        if (!tag.name || !tag.kind) {
          console.warn(`Invalid tag in ${event.file}:`, tag);
        }
      }
    });

    // Validate graph structure
    xray.on('graph:complete', (event) => {
      if (event.nodeCount === 0) {
        console.warn('Empty graph generated!');
      }
    });
  }
}
```

### Pattern: Caching Plugin

Implements custom caching strategy:

```typescript
class CustomCachePlugin implements XrayPlugin {
  name = 'custom-cache';
  private cache = new Map();

  apply(xray: Xray): void {
    xray.on('cache:miss', (event) => {
      // Try custom cache
      const cached = this.cache.get(event.file);
      if (cached) {
        console.log(`Custom cache hit: ${event.file}`);
      }
    });

    xray.on('cache:write', (event) => {
      // Store in custom cache
      this.cache.set(event.file, {
        tags: event.tags,
        imports: event.imports
      });
    });
  }
}
```

### Pattern: Statistics Aggregation

Collects detailed statistics:

```typescript
class DetailedStatsPlugin implements XrayPlugin {
  name = 'detailed-stats';
  private stats = {
    byKind: new Map<string, number>(),
    byFile: new Map<string, number>(),
    largestFiles: [] as Array<{ file: string; tags: number }>
  };

  apply(xray: Xray): void {
    xray.on('parse:after', (event) => {
      // Count by kind
      event.tags.forEach(tag => {
        const count = this.stats.byKind.get(tag.kind) || 0;
        this.stats.byKind.set(tag.kind, count + 1);
      });

      // Count by file
      this.stats.byFile.set(event.file, event.tags.length);

      // Track largest files
      this.stats.largestFiles.push({
        file: event.file,
        tags: event.tags.length
      });
    });

    xray.on('render:complete', () => {
      console.log('\n📈 Detailed Statistics:');

      console.log('\nBy Kind:');
      Array.from(this.stats.byKind.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([kind, count]) => {
          console.log(`  ${kind}: ${count}`);
        });

      console.log('\nLargest Files:');
      this.stats.largestFiles
        .sort((a, b) => b.tags - a.tags)
        .slice(0, 5)
        .forEach(({ file, tags }) => {
          console.log(`  ${file}: ${tags} tags`);
        });
    });
  }
}
```

## Testing Plugins

Example test for a custom plugin:

```typescript
import { Xray } from '../src/lib/xray';
import { MyPlugin } from './my-plugin';

describe('MyPlugin', () => {
  it('should modify tags', async () => {
    const xray = new Xray({ path: '/test', cachePath: ':memory:' });
    const plugin = new MyPlugin();
    await xray.use(plugin);

    // Emit test event
    const event = { file: 'test.ts', tags: [...], imports: [] };
    await xray.emitAsync('parse:after', event);

    // Verify plugin behavior
    expect(event.tags).toHaveLength(expectedLength);
  });
});
```

## Further Reading

- [Plugin Development Guide](../docs/plugin-development-guide.md) - Detailed guide on creating plugins
- [Event Reference](../docs/event-reference.md) - Complete event documentation
- [Main README](../README.md) - Project overview and setup

## Contributing

To contribute a plugin example:

1. Create `plugins/your-plugin.ts`
2. Create `__tests__/plugins/your-plugin.test.ts` with full test coverage
3. Add documentation to this README
4. Submit a pull request

Ensure your plugin:
- Has 100% test coverage
- Follows TypeScript best practices
- Includes clear documentation
- Has a descriptive name and version
