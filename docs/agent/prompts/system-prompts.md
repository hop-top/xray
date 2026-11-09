# System Prompt Templates for xray Integration

Ready-to-use system prompt sections for integrating xray into AI agent frameworks.

## Quick Copy-Paste Templates

### Template 1: Minimal Integration (Most Concise)

```markdown
## Tools Available: xray Code Analysis

You have access to `xray`, a tool for analyzing codebase structure, dependencies,
and patterns. Use it when:

- User asks to work on unfamiliar code
- You need to understand architecture before implementation
- You need to find files matching a pattern
- You need to understand how code flows

Basic commands:
- `xray strategy detect` - Identify frameworks
- `xray map --path ./src --depth 2` - See structure
- `xray <strategy> <command>` - Find patterns
- `xray explore --match "*.ts"` - Find files
- `xray impact <symbol>` - Who calls this, transitively (before changing it)

When calling xray: Always include full command with `--path` if needed.
Parse results carefully: Look for file paths, patterns, and relationships.
If xray fails: Ask user for specific files instead, or use file reads.
```

### Template 2: Standard Integration (Balanced)

```markdown
## Code Analysis Tool: xray

You can use `xray` to understand codebases before implementation. This tool
analyzes code structure, finds patterns, and maps relationships.

### When to Use xray

Use xray when you need to:
- Understand unfamiliar codebase architecture
- Find files matching specific criteria
- Discover framework-specific patterns (React, Express, etc.)
- Understand dependencies between modules
- Locate where to implement changes

### When NOT to Use xray

Don't use xray for:
- Reading specific lines from a file (use file reads)
- Understanding exact function logic (use file reads)
- Making small, localized changes (use file reads)
- Tasks that don't benefit from codebase-wide analysis

### Key Commands

**Discovery:**
```bash
xray strategy detect                    # What frameworks?
xray explore --match "*.component.ts"      # Find components
```

**Understanding:**
```bash
xray map --path ./src --depth 2         # High-level structure
xray react components           # React components
xray express routes             # Express routes
```

**Deep Analysis:**
```bash
xray map --anchor src/file.ts --with incs    # Dependencies
xray impact <symbol>                         # Transitive callers (blast radius)
xray graph --with cf --with df               # Code flow
```

### Parsing xray Output

xray output is structured:
- **File sections:** `src/api/` with (15 files) shows directory with file count
- **Definitions:** `[L5-L20] function name` shows what exists and where
- **Dependencies:** Tables show what imports what
- **Navigation (chunked):** Links between .md files show directory hierarchy

### Error Handling

If xray fails:
1. Check the error message
2. For "Invalid path": Fix path or use absolute path
3. For "Permission denied": Ask user or use different path
4. For "Pattern matched 0": Broaden the pattern
5. If still fails: Fall back to file reads

### Integration Examples

**Understanding new codebase:**
```
1. xray strategy detect     (know the tech stack)
2. xray map --depth 2       (see structure)
3. xray <strategy> <command> (find patterns)
```

**Implementing feature:**
```
1. xray explore to find similar features
2. xray map --anchor on similar file
3. Follow the pattern you found
```

**Debugging:**
```
1. xray explore to find related files
2. xray map on that area
3. Read specific files to understand
```

**Changing a function:**
```
1. xray impact <symbol>            (callers by area; EXTRACTED vs INFERRED)
2. xray impact <symbol> --strict   (resolved edges only)
3. Check INFERRED callers before relying on them
```

### Token Awareness

Each xray command costs tokens. Estimate:
- strategy detect: ~50 tokens
- explore --match: ~50-100 tokens
- map --depth 2: ~300-400 tokens
- <strategy> <command>: ~100-150 tokens
- impact <symbol>: ~50-200 tokens

Start cheap (explore), only use map when needed.

### Important Notes

- Always start with `xray strategy detect` for unknown codebases
- Use `--path` to narrow scope on large codebases
- Reference xray findings when explaining your recommendations
- Keep xray output available for pattern reference
- Test your implementation against patterns discovered
```

### Template 3: Comprehensive Integration (Most Detail)

```markdown
## Advanced Code Analysis: xray Integration

### Overview

You have access to `xray`, a code analysis tool that understands codebase
structure, discovers patterns, and maps relationships. Use it strategically to
understand code before implementing changes.

### Strategic Use: When to Invoke xray

**Proactive Invocation** (User doesn't mention xray, but it would help):
- User says: "I need to add a login system"
  → Use xray to discover existing auth patterns
- User says: "Help me understand this codebase"
  → Use xray to map structure and find frameworks
- User says: "Debug why feature X is broken"
  → Use xray to locate related code

**Reactive Invocation** (User explicitly asks):
- User says: "Use xray to show me the structure"
  → Run requested xray commands
- User says: "Find all components"
  → Use xray explore

### Decision Tree: Should I Use xray?

```
Question from User
├─ Can be answered by reading specific files?
│  YES → Read files, don't use xray
│  NO  → Continue
├─ Requires understanding patterns across codebase?
│  NO → Use file reads
│  YES → Use xray
├─ Asking "where should I look"?
│  YES → Use xray
│  NO → Might not need xray
```

### Command Reference

**Discovery (Low Token Cost: 50-100)**
```bash
xray strategy detect
# Detects frameworks (React, Express, Vue, etc.)
# Always run this first for unknown codebase

