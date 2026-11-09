# Optimal Usage Patterns for Agent xray Integration

Best practices and patterns for maximizing xray effectiveness in agent workflows.

## Core Patterns

### Pattern 1: Progressive Disclosure

Start simple, add detail only if needed.

```
LEVEL 1 (Discovery): Very cheap, high signal-to-noise
Command: xray strategy detect
Tokens: 50
Info: Frameworks, basic structure
Next: Based on result, use more specific command

LEVEL 2 (Structure): Medium cost, essential info
Command: xray map --depth 1-2
Tokens: 200-300
Info: Directory organization, main files
Next: Based on structure, drill down specific areas

LEVEL 3 (Patterns): Low-medium cost, pattern info
Command: xray <strategy> <command>
Tokens: 100-150
Info: Components, routes, hooks, etc.
Next: Based on patterns, study specific implementation

LEVEL 4 (Deep): Higher cost, detailed info
Command: xray map --anchor <file> --with incs
Tokens: 300-500
Info: Dependencies, relationships, data flow
Next: Ready to implement or debug
```

**When to use each level:**

```
If answering "What frameworks?"          → LEVEL 1
If answering "How is it organized?"      → LEVEL 2
If answering "What patterns exist?"      → LEVEL 3
If answering "How does this work?"       → LEVEL 4
If implementing/debugging                → LEVEL 2-4
If time-constrained                      → LEVEL 1-2
If token-constrained                     → LEVEL 1-3
```

### Pattern 2: Hypothesis-Driven Analysis

Start with hypothesis, use xray to validate.

```
HYPOTHESIS: "This uses React hooks for state"
VALIDATION: xray react hooks
RESULT: Found 8 custom hooks, validate hypothesis
ACTION: Can now explain React pattern to user

vs.

NO HYPOTHESIS: "Let me explore the codebase"
EXPLORATION: xray map (too broad, 500+ tokens)
RESULT: Understand structure but no specific hypothesis
ACTION: Still need to formulate hypothesis
```

**How to form hypothesis:**

```
From user's question:
├─ User mentions "React components"
│  → Hypothesis: Uses React components for UI
├─ User mentions "API endpoints"
│  → Hypothesis: Has REST API
├─ User mentions "authentication"
│  → Hypothesis: Has auth service/middleware
└─ User is vague
   → Run `strategy detect` to form hypothesis
```

### Pattern 3: Accumulation Over Re-discovery

Build understanding across turns instead of re-analyzing.

```
TURN 1: "Help me understand React"
→ xray react components (100 tokens)
← Learn: 12 components, structure

TURN 2: "Show me how auth works"
WRONG: xray map (waste 300 tokens re-analyzing)
RIGHT: Based on Turn 1, ask for specific file
TOKENS SAVED: 300 tokens

ACCUMULATION: Each turn adds understanding
Turn 1: Know components exist
Turn 2: Know how one works
Turn 3: Can infer patterns
```

**Key: Reference previous findings:**

```
Previous finding: "React components in src/components/ use hooks"

When user asks: "How should I add a new component?"
DON'T: Run xray explore again
DO: "Based on what I found earlier, follow this pattern..."
RESULT: Use existing knowledge, save tokens
```

### Pattern 4: Scope Narrowing

Start broad, narrow to relevant areas.

```
BROAD ANALYSIS (waste):
→ xray map (analyzes entire src/)
Cost: 400 tokens
Result: Mostly irrelevant info

NARROW ANALYSIS (efficient):
→ xray explore --match "*auth*" (find relevant files)
Cost: 50 tokens
→ xray map --path ./src/auth
Cost: 200 tokens
Result: Only relevant info, saved 150 tokens
```

**Narrowing techniques:**

```
By path:       xray map --path ./src/api
By pattern:    xray map --match "*.service.ts"
By framework:  xray <strategy> <command>
By anchor:     xray map --anchor <key-file>
By depth:      xray map --depth 1-2
Combination:   xray map --path ./src --depth 1 --match "*.ts"
```

### Pattern 5: Pre-work, Then Code

Complete all analysis before writing implementation code.

