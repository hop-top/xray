# Agent Documentation Complete Index

Comprehensive index and guide to all agent documentation for AI coding assistants using xray.

## Documentation Structure

```
docs/agent/
├── Core Documentation
│   ├── README.md                    Main entry point for agents
│   ├── integration-protocol.md      When/how to invoke xray
│   ├── command-selection.md         Which command to use
│   ├── output-interpretation.md     How to parse results
│   ├── error-handling.md            Error recovery procedures
│   ├── decision-trees.md            Visual decision logic
│   ├── optimal-usage-patterns.md    Best practices
│   └── token-optimization.md        Token budget management
│
├── Workflows (Step-by-Step Protocols)
│   ├── workflows/README.md          Workflow overview
│   ├── codebase-understanding.md    Understanding new codebases
│   ├── bug-investigation.md         Debugging issues
│   ├── feature-implementation.md    Implementing features
│   ├── refactoring.md               Safe refactoring
│   ├── code-review.md               Code review preparation
│   └── impact-analysis.md           What breaks if I change X?
│
├── Examples
│   ├── examples/README.md           Integration examples
│   ├── claude-integration.md        Claude-specific patterns
│   ├── gpt-integration.md           GPT-specific patterns
│   └── copilot-integration.md       Copilot-specific patterns
│
└── Prompts
    ├── prompts/system-prompts.md    System prompt templates
    └── prompts/user-prompts.md      User prompt patterns
```

## Quick Navigation by Question

