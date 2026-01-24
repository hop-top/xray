# Chunked Output: Navigating Large Codebases

## The Problem

You have a 50,000 line codebase. You need to help Claude understand it.

**Option A**: One giant file
- 100K+ tokens
- AI can't fit it in context
- Overwhelming to parse ❌

**Option B**: Many small files
- Multiple requests to AI
- Loss of context between files
- How do they connect? ❌

**Option C**: Chunked output
- Multiple files organized by structure
- Each chunk: 2K-4K tokens
- Built-in navigation links
- AI works with one chunk, understands connections ✅

## What is Chunked Output?

Instead of one giant map, xray creates a "book" with chapters:

- `.xray_root.md` - Table of contents & root directory
- `.xray_src.md` - src/ overview
- `.xray_src_lib.md` - src/lib/ detailed view
- `.xray_src_components.md` - src/components/ detailed view
- etc.

Each chapter has links to parent and child chapters. Perfect for AI assistants (and humans) navigating large projects.

## Features

- **Automatic Chunking**: Enabled by default, splits output across multiple files based on directory structure
- **Token Limit Enforcement**: Each chunk respects the specified token limit (default: 4096 tokens)
- **Parent-Child Navigation**: Automatic bidirectional links between parent and child directories
- **Depth Control**: Use `--depth` to limit how deep the directory tree is explored
- **Single File Option**: Use `--no-chunk` to disable chunking and get a single output file

## Usage

### Default Behavior (Chunked)

By default, all commands generate chunked output:

```bash
xray map -p src/
```

This generates multiple files:
- `.xray_root.md` - Root directory map
- `.xray_src.md` - src/ directory map
- `.xray_src_lib.md` - src/lib/ directory map
- `.xray_src_commands.md` - src/commands/ directory map
- etc.

### Disable Chunking

To get a single output file (original behavior):

```bash
xray map -p src/ --no-chunk
```

### Custom Token Limit

Control the token limit per chunk:

```bash
xray map -p src/ --limit 8192
```

### Limit Depth

Control how deep the directory tree is processed:

```bash
xray map -p src/ --depth 2
```

This will only create chunks for directories up to 2 levels deep.

### Custom Output Path

Specify the base output path:

```bash
xray map -p src/ -o analysis/codebase
```

This generates:
- `analysis/codebase_root.md`
- `analysis/codebase_src.md`
- `analysis/codebase_src_lib.md`
- etc.

## Navigation Structure

Each chunk includes a navigation section at the top:

```markdown
---
## Navigation

⬆️ **Parent:** [src](../.xray_src.md)

⬇️ **Children:**
  - [src/lib](../.xray_src_lib.md)
  - [src/commands](../.xray_src_commands.md)

---

# Directory: src

...content...
```

## Directory Organization

Files are organized by their directory structure:

```
/project
├── index.ts
├── src/
│   ├── lib/
│   │   ├── config.ts
│   │   └── utils.ts
│   └── commands/
│       ├── generate.ts
│       └── explore.ts
```

Generates chunks:
- `.xray_root.md` - Contains index.ts
- `.xray_src.md` - Overview of src/ (if needed)
- `.xray_src_lib.md` - Contains config.ts, utils.ts
- `.xray_src_commands.md` - Contains generate.ts, explore.ts

## Configuration

### In Config File

You can disable chunking globally in your config file:

```json
{
  "chunked": false,
  "limit": 8192
}
```

Or per scope:

```json
{
  "scopes": {
    "backend": {
      "paths": ["src/backend"],
      "chunked": true,
      "limit": 4096
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

CLI flags always take precedence over config:

```bash
# Force chunked even if config disables it
xray map --config .xrayrc.json --chunk

# Disable chunking even if config enables it
xray map --config .xrayrc.json --no-chunk
```

## Chunk Metadata

After generation, you'll see a summary:

```
✓ Analysis written to 5 chunk files
ℹ Root chunk: /project/.xray_root.md
ℹ Total chunks: 5

Chunk Summary:
. (2 files, 1024 tokens)
  src (0 files, 256 tokens)
    src/lib (3 files, 2048 tokens)
    src/commands (2 files, 1536 tokens)
```

## Use Cases

### Large Monorepos

For large monorepos, chunking allows you to:
- Stay within token limits for each LLM query
- Navigate specific subsystems easily
- Process only relevant directories

### Modular Analysis

Feed specific chunks to LLM:
```bash
# Generate chunked output
xray map -p .

# Use only the backend chunk with your LLM
cat .xray_src_backend.md | llm "Explain the backend architecture"
```

### Incremental Updates

When code changes in one directory, regenerate only that chunk:
```bash
# Regenerate only src/lib
xray map -p src/lib -o .xray_src_lib
```

## Token Limit Behavior

The renderer stops adding content when approaching the token limit:

1. **Files are ranked** by importance (PageRank + heuristics)
2. **Files are processed** in order of importance
3. **Content is added** until token limit is reached
4. **Remaining files** overflow to maintain the limit

This ensures the most important code appears in each chunk.

## Best Practices

1. **Use depth limits** for very deep directory structures:
   ```bash
   xray map -p . --depth 3
   ```

2. **Adjust token limits** based on your LLM's context window:
   ```bash
   xray map -p . --limit 16384  # For GPT-4
   ```

3. **Organize by feature** using scopes:
   ```json
   {
     "scopes": {
       "auth": { "paths": ["src/auth"], "limit": 4096 },
       "api": { "paths": ["src/api"], "limit": 8192 }
     }
   }
   ```

4. **Use --no-chunk** for small codebases:
   ```bash
   xray map -p small-lib/ --no-chunk
   ```

## Technical Details

### Chunk File Naming

Chunk files follow this pattern:
```
{base}_{sanitized_directory}{extension}
```

Where:
- `base` is the output path without extension (default: `.xray`)
- `sanitized_directory` replaces `/` with `_` (e.g., `src/lib` → `src_lib`)
- `extension` is based on format (default: `.md`)

Examples:
- Root: `.xray_root.md`
- src/: `.xray_src.md`
- src/lib/: `.xray_src_lib.md`

### Relative Paths in Navigation

Navigation links use relative paths:
```markdown
⬆️ **Parent:** [src](../.xray_src.md)
```

This ensures links work regardless of where the files are moved.

## Future Enhancements

Planned improvements:
- [ ] Automatic index generation listing all chunks
- [ ] Smart chunking based on module boundaries
- [ ] Compression for large chunks
- [ ] Interactive web UI for navigation
- [ ] Chunk merging for related directories

## Troubleshooting

### Chunks are too small

Increase the token limit:
```bash
xray map -p . --limit 16384
```

### Too many chunks generated

Reduce depth:
```bash
xray map -p . --depth 2
```

### Missing content in chunks

Some content might be filtered out by ranking. Try increasing the limit or using `--anchor` to focus on specific files.

### Navigation links broken

Ensure you're using relative paths and haven't moved chunk files to different directories.

## See Also

- [Configuration Guide](./configuration.md)
- [Token Limits](./token-limits.md)
- [Navigation Best Practices](./navigation.md)
