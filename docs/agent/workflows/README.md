# Agent Workflow Protocols

This section contains step-by-step protocols for common development tasks. Each protocol is designed to be mechanically executable by an agent.

## Available Workflows

### 1. [Codebase Understanding](codebase-understanding.md)

**When:** You need to understand a new or unfamiliar codebase before doing analysis or implementation

**Time:** 5-10 minutes of xray analysis
**Tokens:** 500-1000 tokens
**Outcome:** High-level understanding of architecture, frameworks, and main components

**Sample use cases:**
- New developer joining project
- Agent taking on code analysis task in unfamiliar codebase
- Understanding dependencies before making changes
- Planning refactoring or major changes

**Key questions answered:**
- What is the tech stack?
- How is the code organized?
- What are the main components/modules?
- What patterns are used throughout?

### 2. [Bug Investigation](bug-investigation.md)

**When:** Debugging an issue or unexpected behavior

**Time:** 10-15 minutes of analysis
**Tokens:** 600-1200 tokens
**Outcome:** Hypothesis about bug location and understanding of affected areas

**Sample use cases:**
- User reports a bug
- Tests failing in specific area
- Unexpected behavior reported
- Performance issue needs root cause

**Key questions answered:**
- Where is the bug likely located?
- What code paths are involved?
- What dependencies might be affected?
- What are similar patterns elsewhere?

### 3. [Feature Implementation](feature-implementation.md)

**When:** Adding new functionality to the codebase

**Time:** 15-20 minutes of analysis and planning
**Tokens:** 1000-1500 tokens
**Outcome:** Implementation plan with specific files and patterns to follow

**Sample use cases:**
- User requests new feature
- Adding support for new framework
- Extending existing functionality
- Integrating new library/service

**Key questions answered:**
- Where should this feature go?
- What patterns should I follow?
- What dependencies exist?
- Where are similar features implemented?

### 4. [Refactoring](refactoring.md)

**When:** Restructuring code to improve quality/clarity without changing behavior

**Time:** 15-20 minutes of analysis
**Tokens:** 1000-1500 tokens
**Outcome:** Safety analysis and refactoring plan

**Sample use cases:**
- User wants to improve code structure
- Consolidating duplicate code
- Improving naming/organization
- Reducing complexity

**Key questions answered:**
- What depends on this code?
- What will break if we change it?
- Are there duplicate patterns to consolidate?
- What's the safest way to refactor?

### 5. [Code Review](code-review.md)

**When:** Preparing for or conducting code review

**Time:** 10-15 minutes of analysis
**Tokens:** 700-1200 tokens
**Outcome:** Understanding of changes and potential issues

**Sample use cases:**
- Preparing to review changes
- Analyzing pull request impact
- Understanding new code in unfamiliar area
- Assessing testing coverage

**Key questions answered:**
- What changed and why?
- What areas are affected?
- Are there similar patterns elsewhere?
- What could break?

### 6. [Impact Analysis](impact-analysis.md)

**When:** You are about to change a function or method and need to know what breaks

**Time:** 2-5 minutes of analysis
**Tokens:** 400-1500 tokens
**Outcome:** Callers grouped by package, marked confirmed (`EXTRACTED`) or name-only (`INFERRED`), and a change plan

**Sample use cases:**
- Changing a function signature or return type
- Renaming or removing a method
- Checking whether other repositories in the workspace call a symbol
- Listing call sites to update in one commit

**Key questions answered:**
- Who calls this, directly and transitively?
- Which callers are confirmed and which are name matches?
- Does any other repo call it?
- Which call sites must change together?

## Protocol Structure

Each workflow follows this structure:

```
### Protocol: [Task Name]

**Description:** What this protocol accomplishes

**Prerequisites:**
- What you need before starting
- Assumptions about your knowledge/context

**Steps:**
1. First step with:
   - Action to take
   - Expected result
   - Success criteria

2. Second step with:
   - Action to take
   - Expected result
   - Success criteria

**Validation:**
- How to verify you completed it successfully

**Pitfalls:**
- Common mistakes to avoid
- What could go wrong

**Next Steps:**
- What to do after completing this protocol
```

## How to Use These Workflows

### As an Agent

1. **Identify your task** from the list above
2. **Read the relevant workflow** completely before starting
3. **Follow the steps mechanically** in order
4. **At each step:**
   - Run the specified command(s)
   - Validate the results
   - Proceed or troubleshoot
5. **At the end:**
   - Verify validation criteria
   - Note what you learned
   - Proceed with implementation/analysis

### Workflow Selection Decision Tree

