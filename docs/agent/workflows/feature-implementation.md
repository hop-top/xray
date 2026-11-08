# Workflow: Feature Implementation

Step-by-step protocol for implementing a new feature from discovery through integration.

**Time:** 20-30 minutes of analysis and planning
**Tokens:** 1000-1500
**Outcome:** Implementation plan with specific files, patterns, and dependencies

## Prerequisites

- User has requested a specific feature to implement
- You have access to the codebase
- You can run xray commands

## Protocol Steps

### Phase 1: Discovery (Token Budget: 300)

#### Step 1.1: Detect Frameworks

```bash
xray strategy detect
```

**Success Criteria:**
- [ ] Command completed
- [ ] Frameworks identified or noted as unknown

**What You Learn:**
- What tech stack you're working with
- What pattern-finding commands are available

#### Step 1.2: Find Similar Features

**Decision:** Does a similar feature exist?

```bash
# For React/Vue projects
xray react components

# For Express/Node projects
xray express routes

# General search
xray explore --match "*<related-keyword>*"
```

**Success Criteria:**
- [ ] Found existing similar feature
- [ ] Know where similar code is located
- [ ] OR confirmed no similar feature exists

**What You Learn:**
- Pattern to follow (if exists)
- Files to examine
- Where in codebase to place new code

### Phase 2: Planning (Token Budget: 500)

#### Step 2.1: Understand High-Level Architecture

```bash
xray map --path ./src --depth 2
```

**Success Criteria:**
- [ ] Understand directory organization
- [ ] Know where different types of files are
- [ ] Can identify where new feature should go

**What You Learn:**
- Project structure
- Where to add new files
- Layer organization (components, services, etc.)

#### Step 2.2: Study Similar Feature Pattern

If similar feature exists:

```bash
xray map --anchor <similar-feature-file> --with incs
```

**Success Criteria:**
- [ ] Understand how similar feature is implemented
- [ ] Know what dependencies it uses
- [ ] Understand file structure/naming

**What You Learn:**
- Pattern to follow
- Dependencies to use
- Naming conventions
- Integration points

**If No Similar Feature:**
```bash
xray map --path ./src --depth 3 --with incs
```

Learn the general patterns and structure instead.

#### Step 2.3: Identify Integration Points

**Question:** How does this feature connect to rest of app?

```bash
# For React: How does it connect to app state?
xray react hooks

# For Express: How does it connect to routes?
xray express routes

# For all: Understand dependency relationships
xray map --anchor <key-file> --with incs
```

**Success Criteria:**
- [ ] Identified where feature needs to be registered/imported
- [ ] Know what other systems it needs to interact with
- [ ] Understand authentication/authorization requirements if needed

**What You Learn:**
- Where to wire in new feature
- Dependencies to manage
- Testing requirements

### Phase 3: Analysis (Token Budget: 300)

#### Step 3.1: Deep Dive on Key Files

```bash
# If React component-heavy feature
xray react components

# If API-heavy feature
xray rest-api endpoints

# If data-heavy feature
xray explore --match "*model*" --match "*schema*" --match "*service*"
```

**Success Criteria:**
- [ ] Identified specific files to examine
- [ ] Know naming patterns
- [ ] Understand conventions

#### Step 3.2: Check Dependencies and Services

```bash
xray explore --match "*service*"
```

**Success Criteria:**
- [ ] Identified available services
- [ ] Know how services are structured
- [ ] Can decide if new service needed

**What You Learn:**
- Existing utilities and services to reuse
- Patterns for service organization
- How to avoid duplication

### Phase 4: Validation (Token Budget: 200)

#### Step 4.1: Verify Plan Against Findings

**Checklist:**

- [ ] Know exactly where to add new code (specific directory)
- [ ] Know what pattern/naming convention to follow
- [ ] Identified similar features to learn from
- [ ] Know what files need modification
- [ ] Know what dependencies to use
- [ ] Know integration points
- [ ] Understand testing strategy

#### Step 4.2: Check for Blockers or Concerns

**Questions to answer:**

1. Will this break existing code?
   ```
   → Use xray to check dependents
   → If breaking change: need migration plan
   ```

2. Do we have all dependencies available?
   ```
   → From earlier xray run, check what's already available
   → Identify missing dependencies
   ```

3. Are there conflicting patterns?
   ```
   → Did xray show similar features?
   → Do they use different patterns?
   → Which pattern should you follow?
   ```

## Implementation Plan Template

After completing protocol, you should have:

```
FEATURE IMPLEMENTATION PLAN
==========================

Feature: [Name of feature]
Framework(s): [Detected frameworks]

PHASE 1: NEW FILES
├─ Component/Module: [Name]
│  ├─ Path: [src/location/FileName.tsx]
│  ├─ Pattern: [From similar feature]
│  └─ Dependencies: [react, lodash, etc.]
├─ Service: [Name] (if needed)
│  └─ Path: [src/services/featureName.ts]
└─ Tests: (Corresponding .test.ts files)

PHASE 2: MODIFIED FILES
├─ [src/App.tsx] - Register new component
├─ [src/index.ts] - Export if needed
├─ [src/types/index.ts] - Add types if needed
└─ [src/services/api.ts] - Add API calls if needed

PHASE 3: PATTERNS TO FOLLOW
├─ Similar Feature: [File from xray]
├─ Naming: [Convention found]
├─ Import Style: [How imports are organized]
├─ Service Pattern: [How services work]
└─ Testing: [How tests are structured]

PHASE 4: DEPENDENCIES
├─ External: [react, express, etc.]
├─ Internal: [services/*, components/*, etc.]
└─ New: [Dependencies to add to package.json]

PHASE 5: INTEGRATION POINTS
├─ Registration: [Where to register/import]
├─ Data Flow: [How data flows]
├─ Error Handling: [How errors are handled]
└─ Testing: [What to test]
```

## Success Validation

You've succeeded when:

- [ ] Can list all files to create/modify
- [ ] Can explain pattern for each file
- [ ] Can describe dependencies
- [ ] Know where to register new code
- [ ] Understand testing strategy
- [ ] Identified potential issues/blockers
- [ ] Ready to implement without more xray calls

## Common Pitfalls

**Pitfall 1: Overlooking Dependencies**
- **Issue:** Found pattern but didn't check what it imports
- **Fix:** Use `xray map --anchor <file> --with incs` to see dependencies

**Pitfall 2: Wrong Integration Point**
- **Issue:** Created feature but didn't wire it into app
- **Fix:** Use `xray explore` to find where similar features are wired

**Pitfall 3: Ignoring Conventions**
- **Issue:** Created feature with different naming/structure than rest of app
- **Fix:** Use xray to find similar features and match their patterns

**Pitfall 4: Missing Test Files**
- **Issue:** Didn't account for test files in plan
- **Fix:** Check xray output for existing tests to understand pattern

**Pitfall 5: Underestimating Scope**
- **Issue:** Feature turned out to need more changes than planned
- **Fix:** Review all integration points with xray before starting

## Token Budget Optimization

**If you have less than 1000 tokens:**

```
Priority order:
1. strategy detect + similar feature search (150 tokens)
2. High-level map (250 tokens)
3. Key file analysis (300 tokens)
Skip: Deep dependency analysis
Result: Basic implementation plan
```

**If you have 1000-1500 tokens:**

```
Follow full protocol:
1. Discovery (300 tokens)
2. Planning (500 tokens)
3. Analysis (300 tokens)
4. Validation (200 tokens)
Result: Complete implementation plan
```

**If you have 1500+ tokens:**

```
Full protocol plus refinement:
1. Discovery (300 tokens)
2. Planning (500 tokens)
3. Analysis (400 tokens)
4. Validation (300 tokens)
5. Deep verification (100+ tokens)
Result: Very detailed implementation plan
```

## Next Steps

After completing this workflow:

1. **Implement:** Use your plan to write code
2. **Reference:** Keep xray output handy for pattern reference
3. **Verify:** Check implementation against patterns found
4. **Test:** Write tests following discovered patterns
5. **Review:** Have code reviewed by team

## Troubleshooting

**Problem: Can't find similar feature**
- Recovery: Look at framework patterns with `xray explore`
- Continue with generic structure based on framework

**Problem: Too many integration points**
- Recovery: Re-run `xray map --anchor <file>` on each one
- Focus on most critical first

**Problem: Conflicting patterns in codebase**
- Recovery: Ask team which pattern to follow
- Follow the most common one from xray results

**Problem: Feature seems too complex**
- Recovery: Break into smaller features
- Plan each part separately

## Related Documentation

- [Command Selection](../command-selection.md) - Choose specific commands
- [Integration Protocol](../integration-protocol.md) - General xray usage
- [Token Optimization](../token-optimization.md) - Manage token budget
- [Output Interpretation](../output-interpretation.md) - Parse xray results

---

**Key Takeaway:** Implementation success depends on understanding patterns before coding. Use xray to find those patterns, then follow them exactly. Most bugs come from deviating from established patterns.
