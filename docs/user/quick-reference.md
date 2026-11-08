# Quick Reference Card

Print this or bookmark it. The 80/20 of xray commands.

## The 10 Most Used Commands

```bash
# 1. Basic map
xray map

# 2. Map with dependencies shown
xray map --with incs

# 3. Map with variables
xray map --with vars

# 4. Focus on one area
xray map --anchor src/api

# 5. Shallow, quick map
xray map --depth 2

# 6. React components
xray react components

# 7. Express routes
xray express routes

# 8. What frameworks?
xray strategy detect

# 9. Clear stale cache
xray clear-cache --confirm=yes

# 10. Help me understand this for AI
xray map --anchor src/main --with incs --with vars --limit 4000
```

---

## Common Flags Explained

| Flag | What It Does | Example |
|------|---|---|
| `--path, -p` | Which directory | `xray map -p ./src` |
| `--anchor, -a` | Focus on one file | `xray map --anchor src/api.ts` |
| `--with` | Add details | `xray map --with incs --with vars` |
| `--limit, -l` | Output size (tokens) | `xray map --limit 8000` |
| `--depth, -d` | Directory levels | `xray map --depth 2` |
| `--match, -m` | Filter files | `xray map --match "*.ts"` |
| `--catch, -c` | Filter functions | `xray map --catch "*Handler"` |
| `--output, -o` | Save file | `xray map -o mymap.txt` |
| `--no-chunk` | Single file output | `xray map --no-chunk` |

---

## Quick Decision Tree

```
Do you want to...

├─ Understand your codebase?
│  └─> xray map
│
├─ See React components?
│  └─> xray react components
│
├─ See Express routes?
│  └─> xray express routes
│
├─ See all frameworks?
│  └─> xray strategy detect
│
├─ Focus on one file?
│  └─> xray map --anchor src/file.ts --with incs
│
├─ Find where something is called? / What breaks if I change it?
│  └─> xray impact functionName
│
├─ Share with AI?
│  └─> xray map --anchor src/main --with incs --limit 4000 --no-chunk
│      cat .xray.txt | xclip
│
├─ Understand just one subsystem?
│  └─> xray map --path ./src/api --depth 2
│
├─ Include dependencies and variables?
│  └─> xray map --with incs --with vars
│
└─ Fix stale results?
   └─> xray clear-cache --confirm=yes && xray map
```

---

## Feature Flags (`--with`)

| Feature | When to Use |
|---------|---|
| `incs` | Show imports/dependencies (almost always useful) |
| `vars` | Show variables/constants (good for refactoring) |
| `docs` | Show docstrings (good for understanding intent) |
| `cost` | Estimate AI cost (need `OPENAI_API_KEY`) |
| `cf` | Control flow graph (for understanding logic) |
| `df` | Data flow graph (for debugging) |

**Most common**: `--with incs --with vars`

---

## Output Sizes (Tokens)

| Limit | Best For | Example |
|-------|----------|---------|
| 1000-2000 | Quick overview | `--limit 1500` |
| 3000-4000 | Standard use | `--limit 4000` (default) |
| 6000-8000 | Detailed analysis | `--limit 8000` |
| 10000-16000 | Comprehensive | `--limit 16000` |
| Chunked | Large codebases | (default for `xray map`) |

**Pro tip**: Start with 4000, adjust based on what you need.

---

## Strategy Commands (Framework-Specific)

### React
```bash
xray react components    # All components
xray react hooks         # All custom hooks
xray react contexts      # All contexts
```

### Express
```bash
xray express routes      # All routes
xray express middleware  # All middleware
xray express routers     # All routers
xray express error-handlers  # Error handling
```

### REST API (Node/Python/Go)
```bash
xray rest-api endpoints  # All endpoints
xray rest-api methods    # Group by HTTP method
xray rest-api middleware # All middleware
```

### Go CLI
```bash
xray go-cli commands     # Command tree with flags
```

---

## Copy-Paste Templates

### "Give me an overview"
```bash
xray map
```

### "Show me the structure"
```bash
xray map --depth 2
```

### "Show me dependencies"
```bash
xray map --with incs
```

### "Let me focus on API"
```bash
xray map --path ./src/api --with incs
```

### "Help me understand this file"
```bash
xray map --anchor src/yourfile.ts --with incs --with vars
```

### "I need this for Claude"
```bash
xray map --anchor src/main.ts --with incs --with vars --limit 4000 --no-chunk
cat .xray.txt | xclip
```

### "Show me just React components"
```bash
xray react components
```

### "Show me just API routes"
```bash
xray express routes
```

### "What's in this project?"
```bash
xray strategy detect
```

### "What breaks if I change this function?"
```bash
xray impact createSession               # transitive callers, 3 levels, by area
xray impact createSession --strict      # scope-resolved (EXTRACTED) callers only
```

### "Fix stale results"
```bash
xray clear-cache --confirm=yes && xray map
```

---

## Useful Pipes (Unix Tricks)

```bash
# Find specific functions
xray map --no-chunk && grep "function" .xray.txt

# Find imports of a library
xray map --with incs --no-chunk && grep axios .xray.txt

# Count components
xray react components | wc -l

# Find error handlers
xray map --catch "*Error" --no-chunk && head -20 .xray.txt

# Find who calls a function
xray impact myFunction --depth 1

# Save output and share
xray map --no-chunk --output my-map.txt
cat my-map.txt | xclip
```

---

## Configuration Shortcut

Instead of typing long commands, create `.xrayrc.json`:

```json
{
  "paths": ["./src"],
  "limit": 8000,
  "features": { "incs": true, "vars": true }
}
```

Then just: `xray map`

See [Configuration Guide](configuration.md) for more.

---

## Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| Stale results | `xray clear-cache --confirm=yes` |
| Command not found | `npx @hop-top/xray` instead of `xray` |
| Installation failed | `CXXFLAGS="-std=c++20" npm install` |
| No output | `xray map -p ./src` (specify path) |
| Too much output | `xray map --limit 2000` (reduce limit) |
| Too little output | `xray map --limit 16000` (increase limit) |
| Want single file | `xray map --no-chunk` |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required for `--with cost` |
| `PATH` | Make sure npm's global bin is here |

---

## File Naming

Default output files:
- `.xray_root.md` - Root level
- `.xray_src.md` - src/ directory
- `.xray_src_lib.md` - src/lib/ directory
- etc.

Single file (`--no-chunk`): `.xray.txt`; `--format json|xml` write `.xray.json` / `.xray.xml`.

Custom naming:
```bash
xray map -o mymap.txt  # Creates mymap_root.txt, mymap_src.txt, etc.
```

---

## Remember

1. **Start simple**: `xray map` first
2. **Add features as needed**: `--with incs`, then `--with vars`
3. **Focus when needed**: `--anchor` and `--depth`
4. **Cache helps**: Second runs are fast
5. **Strategies show frameworks**: `xray strategy detect`

---

## Most Useful Resources

- [Getting Started](getting-started.md) - Installation & first steps
- [Workflows](workflows.md) - Real-world scenarios
- [Cookbook](cookbook.md) - Copy-paste ready solutions
- [Best Practices](best-practices.md) - Tips and patterns
- [Troubleshooting](troubleshooting.md) - Fix problems

---

**Print this page or bookmark it. These 50 commands cover 95% of daily xray usage.**
