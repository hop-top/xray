# Workflow: Bug Investigation and Debugging

Step-by-step protocol for investigating and debugging issues using xray.

**Time:** 15-20 minutes of analysis
**Tokens:** 600-1200
**Outcome:** Bug location identified, root cause understood, fix strategy formulated

## Prerequisites

- User has reported a specific issue or bug
- You can run xray commands
- You need to understand where the bug is and why it occurs

## Protocol Steps

### Phase 1: Issue Localization (Token Budget: 200)

#### Step 1.1: Identify Keywords

From user's bug report, extract keywords:

```
User says: "Payment page is showing wrong total"
Keywords: "payment", "total", "calculation"

Use these in explore --match patterns below
```

#### Step 1.2: Find Related Files

```bash
xray explore --match "*payment*" --match "*total*"
```

Or multiple separate scans if needed:

```bash
xray explore --match "*payment*"
xray explore --match "*checkout*"
xray explore --match "*order*"
```

**Success Criteria:**
- [ ] Found files related to bug area
- [ ] Know approximately where bug is
- [ ] Have file list to investigate

#### Step 1.3: Narrow Scope

If too many files found:

```bash
xray explore --match "*.service.ts" --match "*payment*"
```

If too few files found:

```bash
xray explore --match "*payment*"  # Broader pattern
```

### Phase 2: Context Analysis (Token Budget: 400)

#### Step 2.1: Map Bug Area

```bash
xray map --path ./src/payment --with incs
```

Or if uncertain about exact path:

```bash
xray map --anchor <suspected-main-file> --with incs
```

**Success Criteria:**
- [ ] Understand structure of bug area
- [ ] Know what files depend on each other
- [ ] Know external dependencies used

**What You Learn:**
- Organization of buggy area
- Dependencies and relationships
- Potential culprits

#### Step 2.2: Understand Data Flow

```bash
xray graph --path ./src/payment --with cf --with df
```

**Success Criteria:**
- [ ] Understand how data flows through area
- [ ] See control flow (if/else, loops, calls)
- [ ] Identify potential issue points

### Phase 3: Hypothesis Formation (Token Budget: 200)

Based on xray findings, formulate hypotheses:

```
HYPOTHESIS 1: Calculation wrong in payment service
HYPOTHESIS 2: Discount not being applied
HYPOTHESIS 3: Tax calculation incorrect
HYPOTHESIS 4: Data not being passed to template
```

For each hypothesis, identify:
- **What would cause it?** (code change needed)
- **Where in code?** (specific file from xray)
- **How to verify?** (what to check)

### Phase 4: Verification (Token Budget: 200)

For each hypothesis, gather evidence:

```bash
# Check if hypothesis 1 is likely
xray explore --match "*calculation*"
xray map --anchor src/payment/calculation.ts --with incs

# Check imports to see if discount service is used
xray explore --match "*discount*"
```

### Phase 5: Implementation Planning (Token Budget: 0)

Once bug is located and cause understood:

1. **Identify fix location** (from xray output)
2. **Understand what's wrong** (from analysis)
3. **Know what to change** (from understanding)
4. **Plan tests** (based on what breaks)

## Validation: Have You Succeeded?

You've succeeded when:

- [ ] Can point to specific file where bug is
- [ ] Can explain what's wrong in that file
- [ ] Can explain why it's wrong (root cause)
- [ ] Can identify what change fixes it
- [ ] Know what could break if you fix it
- [ ] Understand the correct behavior
- [ ] Ready to implement fix

## Common Debugging Scenarios

### Scenario 1: Feature Works Locally But Not Production

```bash
STEP 1: Find configuration-related files
→ xray explore --match "*config*" --match "*env*"

STEP 2: Find initialization code
→ xray map --anchor src/index.ts --with incs

STEP 3: Look for environment-dependent code
→ xray explore --match "*process.env*" --match "*if*"
```

### Scenario 2: Feature Works in Some Cases But Not Others

```bash
STEP 1: Find feature code
→ xray explore --match "*feature-name*"

STEP 2: Look at conditional logic
→ xray graph --with cf on that file

STEP 3: Identify which branch is broken
→ Understand the conditions
```

### Scenario 3: Performance Issue

```bash
STEP 1: Identify slow operation
→ xray explore --match "*slow-operation*"

STEP 2: Find what it calls
→ xray map --anchor <operation-file> --with incs

STEP 3: Analyze chain
→ Each call might be slow
```

## Error Recovery

**If xray fails during debugging:**

```
Fallback: Ask user
"Could you show me the [specific file] where you're seeing the issue?
Then I can help debug even without analyzing the full codebase."

User provides file → Read file → Debug from there
```

## Tips for Effective Debugging

- **Record hypotheses:** Write down what you think, then test
- **Use specific keywords:** Bug reports have clues, extract them
- **Follow data flow:** Understand how data moves through buggy area
- **Know dependencies:** What services/libraries are used?
- **Test hypotheses:** Don't assume, verify with xray findings
- **Look at similar code:** If similar feature works, compare

## Common Pitfalls

**Pitfall 1: Jumping to conclusions**
- Fix: Form multiple hypotheses, test each one

**Pitfall 2: Wrong scope**
- Fix: Start broad with explore --match, narrow with map

**Pitfall 3: Ignoring dependencies**
- Fix: Always use --with incs to see what's involved

**Pitfall 4: Assuming deterministic behavior**
- Fix: Race conditions, timing issues might be random

## Validation Checklist

Before implementing fix, verify:

- [ ] Located specific line(s) with bug
- [ ] Understand why current code is wrong
- [ ] Know what correct behavior should be
- [ ] Verified with xray + file inspection
- [ ] Identified potential side effects
- [ ] Know what tests should cover this
- [ ] Have recovery plan if fix breaks other things

## Next Steps

After debugging workflow:

1. **Implement Fix:** Based on understanding
2. **Write Tests:** Cover the bug case
3. **Verify Fix:** Test locally and in production
4. **Document:** Add comment explaining the fix

## Related Documentation

- [Command Selection](../command-selection.md) - Choosing commands
- [Output Interpretation](../output-interpretation.md) - Understanding results
- [Error Handling](../error-handling.md) - When things go wrong
- [Integration Protocol](../integration-protocol.md) - xray in workflows

---

**Key Takeaway:** Debugging is about narrowing scope, understanding context, and testing hypotheses. Use xray to map the area, then inspect specific files to understand the bug. Never jump to fixes without understanding root cause.
