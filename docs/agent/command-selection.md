# Command Selection Decision Tree

Use this document to determine which xray command to run for any given scenario. Each section presents a decision point that narrows to a specific command.

## Quick Command Reference

| Command | Best For | Token Cost | Speed |
|---------|----------|-----------|-------|
| `strategy detect` | Identify frameworks | Low (50t) | Fast |
| `explore --match` | Find files by pattern | Low (50-100t) | Fast |
| `map` | Understand structure | Medium (300-500t) | Medium |
| `explore` | Find patterns (React components, routes, etc.) | Low-Med (100-200t) | Fast |
| `graph` | Control/data flow per function (TypeScript, JavaScript, Python, Go) | Grows with function size: roughly 1-2 output lines per source line | Medium |
| `map --with incs` | Understand dependencies | Medium-High (400-600t) | Medium |
| `impact <symbol>` | What breaks if a function changes (transitive callers) | Low-Med (150-750t) | Medium |

## Master Decision Tree

```
WHAT DO YOU WANT TO UNDERSTAND?
│
├─ "What frameworks are in this codebase?"
│   └─ COMMAND: xray strategy detect
│       TOKENS: ~50
│       TIME: ~2s
│
├─ "What files exist matching criteria X?"
│   ├─ "By filename pattern" (*.ts, *.tsx, etc.)
│   │   └─ COMMAND: xray explore --match "*.ts"
│   │       TOKENS: ~50-100
│   │       TIME: ~2s
│   │
│   ├─ "By folder"
│   │   └─ COMMAND: xray explore --path ./src
│   │       TOKENS: ~50-100
│   │       TIME: ~2s
│   │
│   └─ "Excluding certain patterns"
│       └─ COMMAND: xray explore --type ts --match "!*.test.ts"
│           TOKENS: ~50-100
│           TIME: ~2s
│
├─ "How is the codebase structured?"
│   ├─ "High-level overview" (top-level structure)
│   │   └─ COMMAND: xray map --path ./src --depth 1
│   │       TOKENS: ~200-300
│   │       TIME: ~5s
│   │
│   ├─ "Medium-level overview" (2-3 levels deep)
│   │   └─ COMMAND: xray map --path ./src --depth 2
│   │       TOKENS: ~300-500
│   │       TIME: ~8s
│   │
│   ├─ "Complete structure" (all levels)
│   │   └─ COMMAND: xray map
│   │       TOKENS: ~400-800
│   │       TIME: ~10s
│   │
│   └─ "Focus on specific area"
│       └─ COMMAND: xray map --anchor src/specific/file.ts
│           TOKENS: ~300-500
│           TIME: ~8s
│
├─ "Find specific types of code"
│   ├─ "React components"
│   │   ├─ Is this a React app? YES → COMMAND: xray react components
│   │   │   TOKENS: ~100
│   │   │   TIME: ~3s
│   │   └─ Unknown? → COMMAND: xray strategy detect (first)
│   │
│   ├─ "Express routes"
│   │   └─ COMMAND: xray express routes
│   │       TOKENS: ~100
│   │       TIME: ~3s
│   │
│   ├─ "React hooks"
│   │   └─ COMMAND: xray react hooks
│   │       TOKENS: ~100
│   │       TIME: ~3s
│   │
│   ├─ "API endpoints (any framework)"
│   │   └─ COMMAND: xray rest-api endpoints
│   │       TOKENS: ~100
│   │       TIME: ~3s
│   │
│   └─ "Custom patterns"
│       └─ COMMAND: xray explore --match "<pattern>"
│           TOKENS: ~50-100
│           TIME: ~2s
│
├─ "How do dependencies work in this codebase?"
│   ├─ "What does specific file depend on?"
│   │   └─ COMMAND: xray map --anchor src/file.ts --with incs
│   │       TOKENS: ~400-600
│   │       TIME: ~8s
│   │
│   ├─ "What imports are used everywhere?"
│   │   └─ COMMAND: xray map --with incs
│   │       TOKENS: ~400-600
│   │       TIME: ~10s
│   │
│   ├─ "What depends on this file?"
│   │   └─ COMMAND: xray map --anchor src/file.ts --with incs
│   │       (Look at "used by" references)
│   │       TOKENS: ~400-600
│   │       TIME: ~8s
│   │
│   └─ "What calls this function? What breaks if I change it?"
│       └─ COMMAND: xray impact <symbol> --depth 3
│           (--lens <name> for every repo in the workspace)
│           TOKENS: ~150-750
│           TIME: ~3s for ~300 files (graph built in memory)
│
├─ "How does data/control flow through code?" (TypeScript, JavaScript, Python, Go)
│   ├─ "Control flow (if/else, loops, try/finally, switch)"
│   │   └─ COMMAND: xray graph --with cf
│   │       OUTPUT: one CFG per function under it: nodes + labelled edges
│   │       COST: about one line per statement; capped at 500 nodes per function
│   │
│   ├─ "Data flow (which assignment reaches which use)"
│   │   └─ COMMAND: xray graph --with df
│   │       OUTPUT: one line per definition → the nodes reading it
│   │
│   └─ "Both control and data flow"
│       └─ COMMAND: xray graph
│           (cf and df are on by default; --with cf / --with df narrows)
│
├─ "I want ALL the details"
│   └─ COMMAND: xray map --with vars --with incs --with docs
│       TOKENS: ~700-1000
│       TIME: ~15s
│       Note: Maximum information, highest token cost
│
└─ "I'm not sure what I'm looking for"
    └─ START: xray strategy detect
       THEN: xray map --path ./src --depth 1
       THEN: Based on results, use specific command
```

