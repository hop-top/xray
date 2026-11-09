# Token Optimization Guide for Agents

Maximize information gained per token spent. This guide provides strategies and patterns for token-efficient xray usage.

## Core Principle

**Token Efficiency Ratio = Information Gained / Tokens Spent**

Optimize this ratio at every decision point.

## Token Cost Reference

**Command Costs (approximate, for agent calculations):**

| Command | Base Cost | With Options | Notes |
|---------|-----------|--------------|-------|
| `strategy detect` | 50t | 50-70t | Very cheap, always do first |
| `explore --match <pattern>` | 50-100t | 50-150t | Cheap for focused file lists |
| `map --depth 1` | 150-200t | 200-300t | Good for high-level |
| `map --depth 2` | 250-350t | 350-500t | Good balance |
| `map (full)` | 400-800t | 500-1000t | Very expensive |
| `<strategy> <cmd>` | 100-150t | 100-200t | Framework-specific, cheap |
| `graph --with cf` | 400-600t | 500-700t | Control flow analysis |
| `graph --with df` | 400-600t | 500-700t | Data flow analysis |
| `--with incs` | +100-150t | Adds to base | Always include? Maybe |
| `--with vars` | +50-100t | Adds to base | Include for variables |
| `--with docs` | +50-150t | Adds to base | Include for descriptions |

**Total Cost Calculation:**
```
total_tokens = base_command_cost + feature_costs + filtering_costs
```

Example:
```
xray map --depth 2 --with incs
= 250 (map --depth 2) + 100 (incs)
= 350 tokens
```

## Decision Tree: Spend or Save Tokens?

**Before spending tokens, ask:**

```
Do I NEED this information?
├─ NO → Skip, save tokens
├─ YES:
    ├─ Can I get it cheaper a different way?
    │   └─ Yes? → Use cheaper method
    │   └─ No? → Proceed to spend
    │
    ├─ Is this information critical to proceed?
    │   └─ YES → Spend tokens (necessary)
    │   └─ NO → Might skip (optional)
    │
    └─ Do I have token budget remaining?
        └─ YES → Proceed
        └─ NO → Find cheaper alternative or skip
```

## Strategies for Token Efficiency

### Strategy 1: Start Cheap, Add Details Only If Needed

**Cheap First Approach:**

```
Step 1: Cheap discovery (100-150 tokens)
  COMMAND: xray strategy detect + xray explore
  RESULT: Know what exists, frameworks

Step 2: If more needed (200-350 tokens)
  COMMAND: xray map --depth 1 or xray explore
  RESULT: Basic structure or patterns

Step 3: Only if still needed (additional tokens)
  COMMAND: xray map --depth 2 --with incs
  RESULT: Detailed understanding
```

**vs. Expensive First Approach (AVOID):**
```
Immediately run: xray map --with incs --with vars --with docs
COST: 500-700 tokens upfront
PROBLEM: Might be more than needed, wastes tokens
```

### Strategy 2: Narrow Scope to Reduce Tokens

**Technique: Use Filters**

```
EXPENSIVE:
  xray map
  = 400-800 tokens

CHEAPER (equivalent information):
  xray map --path ./src/api --depth 2
  = 200-300 tokens (focuses on relevant area)
```

**Technique: Use Patterns**

```
EXPENSIVE:
  xray map
  = 400-800 tokens

CHEAPER (find relevant files first):
  xray explore --match "*api*"
  = 50 tokens
  THEN:
  xray map --path ./src/api
  = 200-250 tokens
  TOTAL: 250-300 tokens (saves 100-500 tokens)
```

### Strategy 3: Choose Right Command for Question

**Token waste: Using wrong command**

```
Question: "Find all React components"
EXPENSIVE: xray map = 300-500 tokens
CHEAP: xray react components = 100 tokens
SAVINGS: 200-400 tokens

Question: "How do files depend on each other?"
EXPENSIVE: xray graph = 500-700 tokens
CHEAP: xray map --with incs = 350-450 tokens
SAVINGS: 50-250 tokens
```

### Strategy 4: Combine Results Instead of Re-running

**Pattern: Accumulate Knowledge**

```
Turn 1: xray react components
  COST: 100 tokens
  RESULT: Know components exist

Turn 2 (WRONG): xray map --path ./src/components
  COST: 200 tokens
  TOTAL: 300 tokens

Turn 2 (RIGHT): Use Turn 1 results + xray react hooks
  COST: 100 tokens
  TOTAL: 200 tokens
  RESULT: Know both components AND hooks without re-running
```

