# Chunked Output Architecture

Technical implementation details of xray's chunked output rendering system.

## Overview

The chunked output system breaks large codebase maps into multiple files organized by directory structure. This enables:
- Handling of large codebases without hitting token limits
- Intuitive navigation through directory structure
- Per-chunk optimization and customization
- Backward compatibility with single-file output

**Status:** Enabled by default; can be disabled with `--no-chunk` flag.

## Architecture Components

### 1. ChunkedRenderer (`src/lib/renderer/chunked-renderer.ts`)

Core rendering engine for chunked output.

**Main Functions:**

```typescript
export interface RenderedChunk {
  path: string;        // Output file path
  content: string;     // Rendered markdown content
  directory: string;   // Directory this chunk represents
  depth: number;       // Directory depth
  files: number;       // File count in this chunk
  tokens: number;      // Token count for content
}

export class ChunkedRenderer {
  // Main entry point
  async renderChunked(
    graph: Graph,
    files: string[],
    config: RenderConfig
  ): Promise<RenderedChunk[]>

  // Directory organization
  private organizeByDirectory(
    sortedItems: RankedItem[],
    basePath: string,
    maxDepth?: number
  ): Map<string, RankedItem[]>

  // Single directory rendering
  private async renderDirectory(
    dirPath: string,
    items: RankedItem[],
    tokenLimit: number,
    includeImports: boolean
  ): Promise<string>

  // Navigation linking
  private addNavigationLinks(
    content: string,
    dirPath: string,
    allChunks: Map<string, RenderedChunk>
  ): string

  // Path utilities
  private sanitizePath(dirPath: string): string
  private getRelativePath(from: string, to: string): string
}
```

**Key Algorithms:**

**Directory Organization:**
1. For each ranked item, extract directory path
2. Group items by directory
3. Apply depth filtering if specified
4. Return Map<directory, items>

**Token Limit Enforcement:**
1. Initialize token counter to 0
2. For each ranked item (in importance order):
   - Estimate tokens for item
   - Add to chunk if under limit
   - Skip if would exceed limit
3. Return content with actual token count

**Navigation Generation:**
1. Parse directory path (e.g., `src/lib/` -> `["src", "lib"]`)
2. Find parent directory (e.g., `src/`)
3. Find all sibling directories
4. Generate markdown links with relative paths

### 2. Integration with Xray Core (`src/lib/xray.ts`)

The main Xray class provides:

```typescript
export class Xray {
  private config: XrayConfig;
  private cache: SqliteCache;

  // Main entry point
  async run(): Promise<string | ChunkMetadata> {
    // Build analysis
    const graph = await this.buildGraph();

    // Route to appropriate renderer
    if (this.config.chunked !== false) {
      const chunks = await new ChunkedRenderer().renderChunked(
        graph,
        files,
        config
      );
      return this.buildChunkMetadata(chunks);
    } else {
      const content = new MapRenderer().render(graph, config);
      return content;
    }
  }

  // Build graph (now public for testing)
  async buildGraph(): Promise<Graph> {
    // AST parsing
    // Graph construction
    // PageRank ranking
    return graph;
  }
}
```

**Return Type Change:**
- **Old:** Always returned `string` (rendered content)
- **New:** Returns `string | ChunkMetadata` based on chunking mode
  - Single-file: Returns rendered content string
  - Chunked: Returns metadata for file writing

### 3. Configuration Types (`src/types/xray-config.ts`)

```typescript
export interface XrayScopeConfig {
  // ... existing fields

  // Chunked output control
  chunked?: boolean;  // Enable/disable chunking (default: true)
}

export interface RenderConfig {
  // Token limits
  limit?: number;           // Tokens per chunk (default: 4096)

  // Depth control
  depth?: number;           // Max directory depth

  // Features
  includeImports?: boolean; // Include import tables (--with incs)
  includeVars?: boolean;    // Include variables (--with vars)
  // ... other features

  // Output paths
  outputBase: string;       // Base output path
  format?: string;          // File extension (default: '.md')
}
```

### 4. Command Integration (`src/commands/generate.ts`)

The generate command orchestrates chunked output:

