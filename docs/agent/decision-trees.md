# Decision Trees and Flowcharts

Visual decision logic for agent xray integration.

## Master Decision Tree: When to Use xray

```
AGENT RECEIVES USER REQUEST
    │
    ├─ Does request ask about/require understanding code structure?
    │   │
    │   ├─ YES: Continue to next decision
    │   │
    │   └─ NO: Answer directly, no xray needed
    │       └─ DONE: Respond to user
    │
    ├─ Can this be answered by reading 1-2 specific files?
    │   │
    │   ├─ YES: Read those files directly
    │   │   └─ DONE: Answer based on file content
    │   │
    │   └─ NO: Continue to next decision
    │
    ├─ Does understanding require codebase-wide analysis?
    │   │
    │   ├─ NO: Can answer without xray
    │   │   └─ DONE: Answer based on common patterns
    │   │
    │   └─ YES: Continue to next decision
    │
    ├─ Is token budget available for xray?
    │   │
    │   ├─ NO: Tell user budget exhausted
    │   │   └─ DONE: Suggest file reads instead
    │   │
    │   └─ YES: Invoke xray (continue)
    │
    ├─ Is codebase framework known?
    │   │
    │   ├─ YES: Use framework-specific commands
    │   │   └─ Continue to Command Selection
    │   │
    │   └─ NO: Run strategy detect first
    │       └─ Continue to Command Selection
    │
    └─ SELECT COMMAND
        └─ See: Command Selection Tree (below)
```

## Command Selection Decision Tree

```
WHAT DOES USER WANT TO UNDERSTAND?
    │
    ├─ "What frameworks are used?"
    │   └─ COMMAND: xray strategy detect
    │       TOKENS: 50
    │       NEXT: Based on detected frameworks
    │
    ├─ "What files exist [with pattern]?"
    │   ├─ Specific filename pattern
    │   │   └─ COMMAND: xray explore --match "pattern"
    │   │       TOKENS: 50-100
    │   │       NEXT: Found files or no matches
    │   │
    │   └─ All files in directory
    │       └─ COMMAND: xray explore --path ./dir
    │           TOKENS: 50
    │           NEXT: Understand what exists
    │
    ├─ "How is the codebase organized?"
    │   ├─ High-level overview only
    │   │   └─ COMMAND: xray map --depth 1
    │   │       TOKENS: 150-200
    │   │       NEXT: User understands top level
    │   │
    │   ├─ Medium-level structure
    │   │   └─ COMMAND: xray map --depth 2
    │   │       TOKENS: 300-400
    │   │       NEXT: User understands organization
    │   │
    │   └─ Complete structure
    │       └─ COMMAND: xray map
    │           TOKENS: 400-800
    │           NEXT: User understands full structure
    │
    ├─ "Find [framework] patterns" (React components, routes, etc.)
    │   ├─ React patterns
    │   │   ├─ COMMAND: xray react components
    │   │   ├─ COMMAND: xray react hooks
    │   │   └─ TOKENS: 100-150 each
    │   │
    │   ├─ Express patterns
    │   │   ├─ COMMAND: xray express routes
    │   │   └─ TOKENS: 100
    │   │
    │   ├─ REST API patterns
    │   │   ├─ COMMAND: xray rest-api endpoints
    │   │   └─ TOKENS: 100
    │   │
    │   └─ Other framework
    │       └─ COMMAND: xray <strategy> <command>
    │           TOKENS: 100-150
    │
    ├─ "How does [file/component] work?"
    │   ├─ Without dependencies
    │   │   └─ COMMAND: xray map --anchor file.ts
    │   │       TOKENS: 250-300
    │   │       NEXT: Understand what's in file
    │   │
    │   └─ Including dependencies
    │       └─ COMMAND: xray map --anchor file.ts --with incs
    │           TOKENS: 350-400
    │           NEXT: Understand file and relationships
    │
    ├─ "What are the dependencies?"
    │   ├─ Overall dependencies
    │   │   └─ COMMAND: xray map --with incs
    │   │       TOKENS: 400-500
    │   │       NEXT: Understand imports
    │   │
    │   └─ Dependencies of specific area
    │       └─ COMMAND: xray map --path ./area --with incs
    │           TOKENS: 300-400
    │           NEXT: Understand imports in that area
    │
    ├─ "How does data/control flow?"
    │   ├─ Control flow only
    │   │   └─ COMMAND: xray graph --with cf
    │   │       TOKENS: 500-700
    │   │       NEXT: Understand logic flow
    │   │
    │   ├─ Data flow only
    │   │   └─ COMMAND: xray graph --with df
    │   │       TOKENS: 500-700
    │   │       NEXT: Understand data movement
    │   │
    │   └─ Both flows
    │       └─ COMMAND: xray graph --with cf --with df
    │           TOKENS: 800-1000
    │           NEXT: Complete flow understanding
    │
    └─ "I'm not sure what I need"
        └─ START: xray strategy detect (discover frameworks)
            THEN: xray map --depth 1 (understand structure)
            THEN: Ask user clarifying question
            TOKENS: 200-250
```

