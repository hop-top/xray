# Workflow: Safe Refactoring

Step-by-step protocol for planning and executing code refactoring safely using xray.

**Time:** 20-25 minutes of analysis
**Tokens:** 1000-1500
**Outcome:** Refactoring plan with safety validation and testing strategy

## Prerequisites

- You want to refactor code (improve quality without changing behavior)
- You need to understand impact before making changes
- You can run xray commands

## Protocol Steps

### Phase 1: Scope Definition (Token Budget: 200)

#### Step 1.1: Identify What to Refactor

User specifies what to refactor:
- "Consolidate duplicate auth code"
- "Improve component structure"
- "Simplify service layer"

#### Step 1.2: Find All Related Code

```bash
# Find files with refactoring keywords
xray explore --match "*auth*"  # for auth consolidation
xray explore --match "*component*"  # for component refactoring
```

**Success Criteria:**
- [ ] Know approximately what will be affected
- [ ] Have list of files to examine

### Phase 2: Impact Analysis (Token Budget: 600)

#### Step 2.1: Map Dependencies

```bash
xray map --anchor <file-to-refactor> --with incs
```

For each file being refactored:

**Success Criteria:**
- [ ] Know what imports this file
- [ ] Know what this file imports
- [ ] Understand the dependency graph

#### Step 2.2: Find All Uses

```bash
# Find everywhere this code is used
xray explore --match "!*.test.ts"

# Manually check what depends on it (from previous map output)
```

**Success Criteria:**
- [ ] Know all files that depend on code being refactored
- [ ] Know scope of impact
- [ ] Can assess breaking change risk

#### Step 2.3: Check for Duplicates

If consolidating code:

```bash
xray explore --match "*similar-pattern*"
```

**Success Criteria:**
- [ ] Found all instances of duplicated code
- [ ] Understand variations between them
- [ ] Know if they can be truly consolidated

### Phase 3: Refactoring Strategy (Token Budget: 300)

#### Step 3.1: Study Existing Patterns

```bash
xray <strategy> <command>  # See how similar code is structured
xray map --anchor <similar-file>  # Understand pattern
```

#### Step 3.2: Plan Refactoring

Document the plan:

```
REFACTORING PLAN
================

FILES TO MODIFY:
├─ src/auth/service.ts (consolidate auth logic)
├─ src/auth/middleware.ts (update imports)
├─ src/api/routes.ts (update imports)
└─ src/components/Login.tsx (update imports)

FILES TO DELETE:
├─ src/auth/oldAuth.ts (consolidate into service)
└─ src/auth/deprecatedHelper.ts (no longer needed)

BREAKING CHANGES:
├─ Export names change: oldExportName → newExportName
├─ API path doesn't change
└─ Behavior is identical

TESTING STRATEGY:
├─ All existing tests must pass (no behavior change)
├─ Run tests for all dependent modules
└─ Integration tests for auth flow
```

### Phase 4: Safety Validation (Token Budget: 500)

#### Step 4.1: Verify No Breaking Changes

```bash
# Get list of all references
xray explore --match "*"

# From earlier map, understand all dependencies
```

Check:
- [ ] All import statements will be updated
- [ ] No hardcoded references to old structure
- [ ] Public API doesn't change (or have deprecation plan)

#### Step 4.2: Plan Tests

```bash
xray explore --match "*.test.ts"
```

Identify tests that cover:
- [ ] Code being refactored
- [ ] Code that depends on it
- [ ] Integration points

#### Step 4.3: Create Rollback Plan

```
IF SOMETHING BREAKS:
├─ Identify the breaking change
├─ Revert the specific change
├─ Update imports/references
└─ Re-test

KEY TESTS TO RUN:
├─ Unit tests for refactored code
├─ Tests for all dependent code
├─ Integration tests for features using this code
└─ End-to-end tests if critical path
```

### Phase 5: Implementation Planning (Token Budget: 300)

Create step-by-step implementation plan:

```
STEP 1: Create new consolidated function
  Location: src/auth/service.ts
  Pattern: Based on existing pattern from xray
  Behavior: Same as original

STEP 2: Update imports in dependent files
  Files: (from xray dependency analysis)
  Change: Redirect imports to new location

STEP 3: Run tests
  Command: npm test
  Success: All tests pass

STEP 4: Delete old code
  Files: (identified in planning phase)
  Verify: No remaining references

STEP 5: Final validation
  Verify: All dependent code works
  Run: Full test suite
```

## Validation: Safe to Refactor?

Before proceeding, verify:

- [ ] Identified all affected files (from xray)
- [ ] No breaking changes to public API
- [ ] Have complete test coverage
- [ ] Know exact steps to implement
- [ ] Have rollback plan
- [ ] All dependencies understood
- [ ] Can implement without breaking builds

## Common Refactoring Scenarios

### Scenario 1: Consolidate Duplicate Code

```
GOAL: Remove duplicate auth logic in 3 places

STEPS:
1. xray explore --match "*auth*" (find all auth code)
2. Compare the 3 implementations
3. xray map to understand dependencies
4. Create consolidated version
5. Update imports in all 3 places
6. Delete old code
```

### Scenario 2: Improve Component Structure

```
GOAL: Reorganize React component hierarchy

STEPS:
1. xray react components (see current structure)
2. Identify components to move/restructure
3. xray map on component files (understand imports)
4. Plan new structure
5. Move/reorganize files
6. Update imports
7. Run component tests
```

### Scenario 3: Simplify Service Layer

```
GOAL: Reduce number of service files

STEPS:
1. xray explore --match "*.service.ts" (list all services)
2. xray map on each service (understand dependencies)
3. Identify which can be consolidated
4. Create consolidated service
5. Update imports in all dependent files
6. Delete old services
7. Run service tests
```

## Pitfalls to Avoid

**Pitfall 1: Underestimating dependencies**
- Fix: Use xray --with incs to see all dependencies
- Verify: Check every reference was found

**Pitfall 2: Changing behavior during refactoring**
- Fix: Refactor structure only, don't change logic
- Verify: All tests should pass unchanged

**Pitfall 3: Not updating all references**
- Fix: Use xray explore to find all references
- Verify: Build should work after changes

**Pitfall 4: Breaking public API**
- Fix: Only refactor internal structure
- If API changes: Have deprecation plan
- Verify: All consumers updated before deletion

**Pitfall 5: Missing test coverage**
- Fix: Identify tests before refactoring
- Verify: Tests still pass after changes

## Success Indicators

Refactoring succeeded when:

- [ ] All tests pass (behavior unchanged)
- [ ] Code is simpler/clearer
- [ ] No new dependencies introduced
- [ ] Public API unchanged (or properly deprecated)
- [ ] Performance same or better
- [ ] Builds without errors
- [ ] Code review approves changes

## Token Budget Optimization

**If token budget is tight:**

```
Skip: Deep analysis of unrelated code
Do: Focus on code being refactored
Do: Check only direct dependencies
Result: Slightly more risk, but can proceed
```

## Related Documentation

- [Command Selection](../command-selection.md) - Finding files
- [Output Interpretation](../output-interpretation.md) - Understanding dependencies
- [Optimal Usage Patterns](../optimal-usage-patterns.md) - Efficient analysis
- [Error Handling](../error-handling.md) - Handling problems

---

**Key Takeaway:** Safe refactoring requires understanding all dependencies before making changes. Use xray to map the impact, plan carefully, and test thoroughly. Behavior should not change, only structure improves.
