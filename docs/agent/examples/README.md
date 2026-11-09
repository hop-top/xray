# Agent Integration Examples

Real-world examples of how AI agents (Claude, GPT, Copilot) integrate xray into their workflows.

## Quick Navigation

- [Claude-Specific Patterns](#claude-integration) - How Claude uses xray
- [GPT-Specific Patterns](#gpt-integration) - How GPT uses xray
- [Copilot-Specific Patterns](#copilot-integration) - How Copilot uses xray

## Common Integration Patterns

### Pattern 1: Proactive Discovery

**When:** User asks to work on unfamiliar codebase

**What happens:**
```
User: "Help me add a login feature"
Agent: "I need to understand your codebase first"
Agent: runs xray strategy detect + xray map
Agent: "I found React + Express. Here's the structure..."
Agent: Provides implementation guidance based on xray findings
```

### Pattern 2: Context Gathering Before Implementation

**When:** User wants you to write code

**What happens:**
```
User: "Add a dark mode toggle"
Agent: "Let me understand the current structure"
Agent: runs xray react components
Agent: "Found X components, here's how styling works..."
Agent: Writes code following discovered patterns
```

### Pattern 3: Error Investigation

**When:** User reports a bug

**What happens:**
```
User: "The payment page is broken"
Agent: "Let me find and understand that code"
Agent: runs xray explore --match "*payment*"
Agent: runs xray map --anchor <payment-file> --with incs
Agent: "Found the issue in the payment flow..."
```

### Pattern 4: Optimization Discovery

**When:** User wants to improve code

**What happens:**
```
User: "Find duplicate code we can consolidate"
Agent: runs xray explore --match and xray explore --search
Agent: "Found duplicate auth patterns in 3 places..."
Agent: Suggests consolidation strategy
```

## Example Conversations

### Example 1: Understanding New React+Express App

```
USER: "I need to understand this codebase before implementing features"

AGENT: "Let me analyze the structure for you."

[Agent runs: xray strategy detect]
Output: React and Express detected

[Agent runs: xray map --path ./src --depth 2]
Output: Shows directory structure

[Agent runs: xray react components]
Output: Lists 12 React components

[Agent runs: xray express routes]
Output: Lists 8 API routes

AGENT SUMMARY:
"This is a React + Express application with:
- UI layer: 12 components in src/components/
- API layer: 8 endpoints in src/api/
- Services: Authentication, database, file handling
- Pattern: Component containers handle state, use services for API calls

To implement [feature X], I would:
1. Create component at src/components/[X]/
2. Use existing API endpoints or add new to src/api/
3. Follow service pattern for business logic"

USER: "Perfect, let's implement the feature"
[Now Agent has full context from xray]
```

### Example 2: Debugging a Bug

```
USER: "Users are getting 500 errors when uploading files"

AGENT: "Let me find the file upload code"

[Agent runs: xray explore --match "*upload*"]
Output: Found 5 files related to upload

[Agent runs: xray map --anchor src/api/upload.ts --with incs]
Output: Shows upload handler and dependencies

AGENT: "I found the issue. The upload handler in src/api/upload.ts
is missing error handling for large files. Here's what's happening:
1. User uploads file
2. Express body parser has no limit set
3. Request fails silently
4. Returns 500 error

The fix is to add: express.json({ limit: '50mb' })"

[Now can implement fix with confidence]
```

### Example 3: Code Review Context

```
USER: [Provides pull request with code changes]

AGENT: "Let me understand the impact of these changes"

[Agent runs: xray map for changed areas]
[Agent runs: xray explore --match for related code]
[Agent runs: xray explore for patterns]

AGENT REVIEW:
"The changes look good, but:
1. You're modifying authentication in 3 places (found via xray)
   - Should consolidate in service instead
2. New API endpoint follows existing patterns (✓)
3. Component structure matches conventions (✓)
4. Don't forget to update these related tests..."
```

## Integration Patterns by Agent Type

### Claude Integration

**Strengths:**
- Good at understanding complex patterns
- Can maintain context across long conversations
- Good at explaining tradeoffs

**Common Flow:**
1. User asks to work on codebase
2. Claude proactively runs xray strategy detect
3. Claude asks clarifying questions based on detected frameworks
4. Claude runs targeted xray commands for specific question
5. Claude references xray findings throughout conversation

### GPT Integration

**Strengths:**
- Fast command execution
- Good at structured analysis
- Good at generating code from patterns

**Common Flow:**
1. User provides xray output (or asks agent to run it)
2. GPT analyzes structure from provided output
3. GPT asks for specific files to understand patterns
4. GPT generates code/fixes based on pattern understanding

### Copilot Integration

**Strengths:**
- Inline code context understanding
- Quick pattern matching
- Good for small, targeted changes

**Common Flow:**
1. User has file open in editor
2. Copilot runs xray explore
3. Copilot suggests completions based on discovered patterns
4. User accepts/modifies suggestions

## Token Usage Examples

### Example 1: Quick Context (200 tokens)

```
Command: xray strategy detect
Tokens: 50

Command: xray react components
Tokens: 100

Command: xray explore --match "*auth*"
Tokens: 50

Total: 200 tokens
Result: Know frameworks, see components, find auth code
```

### Example 2: Moderate Context (700 tokens)

```
Command: xray strategy detect
Tokens: 50

Command: xray map --path ./src --depth 2
Tokens: 300

Command: xray react components
Tokens: 100

Command: xray map --anchor src/auth.ts --with incs
Tokens: 250

Total: 700 tokens
Result: Full architectural understanding
```

### Example 3: Deep Analysis (1200 tokens)

```
Command: xray strategy detect
Tokens: 50

Command: xray map --path ./src --depth 2
Tokens: 300

Command: xray react components + hooks
Tokens: 200

Command: xray map --anchor src/auth.ts --with incs
Tokens: 400

Command: xray graph --path src/auth --with cf
Tokens: 250

Total: 1200 tokens
Result: Deep understanding of authentication system
```

## Success Indicators

**Agent is using xray well when:**

- Asks informed questions based on codebase structure (evidence of xray understanding)
- Recommends code changes that match discovered patterns
- Points to specific files from xray output
- Explains decisions based on architectural understanding
- Identifies issues before coding (from xray analysis)
- Suggests testing strategy based on patterns

**Agent should improve if:**

- Makes assumptions without checking structure
- Suggests code that doesn't match patterns
- Gets confused about file locations/organization
- Repeats analysis across conversation turns
- Doesn't use strategy findings to guide explorations

## Common Gotchas

**Gotcha 1: Assuming Same Pattern Everywhere**

```
WRONG: "All React components do X, so new component should too"
RIGHT: Use xray to verify pattern is consistent
FIX: xray react components to see actual patterns
```

**Gotcha 2: Not Using Strategy Results**

```
WRONG: Run xray map on Express+React project without using strategy detection
RIGHT: Run xray strategy detect first, then use framework-specific commands
FIX: Always check strategy results before planning
```

**Gotcha 3: Ignoring Dependencies**

```
WRONG: Suggest adding feature without understanding what it depends on
RIGHT: Use xray map --with incs to understand relationships
FIX: Always include --with incs when analyzing
```

**Gotcha 4: Over-specifying**

```
WRONG: Run xray map with 10 different filters and flags
RIGHT: Start simple, add filters only if needed
FIX: Use minimal flags, iterate if results unclear
```

## Integration Checklist

Before using xray in agent system prompt, verify:

- [ ] Know when to invoke xray (integration-protocol.md)
- [ ] Know which command to use (command-selection.md)
- [ ] Know how to parse results (output-interpretation.md)
- [ ] Know how to handle errors (error-handling.md)
- [ ] Know how to optimize tokens (token-optimization.md)
- [ ] Have fallback for xray failures
- [ ] Can explain xray findings to user clearly
- [ ] Test on real codebases before deployment

## File Structure for Integration

When integrating xray into agent system prompt:

```
System Prompt should include:
├─ Brief description of what xray does
├─ When to invoke xray (when user asks OR proactively)
├─ Which commands to use for which questions
├─ How to parse output (reference output-interpretation.md)
├─ Error recovery procedures
└─ Example workflows

Don't include:
├─ Full command reference (link to user docs)
├─ Complete strategy documentation (link to strategy docs)
├─ All edge cases (handle gracefully)
```

## Related Documentation

- [Integration Protocol](../integration-protocol.md) - Theory
- [Command Selection](../command-selection.md) - How to choose commands
- [System Prompt Templates](../prompts/system-prompts.md) - Ready-to-use prompts
- [Claude Integration](#claude-integration) - Claude-specific examples

---

**Key Point:** These are examples of how agents successfully use xray. Use them as inspiration for your own integration. The core patterns are:

1. Detect frameworks first
2. Map high-level structure
3. Explore framework-specific patterns
4. Deep-dive on key areas
5. Reference findings throughout task