## Error Recovery Flowchart

```
XRAY COMMAND EXECUTED
    │
    ├─ Did command succeed?
    │   │
    │   ├─ YES: Continue to Output Parsing
    │   │
    │   └─ NO: Parse error message
    │
    ├─ ERROR TYPE?
    │   │
    │   ├─ "Invalid path" or "No such file"
    │   │   ├─ Action: Verify path exists
    │   │   ├─ Fix: Use absolute path
    │   │   ├─ Retry: xray with correct path
    │   │   └─ If fails: Ask user for correct path
    │   │
    │   ├─ "Permission denied"
    │   │   ├─ Action: Check permissions
    │   │   ├─ Fix: Use alternative path or ask user
    │   │   ├─ Retry: with different path
    │   │   └─ If fails: Fall back to file reads
    │   │
    │   ├─ "Pattern matched 0 files"
    │   │   ├─ Action: Broaden pattern
    │   │   ├─ Fix: Remove or loosen filters
    │   │   ├─ Retry: with broader pattern
    │   │   └─ If still no match: Pattern doesn't exist
    │   │
    │   ├─ "Timeout"
    │   │   ├─ Action: Reduce scope
    │   │   ├─ Fix: Add --depth, --path, or --match
    │   │   ├─ Retry: with reduced scope
    │   │   └─ If fails: Accept partial results
    │   │
    │   ├─ "Strategy not found"
    │   │   ├─ Action: Show available strategies
    │   │   ├─ Fix: Use correct strategy name
    │   │   ├─ Retry: with correct strategy
    │   │   └─ If fails: Use strategy list
    │   │
    │   └─ Other error
    │       ├─ Action: Log error
    │       ├─ Retry: Once more with simple command
    │       └─ Fallback: Use file reads
    │
    ├─ Retry successful?
    │   │
    │   ├─ YES: Continue to Output Parsing
    │   │
    │   └─ NO: Activate Graceful Degradation
    │       ├─ Tell user: "Having trouble analyzing codebase"
    │       ├─ Offer: "Could you provide [specific help]?"
    │       └─ Continue: With file reads instead
    │
    └─ OUTPUT PARSING
        └─ Extract: Files, patterns, relationships
            └─ Return: Summary to user
```

## Workflow Selection Flowchart

```
AGENT RECOGNIZES TASK TYPE
    │
    ├─ User wants to understand new codebase
    │   └─ USE: Codebase Understanding Workflow
    │       LINK: workflows/codebase-understanding.md
    │
    ├─ User is debugging an issue
    │   └─ USE: Bug Investigation Workflow
    │       LINK: workflows/bug-investigation.md
    │
    ├─ User wants to implement feature
    │   └─ USE: Feature Implementation Workflow
    │       LINK: workflows/feature-implementation.md
    │
    ├─ User wants to refactor code
    │   └─ USE: Refactoring Workflow
    │       LINK: workflows/refactoring.md
    │
    ├─ User is reviewing code changes
    │   └─ USE: Code Review Workflow
    │       LINK: workflows/code-review.md
    │
    └─ Task doesn't fit above
        └─ APPROACH: Adapt relevant workflow
            └─ Use patterns from most similar workflow
```

## Token Budget Decision Tree

```
HOW MANY TOKENS AVAILABLE?
    │
    ├─ < 100 tokens
    │   ├─ Can only afford: ONE cheap command
    │   ├─ Recommendation: xray strategy detect OR xray explore
    │   └─ Limitation: Very limited analysis possible
    │
    ├─ 100-200 tokens
    │   ├─ Can afford: Discovery + limited exploration
    │   ├─ Recommendation: strategy detect + explore --match
    │   └─ Limitation: No deep analysis
    │
    ├─ 200-500 tokens
    │   ├─ Can afford: Discovery + basic structure
    │   ├─ Recommendation: strategy detect + map --depth 1
    │   └─ Limitation: Limited to overview only
    │
    ├─ 500-1000 tokens
    │   ├─ Can afford: Good understanding
    │   ├─ Recommendation: Full discovery workflow
    │   └─ Capability: Ready for implementation
    │
    ├─ 1000-1500 tokens
    │   ├─ Can afford: Deep understanding
    │   ├─ Recommendation: Comprehensive analysis
    │   └─ Capability: Ready for complex implementation
    │
    └─ 1500+ tokens
        ├─ Can afford: Complete analysis
        ├─ Recommendation: Exhaustive analysis if needed
        └─ Capability: Expert-level understanding
```

