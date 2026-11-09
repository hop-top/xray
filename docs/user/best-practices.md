# Best Practices & Patterns

Tips and patterns for getting the most out of xray.

## Token Budget Management

Your AI's context window is precious. Here's how to use it wisely with xray.

### Understanding Token Limits

A rough guide to token usage by file size:

| Code Size | Typical Tokens | xray Limit | Good For |
|-----------|---|---|---|
| 50 lines | 100-150 | 1K-2K | Small functions, quick review |
| 200 lines | 400-600 | 2K-4K | Medium modules, API specs |
| 1000 lines | 2K-3K | 4K-8K | Subsystems, components |
| 5000 lines | 10K-15K | 8K-16K | Large systems, entire APIs |
| 50K+ lines | 100K+ | Use chunked | Full applications |

### Setting Appropriate Limits

**For quick questions**:
```bash
xray map --limit 2000 --depth 2
# Small, focused output. Fast to read, fast for AI to process.
```

**For context**:
```bash
xray map --limit 4000 --with incs
# Medium detail. Includes relationships. Good for "understand this system" requests.
```

**For deep analysis**:
```bash
xray map --limit 8000 --with incs --with vars --with docs
# Comprehensive. Includes details. Good for "help me refactor this" requests.
```

**For very large systems** (use chunked output):
```bash
xray map  # Default: chunked with 4096 tokens per chunk
# Multiple files, easy to navigate. AI can work chunk-by-chunk.
```

### Optimizing Output Size

Want to show more without raising token limit?

```bash
# Reduce depth (fewer directory levels)
xray map --depth 2

# Filter files
xray map --match "*.ts" --match "!*.test.ts"

# Focus on specific area
xray map --path ./src/api

# Use anchor to exclude unrelated code
xray map --anchor src/main.ts
```

### AI Token Budget Calculation

**Claude 3.5 Sonnet** (200K context):
- Reserve 10K for your questions and AI responses
- Available for code context: ~190K tokens
- One full codebase map: Usually 4K-16K tokens
- Remaining tokens: For conversation and AI thinking

**Strategy**: Generate one focused map, have a conversation, generate another map as needed.

---

## Iterative Exploration

Don't try to understand everything at once. Explore iteratively.

### The Exploration Funnel

1. **Broad overview** (2 min): What's the structure?
   ```bash
   xray strategy detect
   xray map --depth 2
   ```

2. **System-level understanding** (3 min): How does this system work?
   ```bash
   xray [express routes | react components | rest-api endpoints]
   ```

3. **Targeted drilling** (5 min): How does feature X work?
   ```bash
   xray map --anchor src/featureX/index.ts --with incs
   ```

4. **Deep dive** (10+ min): What's wrong with this function?
   ```bash
   xray map --anchor src/buggyFunction.ts --with vars --with incs --with docs
   ```

### When to Stop Exploring

You've gone deep enough when you can:
- Draw a diagram of the system
- Explain it to someone else
- Predict what happens when you change X
- Know what tests would catch a bug

If you can't do these, drill deeper.

---

## Caching & Performance

xray uses SQLite caching for speed. Understand how to use it effectively.

### First Run vs Cached Runs

**First run** (new or after `clear-cache`):
- AST parsing: 5-30 seconds
- Dependency analysis: 5-10 seconds
- Total: 10-30 seconds for medium codebases

**Cached runs** (subsequent runs):
- Cache lookup: < 1 second
- Analysis: 1-5 seconds
- Total: 1-5 seconds

**Pro tip**: Run xray once to build cache, then subsequent commands are fast.

### When to Clear Cache

Clear cache when:

```bash
# You've made significant changes
git status  # See many .ts/.js files changed?
xray clear-cache --confirm=yes

# Results seem stale
# (Cache invalidation is automatic based on file mod times, but manual clear helps)
xray clear-cache --confirm=yes

# You suspect cache corruption
# (Very rare, but a full cache rebuild might help)
xray clear-cache --confirm=yes

# You've added new dependencies
# (New frameworks need re-detection)
xray clear-cache --confirm=yes
```