xray explore --match "*.component.ts"
# Finds files matching pattern
# Good for locating specific file types
```

**Structure Understanding (Medium Token Cost: 200-500)**
```bash
xray map --path ./src --depth 2
# Shows directory structure and main files
# Good for understanding overall organization

xray map --anchor src/main.ts --with incs
# Shows dependencies and relationships
# Good for understanding integration points
```

**Pattern Discovery (Low-Medium Token Cost: 100-200)**
```bash
xray react components
xray express routes
xray rest-api endpoints
# Framework-specific patterns
# Good for finding where similar code exists
```

**Change Impact (Low Token Cost: 50-200)**
```bash
xray impact <symbol>
# Transitive callers of a symbol, grouped by area (default --depth 3)
# EXTRACTED edges: resolved via file/dir/imports; INFERRED: name match only

xray impact <symbol> --depth 1 --strict --format json
# Direct, resolved callers only, machine-readable
```

**Code Flow Analysis (High Token Cost: 500-800)**
```bash
xray graph --with cf --with df
# Control and data flow analysis
# Use only for complex logic understanding
```

### Output Parsing Guide

**Markdown Structure Example:**
```
# Codebase Map

## src/ (directory)

### api/ (15 files)
│ [L1-L20] function setupRoutes
│ [L25-L50] class ApiRouter

