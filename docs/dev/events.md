# Event System Reference

**Target Audience:** xray developers, plugin authors, maintainers

This document provides complete technical documentation for xray's event-driven architecture.

## Overview

xray emits lifecycle events during analysis, enabling plugins to hook into the pipeline at specific points. Events are emitted using an async event emitter with two execution modes.

## Event Execution Modes

### Sequential Execution (⚡)

Events are processed **one listener at a time** in registration order. Later listeners see modifications made by earlier listeners.

**Implementation:** `emitAsync(eventName, payload)`

**Use for:**
- Data transformations (modify payloads)
- Operations that depend on previous listener results
- Setting skip flags
- Ordered pipeline processing

**Events using sequential mode:**
- `scan:file`
- `cache:hit`, `cache:write`
- `parse:before`, `parse:after`, `parse:error`
- `graph:add-file`, `graph:add-node`, `graph:add-edge`
- `rank:complete`
- `error`

**Implementation Detail:**
```typescript
async emitAsync(eventName: string, payload: any): Promise<void> {
  const listeners = this.listeners.get(eventName) || [];

  for (const listener of listeners) {
    try {
      await listener(payload);
    } catch (error) {
      await this.emitAsync('error', {
        event: eventName,
        error,
        payload
      });
    }
  }
}
```

---

### Parallel Execution (🔀)

Events are processed **concurrently**. All listeners receive the original payload simultaneously. Modifications by one listener don't affect others.

**Implementation:** `emitAsyncParallel(eventName, payload)`

**Use for:**
- Logging and metrics
- Independent observers
- Non-modifying operations
- Performance-critical paths

**Events using parallel mode:**
- `scan:start`, `scan:complete`
- `cache:check`, `cache:miss`
- `graph:complete`
- `rank:start`
- `render:start`, `render:complete`
- `progress`

**Implementation Detail:**
```typescript
async emitAsyncParallel(eventName: string, payload: any): Promise<void> {
  const listeners = this.listeners.get(eventName) || [];

  await Promise.all(
    listeners.map(async (listener) => {
      try {
        await listener(payload);
      } catch (error) {
        // Error logged but doesn't block other listeners
        console.error(`Error in ${eventName}:`, error);
      }
    })
  );
}
```

## Complete Event Reference

### Scan Lifecycle

#### `scan:start` 🔀

Emitted when analysis begins.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  path: string;        // Directory being scanned
  config: XrayConfig;  // Analysis configuration
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
await this.emitter.emitAsyncParallel('scan:start', { path, config });
```

**Example:**
```typescript
xray.on('scan:start', (event) => {
  console.log(`Scanning ${event.path}...`);
  this.startTimer = Date.now();
});
```

---

#### `scan:file` ⚡

Emitted before processing each file. Set `skip: true` to exclude file from analysis.

**Execution:** Sequential
**Modifiable:** Yes (skip flag)

**Payload:**
```typescript
{
  file: string;   // Relative file path
  skip?: boolean; // Set to true to skip this file
}
```

**Emitted from:** `src/lib/scanner.ts`
```typescript
for (const file of files) {
  const event = { file, skip: false };
  await this.emitter.emitAsync('scan:file', event);

  if (!event.skip) {
    processedFiles.push(file);
  }
}
```

**Example:**
```typescript
// Skip test files
xray.on('scan:file', (event) => {
  if (event.file.includes('.test.') || event.file.includes('.spec.')) {
    event.skip = true;
  }
});
```

**Testing:**
```typescript
it('should skip files when listener sets skip flag', async () => {
  xray.on('scan:file', (event) => {
    if (event.file.includes('.test.')) event.skip = true;
  });

  const files = await xray.scan();
  expect(files).not.toContain(expect.stringContaining('.test.'));
});
```

---

#### `scan:complete` 🔀

Emitted when file scanning completes.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  files: string[];  // Array of discovered files
}
```

**Emitted from:** `src/lib/scanner.ts`
```typescript
await this.emitter.emitAsyncParallel('scan:complete', { files });
```

**Example:**
```typescript
xray.on('scan:complete', (event) => {
  console.log(`Found ${event.files.length} files`);
  this.metrics.filesScanned = event.files.length;
});
```

---

### Cache Lifecycle

#### `cache:check` 🔀

