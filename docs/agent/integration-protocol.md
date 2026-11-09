# Agent Integration Protocol

This document defines how to integrate xray into agent workflows, including when to invoke it, how to invoke it, and how to handle results.

## Table of Contents

1. [Decision: Should I Use xray?](#decision-should-i-use-xray)
2. [Proactive Invocation](#proactive-invocation)
3. [Reactive Invocation](#reactive-invocation)
4. [Multi-Step Workflows](#multi-step-workflows)
5. [Context Accumulation](#context-accumulation)
6. [Error Handling](#error-handling)
7. [Success Validation](#success-validation)
8. [Pushed Context (Harness Hooks)](#pushed-context-harness-hooks)

## Decision: Should I Use xray?

Use xray when you need to answer questions about code structure, patterns, or organization. DO NOT use xray when you can answer the question with direct file access.

### Decision Tree

```
QUESTION FROM USER
  │
  ├─ Can be answered by reading specific files?
  │   YES → Read files directly, don't use xray
  │   NO → Continue
  │
  ├─ Does it require understanding codebase-wide patterns?
  │   NO → Read specific files, don't use xray
  │   YES → Continue
  │
  ├─ Is it about "where in the codebase should I look"?
  │   YES → Use xray
  │   NO → Continue
  │
  ├─ Is it about "what files exist matching criteria"?
  │   YES → Use xray explore
  │   NO → Continue
  │
  ├─ Is it about "how is this organized"?
  │   YES → Use xray map
  │   NO → Continue
  │
  ├─ Is it about "find framework-specific patterns"?
  │   YES → Use xray explore
  │   NO → Continue
  │
  ├─ Is it about dependencies/relationships?
  │   YES → Use xray map --with incs
  │   NO → Continue
  │
  ├─ Is it about code flow/control structures?
  │   YES → Use xray graph
  │   NO → Continue
  │
  └─ Otherwise: Use xray map as general analysis
```

### When NOT to Use xray

- User asks: "What does line 42 of foo.ts do?" → Read foo.ts directly
- User asks: "Show me the handleClick function" → Read the file with that function
- User asks: "What error is on line 15?" → Read the file and line 15
- User asks: "Add a comment to this function" → Work with provided code
- Analysis requires reading specific, small code sections → Use file reads
- Question is about logic of specific functions → Use file reads

### When TO Use xray

- User asks: "Where would I add a new React component?" → Use xray explore
- User asks: "How is the authentication system structured?" → Use xray map + explore
- User asks: "What files handle payments?" → Use xray explore + map
- User asks: "Is there a logger I can use?" → Use xray explore --search logger
- User asks: "Find all API routes" → Use xray explore
- User asks: "How do requests flow through the app?" → Use xray map + graph
- User asks: "What does the project look like?" → Use xray strategy detect + map
- User needs context before implementing changes → Use xray to understand area

## Proactive Invocation

Agent recognizes a user request that would benefit from xray before user explicitly mentions it.

### Protocol: Proactive Discovery

**Trigger:** User states they want to do something but asks how or where to start

**Example Triggers:**
- "I need to add a feature but I'm not sure where to start"
- "Help me understand this codebase"
- "I'm debugging an issue but not sure where to look"
- "I need to refactor this without breaking anything"

**Response Protocol:**

1. **Announce Intent**
   ```
   I'll help you [task]. First, let me understand the codebase structure
   so I can give you better guidance.
   ```

2. **Gather Context**
   - If framework unknown: `xray strategy detect`
   - If structure unknown: `xray map --path ./src --depth 2`
   - If looking for patterns: `xray <strategy> <command>`

3. **Integrate Findings**
   - Extract key architectural insights
   - Reference specific files/patterns from xray output
   - Build context for next steps

4. **Proceed with Task**
   - Now have structural understanding
   - Can guide user with specific, accurate recommendations

### Protocol: Proactive Investigation

**Trigger:** User reports a bug/issue but context is insufficient

**Example Triggers:**
- "There's a bug in the payment flow"
- "The API is returning wrong data"
- "Tests are failing in the X module"

**Response Protocol:**

1. **Announce Intent**
   ```
   I need to understand the relevant code architecture before debugging.
   Let me map out the affected areas.
   ```

2. **Gather Context**
   - `xray explore --match "*payment*"` or `--match "*api*"` (narrow scope)
   - `xray <strategy> <relevant-command>` (find related code)
   - `xray map --anchor <key-file> --with incs` (understand dependencies)

3. **Analyze Findings**
   - Identify likely error location
   - Understand data flow
   - Find related code that might have context

4. **Request Specific Files**
   - Now can ask for specific files with context
   - Recommend where to look
   - Have informed hypotheses to test

## Reactive Invocation

User explicitly mentions xray or asks for codebase-wide analysis.

### Protocol: User-Requested xray Analysis

**Trigger:** User explicitly asks for xray (examples):
- "Run xray to understand the structure"
- "Use xray to find all routes"
- "Can you scan for TypeScript files?"
- "Map out the dependencies"

**Response Protocol:**

1. **Clarify Intent** (if needed)
   ```
   What specifically would you like to understand?
   - The overall architecture?
   - Specific patterns (e.g., React components)?
   - Dependencies between modules?
   - File organization?
   ```

2. **Select Command** (see command-selection.md)
   - Map user's question to appropriate xray command
   - Choose options that answer their question specifically
   - Consider token budget

3. **Run Command**
   - Execute the appropriate xray command
   - Capture output
   - Parse and summarize key findings

4. **Present Results**
   - Highlight most relevant findings
   - Show specific files/patterns they asked about
   - Offer next steps

## Multi-Step Workflows

Complex tasks use xray multiple times across conversation turns.

### Protocol: Iterative Exploration

**Scenario:** User wants to implement feature but needs iterative discovery

**Conversation Flow:**

```
Turn 1: User says "I need to add authentication"
  → Action: xray strategy detect + xray react components
  → Result: User understands architecture, knows pattern

Turn 2: User asks "Where would the login form go?"
  → Action: xray explore --match + map with appropriate filters
  → Result: User knows file locations and patterns

Turn 3: User implements based on findings
  → Action: No xray needed, use file context
  → Result: Implementation complete

Turn 4: User asks "How do I integrate with API?"
  → Action: xray rest-api endpoints + map --with incs
  → Result: User understands API structure
```

### Protocol: Refinement Cycle

**Pattern:** If initial xray result is too broad or too narrow

**Steps:**

```
1. Run initial command (e.g., xray map)
   - May be too broad (too many files)
   - May be too narrow (missing relevant area)

2. Assess result:
   - Too broad? Rerun with --depth limit or --match filter
   - Too narrow? Rerun with --anchor different-file or --with more-features
   - Wrong area? Rerun with --path different-path

3. Accumulate results across turns:
   - Each xray run adds understanding
   - Combine results to build complete picture
   - Reference previous findings in new analysis
```

**Example Refinement:**

```
Turn 1: xray map --path ./src
  → Too many files, output overwhelming

Turn 2: User clarifies "I only care about API routes"
  → Action: xray express routes
  → Better: Focused on user's actual need

Turn 3: User sees routes, asks "How do these call services?"
  → Action: xray map --anchor src/api/routes.ts --with incs
  → Better: Answers follow-up question
```

## Context Accumulation

Build understanding across multiple xray invocations within a conversation.

### Protocol: Knowledge Building

**Pattern:**

```
xray Output #1: High-level structure (map --depth 1)
  ├─ What: Directory structure
  ├─ When: First step
  └─ Stored: Architectural understanding

xray Output #2: Framework patterns (`xray <strategy> <command>`)
  ├─ What: Component/route discovery
  ├─ When: After understanding structure
  └─ Combined with #1: Now know patterns + structure

xray Output #3: Dependencies (map --anchor <key-file> --with incs)
  ├─ What: Cross-file relationships
  ├─ When: After identifying relevant files
  └─ Combined with #1+#2: Now have complete context
```

### Protocol: Context Reference

When accumulating context, explicitly reference previous findings:

```
From earlier xray output, we know:
- The API is in src/api/ (from map output)
- Routes are defined with express decorators (from explore output)
- Authentication middleware is in src/middleware/ (from map output)

Based on this context, the new feature should...
```

### Protocol: Cache Awareness

xray caches analysis results. When relevant:

1. **After first xray call in a session:**
   - Subsequent calls with same parameters are faster
   - Results are consistent (same cache)

2. **If code changes during session:**
   - xray auto-detects file changes
   - Cache invalidates automatically
   - No need to manually clear cache

3. **If troubleshooting stale results:**
   ```
   If xray results seem old or wrong:
   → Run: xray clear-cache --confirm=yes
   → Then: Rerun your xray command
   ```

## Error Handling

When xray invocation fails or produces unexpected results.

### Protocol: Graceful Degradation

**If xray fails:**

```
TRY: Run xray command
CATCH error:
  1. Log the error
  2. Determine error type:
     - Connection/file system error → Can retry
     - Invalid options → Fix and retry
     - Parsing error → Fallback to file reads
     - Unknown error → Ask user for help
  3. Fall back gracefully:
     - If needed file structure → Use file reads
     - If needed patterns → Ask user to explain
     - If couldn't understand → Ask for clarification
```

**Example Error Recovery:**

```
User: "Analyze the payment flow"
Agent: Run xray explore --match "*payment*"
  → ERROR: "Invalid path"

Recovery:
  1. Check if path exists
  2. Rerun xray with correct path: xray explore --path ./src --match "*payment*"

If still fails:
  3. Fall back: Ask user "What files are related to payments?"
  4. Proceed with file reads instead of xray
```

### Protocol: Timeout Handling

**If xray takes too long:**

```
If xray command doesn't complete in reasonable time:
  1. Wait up to 30 seconds
  2. If still running, offer user choice:
     - "This is taking longer than expected. Should I:"
     - "  A) Keep waiting"
     - "  B) Try a simpler analysis (smaller scope)"
     - "  C) Skip xray and work with current context"
  3. User chooses:
     - A: Continue waiting
     - B: Retry with --depth 1 or --match filter
     - C: Proceed without codebase-wide analysis
```

## Success Validation

Verify that xray invocation succeeded and produced useful results.

### Protocol: Validation Steps

After running xray command:

```
1. PARSE OUTPUT
   ├─ Is output valid markdown/JSON?
   ├─ Does it contain expected content?
   └─ Any error messages or warnings?

2. ASSESS RELEVANCE
   ├─ Does output answer the question I asked?
   ├─ Is the scope appropriate (too broad/narrow)?
   └─ Are the findings actionable?

3. VALIDATE QUALITY
   ├─ Do the results make sense?
   ├─ Can I explain why files appear?
   └─ Are the relationships clear?

4. DECIDE NEXT STEP
   ├─ Sufficient context? → Proceed with task
   ├─ Need refinement? → Run follow-up xray
   ├─ Contradictory results? → Validate with file reads
   └─ Unclear output? → Run simpler xray first
```

### Protocol: Success Criteria

xray invocation is successful when:

- [ ] Output parses without errors
- [ ] Output contains non-empty results (not just errors)
- [ ] Results are relevant to the question asked
- [ ] Results make logical sense (no impossible relationships)
- [ ] Results enable the next step of the task
- [ ] Scope is appropriate (not overwhelming, not trivial)

### Protocol: Failure Detection

xray invocation failed when:

- [ ] Output is empty or only contains errors
- [ ] Results don't match the question asked
- [ ] Results seem illogical or contradictory
- [ ] Cannot parse output format
- [ ] Results don't enable task progress
- [ ] Timeout or process error occurred

**Recovery:** See Error Handling section above

## Pushed Context (Harness Hooks)

With harness hooks installed ([Harness Integration Guide](../user/harness-integration.md)),
xray output can arrive without you calling it: when you search for a
plain identifier, a block like this lands next to the tool call (as a
system reminder, additional context, or appended to the tool result):

```
[xray impact] loadConfig (graph saved 0m ago)
loadConfig (function, src/lib/config.ts:L244) — 32 callers across 3 groups
  src: 23 callers — registerAliasCommand (src/commands/alias.ts:L43), resolveRunOptions (src/commands/generate.ts:L667), handleGenerateAction (src/commands/generate.ts:L686), …and 20 more
  __tests__: 8 callers — layered (__tests__/lib/config-precedence.test.ts:L140), build (__tests__/commands/alias-registration.test.ts:L36), names (__tests__/cache/cross-root-key.test.ts:L31), …and 5 more
  scripts: 1 caller — main (scripts/benchmark-clustering.ts:L47)
edges: EXTRACTED 31 · INFERRED 3
```

How to read it:

- **Your search still ran.** The block is extra context; the hook never
  blocks or rewrites a tool call.
- **Trust `EXTRACTED`.** Those edges were resolved in the caller's file,
  directory or imports.
- **Check `INFERRED`.** Callers marked `(inferred)` matched by name only;
  confirm them in the file, or re-run with `--strict` to drop them.
- **It is a summary.** At most 3 callers per group, 1200 chars. For the
  full list and depths run `xray impact <symbol> --graph .xray/graph.json`
  (add `--depth <n>`, or `--format json` to parse).
- **The graph may be stale.** `graph saved <N>m ago` is the age of the
  session-start graph; edits made since are not in it. Re-run against the
  live tree (`xray impact <symbol>`, no `--graph`) after you change call
  sites.
- **No block is not "no callers".** The hook is silent on regexes, paths,
  a symbol already reported this session, a missing or untrusted graph,
  and no match. Run `xray impact` yourself when it matters.

Workflow: [Impact Analysis](workflows/impact-analysis.md).

**Telemetry.** Runs from a hook, a subprocess or the MCP server never
record telemetry (stdout not a TTY, `--format json`, `xray mcp`, CI), even
when the user consented. Check `telemetry.defaultOff` in `xray describe`;
set `XRAY_NO_TELEMETRY=1` (or `DO_NOT_TRACK=1`) or pass `--no-telemetry`
to force it off everywhere. Details:
[Telemetry](../user/telemetry.md#when-telemetry-is-off).

## Integration Checklist

Before integrating xray into agent workflow:

- [ ] Can I articulate when xray is needed vs. file reads
- [ ] Can I select appropriate command for each scenario
- [ ] Can I parse and interpret xray output
- [ ] Can I accumulate context across multiple invocations
- [ ] Can I recover from xray errors gracefully
- [ ] Can I validate xray results are useful
- [ ] Can I explain xray findings to user clearly
- [ ] Can I stay within token budget for the task

## Related Documentation

- [Command Selection Decision Tree](command-selection.md) - Choose which command
- [Output Interpretation Guide](output-interpretation.md) - Parse xray results
- [Error Handling Protocols](error-handling.md) - Specific error scenarios
- [Workflow Examples](workflows/README.md) - Real task workflows
- [Token Optimization](token-optimization.md) - Manage token budget
- [Harness Integration Guide](../user/harness-integration.md) - Skill, MCP and hooks per harness

---

**Key Takeaway:** Use xray for codebase-wide structural questions, not for specific line-by-line analysis. Integrate into agent workflows as a tool for understanding before implementation.