Clear cache before important analysis:
```bash
xray clear-cache --confirm=yes && xray map --anchor src/ImportantFile.ts --with incs
```

### Cache Location

xray stores the parse cache in the user cache dir, never in the project: `<cache-dir>/projects/<project-key>/xray_cache.db` (SQLite database; `cache-db` in `xray paths` prints the exact path). The key is derived from the project root, so two projects with the same name never share an entry. `xray cache clear --confirm=yes` clears the current project's entry. Strategy detection results are cached separately in the user cache dir (`cache-dir` in `xray paths`).

If it gets too large:
```bash
xray cache clear --confirm=yes  # Safe, will regenerate
```

---

## Output Organization

Structure your xray outputs for easy navigation and sharing.

### Directory Structure for Maps

```
docs/
├── codebase-overview.txt     # Main map
├── api-routes.txt             # API analysis
├── components-list.txt        # React components
├── architecture/
│   ├── overview.md
│   ├── api-layer.md
│   └── ui-layer.md
└── .xray*                     # Chunked outputs
```

### Naming Convention

Be descriptive in output names:

```bash
# Good names
xray map -o docs/api-core-services-map.txt
xray react components -o docs/react-components-audit.txt
xray express routes -o docs/api-endpoints-v1.txt

# Ambiguous names (avoid)
xray map -o output.txt
xray express routes -o routes.txt
```

### Including Maps in Documentation

```markdown
# API Documentation

See [complete API map](./api-routes.txt) for full details.

## Main Routes

(Include key excerpt from xray output)

## Authentication Routes

(Include key excerpt focused on auth)
```

### Sharing Maps

**With team members**:
```bash
# Commit to git
xray map --no-chunk --output docs/codebase-map.txt
git add docs/codebase-map.txt
git commit -m "docs: update codebase map"

# Or as attachment
xray map --no-chunk --output team-context.txt
# Share team-context.txt in Slack/email
```

**With AI assistants**:
```bash
# Copy to clipboard and paste into Claude/GPT
xray map --no-chunk
cat .xray.txt | xclip

# Or save and upload
xray map --no-chunk --output claude-context.txt
```

---

## Integration with AI Workflows

Patterns for working with AI assistants.

### Before Asking AI for Help

1. **Generate focused map**:
   ```bash
   xray map --anchor src/problemArea.ts --with incs --with vars --no-chunk
   ```

2. **Copy output to clipboard**:
   ```bash
   cat .xray.txt | xclip  # Linux
   cat .xray.txt | pbcopy  # macOS
   ```

3. **Paste into AI chat**

4. **Ask specific question** (not "help me understand this")

### AI-Friendly Output

Use flags that help AI understand context:

```bash
# For refactoring help
xray map --with incs --with vars --with docs

# For bug hunting
xray map --with incs --with df  # Data flow: which assignment reaches which use (TypeScript, JavaScript, Python, Go)

# For architecture questions
xray map --depth 2 --with incs

# For code review
xray map --with incs  # Show dependencies
```

### Regenerate After Changes

After AI suggests changes:

```bash
# Implement the suggestion
# ... make code changes ...

# Regenerate map to verify
xray clear-cache --confirm=yes
xray map --anchor src/changedFile.ts --with incs

# Share new map with AI
# "I made your suggested changes. Here's the new structure. Does it look right?"
```

---

## Configuration Patterns

Common configuration setups for different team styles.