Emitted before checking cache for a file.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  file: string;   // File being checked
  mtime: number;  // File modification time (milliseconds)
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
await this.emitter.emitAsyncParallel('cache:check', { file, mtime });
```

**Example:**
```typescript
xray.on('cache:check', (event) => {
  this.metrics.cacheChecks++;
});
```

---

#### `cache:hit` ⚡

Emitted when cache entry is found. Listeners can modify cached data before use.

**Execution:** Sequential
**Modifiable:** Yes (tags, imports)

**Payload:**
```typescript
{
  file: string;
  tags: Tag[];      // Cached tags (modifiable)
  imports: Import[]; // Cached imports (modifiable)
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
const event = { file, tags, imports };
await this.emitter.emitAsync('cache:hit', event);
// Use event.tags and event.imports (potentially modified)
```

**Example:**
```typescript
// Add metadata to cached tags
xray.on('cache:hit', (event) => {
  event.tags.forEach(tag => {
    tag.metadata = { ...tag.metadata, fromCache: true };
  });
});
```

---

#### `cache:miss` 🔀

Emitted when cache entry is not found or stale.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  file: string;  // File that will be parsed
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
await this.emitter.emitAsyncParallel('cache:miss', { file });
```

**Example:**
```typescript
xray.on('cache:miss', (event) => {
  this.metrics.cacheMisses++;
});
```

---

#### `cache:write` ⚡

Emitted before writing parsed data to cache. Listeners can modify data before caching.

**Execution:** Sequential
**Modifiable:** Yes (tags, imports)

**Payload:**
```typescript
{
  file: string;
  tags: Tag[];      // Tags to cache (modifiable)
  imports: Import[]; // Imports to cache (modifiable)
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
const event = { file, tags, imports };
await this.emitter.emitAsync('cache:write', event);
await this.cache.set(file, event.tags, event.imports);
```

**Example:**
```typescript
// Don't cache private functions
xray.on('cache:write', (event) => {
  event.tags = event.tags.filter(tag => !tag.name.startsWith('_'));
});
```

---

### Parse Lifecycle

#### `parse:before` ⚡

Emitted before parsing file content. Listeners can modify content or skip parsing.

**Execution:** Sequential
**Modifiable:** Yes (content, skip flag)

**Payload:**
```typescript
{
  file: string;
  content: string;  // File content (modifiable)
  skip?: boolean;   // Set to true to skip parsing
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
const event = { file, content, skip: false };
await this.emitter.emitAsync('parse:before', event);

if (event.skip) return { tags: [], imports: [] };

const result = await this.parseContent(event.content);
```

**Example:**
```typescript
// Sanitize secrets before parsing
xray.on('parse:before', (event) => {
  event.content = event.content.replace(
    /Bearer\s+\S+/g,
    'Bearer [REDACTED]'
  );
});
```

**Testing:**
```typescript
it('should allow modifying content before parsing', async () => {
  xray.on('parse:before', (event) => {
    event.content = event.content.replace(/secret/g, '[REDACTED]');
  });

  const result = await xray.parseFile('test.ts');
  expect(result.tags.some(t => t.content.includes('secret'))).toBe(false);
});
```

---

#### `parse:after` ⚡

Emitted after parsing completes. Listeners can transform extracted tags and imports.

**Execution:** Sequential
**Modifiable:** Yes (tags, imports)

**Payload:**
```typescript
{
  file: string;
  tags: Tag[];      // Extracted tags (modifiable)
  imports: Import[]; // Extracted imports (modifiable)
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
const event = { file, tags, imports };
await this.emitter.emitAsync('parse:after', event);
return { tags: event.tags, imports: event.imports };
```

**Example:**
```typescript
// Filter private functions
xray.on('parse:after', (event) => {
  event.tags = event.tags.filter(tag => !tag.name.startsWith('_'));
});
```

**Testing:**
```typescript
it('should allow filtering tags after parsing', async () => {
  xray.on('parse:after', (event) => {
    event.tags = event.tags.filter(t => t.scope === 'public');
  });

  const result = await xray.parseFile('test.ts');
  expect(result.tags.every(t => t.scope === 'public')).toBe(true);
});
```

---

#### `parse:error` ⚡

Emitted when parsing fails.

**Execution:** Sequential
**Modifiable:** No

**Payload:**
```typescript
{
  file: string;
  error: Error;
  recovered?: boolean;  // Whether parsing continued
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
try {
  await this.parseContent(content);
} catch (error) {
  await this.emitter.emitAsync('parse:error', {
    file,
    error,
    recovered: false
  });
  throw error;
}
```

**Example:**
```typescript
xray.on('parse:error', (event) => {
  console.error(`Failed to parse ${event.file}:`, event.error.message);
  this.metrics.parseErrors++;
});
```

---

### Graph Building Lifecycle

#### `graph:add-file` ⚡

Emitted before adding file and its tags to the graph. Set `skip: true` to prevent addition.

**Execution:** Sequential
**Modifiable:** Yes (tags, imports, skip flag)

**Payload:**
```typescript
{
  file: string;
  tags: Tag[];      // Tags to add (modifiable)
  imports: Import[]; // Imports to add (modifiable)
  skip?: boolean;   // Set to true to skip this file
}
```

**Emitted from:** `src/lib/graph/builder.ts`
```typescript
const event = { file, tags, imports, skip: false };
await this.emitter.emitAsync('graph:add-file', event);

if (event.skip) return;

for (const tag of event.tags) {
  await this.addTag(file, tag);
}
```

**Example:**
```typescript
// Only include files with public APIs
xray.on('graph:add-file', (event) => {
  const hasPublicApi = event.tags.some(t => !t.name.startsWith('_'));
  if (!hasPublicApi) {
    event.skip = true;
  }
});
```

---

#### `graph:add-node` ⚡

Emitted before adding each node to graph. Set `skip: true` to prevent addition.

**Execution:** Sequential
**Modifiable:** Yes (attrs, skip flag)

**Payload:**
```typescript
{
  nodeId: string;   // Node identifier
  attrs: any;       // Node attributes (modifiable)
  skip?: boolean;   // Set to true to skip this node
}
```

**Emitted from:** `src/lib/graph/builder.ts`
```typescript
const event = { nodeId, attrs, skip: false };
await this.emitter.emitAsync('graph:add-node', event);

if (!event.skip) {
  this.graph.setNode(nodeId, event.attrs);
}
```

**Example:**
```typescript
// Skip private tag nodes
xray.on('graph:add-node', (event) => {
  if (event.attrs.type === 'tag' && event.attrs.label.startsWith('_')) {
    event.skip = true;
  }
});
```

---

#### `graph:add-edge` ⚡

Emitted before adding each edge to graph. Set `skip: true` to prevent addition.

**Execution:** Sequential
**Modifiable:** Yes (attrs, skip flag)

**Payload:**
```typescript
{
  source: string;           // Source node ID
  target: string;           // Target node ID
  type: 'defines' | 'calls'; // Edge type
  attrs?: any;              // Edge attributes (modifiable)
  skip?: boolean;           // Set to true to skip this edge
}
```

**Emitted from:** `src/lib/graph/builder.ts`
```typescript
const event = { source, target, type, attrs, skip: false };
await this.emitter.emitAsync('graph:add-edge', event);

if (!event.skip) {
  this.graph.setEdge(source, target, event.attrs);
}
```

**Example:**
```typescript
// Add weight to edges
xray.on('graph:add-edge', (event) => {
  if (!event.attrs) event.attrs = {};
  event.attrs.weight = event.type === 'calls' ? 2 : 1;
});
```

---

#### `graph:complete` 🔀

Emitted when graph building completes.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  graph: Graph;      // Completed graph
  nodeCount: number; // Total nodes
  edgeCount: number; // Total edges
}
```

**Emitted from:** `src/lib/graph/builder.ts`
```typescript
await this.emitter.emitAsyncParallel('graph:complete', {
  graph: this.graph,
  nodeCount: this.graph.nodeCount(),
  edgeCount: this.graph.edgeCount()
});
```

**Example:**
```typescript
xray.on('graph:complete', (event) => {
  console.log(`Graph: ${event.nodeCount} nodes, ${event.edgeCount} edges`);
  this.metrics.graph = { nodes: event.nodeCount, edges: event.edgeCount };
});
```

---

### Ranking Lifecycle

#### `rank:start` 🔀

Emitted when ranking begins.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  graph: Graph;
  anchor?: string;  // Optional focus node
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
await this.emitter.emitAsyncParallel('rank:start', { graph, anchor });
```