```typescript
// Simplified flow
export async function generateCommand(options) {
  // Load and merge configuration
  const config = mergeConfig(loadedConfig, options);

  // Run analysis
  const result = await xray.run();

  if (typeof result === 'string') {
    // Single-file output
    fs.writeFileSync(outputPath, result);
  } else {
    // Chunked output
    for (const chunk of result.chunks) {
      fs.writeFileSync(chunk.path, chunk.content);
    }
    displayChunkSummary(result);
  }
}
```

## Data Flow

### Chunked Rendering Process

```
Input Graph
    │
    ├─ Score and rank items (PageRank + heuristics)
    │
    ├─ Organize by directory
    │   └─ Group files into directory buckets
    │   └─ Apply depth filtering
    │
    ├─ For each directory chunk:
    │   ├─ Collect items for this directory
    │   ├─ Sort by importance (PageRank)
    │   ├─ Render content until token limit
    │   │   ├─ Render file info
    │   │   ├─ List functions/classes
    │   │   ├─ Add cross-references (if enabled)
    │   │   └─ Track tokens used
    │   ├─ Create RenderedChunk object
    │   │   └─ Store path, content, metadata
    │   └─ Store in chunks list
    │
    ├─ Add navigation links
    │   ├─ For each chunk, find parent/children
    │   ├─ Generate relative paths
    │   └─ Update chunk content with nav section
    │
    └─ Return chunk metadata
        ├─ List of chunks with paths
        ├─ Directory tree structure
        └─ Statistics (token counts, file counts)
```

### Example Output Structure

```
Project Structure:
├── src/                     (depth 1)
│   ├── index.ts
│   ├── lib/                 (depth 2)
│   │   ├── xray.ts
│   │   ├── config.ts
│   │   └── parser/          (depth 3)
│   │       └── manager.ts
│   └── commands/            (depth 2)
│       ├── generate.ts
│       └── explore.ts

Generated Chunks (with --depth 2):
.xray_root.md           (files in root)
.xray_src.md            (src/ files only)
.xray_src_lib.md        (src/lib/ files)
.xray_src_commands.md   (src/commands/ files)
(src/lib/parser not included due to depth limit)
```

## Navigation System

### Link Generation

Each chunk includes navigation links at the top:

```markdown
---
## Navigation

⬆️ **Parent:** [src](../.xray_src.md)

⬇️ **Children:**
  - [src/lib](../.xray_src_lib.md)
  - [src/commands](../.xray_src_commands.md)

---
```

**Link Algorithm:**

1. **Parse current directory:**
   ```
   .xray_src_lib.md -> src/lib
   ```

2. **Find parent directory:**
   ```
   src/lib -> src -> .xray_src.md
   ```

3. **Find child directories:**
   ```
   src/lib -> [src/lib/parser, src/lib/cache, ...]
   -> [.xray_src_lib_parser, .xray_src_lib_cache, ...]
   ```

4. **Generate relative path:**
   ```
   From: .xray_src_lib.md
   To:   .xray_src.md
   Path: ../.xray_src.md
   ```

**Relative Path Logic:**
- Parent links: `../` (up one directory)
- Sibling links: Same directory level
- Child links: `./` (same directory)

### Special Cases

**Root Level:**
```markdown
⬇️ **Children:**
  - [src](../.xray_src.md)
  - [lib](../.xray_lib.md)
```
(No parent link)

**Single File Directory:**
- Navigation still included for consistency
- Parents/children shown even if only one file

## Token Limit Management

### Per-Chunk Limits

Each chunk enforces the configured token limit independently:

```
Chunk: src/lib/
Limit: 4096 tokens
Files: [config.ts, xray.ts, query-resolver.ts, logger.ts, ...]
Sorted: [xray.ts (950t), config.ts (820t), logger.ts (650t), ...]

Rendering:
1. Add xray.ts:        950 tokens  (total: 950)
2. Add config.ts:      820 tokens  (total: 1770)
3. Add logger.ts:      650 tokens  (total: 2420)
4. Add query-resolver: 800 tokens  (total: 3220)
5. Try parser.ts:      900 tokens  (total: 4120) -> SKIP (would exceed limit)

Result: 4 files, 3220 tokens (under 4096 limit)
```

**Token Estimation:**
```typescript
// Approximate tokens: ~4 chars per token
const estimateTokens = (content: string): number => {
  return Math.ceil(content.length / 4);
};
```

### Disabling Chunking

Use `--no-chunk` to disable:

