# Event System: Agent Integration Reference

**Target Audience:** AI coding agents using xray programmatically

## Decision Protocol: When to Use Events

```
IF building_custom_plugin THEN
  use_events = true
ELSE IF need_progress_tracking THEN
  use_events = true
ELSE IF need_data_transformation THEN
  use_events = true
ELSE
  use_events = false  # Use CLI commands instead
```

## Core Concept

xray emits lifecycle events during analysis. You can listen to these events to:
- **Filter** files or tags before processing
- **Transform** data during pipeline
- **Track** progress of long operations
- **Collect** metrics

## Event Execution Modes

Critical distinction for predictable behavior:

| Mode | Symbol | Behavior | Use For |
|------|--------|----------|---------|
| **Sequential** | ⚡ | Listeners execute one-by-one. Later listeners see earlier modifications. | Data transformation, filtering |
| **Parallel** | 🔀 | Listeners execute concurrently. All receive original payload. | Logging, metrics |

## Quick Reference Table

| Event | Mode | Modifiable | When Fired |
|-------|------|-----------|------------|
| `scan:file` | ⚡ | Yes (skip) | Before each file scanned |
| `parse:after` | ⚡ | Yes (tags) | After parsing file |
| `graph:add-file` | ⚡ | Yes (tags, skip) | Before adding file to graph |
| `graph:add-node` | ⚡ | Yes (attrs, skip) | Before adding node |
| `graph:complete` | 🔀 | No | Graph building done |
| `render:chunk` | ⚡ | Yes (content) | Before writing chunk |
| `progress` | 🔀 | No | Progress update |

**Full list:** See [Complete Event Reference](#complete-event-reference)

## Usage Pattern

```typescript
import { Xray } from 'xray';

const xray = new Xray({ path: './src' });

// Listen to event
xray.on('scan:file', (event) => {
  if (event.file.includes('.test.')) {
    event.skip = true;  // Skip test files
  }
});

// Run analysis
await xray.run();
```

## Common Patterns for Agents

### Pattern 1: Filter Files

```typescript
// Skip files matching pattern
xray.on('scan:file', (event) => {
  const skipPatterns = ['.test.', '.spec.', '__tests__'];

  for (const pattern of skipPatterns) {
    if (event.file.includes(pattern)) {
      event.skip = true;
      break;
    }
  }
});
```

### Pattern 2: Track Progress

```typescript
let filesProcessed = 0;
let totalFiles = 0;

xray.on('scan:complete', (event) => {
  totalFiles = event.files.length;
});

xray.on('parse:after', () => {
  filesProcessed++;
  const percent = Math.round((filesProcessed / totalFiles) * 100);
  console.log(`Progress: ${percent}%`);
});
```

### Pattern 3: Filter Private Functions

```typescript
xray.on('parse:after', (event) => {
  // Remove underscore-prefixed (private) tags
  event.tags = event.tags.filter(tag => !tag.name.startsWith('_'));
});
```

### Pattern 4: Collect Metrics

```typescript
const metrics = {
  filesScanned: 0,
  tagsExtracted: 0,
  cacheHits: 0,
  cacheMisses: 0
};

xray.on('scan:file', () => metrics.filesScanned++);
xray.on('parse:after', (event) => metrics.tagsExtracted += event.tags.length);
xray.on('cache:hit', () => metrics.cacheHits++);
xray.on('cache:miss', () => metrics.cacheMisses++);

xray.on('render:complete', () => {
  console.log('Analysis metrics:', metrics);
});
```

### Pattern 5: Sanitize Sensitive Content

```typescript
xray.on('parse:before', (event) => {
  // Redact API keys and tokens
  event.content = event.content
    .replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]')
    .replace(/api[_-]?key\s*=\s*['"][^'"]+['"]/gi, 'api_key="[REDACTED]"');
});
```

## Complete Event Reference

### Scan Events

#### `scan:file` ⚡

Emitted before processing each file.

**Payload:**
```typescript
{
  file: string;   // Relative path
  skip?: boolean; // Set to skip file
}
```

**Typical Use:**
```typescript
xray.on('scan:file', (event) => {
  if (shouldSkip(event.file)) {
    event.skip = true;
  }
});
```

---

#### `scan:complete` 🔀

Emitted after file scanning completes.

**Payload:**
```typescript
{
  files: string[]; // All discovered files
}
```

**Typical Use:**
```typescript
xray.on('scan:complete', (event) => {
  console.log(`Found ${event.files.length} files`);
});
```

---

### Parse Events

#### `parse:before` ⚡

Emitted before parsing file.

**Payload:**
```typescript
{
  file: string;
  content: string;  // Modifiable
  skip?: boolean;   // Set to skip parsing
}
```

**Typical Use:**
```typescript
xray.on('parse:before', (event) => {
  // Sanitize content before parsing
  event.content = sanitize(event.content);
});
```

---

#### `parse:after` ⚡

Emitted after parsing file.

**Payload:**
```typescript
{
  file: string;
  tags: Tag[];      // Modifiable
  imports: Import[]; // Modifiable
}
```

**Typical Use:**
```typescript
xray.on('parse:after', (event) => {
  // Filter tags
  event.tags = event.tags.filter(isPublic);
});
```

---

### Graph Events

#### `graph:add-file` ⚡

Emitted before adding file to graph.

**Payload:**
```typescript
{
  file: string;
  tags: Tag[];      // Modifiable
  imports: Import[]; // Modifiable
  skip?: boolean;   // Set to skip file
}
```

**Typical Use:**
```typescript
xray.on('graph:add-file', (event) => {
  if (event.tags.length === 0) {
    event.skip = true; // Skip empty files
  }
});
```

---

#### `graph:add-node` ⚡

Emitted before adding node to graph.

**Payload:**
```typescript
{
  nodeId: string;
  attrs: any;       // Modifiable
  skip?: boolean;   // Set to skip node
}
```

**Typical Use:**
```typescript
xray.on('graph:add-node', (event) => {
  if (event.attrs.type === 'tag' && isPrivate(event.attrs.label)) {
    event.skip = true;
  }
});
```

---

#### `graph:complete` 🔀

Emitted when graph building completes.

**Payload:**
```typescript
{
  graph: Graph;
  nodeCount: number;
  edgeCount: number;
}
```

**Typical Use:**
```typescript
xray.on('graph:complete', (event) => {
  console.log(`Graph: ${event.nodeCount} nodes, ${event.edgeCount} edges`);
});
```

---

### Render Events

#### `render:chunk` ⚡

Emitted before writing each chunk.

**Payload:**
```typescript
{
  chunkPath: string;
  content: string;  // Modifiable
}
```

**Typical Use:**
```typescript
xray.on('render:chunk', (event) => {
  // Add header to each chunk
  event.content = `// Generated ${new Date()}\n${event.content}`;
});
```

---

#### `render:complete` 🔀

Emitted when rendering completes.

**Payload:**
```typescript
{
  outputPath: string;
  filesWritten: number;
}
```

**Typical Use:**
```typescript
xray.on('render:complete', (event) => {
  console.log(`✓ Wrote ${event.filesWritten} files`);
});
```

---

### Progress Events

#### `progress` 🔀

Emitted during long operations.

**Payload:**
```typescript
{
  stage: string;   // 'parsing', 'ranking', etc.
  current: number;
  total: number;
  message: string;
}
```

**Typical Use:**
```typescript
xray.on('progress', (event) => {
  const percent = Math.round((event.current / event.total) * 100);
  console.log(`${event.stage}: ${percent}%`);
});
```

---

## Plugin Pattern

For reusable event listeners, create plugins:

```typescript
interface XrayPlugin {
  name: string;
  apply(xray: Xray): void;
}