## Specific Use Case Flows

### Use Case: "Understand a New Codebase"

**Scenario:** New project, no prior knowledge

**Recommended Command Sequence:**

```
1. Detect frameworks
   COMMAND: xray strategy detect
   WHY: Know what tech stack you're dealing with
   TOKENS: ~50
   OUTPUT: List of frameworks (React, Express, etc.)

2. Map structure
   COMMAND: xray map --path ./src --depth 2
   WHY: Understand high-level organization
   TOKENS: ~300
   OUTPUT: Directory structure with key files

3. Explore patterns
   FOR EACH detected framework:
     COMMAND: xray react components (or similar)
     WHY: Find key files to understand
     TOKENS: ~100 each
     OUTPUT: List of main components/routes

TOTAL TOKENS: ~450-550
RESULT: You now understand architecture and key areas
```

### Use Case: "Debug a Specific Issue"

**Scenario:** Bug reported in specific feature area

**Recommended Command Sequence:**

```
1. Find related files
   COMMAND: xray explore --match "*<feature-name>*"
   WHY: Narrow down where bug might be
   TOKENS: ~50
   OUTPUT: List of relevant files

2. Map the area
   COMMAND: xray map --anchor <most-likely-file> --with incs
   WHY: Understand this area and its dependencies
   TOKENS: ~400
   OUTPUT: Structure of relevant area, what it imports/exports

3. Find patterns
   COMMAND: xray explore --path <specific-dir> --match "*.ts"
   WHY: Verify all files in that area
   TOKENS: ~50
   OUTPUT: Complete list of files in this area

TOTAL TOKENS: ~500
RESULT: You now know where the bug likely is and its context
```

### Use Case: "Implement a New Feature"

**Scenario:** Need to add new feature, unsure where to start

**Recommended Command Sequence:**

```
1. Detect frameworks (if unknown)
   COMMAND: xray strategy detect
   TOKENS: ~50

2. Find similar features
   COMMAND: xray <strategy> <command>
   WHY: See what similar features exist
   TOKENS: ~100
   OUTPUT: Files with similar patterns

3. Map architecture
   COMMAND: xray map --path ./src --depth 2
   WHY: Understand project structure
   TOKENS: ~300
   OUTPUT: Where to add new code

4. Analyze existing pattern
   COMMAND: xray map --anchor <similar-feature-file> --with incs
   WHY: See how similar feature is implemented
   TOKENS: ~400
   OUTPUT: Pattern to follow, dependencies

TOTAL TOKENS: ~850
RESULT: You know where to add feature and what pattern to follow
```

### Use Case: "Code Review Preparation"

**Scenario:** Need to understand impact of changes before reviewing

**Recommended Command Sequence:**

```
1. Identify changed files
   (User provides or you have from diff)

2. Map changed area
   COMMAND: xray map --anchor <changed-file> --with incs
   WHY: Understand what changed and impact
   TOKENS: ~400
   OUTPUT: Dependencies and related files

3. Find callers of changed functions
   COMMAND: xray impact <changed-function> --depth 2
   WHY: See what breaks if the function's behavior or signature changed
   TOKENS: ~150-400 (at most 5 callers listed per group line)
   OUTPUT: Transitive callers by area, EXTRACTED/INFERRED edge counts

4. Find patterns
   COMMAND: xray <strategy> <command>
   WHY: If framework patterns changed
   TOKENS: ~100
   OUTPUT: How this pattern is used elsewhere

TOTAL TOKENS: ~650-900
RESULT: You understand change impact and can review effectively
```