```bash
xray map --path ./src --no-chunk --limit 16384
```

This uses the original MapRenderer with a single token limit for entire output.

## Configuration Examples

### Config File with Chunking

```json
{
  "paths": ["src/"],
  "output": ".xray",
  "chunked": true,
  "limit": 4096,
  "depth": 3,
  "features": {
    "vars": true,
    "incs": true
  }
}
```

### Per-Scope Chunking Control

```json
{
  "scopes": {
    "backend": {
      "paths": ["src/backend"],
      "chunked": true,
      "limit": 8192
    },
    "frontend": {
      "paths": ["src/frontend"],
      "chunked": false,
      "limit": 16384
    }
  }
}
```

### CLI Override

```bash
# Force single-file despite config
xray map --no-chunk

# Use larger chunks
xray map --limit 8192

# Control depth
xray map --depth 2
```

## Performance Characteristics

### Memory Usage

**Chunked vs. Single-file:**
- **Single-file:** Must load entire codebase analysis into memory before rendering
- **Chunked:** Can render one directory at a time (more efficient for large codebases)

**Current Implementation:**
- All chunks built in memory before writing
- Future: Streaming rendering could reduce memory further

### I/O Operations

**Chunked Output:**
```
Reading:  1 scan (entire codebase)
Writing:  N files (one per directory chunk)
Total I/O: 1 read + N writes
```

**Single-File Output:**
```
Reading:  1 scan (entire codebase)
Writing:  1 file
Total I/O: 1 read + 1 write
```

**Trade-off:** Slightly more disk I/O but better memory efficiency.

## Testing

### Test Suite (`__tests__/chunked-renderer.test.ts`)

Comprehensive tests covering:

```typescript
describe('ChunkedRenderer', () => {
  // Directory organization
  it('should organize files by directory', ...)
  it('should respect depth limits', ...)

  // Navigation
  it('should generate parent links', ...)
  it('should generate child links', ...)
  it('should use relative paths', ...)

  // Token management
  it('should respect token limits per chunk', ...)
  it('should estimate tokens accurately', ...)

  // Edge cases
  it('should handle root directory', ...)
  it('should handle single file directories', ...)
  it('should handle deeply nested structures', ...)

  // Output validation
  it('should generate valid markdown', ...)
  it('should include all necessary files', ...)
});
```

**Running Tests:**
```bash
npm test -- chunked-renderer
npm run test:coverage
```

## Future Enhancements

### Planned Features

1. **Smart Chunking:** Chunk by module boundaries, not just directories
2. **Automatic Index:** Generate `.xray_index.md` with all chunks listed
3. **Chunk Compression:** Smart file merging for small directories
4. **Incremental Updates:** Only regenerate changed chunks
5. **Streaming:** Reduce memory usage by streaming chunks during generation

### Implementation Notes for Contributors

When extending chunked output:

1. **Preserve Relative Links:** Always use relative paths in navigation
2. **Token Accuracy:** Keep token estimation aligned with actual usage
3. **Directory Structure:** Respect user's directory organization
4. **Edge Cases:** Test with deep nesting, single files, empty dirs
5. **Backward Compatibility:** Ensure `--no-chunk` still works perfectly

## Troubleshooting

### Chunks Too Small

**Problem:** Important files missing from chunks

**Solution:**
```bash
xray map --limit 8192     # Increase token limit
xray map --depth 2        # Reduce depth (fewer chunks)
```

### Too Many Chunks

**Problem:** Too many small chunks generated

**Solution:**
```bash
xray map --depth 2        # Limit depth
xray map --no-chunk       # Single file instead
```

### Broken Navigation Links

**Problem:** Links not working between chunks

**Cause:** Chunks moved to different directories (relative paths broken)

**Solution:** Regenerate chunks in original location

### Missing Content

**Problem:** Expected files not in chunks

**Cause:** Filtered by `--match`, `--catch`, or depth limits

**Solution:**
```bash
xray map --depth 5        # Include deeper files
xray map -m "*.ts"        # Adjust patterns
xray map                  # Check what's included
```

## See Also

- [Chunked Output User Guide](../user/README.md#3-chunked-output) - Usage documentation
- [Command Structure](command-structure.md) - How commands work
- [Architecture Overview](architecture.md) - System design
- [Contributing Guide](contributing.md) - Development workflow