```
POOR PATTERN:
├─ Start writing code
├─ Realize need to understand structure
├─ Run xray (interrupts flow)
├─ Modify code based on findings
└─ Result: Inefficient, multiple changes

GOOD PATTERN:
├─ Run all xray analysis first
├─ Understand patterns completely
├─ Plan implementation based on findings
├─ Write code once, matching patterns exactly
├─ Result: Efficient, matches patterns first time
```

**Analysis checklist before coding:**

```
Before writing implementation code, verify:
- [ ] Understand frameworks in use
- [ ] Know where to put new code
- [ ] Know patterns to follow
- [ ] Know dependencies needed
- [ ] Know integration points
- [ ] Know how tests are structured
```

## Efficiency Patterns

### Pattern: Caching xray Results

Assume xray cache is working for repeated queries.

```
Turn 1: xray map --path ./src
→ Cache stores result

Turn 2: xray map --path ./src (same query)
→ Cache returns result (fast)

Turn 3: User modifies files
→ xray cache auto-invalidates

Turn 4: xray map --path ./src (after modification)
→ Cache regenerates with new data
```

**Don't need to:**
- Manually clear cache (does it automatically)
- Worry about stale data (invalidates on file changes)
- Run same command twice (cache speeds up)

**Only clear cache if:**
- Troubleshooting stale results
- Files changed outside of current context
- Seeing inconsistent results

### Pattern: Selective Feature Inclusion

Only use --with flags when necessary.

```
EXPENSIVE (500+ tokens):
xray map --with vars --with incs --with docs --with cf

CHEAP (300 tokens):
xray map --with incs (only what's needed)

DIFFERENCE: 200+ tokens saved
```

**Feature priority:**

```
ALWAYS include (high ROI):
  --with incs  (dependencies are almost always needed)

OFTEN include (medium ROI):
  --with vars  (context on state/constants)

SOMETIMES include (lower ROI):
  --with docs  (only if undocumented/unclear)
  --with cf    (only for complex logic)
  --with df    (only for complex logic)
```

### Pattern: Command Sequencing

Order commands to maximize early learning.

```
EFFICIENT SEQUENCE:
1. xray strategy detect           (learn frameworks)
2. xray explore --match "*pattern*"  (narrow scope)
3. xray <strategy> <command>      (find patterns)
4. xray map on narrow area        (deep dive)

vs.

INEFFICIENT SEQUENCE:
1. xray map (entire codebase)     (too much data)
2. xray strategy detect           (could have done first)
3. xray map again (focused)       (wasted first command)
```

**Optimal ordering:**

```
For discovery:      detect → explore --match → explore
For understanding:  detect → map --depth 1 → map deeper
For implementation: detect → explore → map --anchor → explore --match
For debugging:      explore --match → map --anchor → graph
```

## Integration Patterns

### Pattern: Proactive xray Invocation

Agent recognizes need for xray without user asking.

```
USER: "I need to add authentication"

AGENT THINKS:
"User wants to add auth. I don't know this codebase.
Should I ask user or use xray?
→ Use xray to understand first, then guide user"

AGENT ACTS:
"Let me understand your codebase structure first.
I'm analyzing to find existing auth patterns..."

[Run xray automatically]

AGENT EXPLAINS:
"I found Express + React app with existing auth service.
To add auth, I would..."
```

**Conditions for proactive invocation:**

```
IF user asks to work on code AND
  codebase is unfamiliar AND
  question would benefit from structure understanding AND
  token budget available
THEN: Proactively run xray
```

### Pattern: Clarifying Questions Based on xray

Use xray findings to ask smarter questions.

```
WITHOUT xray:
USER: "Add a feature"
AGENT: "What kind of feature?" (generic)

WITH xray:
USER: "Add a feature"
AGENT runs: xray strategy detect
AGENT: "I found React + Express.
        Do you want a React component (UI) or Express endpoint (API)?"
(Much smarter questions)
```

### Pattern: Fallback When xray Unavailable

Have non-xray strategy for when xray fails.

```
PRIMARY: Use xray
→ Provides codebase-wide understanding
→ Answers architectural questions

FALLBACK: Use file reads
→ Ask user to show key files
→ Read file-by-file
→ Slower but works

EXTREME FALLBACK: Ask user directly
→ "Can you explain how your codebase is organized?"
→ "Show me an example of how you implement [pattern]"
→ Manual codebase understanding
```

## Validation Patterns

### Pattern: Success Validation

Verify xray understanding is useful.