### "When should I use xray?"
- **Start here:** [README.md](README.md#when-to-use-xray)
- **Detailed:** [integration-protocol.md](integration-protocol.md#decision-should-i-use-xray)
- **Visual:** [decision-trees.md](decision-trees.md#master-decision-tree-when-to-use-xray)

### "Which command should I run?"
- **Decision tree:** [command-selection.md](command-selection.md#master-decision-tree)
- **Quick matrix:** [command-selection.md](command-selection.md#quick-command-reference)
- **Flowchart:** [decision-trees.md](decision-trees.md#command-selection-decision-tree)

### "How do I parse xray output?"
- **Guide:** [output-interpretation.md](output-interpretation.md)
- **Examples:** [output-interpretation.md](output-interpretation.md#example-map-output)
- **Code samples:** [output-interpretation.md](output-interpretation.md#parsing-strategies)

### "What do I do if xray fails?"
- **Decision tree:** [error-handling.md](error-handling.md#error-handling-decision-tree)
- **Common errors:** [error-handling.md](error-handling.md#error-recovery-protocols)
- **Quick fixes:** [decision-trees.md](decision-trees.md#card-3-error-quick-fix)

### "How do I optimize token usage?"
- **Guide:** [token-optimization.md](token-optimization.md)
- **Strategies:** [token-optimization.md](token-optimization.md#strategies-for-token-efficiency)
- **Budgeting:** [token-optimization.md](token-optimization.md#token-budget-planning)

### "What's the best way to use xray?"
- **Patterns:** [optimal-usage-patterns.md](optimal-usage-patterns.md)
- **Workflows:** [workflows/README.md](workflows/README.md)
- **Examples:** [examples/README.md](examples/README.md)

## Workflow Selection Guide

**Choose your workflow based on what you're doing:**

| Task | Workflow | Time | Tokens |
|------|----------|------|--------|
| **Understanding new codebase** | [codebase-understanding](workflows/codebase-understanding.md) | 10-15 min | 500-1000 |
| **Debugging an issue** | [bug-investigation](workflows/bug-investigation.md) | 15-20 min | 600-1200 |
| **Implementing a feature** | [feature-implementation](workflows/feature-implementation.md) | 20-30 min | 1000-1500 |
| **Refactoring code** | [refactoring](workflows/refactoring.md) | 20-25 min | 1000-1500 |
| **Reviewing code changes** | [code-review](workflows/code-review.md) | 10-15 min | 700-1200 |
| **Changing a function (what breaks?)** | [impact-analysis](workflows/impact-analysis.md) | 2-5 min | 400-1500 |

## Reading Guide by Role/Agent Type

### For Claude
1. Read: [README.md](README.md) - Overview
2. Read: [integration-protocol.md](integration-protocol.md) - How to integrate
3. Skim: [command-selection.md](command-selection.md) - Reference
4. Reference: [output-interpretation.md](output-interpretation.md) - When needed
5. Use: [examples/README.md#claude-integration](examples/README.md#claude-integration) - Patterns

### For GPT
1. Read: [README.md](README.md) - Overview
2. Skim: [integration-protocol.md](integration-protocol.md) - How to integrate
3. Reference: [command-selection.md](command-selection.md) - Which commands
4. Reference: [output-interpretation.md](output-interpretation.md) - Parsing
5. Use: [examples/README.md#gpt-integration](examples/README.md#gpt-integration) - Patterns

### For Copilot
1. Skim: [README.md](README.md) - Quick overview
2. Reference: [decision-trees.md](decision-trees.md) - Quick decisions
3. Reference: [command-selection.md](command-selection.md) - Which commands
4. Use: [prompts/system-prompts.md](prompts/system-prompts.md) - Integration
5. Use: [examples/README.md#copilot-integration](examples/README.md#copilot-integration) - Patterns

## Document Descriptions

### Core Documentation

**[README.md](README.md)**
- Main entry point
- Overview of xray for agents
- Quick navigation
- Core concepts
- Token economics
- Integration patterns

**[integration-protocol.md](integration-protocol.md)**
- When to invoke xray (decision trees)
- Proactive vs. reactive invocation
- Multi-step workflows
- Context accumulation
- Graceful degradation
- Success validation

**[command-selection.md](command-selection.md)**
- Master decision tree (which command to use)
- Quick command reference
- Specific use case flows
- Token cost by command
- Decision points
- Error recovery

**[output-interpretation.md](output-interpretation.md)**
- How to parse map output
- How to parse explore output
- How to parse `explore --match` output
- How to parse graph output
- Parsing strategies (line-by-line, regex, structured)
- Validation procedures
- Common mistakes

**[error-handling.md](error-handling.md)**
- Error classification
- Error handling decision tree
- Recovery protocols for specific errors
- Graceful degradation patterns
- Retry strategy
- When to ask user for help

**[decision-trees.md](decision-trees.md)**
- Visual decision logic
- Master decision tree
- Command selection flowchart
- Error recovery flowchart
- Workflow selection flowchart
- Token budget decision tree
- Quick reference cards

**[optimal-usage-patterns.md](optimal-usage-patterns.md)**
- Core patterns (progressive disclosure, hypothesis-driven, accumulation, narrowing)
- Efficiency patterns (caching, feature inclusion, sequencing)
- Integration patterns (proactive invocation, clarifying questions, fallbacks)
- Validation patterns
- Mistake prevention

**[token-optimization.md](token-optimization.md)**
- Token cost reference
- Spend/save decision tree
- Token efficiency strategies
- Budget planning by available tokens
- Common waste patterns
- Token-efficient workflows
- Monitoring and tracking

### Workflow Documentation

**[workflows/README.md](workflows/README.md)**
- Workflow overview
- Available workflows
- Protocol structure
- Cross-workflow patterns
- Token budget by workflow
- Success indicators

**[workflows/codebase-understanding.md](workflows/codebase-understanding.md)**
- Step-by-step: discover frameworks
- Step-by-step: map structure
- Step-by-step: explore patterns
- Step-by-step: examine entry points
- Step-by-step: understand configuration
- Step-by-step: map dependencies
- Validation checklist
- Troubleshooting

**[workflows/bug-investigation.md](workflows/bug-investigation.md)**
- Phase 1: Issue localization
- Phase 2: Context analysis
- Phase 3: Hypothesis formation
- Phase 4: Verification
- Phase 5: Implementation planning
- Common scenarios
- Debugging tips

**[workflows/feature-implementation.md](workflows/feature-implementation.md)**
- Phase 1: Discovery
- Phase 2: Planning
- Phase 3: Analysis
- Phase 4: Validation
- Implementation plan template
- Common pitfalls
- Success validation

**[workflows/refactoring.md](workflows/refactoring.md)**
- Phase 1: Scope definition
- Phase 2: Impact analysis
- Phase 3: Strategy
- Phase 4: Safety validation
- Phase 5: Implementation planning
- Common scenarios
- Pitfalls to avoid

**[workflows/code-review.md](workflows/code-review.md)**
- Phase 1: Change identification
- Phase 2: Architecture impact
- Phase 3: Change analysis
- Phase 4: Testing assessment
- Phase 5: Review summary
- Review point checklist
- Questions to ask

**[workflows/impact-analysis.md](workflows/impact-analysis.md)**
- Phase 1: Blast radius in one root (`xray impact X --depth 3`)
- Phase 2: Whole workspace (`--lens <name>`, cache lines)
- Phase 3: Fallback to `xray explore --search`
- Phase 4: Change plan (call sites per package)
- Reading EXTRACTED vs INFERRED, when to use `--strict`

### Examples

**[examples/README.md](examples/README.md)**
- Integration patterns (proactive, context gathering, investigation, optimization)
- Example conversations
- Token usage examples
- Success indicators
- Common gotchas
- Integration checklist

**[examples/README.md#claude-integration](examples/README.md#claude-integration)**
- Claude-specific patterns and examples

**[examples/README.md#gpt-integration](examples/README.md#gpt-integration)**
- GPT-specific patterns and examples

**[examples/README.md#copilot-integration](examples/README.md#copilot-integration)**
- Copilot-specific patterns and examples

### Prompts

**[prompts/system-prompts.md](prompts/system-prompts.md)**
- Minimal integration template (concise)
- Standard integration template (balanced)
- Comprehensive integration template (detailed)
- Agent-specific templates (Claude, GPT, Copilot)
- Testing the system prompt
- Integration checklist

## Key Concepts to Understand

### 1. When to Use xray
See: [integration-protocol.md](integration-protocol.md#decision-should-i-use-xray) + [decision-trees.md](decision-trees.md#master-decision-tree-when-to-use-xray)

xray is for codebase-wide structural questions, not single-file analysis.

### 2. Command Selection
See: [command-selection.md](command-selection.md) + [decision-trees.md](decision-trees.md#command-selection-decision-tree)

Different commands answer different questions. Choose the most efficient one.

### 3. Token Efficiency
See: [token-optimization.md](token-optimization.md)

Every token spent should provide proportional value. Optimize budget at each step.

### 4. Error Recovery
See: [error-handling.md](error-handling.md)

Have recovery procedure for every error. Fall back gracefully when needed.

### 5. Progressive Disclosure
See: [optimal-usage-patterns.md](optimal-usage-patterns.md#pattern-1-progressive-disclosure)

Start simple, add detail only if needed. Don't analyze everything at once.

### 6. Output Parsing
See: [output-interpretation.md](output-interpretation.md)

xray output is highly structured. Learn patterns, parse mechanically.

### 7. Workflow Patterns
See: [workflows/README.md](workflows/README.md)

Use workflows for common tasks. They're optimized and tested.

### 8. Validation
See: [integration-protocol.md](integration-protocol.md#success-validation)

After xray, validate results are useful before proceeding.

## Quick Reference Cards

### Command Quick Reference
See: [command-selection.md](command-selection.md#quick-command-reference)

```
Discover:      strategy detect, explore --match
Understand:    map --depth 1/2, explore
Deep Dive:     graph, map --with incs
Impact:        impact <symbol> [--strict] [--lens <name>]
```

### Token Cost Quick Reference
See: [token-optimization.md](token-optimization.md#token-cost-reference)

```
Cheap:   50-150 tokens (detect, explore)
Medium:  200-500 tokens (map --depth 2)
Expensive: 500+ tokens (graph, complete map)
```

### Error Quick Reference
See: [decision-trees.md](decision-trees.md#card-3-error-quick-fix)

```
Invalid path → Fix path, retry
No matches → Broaden pattern, retry
Timeout → Reduce scope, retry
Permission → Ask user or use different path
```

### Workflow Quick Reference
See: [workflows/README.md](workflows/README.md)

```
New codebase → codebase-understanding.md
Debugging → bug-investigation.md
Feature → feature-implementation.md
Refactor → refactoring.md
Review → code-review.md
What breaks if I change X? → impact-analysis.md
```

## Document Statistics

| Category | Count | Total Words |
|----------|-------|-------------|
| Core Documentation | 8 | ~15,000 |
| Workflows | 7 | ~12,000 |
| Examples | 4 | ~3,000 |
| Prompts | 2 | ~3,000 |
| **Total** | **21** | **~33,000** |

## Using These Docs Effectively

### For First-Time Integration
1. Read [README.md](README.md) completely
2. Read [integration-protocol.md](integration-protocol.md) completely
3. Reference other docs as needed

### For Daily Use
1. Use [decision-trees.md](decision-trees.md) for quick decisions
2. Use [command-selection.md](command-selection.md) to choose commands
3. Reference [output-interpretation.md](output-interpretation.md) when needed

### For Specific Tasks
1. Find relevant workflow in [workflows/](workflows/)
2. Follow steps mechanically
3. Reference command docs as needed

### For Error Handling
1. See [error-handling.md](error-handling.md)
2. Or check [decision-trees.md](decision-trees.md#error-recovery-flowchart)
3. Implement recovery procedure

### For Token Optimization
1. See [token-optimization.md](token-optimization.md)
2. Plan budget before running commands
3. Monitor spend as you go

## Implementation Checklist

Before deploying xray integration:

- [ ] Read [README.md](README.md) and [integration-protocol.md](integration-protocol.md)
- [ ] Understand when to use xray (don't overuse)
- [ ] Understand command selection (use right commands)
- [ ] Understand output parsing (parse correctly)
- [ ] Understand error recovery (handle failures)
- [ ] Test on real codebases
- [ ] Have fallback strategy
- [ ] Monitor token usage
- [ ] Track success/failures for improvement

## Updates and Maintenance

This documentation is current as of January 2024. Check the following for updates:

- xray command changes: [developer docs](../dev/)
- New strategies: [strategy docs](../dev/strategies/)
- API changes: [architecture docs](../dev/architecture.md)

## Contributing to Agent Docs

To improve these docs:

1. Note what's missing or unclear
2. Test documentation against real agent usage
3. File issues with specific improvements
4. Reference the docs when implementing features
5. Keep docs in sync with implementation

## Related Documentation

For complementary information:

- **User Documentation:** [docs/user/](../user/) - For human users
- **Developer Documentation:** [docs/dev/](../dev/) - For xray developers
- **Strategy Documentation:** [docs/dev/strategies/](../dev/strategies/) - For strategy developers

## Key Takeaways

1. **xray is a tool for codebase-wide understanding**, not single-file analysis
2. **Choose the right command** for your question (master decision tree)
3. **Optimize for tokens** by starting simple and adding detail only when needed
4. **Have a recovery procedure** for every possible error
5. **Validate results** before proceeding with implementation
6. **Follow workflows** for common tasks (they're optimized and tested)
7. **Accumulate knowledge** across conversation turns instead of re-analyzing
8. **Parse output mechanically** following documented patterns

---

**Total Documentation:** 21 documents, ~33,000 words
**Target Audience:** AI coding agents (Claude, GPT, Copilot, etc.)
**Status:** Comprehensive, production-ready
**Last Updated:** January 2024