**Example:**
```typescript
xray.on('rank:start', (event) => {
  console.log('Computing PageRank...');
});
```

---

#### `rank:complete` ⚡

Emitted when ranking completes. Listeners can modify rankings.

**Execution:** Sequential
**Modifiable:** Yes (rankedNodes)

**Payload:**
```typescript
{
  rankedNodes: RankedNode[];  // Ranked nodes (modifiable)
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
const event = { rankedNodes };
await this.emitter.emitAsync('rank:complete', event);
return event.rankedNodes;
```

**Example:**
```typescript
// Boost public API nodes
xray.on('rank:complete', (event) => {
  event.rankedNodes.forEach(node => {
    if (node.type === 'tag' && node.label.startsWith('public')) {
      node.score *= 1.5;
    }
  });
  // Re-sort after modifications
  event.rankedNodes.sort((a, b) => b.score - a.score);
});
```

---

### Rendering Lifecycle

#### `render:start` 🔀

Emitted when rendering begins.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  format: string;    // Output format
  chunked: boolean;  // Whether using chunked rendering
  outputPath: string; // Output path
}
```

**Emitted from:** `src/lib/xray.ts`
```typescript
await this.emitter.emitAsyncParallel('render:start', {
  format: this.options.format,
  chunked: true,
  outputPath: this.options.outputPath
});
```

**Example:**
```typescript
xray.on('render:start', (event) => {
  console.log(`Rendering to ${event.outputPath}...`);
});
```

---

#### `render:complete` 🔀

Emitted when rendering completes.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  outputPath: string;   // Main output file
  filesWritten: number; // Number of files written
}
```