### Use Case: "What Breaks If I Change X?"

**Scenario:** About to change a function or method's signature, behavior
or name

**Recommended Command Sequence:**

```
1. Callers by area
   COMMAND: xray impact <symbol> --depth 3
   WHY: Every transitive caller once, at its shortest depth
   TOKENS: ~150-750 (at most 5 callers listed per group line)
   OUTPUT: Header, per-group caller lines, EXTRACTED/INFERRED footer

2. Per-caller confidence (if INFERRED > 0)
   COMMAND: xray impact <symbol> --depth 1 --format table
   WHY: Separate confirmed from name-only callers
   TOKENS: ~25 per caller (one row each)

3. Other repos (if the symbol is exported)
   COMMAND: xray impact <symbol> --lens <workspace-lens>
   WHY: Callers in every root of the lens, grouped by root/directory
   TOKENS: ~150-750

4. Call lines / anything impact cannot see
   COMMAND: xray explore --search <symbol>
   WHY: impact shows the caller's definition line; types,
        constructors and constants have no call edges
   TOKENS: ~100-300

TOTAL TOKENS: ~400-1500
RESULT: Change plan listing call sites per package
```

Full protocol: [Impact Analysis workflow](workflows/impact-analysis.md).

### Use Case: "Refactor Code Safely"

**Scenario:** Want to refactor without breaking things

**Recommended Command Sequence:**

```
1. Find all uses
   COMMAND: xray explore --match "<pattern>"
   WHY: Find all files that might be affected
   TOKENS: ~50

2. Map dependencies
   COMMAND: xray map --anchor <file-to-refactor> --with incs
   WHY: See what depends on this file
   TOKENS: ~400
   OUTPUT: All files that import/use this

3. Analyze control and data flow (TypeScript files)
   COMMAND: xray graph --anchor <file-to-refactor>
   WHY: Understand how data flows through this code
   TOKENS: ~600
   OUTPUT: What changes would affect

TOTAL TOKENS: ~1050
RESULT: You know exactly what could break and what to test
```

## Decision Points

### Decision: Scope Selection

**Question:** How much of the codebase do I need to understand?

```
Scope Options:
├─ Very Narrow: Single file or feature
│   COMMAND: xray map --anchor specific-file.ts
│   --depth: 1-2
│
├─ Narrow: One directory/module
│   COMMAND: xray map --path ./src/module
│   --depth: 2-3
│
├─ Medium: Main source directory
│   COMMAND: xray map --path ./src
│   --depth: 2-3
│
├─ Broad: Entire codebase
│   COMMAND: xray map
│   --depth: unspecified
│
└─ Custom: Specific directories/patterns
    COMMAND: xray map --path ./src --path ./lib
```

**Token Cost by Scope:**
- Very Narrow: 150-300 tokens
- Narrow: 250-400 tokens
- Medium: 300-600 tokens
- Broad: 400-1000+ tokens

### Decision: Feature Selection

**Question:** What additional info do I need?

```
Default (no --with flags):
├─ Gives: File/function structure
├─ Tokens: ~300-500
└─ Use when: General understanding needed

--with vars:
├─ Adds: Variable and constant declarations
├─ Tokens: +100
└─ Use when: Need to understand state/constants

--with incs (imports/includes):
├─ Adds: Dependencies and external imports
├─ Tokens: +100
└─ Use when: Need to understand relationships

--with docs:
├─ Adds: Docstrings and comments
├─ Tokens: +100-200
└─ Use when: Need to understand purpose/usage

--with cf (control flow; TypeScript, JavaScript, Python, Go):
├─ Adds: one CFG per function: entry/exit, branches, loops, switch, try/finally
├─ Tokens: about one output line per statement of each function
├─ Other languages: one stderr notice, no graphs (never wrong ones)
└─ Use when: Need to understand logic flow

--with df (data flow; TypeScript, JavaScript, Python, Go):
├─ Adds: one DFG per function: each definition → the nodes that read it
├─ Tokens: about one output line per variable definition
└─ Use when: Need to understand data transformations

Combinations:
├─ --with vars --with incs: Good for understanding structure
├─ --with incs --with docs: Good for understanding usage
├─ --with cf --with df: Good for understanding logic
└─ --with vars --with incs --with docs: Complete picture (high token cost)
```