### Strategy 5: Skip Nice-to-Have Features

**Cost/Benefit Analysis**

```
Feature: --with vars (costs +50-100 tokens)
├─ Do I need to understand variables?
├─ If NO: Skip (save 100 tokens)
├─ If YES but can see from function names? Still skip
├─ If YES and critical to understand? Include

Feature: --with docs (costs +50-150 tokens)
├─ Do I need docstring information?
├─ If NO: Skip (save 150 tokens)
├─ If YES: Check if context already explains it
├─ Include only if truly necessary

Feature: --with incs (costs +100-150 tokens)
├─ Do I need dependency information?
├─ Almost always YES, include this
├─ Exception: if only looking at structure, maybe skip
├─ General rule: Include this, skip others
```

**Token Optimization by Feature Priority:**

```
ALWAYS (high ROI):
  └─ --with incs (understanding relationships is key)

USUALLY (medium ROI):
  └─ --with vars (context on state/constants)

SOMETIMES (lower ROI):
  ├─ --with docs (for complex/unclear functions)
  └─ --with cf/df (only for complex logic)

RARELY (use sparingly):
  └─ Multiple high-cost features combined
```

## Token Budget Planning

**For tasks with token constraints:**

### Small Budget (200-300 tokens)
**Strategy:** Maximum focus, minimal exploration

```
Available: 300 tokens

Allocation:
  - strategy detect: 50 tokens
  - explore --match pattern: 50 tokens
  - <strategy> <command>: 100 tokens
  - Buffer: 100 tokens

Approach: Answer single, focused question only
Result: Know specific thing, limited context
```

### Medium Budget (500-800 tokens)
**Strategy:** Balanced discovery and context

```
Available: 700 tokens

Allocation:
  - strategy detect: 50 tokens
  - map --depth 2: 300 tokens
  - <strategy> <command>: 150 tokens
  - Buffer: 200 tokens

Approach: Understand structure + patterns
Result: Good architectural understanding
```

### Large Budget (1000+ tokens)
**Strategy:** Deep analysis with refinement

```
Available: 1200 tokens

Allocation:
  - Initial discovery: 150 tokens
  - Broad map: 350 tokens
  - Focused exploration: 300 tokens
  - Refinement/followup: 300 tokens
  - Buffer: 100 tokens

Approach: Understand thoroughly, explore details, refine
Result: Deep architectural understanding
```

### Very Small Budget (50-100 tokens)
**Strategy:** Triage only

```
Available: 100 tokens

Allocation:
  - strategy detect: 50 tokens
  - explore: 50 tokens

Approach: Answer: "Does this exist?" or "What frameworks?"
Result: Very limited, directional info only
```

## Common Token Waste Patterns

### Waste Pattern 1: Re-running Same Command

**What happens:**
```
Turn 1: xray map --path ./src
  (300 tokens, results cached)

Turn 2: Forget results, run again
  xray map --path ./src
  (300 tokens, but could have referenced Turn 1)
```

**Solution:** Reference previous results instead of re-running

### Waste Pattern 2: Overlapping Explorations

**What happens:**
```
Turn 1: xray react components
  (100 tokens)

Turn 2: xray map to see same components
  (350 tokens)

WASTE: Used 2 commands to learn similar thing
```

**Solution:** Use explore for patterns, map for structure. Don't overlap.

### Waste Pattern 3: Too Many Filters

**What happens:**
```
xray map --match "*.ts" --match "*.tsx" --match "!*.test.ts" \
  --match "!*.spec.ts" --catch "User*" --catch "!UserTest" \
  --depth 3 --with incs --with vars
```

**Problems:**
- Command becomes complex
- Might miss relevant files due to too-narrow filtering
- Costs more tokens with no clear benefit

**Solution:** Start simple, add filters only if needed

### Waste Pattern 4: Ignoring Chunked Output Navigation

**What happens:**
```
Large codebase produces:
  .xray_root.md
  .xray_src.md
  .xray_src_api.md
  .xray_src_components.md
  (etc., many files)

Agent needs to understand, but:
- Reads all files (expensive)
- Could navigate using links (cheap)
```

**Solution:** Follow navigation links to explore specific areas only

### Waste Pattern 5: Not Using Strategy Results