```
After xray analysis, verify:

Can I describe architecture?
├─ YES: Good, proceed
└─ NO: Need more xray analysis

Did I find what I was looking for?
├─ YES: Good, proceed
└─ NO: Refine xray command

Do results make sense?
├─ YES: Good, proceed
└─ NO: Validate with file reads

Can I move forward?
├─ YES: Good, proceed
└─ NO: More analysis needed
```

### Pattern: Pattern Validation

Verify discovered patterns before using them.

```
FOUND PATTERN: All React components use custom hooks

VALIDATE:
→ xray react hooks (check)
→ Look at 2-3 components (verify)
→ Ask: Does this pattern hold?

PROCEED: Only if pattern confirmed in multiple places
```

## Mistake Prevention

### Avoid: Assuming Complete Analysis

```
WRONG: "xray found 12 components, so there are exactly 12"
RIGHT: "xray found 12 components (might be more, analyzed subset)"

SOLUTION: Acknowledge pruning/token limits in your explanation
```

### Avoid: Ignoring Errors

```
WRONG: xray fails silently, continue assuming success
RIGHT: Always check if xray command succeeded

SOLUTION: Parse output for error indicators
```

### Avoid: Over-analyzing

```
WRONG: Run xray 5 different ways to understand one thing
RIGHT: Run minimal necessary xray, interpret thoroughly

SOLUTION: See Progressive Disclosure pattern
```

### Avoid: Conflicting with User

```
WRONG: "xray says the pattern is X, but you're doing Y"
RIGHT: "xray shows most code uses pattern X,
        but your approach Y is different. Let me explain both."

SOLUTION: Present findings as information, not contradiction
```

## Workflow Patterns

### Pattern: Feature Implementation Workflow

```
PHASE 1: Discovery (100-150 tokens)
  xray strategy detect
  xray explore --match "*similar-feature*"

PHASE 2: Understanding (200-300 tokens)
  xray <strategy> <command>
  xray map on relevant area

PHASE 3: Pattern Study (300-400 tokens)
  xray map --anchor <similar-file> --with incs

PHASE 4: Implementation (0 tokens)
  Code based on discovered patterns

TOTAL: 600-850 tokens
Result: High-quality implementation matching patterns
```

### Pattern: Debugging Workflow

```
PHASE 1: Locating (50 tokens)
  xray explore --match "*bug-related*"

PHASE 2: Understanding Context (200-300 tokens)
  xray map --anchor <suspected-file> --with incs

PHASE 3: Deep Analysis (300-400 tokens)
  xray graph on that area
  Read specific files

PHASE 4: Debugging (0 tokens)
  Use understanding to debug

TOTAL: 550-750 tokens
Result: Informed debugging with full context
```

### Pattern: Code Review Workflow

```
PHASE 1: Context (200 tokens)
  xray map for changed areas

PHASE 2: Pattern Checking (100 tokens)
  xray explore to see if patterns match

PHASE 3: Analysis (0 tokens)
  Use findings to review code

TOTAL: 300 tokens
Result: Informed code review
```

## Quick Reference: Best Practices

**DO:**
- [ ] Start with `strategy detect`
- [ ] Use progressive disclosure (simple to complex)
- [ ] Accumulate knowledge (build on previous runs)
- [ ] Narrow scope (avoid huge analyses)
- [ ] Validate findings (verify patterns)
- [ ] Reference xray in recommendations
- [ ] Plan before coding
- [ ] Fallback gracefully

**DON'T:**
- [ ] Re-run same command unnecessarily
- [ ] Use xray for single-file analysis
- [ ] Ignore errors (handle gracefully)
- [ ] Over-specify filters
- [ ] Assume complete understanding from xray
- [ ] Assume all patterns are consistent
- [ ] Skip validation of findings
- [ ] Proceed without understanding patterns

## Related Documentation

- [Command Selection](command-selection.md) - Choose right commands
- [Token Optimization](token-optimization.md) - Manage budget
- [Integration Protocol](integration-protocol.md) - When to use xray
- [Workflows](workflows/README.md) - Step-by-step guides

---

**Key Principle:** Every xray invocation should move you toward your goal with maximum efficiency. Progressive disclosure, hypothesis-driven analysis, and accumulation of knowledge are the cornerstones of optimal xray usage.