### Decision: Filtering

**Question:** Do I want to include/exclude specific files?

```
No filtering:
├─ COMMAND: xray map
├─ Includes: All files
├─ Use when: Need complete picture

Include specific patterns:
├─ COMMAND: xray map --match "*.ts" --match "*.tsx"
├─ Includes: Only TypeScript/React files
├─ Use when: Want to exclude non-code files

Exclude specific patterns:
├─ COMMAND: xray map --match "!*.test.ts" --match "!*.spec.ts"
├─ Includes: All except test files
├─ Use when: Want to ignore test code

Combine include/exclude:
├─ COMMAND: xray map --match "*.ts" --match "!*.test.ts"
├─ Includes: TS files but not tests
├─ Use when: Precise control needed
```

### Decision: Output Location

**Question:** Do I want single file or chunked output?

```
Chunked Output (default):
├─ COMMAND: xray map
├─ Result: .xray_root.md, .xray_src.md, .xray_src_lib.md, etc.
├─ Token limit: Per chunk (default 4096)
├─ Use when: Large codebase, want navigable output

Single File Output:
├─ COMMAND: xray map --no-chunk
├─ Result: .xray (single file)
├─ Token limit: Entire output (default 4096)
├─ Use when: Want all in one file, small codebase
```

## Quick Decision Matrix

**For each question, find your scenario and follow the arrow:**

| Question | Scenario | Command |
|----------|----------|---------|
| What frameworks? | Unknown | `strategy detect` |
| What files exist? | Need specific files | `explore --match <pattern>` |
| How organized? | Understanding structure | `map --depth 2` |
| Find components? | React/Vue project | `react components` |
| Find routes? | Express/Next.js/etc | `express routes` |
| What's imported? | Understanding dependencies | `map --with incs` |
| How does data flow? | Analyzing logic | `graph --with df` |
| How does control flow? | Analyzing logic | `graph --with cf` |
| Understand one file? | Focused analysis | `map --anchor file.ts` |
| What breaks if I change X? | Before editing a function | `impact X --depth 3` |
| Everything | Complete analysis | `map --with vars --with incs` |

## Token Budget Planning

**For different tokens available:**

### Budget: 100-200 tokens
```
BEST: Quick discovery
COMMAND: strategy detect + explore --match <pattern>
RESULT: Know frameworks and file list
```

### Budget: 300-500 tokens
```
BEST: Basic understanding
COMMAND: strategy detect + map --depth 1
RESULT: Understand high-level structure
```

### Budget: 500-800 tokens
```
BEST: Good understanding
COMMAND: strategy detect + map --depth 2 + explore
RESULT: Know structure, patterns, key files
```

### Budget: 800-1200 tokens
```
BEST: Comprehensive understanding
COMMAND: strategy detect + map --depth 2 --with incs + explore + followup
RESULT: Know structure, patterns, dependencies, relationships
```

### Budget: 1200+ tokens
```
BEST: Complete analysis
COMMAND: All above + graph commands as needed
RESULT: Full architectural understanding, can analyze flows
```

## Error Recovery in Command Selection

**If your command doesn't work:**

```
ERROR: "Invalid path"
RECOVERY: Check path exists with ls, use absolute path, retry

ERROR: "No files matched"
RECOVERY: Broaden --match pattern, remove --catch filter, retry

ERROR: "Strategy not detected"
RECOVERY: Run strategy detect first, then specify explicitly

ERROR: Output too large
RECOVERY: Use --depth limit, use --match filter, use --no-chunk

ERROR: Takes too long
RECOVERY: Reduce scope (--depth, --path), use --match to filter

ERROR: No such file or directory
RECOVERY: Ensure you're running from correct directory, use absolute paths
```

## Related Documentation

- [Integration Protocol](integration-protocol.md) - When to use xray
- [Output Interpretation](output-interpretation.md) - Understanding results
- [Token Optimization](token-optimization.md) - Managing token budget
- [Workflow Examples](workflows/README.md) - Real scenarios

---

**Key Principle:** Select the minimum command complexity needed to answer your question. Start simple, add features only if needed.