## Output Format Decision Tree

```
WHICH OUTPUT FORMAT SHOULD I USE?
    │
    ├─ Default (Markdown tree)?
    │   ├─ WHEN: Most use cases
    │   ├─ COMMAND: xray map
    │   └─ OUTPUT: Human-readable tree structure
    │
    ├─ JSON?
    │   ├─ WHEN: Need to parse programmatically
    │   ├─ COMMAND: xray map --format json
    │   └─ OUTPUT: Structured JSON objects
    │
    ├─ CSV?
    │   ├─ WHEN: Need tabular data
    │   ├─ COMMAND: xray map --format csv
    │   └─ OUTPUT: <out>.nodes.csv + <out>.edges.csv (two tables)
    │
    ├─ XML?
    │   ├─ WHEN: Need one <graph> document
    │   ├─ COMMAND: xray map --format xml
    │   └─ OUTPUT: <out>.xml
    │
    └─ Chunked (multiple files)?
        ├─ WHEN: Large codebase
        ├─ COMMAND: xray map (default)
        └─ OUTPUT: Multiple .xray_*.md files with navigation
```

## Scope Selection Decision Tree

```
HOW MUCH SCOPE DO I NEED?
    │
    ├─ Single function/component only?
    │   ├─ SCOPE: One file
    │   ├─ COMMAND: xray map --anchor src/file.ts
    │   └─ DEPTH: N/A (single file)
    │
    ├─ Single module/feature?
    │   ├─ SCOPE: Single directory
    │   ├─ COMMAND: xray map --path ./src/module
    │   └─ DEPTH: 1-2
    │
    ├─ Multiple related modules?
    │   ├─ SCOPE: 2-3 directories
    │   ├─ COMMAND: xray map --path ./src
    │   └─ DEPTH: 2
    │
    ├─ Entire source directory?
    │   ├─ SCOPE: ./src (all code)
    │   ├─ COMMAND: xray map --path ./src
    │   └─ DEPTH: 2-3
    │
    └─ Entire codebase?
        ├─ SCOPE: Everything
        ├─ COMMAND: xray map
        └─ DEPTH: Unlimited (or specify limit)
```

## Success Validation Flowchart

```
AFTER XRAY ANALYSIS COMPLETE
    │
    ├─ Is output valid (no errors)?
    │   ├─ NO: Review error, handle per Error Recovery tree
    │   └─ YES: Continue
    │
    ├─ Is output relevant to question?
    │   ├─ NO: Maybe wrong command, try different command
    │   └─ YES: Continue
    │
    ├─ Can I understand the results?
    │   ├─ NO: See output-interpretation.md
    │   └─ YES: Continue
    │
    ├─ Do results make logical sense?
    │   ├─ NO: Might be parsing error, verify
    │   └─ YES: Continue
    │
    ├─ Can I move forward with findings?
    │   ├─ NO: Need more analysis, go to Command Selection tree
    │   └─ YES: Success!
    │
    └─ PROCEED WITH TASK
        └─ Implement/debug/review using xray findings
```

## Quick Reference Cards

### Card 1: Command Cost vs. Information

```
CHEAP (50-100 tokens)        MEDIUM (200-400 tokens)     EXPENSIVE (500+ tokens)
├─ strategy detect           ├─ map --depth 2             ├─ graph commands
├─ explore --match pattern   ├─ map --anchor file         ├─ complete map
├─ <strategy> <command>      └─ map with features         └─ multiple commands

USE WHEN: Quick answer    USE WHEN: Good            USE WHEN: Deep
LIMITED INFO              understanding needed      understanding needed
                          TOKENS: ~300              TOKENS: 500-1000+
TOKENS: ~50-100
```

### Card 2: Framework → Command Mapping

```
REACT                    EXPRESS                REST API             GO CLI
├─ components            ├─ routes              ├─ endpoints         ├─ commands
├─ hooks                 ├─ middleware          ├─ handlers          ├─ flags
├─ context               └─ error handlers      └─ models            └─ subcommands
└─ lifecycle
```

### Card 3: Error Quick Fix

```
ERROR                          QUICK FIX
├─ Invalid path              → Use absolute path /home/user/project
├─ Permission denied         → Ask user for accessible path
├─ Pattern matched 0         → Remove filters, try --match "*"
├─ Timeout                   → Add --depth 1 or --path limit
├─ Strategy not found        → Run strategy list for names
└─ No strategies detected    → Normal, continue with generic analysis
```

---

**Key Takeaway:** These decision trees codify the logic for when/how/what to do with xray. Follow mechanically, don't interpret subjectively.
