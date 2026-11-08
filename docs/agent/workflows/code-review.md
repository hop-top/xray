# Workflow: Code Review Preparation

Step-by-step protocol for understanding code changes and preparing for effective code review.

**Time:** 10-15 minutes of analysis
**Tokens:** 700-1200
**Outcome:** Complete understanding of changes and their impact

## Prerequisites

- You have code changes to review (diff, PR, changeset)
- You need to understand what changed and why
- You can run xray commands

## Protocol Steps

### Phase 1: Change Identification (Token Budget: 150)

#### Step 1.1: Identify Changed Files

From PR/changeset, extract:
- What files were added?
- What files were modified?
- What files were deleted?

**Example:**
```
Modified:
  src/components/LoginForm.tsx
  src/services/auth.ts
  src/api/routes.ts

Added:
  src/hooks/useAuth.ts

Deleted:
  (none)
```

#### Step 1.2: Categorize Changes

```bash
# Find what type of changes
xray explore --match "*.tsx" --match "*.ts"
```

Categorize:
- UI changes (components, styles)
- API changes (routes, endpoints)
- Business logic changes (services, utilities)
- Test changes (test files)
- Configuration changes (config files)

### Phase 2: Architecture Impact Analysis (Token Budget: 400)

#### Step 2.1: Understand Changed Area

```bash
# For each changed file, understand its context
xray map --anchor src/components/LoginForm.tsx --with incs
xray map --anchor src/services/auth.ts --with incs
xray map --anchor src/api/routes.ts --with incs
```

**Success Criteria:**
- [ ] Know what dependencies each changed file has
- [ ] Know what depends on each changed file
- [ ] Understand scope of impact

#### Step 2.2: Find Related Code

```bash
# Find other code that might be affected
xray explore --match "*auth*" --match "*login*"

# See what patterns are used
xray react components  # for React changes
xray express routes  # for API changes
```

**Success Criteria:**
- [ ] Know if change is isolated or affects multiple areas
- [ ] Know if patterns are consistent with codebase
- [ ] Understand what else might need updating

#### Step 2.3: Verify Pattern Consistency

```bash
# Check if changes follow established patterns
xray react hooks  # if adding custom hook
xray express routes  # if adding new route
```

**Success Criteria:**
- [ ] Changes match codebase patterns (or justified deviation)
- [ ] No inconsistencies introduced
- [ ] Know if style/pattern questions to ask

### Phase 3: Change Analysis (Token Budget: 300)

#### Step 3.1: Review Each Change

For each modified file:

```
CHECKLIST:
├─ What specifically changed?
├─ Why did it change?
├─ Does it match the PR description?
├─ Does it match established patterns?
├─ Are there any obvious bugs?
├─ Are dependencies correct?
└─ Are there tests for the change?
```

#### Step 3.2: Identify Risk Areas

High risk areas to review carefully:

```
├─ Authentication/security related
├─ Data validation/processing
├─ Database operations
├─ External API calls
├─ Shared/reused code
├─ Public APIs
└─ Complex logic
```

Check if changes are in these areas:

```bash
xray explore --match "*auth*" --match "*validate*" --match "*db*"
```

#### Step 3.3: Check for Side Effects

```bash
# From earlier xray runs, identify what depends on changed files
# Do those dependents still work with the change?

Questions to ask:
├─ What imports this file?
├─ Will they still work?
├─ Are there any breaking changes?
└─ Are consumers updated?
```

### Phase 4: Testing Assessment (Token Budget: 200)

#### Step 4.1: Find Related Tests

```bash
xray explore --match "*.test.ts" --match "*.spec.ts"
```

Check:
- [ ] Are there tests for changed code?
- [ ] Do tests cover the change?
- [ ] Are new tests added?

#### Step 4.2: Verify Test Coverage

```bash
# Look for test patterns
xray explore --match "*.test.ts"

# Check if tests follow established patterns
```

Questions:
- [ ] Tests follow project conventions?
- [ ] Edge cases covered?
- [ ] Integration tests included?

### Phase 5: Review Summary (Token Budget: 50)

Prepare review summary:

```
CODE REVIEW SUMMARY
===================

WHAT CHANGED:
├─ Added: useAuth hook for authentication
├─ Modified: LoginForm component to use new hook
├─ Modified: Auth service to support new flow
└─ Scope: Affects login flow only

IMPACT ANALYSIS:
├─ Breaking changes: None
├─ Pattern consistency: Good
├─ Test coverage: Adequate
└─ Risk level: Low

REVIEW POINTS:
├─ Consider renaming hook for clarity
├─ Add error handling for network failures
├─ Verify performance implications
└─ Update documentation

QUESTIONS FOR AUTHOR:
├─ Why separate hook vs. context?
├─ How does this handle loading states?
└─ Any migration needed for existing code?
```