### Solo Developer Setup

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "limit": 8000,
  "features": {
    "incs": true,
    "vars": true
  }
}
```

Just run: `xray map`

### Team Setup (Multiple Views)

```json
{
  "paths": ["./src"],
  "limit": 8000,
  "features": { "incs": true },
  "scopes": {
    "overview": {
      "output": "docs/overview.txt",
      "limit": 4000,
      "depth": 2
    },
    "api": {
      "paths": ["./src/api"],
      "output": "docs/api-map.txt",
      "catch": ["*Controller", "*Service", "*Handler"]
    },
    "frontend": {
      "paths": ["./src/components"],
      "output": "docs/components-map.txt",
      "match": ["*.tsx", "*.jsx"]
    },
    "detailed": {
      "output": "docs/detailed-analysis.txt",
      "limit": 16000,
      "features": { "incs": true, "vars": true, "docs": true }
    }
  }
}
```

Team members can then run:
```bash
xray map --scope overview      # Quick overview
xray map --scope api           # API documentation
xray map --all-scopes          # Everything
```

### Monorepo Setup

```json
{
  "paths": ["packages/*/src"],
  "output": "docs/monorepo-map.txt",
  "limit": 16000,
  "features": { "incs": true },
  "scopes": {
    "ui": { "paths": ["packages/ui/src"] },
    "api": { "paths": ["packages/api/src"] },
    "sdk": { "paths": ["packages/sdk/src"] }
  }
}
```

---

## Common Patterns by Language

### JavaScript/TypeScript

```bash
# Find all API handlers
xray map --catch "*Handler" --catch "*Controller" --with incs

# Find all custom hooks
xray react hooks

# Find all middleware
xray express middleware

# Find async functions
xray map --catch "*async" --with vars
```

### Python

```bash
# Find all decorators
xray map --with vars

# Find all endpoints
xray rest-api endpoints

# Find all models
xray map --catch "*Model"
```

### Go

```bash
# Find all commands
xray go-cli commands

# Find all endpoints
xray rest-api endpoints

# Find interfaces
xray map --catch "*interface"
```

---

## Performance Tips

Make xray faster for large projects.

### Exclude Unnecessary Directories

```json
{
  "match": [
    "*.ts",
    "*.tsx",
    "!*.test.ts",
    "!*.spec.ts",
    "!*.d.ts",
    "!node_modules/**",
    "!dist/**",
    "!coverage/**"
  ]
}
```

### Use Depth Limits

```bash
# Fast: shallow analysis
xray map --depth 3

# Slow: deep analysis
xray map --depth 10
```

### Focus on Specific Paths

```bash
# Fast: single directory
xray map --path ./src/api

# Slow: all source
xray map --path ./src --path ./lib --path ./packages
```

### Use Anchor for Quick Focus

```bash
# Fast: PageRank from one point
xray map --anchor src/main.ts

# Slow: full PageRank
xray map
```

---

## Troubleshooting Performance

If xray is slow:

```bash
# Check file count
find src -type f -name "*.ts" | wc -l  # > 1000 files = slow

# Reduce scope
xray map --path ./src/api  # Instead of all of src

# Reduce depth
xray map --depth 2  # Instead of unlimited

# Clear old cache
xray clear-cache --confirm=yes

# Check disk space
df -h  # Ensure > 1GB free
```

---

## Regular Maintenance

Keep xray working smoothly.

### Weekly

```bash
# Run after major code changes
xray clear-cache --confirm=yes
xray map
```

### Monthly

```bash
# Update map documentation
xray map --no-chunk -o docs/codebase-map-$(date +%Y-%m).txt

# Check for unused code
xray map --with incs --no-chunk -o map.txt
grep -v "→ used by" map.txt
```

### When Adding Dependencies

```bash
# Refresh strategy detection
xray strategy detect

# Update framework-specific analysis
xray react components  # or express routes, etc.
```

---

## Next Steps

- Learn [Strategies Guide](strategies.md) for framework-specific analysis
- Check [Commands Reference](commands.md) for all options
- See [Troubleshooting](troubleshooting.md) if issues arise

**Remember**: xray is a tool to make you faster and better informed. Experiment with these patterns and find what works for your workflow.