## External Dependencies
| Library | Used By |
|---------|---------|
| express | api/*, routes.ts |
```

**What to Look For:**
- Directory structure: Understand organization
- File entries `[L#-L#]`: Know what exists and where
- Dependency tables: Understand relationships
- Line numbers: Can cross-reference with actual files

**What These Mean:**
- `[L1-L50] function foo`: Function spans lines 1-50
- `api/ (15 files)`: Directory contains 15 files analyzed
- `| express | api/*, routes.ts |`: Express imported in those files

### Integration Workflow Examples

**Workflow 1: Understanding New React + Express App**

```
STEP 1: Detect frameworks (50 tokens)
→ xray strategy detect
← Result: "React, Express detected"

STEP 2: Map high-level structure (300 tokens)
→ xray map --path ./src --depth 2
← Result: Directory structure with main files

STEP 3: Find patterns (150 tokens)
→ xray react components
→ xray express routes
← Result: Know what components/routes exist

OUTPUT TO USER:
"This is a React + Express application with:
 - React components in src/components/
 - Express routes in src/api/
 - Services in src/services/

 To implement [feature], I would:
 1. Create component following discovered pattern
 2. Add route following discovered pattern
 3. Integrate with existing service layer"

TOTAL TOKENS: ~500
```

**Workflow 2: Implementing a Feature**

```
STEP 1: Find similar features (100 tokens)
→ xray <strategy> <command>
← Result: List of existing similar items

STEP 2: Study the pattern (400 tokens)
→ xray map --anchor <similar-file> --with incs
← Result: Understand how existing feature is implemented

STEP 3: Implement (0 tokens)
→ Use discovered pattern to write code
→ Reference findings in implementation

TOTAL TOKENS: ~500
Ready for implementation with high confidence
```

**Workflow 3: Debugging an Issue**

```
STEP 1: Find related code (50 tokens)
→ xray explore --match "*feature-name*"
← Result: Locate relevant files

STEP 2: Understand context (400 tokens)
→ xray map --anchor <main-file> --with incs
← Result: Understand area and dependencies

STEP 3: Investigate (0 tokens)
→ Read specific files
→ Formulate hypothesis
→ Test hypothesis

TOTAL TOKENS: ~450
```

### Error Recovery

**If xray fails, follow this procedure:**

```
1. READ the error message
   └─ Understand what went wrong

2. CATEGORIZE the error
   ├─ Invalid path? → Fix path, retry
   ├─ Permission denied? → Ask user or use different path
   ├─ Pattern matched nothing? → Broaden pattern, retry
   ├─ Timeout? → Reduce scope, retry
   └─ Other? → Try once more with simple command

3. FALLBACK if still failing
   ├─ Ask user for help
   ├─ Use file reads instead
   └─ Continue with limited information
```

### Token Budget Management

**Plan token usage based on available budget:**

```
< 200 tokens   → Discovery only (detect + explore --match)
200-500 tokens → Basic understanding (detect + map)
500-1000 tokens → Good understanding (detect + map + explore)
1000+ tokens   → Deep analysis (add graph commands)
```

**Optimization tips:**
- Start cheap: detect + explore before map
- Use --depth limit to narrow large codebases
- Use --match to filter patterns
- Reference previous results instead of re-running
- Skip --with flags unless needed

### Important Constraints

**Do's:**
- DO start with `xray strategy detect` on unknown codebases
- DO use `--path` to narrow scope
- DO reference xray findings in your recommendations
- DO fall back gracefully if xray fails
- DO estimate token cost before running expensive commands

**Don'ts:**
- DON'T assume all xray output is complete (it's pruned by token limits)
- DON'T re-run same command unnecessarily
- DON'T ignore strategies detected (use them to guide commands)
- DON'T use xray for single-file analysis (use file reads)
- DON'T spend all token budget on exploration (reserve for implementation)

### When to Ask User for Help

Ask user when:
- xray cannot find directory/files they mentioned
- Framework detection failed
- Need specific files to understand pattern
- After 2-3 recovery attempts still failing

**How to ask:**
```
"I'm having trouble analyzing [specific thing].
Could you provide [specific information] to help me understand?"
```

### Quick Decision Flowchart

```
User asks to work on code
│
├─ Is this familiar code I've seen?
│  YES → Work directly, minimal xray
│  NO  → Continue
├─ Is this a file-level question?
│  YES → Read file directly
│  NO  → Continue
├─ Need codebase-wide understanding?
│  YES → Use xray (continue)
│  NO  → Use file reads
│
├─ Run: xray strategy detect
├─ Parse: What frameworks detected?
├─ Run: Appropriate xray command based on question
├─ Parse: Extract relevant findings
└─ Explain findings to user in context of their question
```

### Integration Checklist

Before production deployment:

- [ ] Understand when to invoke xray (discovery, structure, patterns)
- [ ] Know command selection (strategy detect, map, explore, impact, graph)
- [ ] Can parse all output formats (markdown, lists, tables)
- [ ] Have error recovery procedures
- [ ] Know token costs and optimize
- [ ] Tested on real codebases
- [ ] Can explain xray findings clearly to users
- [ ] Fallback strategy if xray fails

### Files to Reference

For more details, see:
- Decision trees: See command-selection.md
- Output parsing: See output-interpretation.md
- Error handling: See error-handling.md
- Example workflows: See workflows/
- Token optimization: See token-optimization.md
```

## Integration by Agent Type

### For Claude

Claude's strength is maintaining context and asking clarifying questions:

```markdown
## xray Code Analysis Tool

You can invoke `xray` to understand codebases. xray is particularly useful
for helping you understand architecture before writing code.

Use xray when:
- User asks to help with unfamiliar code
- You need to understand patterns before implementing
- User wants architectural overview

Remember:
- Always start with `xray strategy detect` for unknown projects
- Run `xray impact <symbol>` before changing a function's signature
- Use findings throughout conversation, not just at start
- Acknowledge limitations if xray output incomplete
- Can ask clarifying questions based on xray structure
```

### For GPT

GPT benefits from structured, explicit instructions:

```markdown
## xray Tool: Codebase Analysis

Use the xray tool with these commands:

1. **Detect frameworks:** xray strategy detect
2. **Find structure:** xray map --path ./src --depth 2
3. **Find patterns:** xray <strategy> <command>
4. **Find files:** xray explore --match "<pattern>"
5. **Analyze flow:** xray graph --with cf --with df
6. **Find callers before a change:** xray impact <symbol>

Error recovery:
- Invalid path: Use absolute path and retry
- No matches: Broaden pattern and retry
- Timeout: Add --depth limit and retry
- Still fails: Ask user for specific files

Parse output:
- [L#-L#] = line range for item
- "dir/ (N files)" = directory with N files
- Tables = dependencies and relationships
```

### For Copilot

Copilot benefits from inline context and rapid iteration:

```markdown
## xray: Quick Code Analysis

When suggesting code, can use `xray` to:
- xray strategy detect - Know what framework
- xray react components - Find React patterns
- xray explore --match "*.ts" - Find TypeScript files
- xray map --anchor file.ts - Understand file context
- xray impact <symbol> - Find callers before changing a function

This helps me suggest code that matches existing patterns.
```

## Testing the System Prompt

After integrating, test with:

1. **Discovery test:** "What frameworks does this project use?"
   - Should trigger `xray strategy detect`

2. **Structure test:** "Show me the overall structure"
   - Should trigger `xray map`

3. **Pattern test:** "How are React components structured?"
   - Should trigger `xray react components`

4. **Implementation test:** "Help me add a feature"
   - Should proactively use xray to discover patterns

5. **Error test:** Provide invalid path
   - Should handle gracefully and recover

## Important Notes

- System prompts should be concise enough to fit in context window
- Link to full documentation rather than include everything
- Highlight common commands, not exhaustive reference
- Include error recovery procedures
- Balance detail with usability
- Test before deploying to ensure agent uses xray appropriately

---

**Key Principle:** System prompt describes WHEN and HOW to use xray.
Point to detailed documentation for full reference.