**What happens:**
```
Turn 1: xray strategy detect
  (50 tokens)
  RESULT: React, Express detected

Turn 2: Ignore result, run generic command
  xray map
  (might not understand React/Express patterns)

Turn 3: Later realize should have used explore
  xray react components
  (100 tokens later than needed)
```

**Solution:** Always use strategy detection results to guide next commands

## Token-Efficient Workflows

### Workflow: Understand Codebase (Efficient)

```
BUDGET: 500 tokens

Step 1: Detect frameworks (50t)
  xray strategy detect

Step 2: High-level map (200t)
  xray map --path ./src --depth 1

Step 3: Find patterns (100t)
  xray <detected-strategy> <command>

Step 4: Understand dependencies (150t)
  xray map --anchor <key-file> --with incs

TOTAL: 500 tokens
RESULT: Complete understanding
```

### Workflow: Find Specific File (Efficient)

```
BUDGET: 150 tokens

Step 1: Search by pattern (50t)
  xray explore --match "*<name-pattern>*"

Step 2: If needed, understand area (100t)
  xray map --path <found-directory> --depth 1

TOTAL: 100-150 tokens
RESULT: Located file and context
```

### Workflow: Implement Feature (Efficient)

```
BUDGET: 800 tokens

Step 1: Detect frameworks (50t)
  xray strategy detect

Step 2: Find similar features (100t)
  xray <strategy> <command>

Step 3: Understand architecture (250t)
  xray map --path ./src --depth 2

Step 4: Study pattern (300t)
  xray map --anchor <similar-feature> --with incs

Step 5: Buffer for refinement (100t)

TOTAL: 800 tokens
RESULT: Ready to implement
```

## Token Awareness Checklist

Before each xray command, ask:

- [ ] Is this command necessary?
- [ ] Is there a cheaper way to get this info?
- [ ] Have I already gathered this info?
- [ ] Can I combine this with previous results?
- [ ] Am I using the right command for this question?
- [ ] Is my scope appropriate (not too broad, not too narrow)?
- [ ] Do I need all the --with flags?
- [ ] Should I use --depth or --match to narrow?
- [ ] Have I tracked my token spend?
- [ ] Do I have budget for this?

## Quick Optimization Wins

**Easy ways to save 50-100 tokens:**

1. Skip `--with docs` unless critical (saves 50-150t)
2. Use `--match` to narrow scope (saves 100-300t)
3. Use `--depth 1` for overview instead of full map (saves 200-300t)
4. Use `explore` instead of `map` for patterns (saves 200-300t)
5. Use `explore --match` to find files, then focused `map` (saves 100-200t)
6. Reference previous results instead of re-running (saves 100%+)
7. Use `--anchor` for focused analysis (saves 100-300t)
8. Skip unnecessary features (saves 50-150t each)

## Token Monitoring

**Track tokens in complex workflows:**

```
Task: Implement authentication system
Budget: 1200 tokens

Turn 1: Understand framework
  Command: strategy detect + map --depth 1
  Cost: 250 tokens
  Remaining: 950 tokens
  Notes: React + Express confirmed

Turn 2: Find similar auth
  Command: explore --match "*auth*"
  Cost: 50 tokens
  Remaining: 900 tokens

Turn 3: Understand pattern
  Command: react hooks
  Cost: 100 tokens
  Remaining: 800 tokens

Turn 4: Map auth area
  Command: map --anchor src/auth.ts --with incs
  Cost: 400 tokens
  Remaining: 400 tokens

Turn 5: Refine understanding if needed
  Cost: 400 tokens (reserve)
```

## When to Abandon Token Conservation

**Sometimes, just spend the tokens:**

- When you're completely stuck (spend to unblock)
- When the task is critical and needs accuracy (spend for thoroughness)
- When you have plenty of budget remaining (spend to get details)
- When time is more important than tokens (spend for speed)
- When previous attempts failed (spend for different approach)

**When NOT to abandon:**
- You have clear path forward (don't spend)
- Information is available with less tokens (don't spend)
- Task is low-priority or exploratory (don't spend)
- You're at budget limit (don't spend)

## Related Documentation

- [Command Selection](command-selection.md) - Choose right commands
- [Integration Protocol](integration-protocol.md) - When to use xray
- [Optimal Usage Patterns](optimal-usage-patterns.md) - Best practices

---

**Key Principle:** Every token should purchase information that moves you toward your goal. Question each command: "Is this the cheapest way to get what I need?"