## Validation: Code Review Ready?

You're ready to review when:

- [ ] Understand all changes made
- [ ] Understand why changes were made
- [ ] Know what areas are affected
- [ ] Know test coverage
- [ ] Identified any potential issues
- [ ] Can explain impact to team
- [ ] Ready to give informed feedback

## Common Review Scenarios

### Scenario 1: Feature Addition

```
STEPS:
1. Understand what feature does
2. xray explore to find similar features
3. Verify new feature follows established patterns
4. Check all integration points
5. Verify test coverage
6. Assess performance impact
```

### Scenario 2: Bug Fix

```
STEPS:
1. Understand what bug was
2. Understand the fix
3. Verify fix is minimal (doesn't change other things)
4. Check if test case added to prevent regression
5. Assess if similar bugs exist elsewhere
```

### Scenario 3: Refactoring

```
STEPS:
1. Verify behavior unchanged
2. Check all tests pass
3. Verify no breaking API changes
4. Assess if consolidation is sound
5. Check documentation updated
```

### Scenario 4: Performance Optimization

```
STEPS:
1. Understand what was optimized
2. Verify performance measurement/before-after
3. Check for regressions (was anything made slower?)
4. Verify no trade-offs made (clarity, maintainability)
5. Check if similar optimizations needed elsewhere
```

## Review Point Checklist

### Correctness
- [ ] Logic is sound
- [ ] No obvious bugs
- [ ] Edge cases handled
- [ ] Error handling present

### Patterns
- [ ] Matches project conventions
- [ ] Uses established patterns
- [ ] No unnecessary deviations
- [ ] Naming is clear

### Quality
- [ ] Code is clear/readable
- [ ] Comments explain non-obvious parts
- [ ] No unnecessary complexity
- [ ] DRY principle followed

### Testing
- [ ] Tests exist and pass
- [ ] Test coverage adequate
- [ ] Edge cases tested
- [ ] Integration tested

### Impact
- [ ] Breaking changes documented
- [ ] Migrations handled
- [ ] Documentation updated
- [ ] No unintended side effects

### Performance
- [ ] No performance regressions
- [ ] Optimizations appropriate
- [ ] Memory usage acceptable
- [ ] Database queries optimized

### Security
- [ ] Input validation present
- [ ] No security vulnerabilities
- [ ] Authentication/authorization correct
- [ ] Secrets not exposed

## Questions to Ask During Review

**About the change:**
- What problem does this solve?
- Why was this approach chosen?
- Were alternatives considered?
- Are there similar issues elsewhere?

**About the implementation:**
- Why is this the right place for this code?
- Could this be simplified?
- Does this follow our patterns?
- Are there edge cases?

**About testing:**
- Are all cases tested?
- How was this tested?
- What happens in error conditions?
- Is performance tested?

**About impact:**
- What breaks if we change this?
- Do consumers need updates?
- Is this a breaking change?
- Will this affect performance?

## Pitfalls to Avoid

**Pitfall 1: Only Looking at Code, Not Context**
- Fix: Use xray to understand surrounding code
- Verify: Understand why change is there

**Pitfall 2: Nitpicking Style Instead of Logic**
- Fix: Focus on correctness first, style second
- Verify: Use project style guide for style comments

**Pitfall 3: Not Understanding Scope**
- Fix: Use xray to see full impact
- Verify: Don't be surprised after merge

**Pitfall 4: Assuming Tests Are Adequate**
- Fix: Check test code, not just that tests exist
- Verify: Test coverage matches change scope

**Pitfall 5: Approving Without Understanding**
- Fix: Ask questions until you understand
- Verify: Could you explain change to team?

## Success Indicators

Code review was effective when:

- [ ] Issues/improvements identified
- [ ] Author learned something from feedback
- [ ] Code quality improved
- [ ] No bugs made it to production
- [ ] Changes integrated smoothly
- [ ] Team consensus on approach

## Token Budget Optimization

**For quick reviews (time-constrained):**

```
1. Understand what changed (from PR title/description)
2. xray map on changed files (understand context)
3. Look for obvious issues
4. Result: Basic review done quickly
```

**For thorough reviews (careful assessment):**

```
1. Full xray analysis (all steps above)
2. Deep code inspection
3. Consider edge cases
4. Verify test coverage
5. Result: Comprehensive review
```

## Related Documentation

- [Command Selection](../command-selection.md) - Finding relevant code
- [Output Interpretation](../output-interpretation.md) - Understanding xray results
- [Optimal Usage Patterns](../optimal-usage-patterns.md) - Efficient analysis
- [Integration Protocol](../integration-protocol.md) - When to use xray

---

**Key Takeaway:** Effective code review requires understanding changes in context. Use xray to see the impact, read changed code carefully, think about edge cases, and ask clarifying questions. Good reviews prevent bugs before they reach production.
