# Agent Integration Guide: xray for AI Coding Assistants

This documentation is specifically designed for AI coding agents (Claude, GPT, Copilot, etc.) to understand and use xray effectively. Unlike user documentation which emphasizes narrative and interaction, this guide provides structured protocols, decision trees, and executable logic.

**Purpose:** Enable AI agents to make optimal xray usage decisions within their workflows and maximize understanding per token spent.

## Quick Navigation

### For Your Current Task
- **Understanding a new codebase?** → [Codebase Understanding Workflow](workflows/codebase-understanding.md)
- **Debugging an issue?** → [Bug Investigation Workflow](workflows/bug-investigation.md)
- **Implementing a feature?** → [Feature Implementation Workflow](workflows/feature-implementation.md)
- **Refactoring code?** → [Refactoring Workflow](workflows/refactoring.md)
- **What breaks if I change a symbol?** → [Impact Analysis Workflow](workflows/impact-analysis.md)
- **Reviewing code changes?** → [Code Review Workflow](workflows/code-review.md)

### For Your Decision-Making
- **Which command should I use?** → [Command Selection Decision Tree](command-selection.md)
- **How should I use xray in my workflow?** → [Integration Protocol](integration-protocol.md)
- **How do I optimize token usage?** → [Token Optimization Guide](token-optimization.md)
- **What should I do if xray fails?** → [Error Handling Protocols](error-handling.md)

### For Integration & Implementation
- **Integration examples (Claude, GPT, Copilot)** → [Agent Integration Examples](examples/README.md)
- **Call xray as MCP tools** → [MCP Server](../user/mcp.md)
- **System prompt templates** → [System Prompt Examples](prompts/system-prompts.md)