class SkipTestsPlugin implements XrayPlugin {
  name = 'skip-tests';

  apply(xray: Xray): void {
    xray.on('scan:file', (event) => {
      if (event.file.includes('.test.')) {
        event.skip = true;
      }
    });
  }
}

// Usage
const xray = new Xray({ path: './src' });
await xray.use(new SkipTestsPlugin());
await xray.run();
```

## Event Flow

Typical event sequence:

```
scan:start
  ↓
scan:file (for each file)
  ↓
scan:complete
  ↓
For each file:
  cache:check
    ↓
  cache:hit OR cache:miss
    ↓
  parse:before (if miss)
    ↓
  parse:after (if miss)
    ↓
  graph:add-file
    ↓
  graph:add-node (for each tag)
  ↓
graph:complete
  ↓
rank:start
  ↓
rank:complete
  ↓
render:start
  ↓
render:chunk (for each chunk)
  ↓
render:complete
```

## Error Handling

```typescript
xray.on('error', (event) => {
  console.error(`Error in ${event.event}:`, event.error);

  if (event.recovered) {
    // Error was handled, continue
  } else {
    // Unrecoverable error, analysis stopped
    throw event.error;
  }
});
```

## Performance Considerations

### Lightweight Listeners

```typescript
// Bad - heavy computation
xray.on('parse:after', (event) => {
  for (let i = 0; i < 1000000; i++) {
    heavyComputation();
  }
});

// Good - defer work
const workQueue = [];

xray.on('parse:after', (event) => {
  workQueue.push(event.tags);
});

xray.on('render:complete', async () => {
  await processQueue(workQueue);
});
```

### Async Listeners

Event listeners can be async:

```typescript
xray.on('parse:before', async (event) => {
  const config = await fetchConfig();
  event.content = applyConfig(event.content, config);
});
```

Note: Sequential events wait for async listeners to complete.

## Validation

Verify event handling:

```typescript
const metrics = {
  filesSkipped: 0,
  tagsFiltered: 0
};

xray.on('scan:file', (event) => {
  if (event.skip) metrics.filesSkipped++;
});

xray.on('parse:after', (event) => {
  const before = event.tags.length;
  event.tags = event.tags.filter(isPublic);
  metrics.tagsFiltered += before - event.tags.length;
});

xray.on('render:complete', () => {
  console.log('Validation:', metrics);
  assert(metrics.filesSkipped > 0, 'Should skip test files');
  assert(metrics.tagsFiltered > 0, 'Should filter private tags');
});
```

## See Also

- [Plugin Development (User)](#) - Creating reusable plugins
- [Integration Protocol](integration-protocol.md) - When to use xray
- [Output Interpretation](output-interpretation.md) - Parsing results