**Emitted from:** `src/lib/renderer/chunked-renderer.ts`
```typescript
await this.emitter.emitAsyncParallel('render:complete', {
  outputPath: this.options.outputPath,
  filesWritten: chunks.size
});
```

**Example:**
```typescript
xray.on('render:complete', (event) => {
  console.log(`✓ Analysis complete: ${event.outputPath}`);
  console.log(`  Written ${event.filesWritten} files`);
});
```

---

### Special Events

#### `progress` 🔀

Emitted during long-running operations to report progress.

**Execution:** Parallel
**Modifiable:** No

**Payload:**
```typescript
{
  stage: string;   // Current stage (e.g., 'parsing', 'ranking')
  current: number; // Current progress
  total: number;   // Total items
  message: string; // Progress message
}
```

**Emitted from:** Various locations throughout codebase
```typescript
await this.emitter.emitAsyncParallel('progress', {
  stage: 'parsing',
  current: i + 1,
  total: files.length,
  message: `Parsing ${file}`
});
```

**Example:**
```typescript
xray.on('progress', (event) => {
  const percent = Math.round((event.current / event.total) * 100);
  process.stdout.write(`\r${event.stage}: ${percent}%`);
});
```

---

#### `error` ⚡

Emitted when an error occurs in a listener.

**Execution:** Sequential
**Modifiable:** No

**Payload:**
```typescript
{
  event: string;    // Event that triggered error
  error: Error;     // The error
  payload: any;     // Original event payload
  recovered?: boolean;
}
```

**Emitted from:** `src/lib/events/async-emitter.ts`
```typescript
try {
  await listener(payload);
} catch (error) {
  await this.emitAsync('error', {
    event: eventName,
    error,
    payload,
    recovered: false
  });
}
```

**Example:**
```typescript
xray.on('error', (event) => {
  console.error(`Error in ${event.event}:`, event.error);

  if (!event.recovered) {
    // Handle unrecoverable error
    process.exit(1);
  }
});
```

---

## Event Flow Diagram

Complete event sequence for typical analysis:

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
  parse:before (if cache miss)
    ↓
  parse:after (if cache miss)
    ↓
  cache:write (if cache miss)
    ↓
  graph:add-file
    ↓
  graph:add-node (for each tag in file)
    ↓
  graph:add-edge (for each call relationship)
  ↓
graph:complete
  ↓
rank:start
  ↓
rank:complete
  ↓
render:start
  ↓
render:complete
```

## See Also

- [Extension System](extensions.md) - Creating plugins
- [AsyncEmitter Implementation](../../src/lib/events/async-emitter.ts) - Event emitter details
- [Testing](testing.md) - Testing event handling