```
WHAT ARE YOU DOING?
│
├─ Starting work on unfamiliar code
│  └─ USE: Codebase Understanding
│
├─ Debugging an issue
│  └─ USE: Bug Investigation
│
├─ Implementing a feature
│  └─ USE: Feature Implementation
│
├─ Refactoring/restructuring code
│  └─ USE: Refactoring
│
├─ Reviewing code changes
│  └─ USE: Code Review
│
├─ Changing a function/method ("what breaks if I change X?")
│  └─ USE: Impact Analysis
│
└─ Something else
   ├─ Could it fit one of above? → Use that workflow
   └─ Otherwise → Read general docs and adapt workflow
```

## Cross-Workflow Patterns

These patterns appear in multiple workflows:

### Pattern: Discovery
```
When: You need to understand what exists

Steps:
1. xray strategy detect (if framework unknown)
2. xray explore (if file list needed)
3. xray <strategy> <command> (if patterns needed)

Use in:
- Codebase Understanding (early steps)
- Feature Implementation (discovery phase)
- Code Review (understanding changes)
```

### Pattern: Context Building
```
When: You need architectural understanding

Steps:
1. xray map --path ./src --depth 2 (overall structure)
2. xray map --anchor <key-file> (focused area)
3. xray map --with incs (dependencies)

Use in:
- Codebase Understanding (middle steps)
- Bug Investigation (narrowing scope)
- Feature Implementation (planning phase)
```

### Pattern: Blast Radius
```
When: You need to know what calls a function before changing it

Steps:
1. xray impact <symbol> --depth 3 (callers by area)
2. xray impact <symbol> --format table (per-caller confidence)
3. xray impact <symbol> --lens <name> (every repo in the workspace)
4. xray explore --search <symbol> (call lines; what the graph misses)

Use in:
- Impact Analysis (all steps)
- Refactoring (impact analysis phase)
- Code Review (what could break)
```

### Pattern: Deep Analysis
```
When: You need to understand specific code deeply

Steps:
1. Identify relevant file(s)
2. xray map --anchor <file> --with incs (see dependencies)
3. xray graph --with cf --with df (see flow)
4. Read specific files

Use in:
- Bug Investigation (final steps)
- Code Review (impact analysis)
- Refactoring (safety analysis)
```

## Token Budget by Workflow

| Workflow | Min Tokens | Typical | Max |
|----------|-----------|---------|-----|
| Codebase Understanding | 400 | 700 | 1000 |
| Bug Investigation | 500 | 900 | 1200 |
| Feature Implementation | 800 | 1200 | 1500 |
| Refactoring | 700 | 1100 | 1500 |
| Code Review | 600 | 900 | 1200 |
| Impact Analysis | 400 | 900 | 1500 |

## Success Indicators by Workflow

### Codebase Understanding Success
- Can explain the project structure
- Know what frameworks are used
- Can name 3+ key files/modules
- Understand the main architecture
- Know where to look for specific things

### Bug Investigation Success
- Have narrowed down likely location
- Understand how data flows to/from bug
- Know what tests to run
- Can explain how bug manifested
- Ready to implement fix

### Feature Implementation Success
- Know where feature goes
- Know what pattern to follow
- Understand dependencies
- Have list of files to create/modify
- Ready to implement

### Refactoring Success
- Know what depends on code being refactored
- Have safety plan (what to test)
- Know if there are patterns to consolidate
- Ready to refactor safely

### Code Review Success
- Understand what changed
- Understand why it changed
- Know what areas are affected
- Can assess impact and risks

### Impact Analysis Success
- Know every direct caller and which are confirmed
- Know whether other repos call the symbol
- Have call sites to update, per package
- Know which tests cover the deeper callers

## Troubleshooting Workflows

**If a workflow step fails:**

1. **Validate the failure**
   - Did xray command error?
   - Did results seem wrong?
   - Did you misunderstand output?

2. **Try to recover**
   - See: [Error Handling Guide](../error-handling.md)
   - Or: See specific workflow troubleshooting section

3. **If unrecoverable**
   - Skip to next step
   - Note what you couldn't learn
   - Proceed with partial understanding
   - See [Graceful Degradation Pattern](../error-handling.md#graceful-degradation)

## Adapting Workflows

Workflows are templates. Adapt as needed for your context:

### If token budget is low
- Skip detailed steps
- Use simpler commands (explore instead of map)
- Focus on essentials only

### If you have plenty of tokens
- Add more detail (--with flags)
- Do deeper analysis
- Verify your findings

### If the codebase is small
- Skip depth limits
- Use broader scopes
- Less filtering needed

### If the codebase is large
- Add depth limits
- Use filtering more
- Focus scope narrowly

## Related Documentation

- [Command Selection](../command-selection.md) - Choose specific commands
- [Integration Protocol](../integration-protocol.md) - When to use workflows
- [Output Interpretation](../output-interpretation.md) - Understand xray output
- [Error Handling](../error-handling.md) - Handle failures

---

**Key Point:** Workflows are step-by-step guides to accomplish real tasks. Follow them mechanically, validate at each step, and proceed when validation succeeds.