### For Understanding xray Output
- **How to parse xray output** → [Output Interpretation Guide](output-interpretation.md)
- **Understanding chunked output** → [Chunked Output Markers](output-interpretation.md#chunked-output-markers)

### For Reference
- **Decision trees and flowcharts** → [Decision Trees](decision-trees.md)
- **Common patterns and anti-patterns** → [Optimal Usage Patterns](optimal-usage-patterns.md)
- **Success validation** → [Success Validation](integration-protocol.md#success-validation)

## Core Concepts

### What xray Does (for agents)

xray analyzes source code to answer structural questions about codebases:
- **What files exist?** (explore --match)
- **How is code organized?** (map)
- **What patterns are used?** (explore with strategies)
- **What are the dependencies?** (map with --with incs)
- **What flows through this code?** (graph with --with cf/df)

**Cost:** xray operations consume tokens. Token efficiency is critical.

### When to Use xray

Use xray when you need to answer questions that require understanding code structure/patterns. Do NOT use xray for:
- Answering questions about code semantics (use direct file reads)
- Making decisions based on specific line-by-line logic (use file reads)
- Small, focused questions about single files (use file reads)
- Tasks that don't benefit from codebase-wide analysis

### Agent-Specific Optimization

Unlike humans who view xray output directly, agents:
1. Receive output as structured text/markdown
2. Must parse and interpret it programmatically
3. Can cache and reference output across turns
4. Should track token spend and adjust scope accordingly

## Command Overview

| Command | Purpose | Token Cost | When to Use |
|---------|---------|-----------|-----------|
| `explore --match` | Find files matching pattern | Low | Narrow search space, verify file existence |
| `map` | Get code structure/organization | Medium | Understand architecture, find key files |
| `explore` | Find framework-specific patterns | Low | Discover components, routes, hooks |
| `strategy detect` | Identify frameworks in use | Low | First step in new codebase |
| `graph` | Generate control/data flow | High | Analyze complex logic flow |
| `clear-cache` | Reset analysis cache | None | Troubleshooting stale results |

## Token Economics for Agents

**Token budget allocation for typical tasks:**

### Understanding New Codebase (500-1000 tokens)
- `strategy detect`: ~50 tokens (framework detection)
- `map --path ./src --depth 2`: ~400 tokens (structure)
- `<strategy> <command>`: ~100 tokens (patterns)
- Buffer for parsing/refinement: ~50 tokens

### Debugging Issue (300-600 tokens)
- `explore --match <pattern>`: ~50 tokens (find relevant files)
- `map --anchor <file>`: ~200 tokens (understand context)
- `map --with incs`: ~100 tokens (dependencies)
- Buffer: ~50 tokens

### Implementing Feature (600-1200 tokens)
- `strategy detect`: ~50 tokens
- `<strategy> <command>`: ~150 tokens (find patterns)
- `map --anchor <key-file>`: ~300 tokens (understand architecture)
- `map --with incs`: ~150 tokens (dependencies)
- Refinement/followups: ~150 tokens

## Success Criteria

You've used xray effectively when:
- [ ] You can describe the codebase structure (architecture, main components)
- [ ] You understand relevant patterns (how similar things are done)
- [ ] You know where to implement changes (which files, which patterns)
- [ ] You can explain dependencies (what depends on what)
- [ ] You stayed within token budget for the task

## Integration Pattern

Typical agent workflow:

```
USER REQUEST
    ↓
DECIDE: Do I need xray?
    ├─ YES: Continue
    └─ NO: Work with current context
    ↓
DECIDE: Which command?
    (See: command-selection.md)
    ↓
RUN xray COMMAND
    ↓
PARSE OUTPUT
    (See: output-interpretation.md)
    ↓
VALIDATE SUCCESS
    (See: validation-criteria.md)
    ↓
PROCEED WITH IMPLEMENTATION/ANALYSIS
```

## What's Different from Human Documentation

This documentation assumes:
- **Structured thinking:** You can follow protocols mechanistically
- **Token awareness:** You optimize for token efficiency
- **Output parsing:** You can interpret markdown/JSON programmatically
- **Decision logic:** You implement if/then/else decision trees
- **Error recovery:** You know when to retry, when to ask user, when to fail

All examples are testable and mechanically executable, not narrative.

## Navigation by Scenario

### "I need to understand this codebase"
1. Read: [Integration Protocol](integration-protocol.md) - Section: Proactive Invocation
2. Read: [Codebase Understanding Workflow](workflows/codebase-understanding.md)
3. Reference: [Command Selection](command-selection.md) - If unsure which command next
4. Reference: [Output Interpretation](output-interpretation.md) - If confused by output

### "I'm implementing a feature"
1. Read: [Feature Implementation Workflow](workflows/feature-implementation.md)
2. Reference: [Command Selection](command-selection.md) - For each decision point
3. Reference: [Token Optimization](token-optimization.md) - If running out of tokens
4. Reference: [Optimal Usage Patterns](optimal-usage-patterns.md) - To find similar implementations

### "I'm debugging an issue"
1. Read: [Bug Investigation Workflow](workflows/bug-investigation.md)
2. Reference: [Command Selection](command-selection.md) - For narrowing scope
3. Reference: [Output Interpretation](output-interpretation.md) - To understand relationships
4. Reference: [Error Handling](error-handling.md) - If things go wrong

### "I'm doing code review"
1. Read: [Code Review Workflow](workflows/code-review.md)
2. Reference: [Command Selection](command-selection.md) - To gather context
3. Reference: [Success Validation](integration-protocol.md#success-validation) - To assess impact

### "Something went wrong with xray"
1. Read: [Error Handling](error-handling.md)
2. Reference: [Common Error Scenarios](error-handling.md#common-error-scenarios-and-solutions)
3. Reference: [Output Interpretation](output-interpretation.md) - To understand error messages

## Files in This Directory

```
docs/agent/
├── README.md                          (this file)
├── INDEX.md                           (full index of agent docs)
├── integration-protocol.md            (how to integrate xray into agent workflows)
├── command-selection.md               (decision tree for command selection)
├── optimal-usage-patterns.md          (best practices for agents)
├── token-optimization.md              (managing token budget)
├── error-handling.md                  (error recovery protocols)
├── output-interpretation.md           (parsing xray output, incl. chunked output)
├── decision-trees.md                  (visual decision logic)
├── events.md                          (event system for plugins)
│
├── workflows/
│   ├── README.md                      (workflow overview)
│   ├── codebase-understanding.md      (step-by-step: understanding new codebase)
│   ├── bug-investigation.md           (step-by-step: debugging)
│   ├── feature-implementation.md      (step-by-step: implementing features)
│   ├── refactoring.md                 (step-by-step: refactoring code)
│   ├── impact-analysis.md             (step-by-step: blast radius of a change)
│   └── code-review.md                 (step-by-step: reviewing changes)
│
├── examples/
│   └── README.md                      (integration patterns: Claude, GPT, Copilot)
│
└── prompts/
    └── system-prompts.md              (templates for system prompts)
```

## Core Principles

1. **Mechanically Executable:** All protocols must be followable without interpretation
2. **Token-Efficient:** Every recommendation considers token cost
3. **Failure-Recoverable:** When things fail, you have a recovery procedure
4. **Success-Validatable:** You can verify success at each step
5. **Decision-Tree-Based:** Complex logic expressed as clear conditionals
6. **Output-Parseable:** Examples include how to interpret output
7. **Error-Explicit:** Error cases are named and handled explicitly

## Quick Reference: Common Commands

### Discovery
```bash
xray strategy detect                    # What frameworks are used?
xray explore --path ./src                 # What files exist?
```

### Understanding
```bash
xray map --path ./src --depth 2         # How is code organized?
xray react components           # What React components exist?
xray map --anchor src/main.ts --with incs  # What depends on what?
xray impact createSession               # Who calls this, transitively?
```

### Investigation
```bash
xray explore --type ts --match "!*.test.ts"  # Filter files
xray map --anchor <file> --with cf --with df  # Control/data flow
```

## Next Steps

1. **First time using xray as agent?** Start with [Integration Protocol](integration-protocol.md)
2. **Working on specific task?** Jump to relevant [Workflow](workflows/README.md)
3. **Need to decide which command?** Use [Command Selection](command-selection.md)
4. **Confused by xray output?** Read [Output Interpretation](output-interpretation.md)
5. **Hit a problem?** Check [Error Handling](error-handling.md)

---

**Last Updated:** 2024
**Status:** Comprehensive documentation for agent integration
**Target Audience:** AI coding agents (Claude, GPT, Copilot, etc.)
