# Error Handling and Recovery Protocols

Systematic approach to handling xray errors and recovering from failures.

## Error Classification

### Category 1: Recoverable Command Errors

**Characteristics:** xray command fails but error is fixable

**Examples:**
- Invalid path (typo or wrong directory)
- File permission denied
- Incorrect filter syntax
- Command timeout

**Recovery:** Modify command and retry

### Category 2: Informational Warnings

**Characteristics:** xray completes but with warnings

**Examples:**
- "No strategies detected"
- "Pattern matched 0 files"
- "Output exceeds token limit (truncated)"

**Recovery:** Interpret results, continue or refine

### Category 3: Unrecoverable Errors

**Characteristics:** xray fails and cause cannot be fixed by agent

**Examples:**
- Codebase corrupted
- File system errors beyond agent control
- xray process crash
- System resource exhaustion

**Recovery:** Fallback to file reads, ask user for help

## Machine-Readable Errors

Pass `--format json` (every command accepts it; `--json` on commands that
have it; `xray imports` needs no flag, its output is JSON by default) and a failing
command writes one JSON error object to **stderr**; stdout stays empty, so
anything on stdout is still a valid document. The exit code is the same as
in text mode. Add `--quiet` so stderr holds the object alone (without it,
log lines may precede it).

```json
{
  "code": "NOT_FOUND",
  "message": "Target \"nope\" not found in any build file",
  "exit_code": 3,
  "transience": "permanent"
}
```

| Field | Meaning |
|-------|---------|
| `code` | Stable token: `GENERIC`, `USAGE`, `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED`, `TRANSIENT`, `CONSENT_REFUSED` |
| `message` | What failed, with the offending input |
| `exit_code` | Same as the process exit code (1 to 7) |
| `transience` | `transient` (retry may clear it), `permanent` (change the input first), `unknown` |
| `suggested_fix`, `cause`, `alternatives` | Present only when the failure carries them |

Branch on `code` or `exit_code`, never on `message`. Usage errors (bad flag,
surplus argument, unknown command) use the same object with `code` `USAGE`.
`xray describe` lists the shape under `errors`. Without a JSON request,
errors stay a `✖ <message>` line on stderr.

## Error Handling Decision Tree

```
XRay Command Returns Error
│
├─ Is it an ERROR or WARNING?
│  │
│  ├─ ERROR:
│  │  │
│  │  ├─ "Invalid path"
│  │  │  └─ Fix: Check path, use absolute path, retry
│  │  │
│  │  ├─ "Permission denied"
│  │  │  └─ Fix: Change permissions, use different path, ask user
│  │  │
│  │  ├─ "No such file or directory"
│  │  │  └─ Fix: Verify directory exists, use correct path
│  │  │
│  │  ├─ "Pattern matched no files"
│  │  │  └─ Fix: Broaden pattern, remove filters, retry
│  │  │
│  │  ├─ "Timeout"
│  │  │  └─ Fix: Reduce scope, use --depth limit, use --match filter
│  │  │
│  │  ├─ "Strategy not found"
│  │  │  └─ Fix: Run strategy list, use correct name
│  │  │
│  │  └─ Other error:
│  │     └─ Retry once, then fallback to file reads
│  │
│  └─ WARNING:
│     │
│     ├─ "No strategies detected"
│     │  └─ Continue: Use generic analysis
│     │
│     ├─ "Output truncated"
│     │  └─ Action: Use --no-chunk or increase --limit
│     │
│     └─ Other warning:
│        └─ Continue: Warning doesn't block progress
│
├─ Can we fix it? YES → Attempt fix and retry
├─ Can we fix it? NO → Graceful degradation (see below)
└─ Ready to proceed? → Use available results
```

## Error Recovery Protocols

### Protocol: Invalid Path Error

**Error Message:**
```
Error: ENOENT: no such file or directory, scandir '[path]'
```

**Steps:**

```
1. VERIFY path exists
   Check: Is directory at [path]?
   TRY: ls [path]
   IF_NOT_FOUND: Ask user to confirm path

2. FIX path format
   CURRENT: xray map --path ./src
   TRY: xray map --path /absolute/path/src
   REASON: Absolute paths more reliable

3. RETRY with absolute path
   COMMAND: xray map --path /absolute/path/src
   SUCCESS?: Continue
   FAIL?: Go to "Unrecoverable Error" below

4. FALLBACK
   IF still fails: Ask user
   "I cannot find the directory. Could you provide the correct path?"
```

### Protocol: Permission Denied Error

**Error Message:**
```
Error: EACCES: permission denied, scandir '/root/protected'
```

**Steps:**

```
1. IDENTIFY problem
   Issue: Cannot read directory at [path]
   Reason: Insufficient permissions

2. TRY alternatives
   A) Use different path with read access
   B) Ask user to change permissions
   C) Ask user to provide accessible path

3. IMPLEMENT solution
   IF user provides alternative path:
     COMMAND: xray map --path <new-path>
   ELSE:
     "I don't have permission to read that directory.
      Could you provide a path I can access?"

4. FALLBACK
   IF cannot get access: Use file reads for available files
```

### Protocol: Pattern Matched No Files

**Error Message:**
```
Error: Pattern matched 0 files
No files found matching: *.nonexistent
```

**Steps:**

```
1. DIAGNOSE problem
   Question: Is pattern too narrow?
   Question: Are files in different location?
   Question: Different file extension?

2. BROADEN search
   Current pattern: --match "*.component.ts"
   Try: --match "*.ts"
   Try: Remove --match entirely
   Try: --match "*" (all files)

3. RETRY with broader pattern
   COMMAND: xray map --path ./src --match "*.ts"
   SUCCESS?: Found files, continue
   FAIL?: Go to step 4

4. VERIFY location
   Question: Are files in specified --path?
   TRY: xray explore --path ./src
   Result: Shows what files exist
   ACTION: Based on results, adjust --path or pattern

5. FALLBACK
   IF still no files: "Cannot find files matching criteria.
                      Here's what exists in [path]:
                      [list from explore]"
```

### Protocol: Command Timeout

**Error Message:**
```
Error: Command timed out after 30 seconds
```

**Steps:**

```
1. IDENTIFY cause
   Likely: Codebase too large
   Likely: Filters/patterns too broad

2. REDUCE scope
   Option A: Reduce depth
     FROM: xray map
     TO: xray map --depth 1
     TRY: --depth 2, --depth 3

   Option B: Narrow path
     FROM: xray map
     TO: xray map --path ./src --depth 2

   Option C: Add filters
     FROM: xray map
     TO: xray map --match "*.ts" --match "!*.test.ts"

   Option D: Use simpler command
     FROM: xray graph
     TO: xray map
     FROM: xray map --with incs --with vars --with docs
     TO: xray map

3. RETRY with reduced scope
   COMMAND: [modified from above]
   SUCCESS?: Continue
   FAIL?: Go to step 4

4. ESCALATE
   IF still times out after simplifying:
   "The codebase is very large.
    I'm analyzing [specific-area] instead.
    Would you like to specify a smaller area?"
```

### Protocol: Strategy Not Found

**Error Message:**
```
Error: Strategy 'typo' not found
Available strategies: react, express, rest-api, go-cli
```

**Steps:**

```
1. SHOW available strategies
   "Available strategies: react, express, rest-api, go-cli"

2. OFFER correction
   If user asked for "ract":
   "Did you mean 'react'? Let me try that..."
   COMMAND: xray react components

3. PROCEED with correct strategy
   SUCCESS?: Continue
   FAIL?: User strategy not applicable

4. HANDLE unavailable strategy
   User asked for unavailable strategy:
   "That strategy is not available in this codebase.
    Available: react, express, rest-api, go-cli
    Try one of these instead."
```

### Protocol: No Strategies Detected

**Warning Message:**
```
Warning: No strategies detected
Proceeding with generic analysis
```

**Steps:**

```
1. ACKNOWLEDGE limitation
   "Framework detection found no matches.
    Proceeding with generic code analysis."

2. CONTINUE with generic commands
   COMMAND: xray map --path ./src
   Use generic structure commands instead of framework-specific

3. INFER framework manually
   IF user mentions framework:
   "You mentioned [framework]. Let me look for [framework] patterns..."
   COMMAND: xray <strategy> <command>
   TRY with correct framework name

4. PROCEED
   Continue with available information
```

## Graceful Degradation

When xray fails and cannot be recovered, fall back to file reads.

### Pattern: Graceful Degradation

```
PHASE 1: TRY xray
  Command: xray [command with options]
  Result: Success? Use output, done
  Result: Recoverable error? Fix and retry (up to 2x)
  Result: Unrecoverable? Continue to PHASE 2

PHASE 2: FALLBACK to file reads
  Goal: Still accomplish task, just not codebase-wide analysis

  Questions to answer:
  - What specific files do you need to understand?
  - Can you read specific files directly?
  - Can you work with partial information?

  Action: Tell user
  "I couldn't analyze the full codebase, but I can help with
   specific files. What would you like me to look at?"

PHASE 3: CONTINUE with limited context
  - Work with files user provides
  - Ask targeted questions instead of broad exploration
  - Acknowledge limitations in analysis
```

### Example: Graceful Degradation in Action

```
Scenario: Need to understand React component patterns

Attempt 1: xray react components
Result: Timeout (codebase too large)

Attempt 2: xray map --path ./src/components --depth 1
Result: Permission denied

Fallback:
"I'm having trouble analyzing the full codebase.
Could you show me an existing component to understand the pattern?
Then I can help you create similar components without needing to
scan the entire codebase."

User provides: src/components/Button.tsx
Now I can: Analyze the pattern and implement new components
```

## Retry Strategy

**When to retry:**

- First attempt timed out? → Retry with reduced scope
- Typo in command? → Retry with correction
- Transient error? → Retry once more

**When NOT to retry:**

- Permission denied (won't change) → Fallback
- File not found (doesn't exist) → Ask user
- Pattern matched no files (need different approach) → Modify command
- After 2 failed attempts → Fallback to degradation

## Error Logging for Debugging

When you encounter errors, track:

```python
error_record = {
    'timestamp': '2024-01-22T10:30:00Z',
    'command': 'xray map --path ./src --depth 5',
    'error_message': 'Command timed out after 30 seconds',
    'error_type': 'Timeout',
    'recovery_attempted': 'Reduced depth to 2',
    'recovery_result': 'Success',
    'lessons_learned': 'Large codebases need --depth limit'
}
```

This helps identify patterns and improve future recovery.

## Common Error Scenarios and Solutions

### Scenario 1: "Just started, everything is unknown"

```
Error might be: Strategy not found, no matches, etc.

Solution:
1. Start with xray strategy detect (safe)
2. If fails: Use xray explore (fallback)
3. If fails: Ask user for guidance
4. Proceed with whatever information available
```

### Scenario 2: "Making progress, hit timeout"

```
Error: Timeout during deep analysis

Solution:
1. Reduce scope (smaller --path)
2. Reduce depth (--depth limit)
3. Add filters (--match patterns)
4. If still times out: Accept partial results
```

### Scenario 3: "User frustrated with errors"

```
Solution:
1. Acknowledge problem
2. Show what DID work
3. Offer alternative approach
4. Ask for help/input from user
5. Continue with hybrid approach
```

## Prevention: Avoid Common Errors

**Prevention Checklist:**

- [ ] Start with simple commands (strategy detect, explore) before complex ones
- [ ] Use --depth limits on large codebases
- [ ] Use --path to narrow scope when possible
- [ ] Check path exists before running (or handle error gracefully)
- [ ] Have fallback strategy for every command
- [ ] Log errors for learning
- [ ] Test on unfamiliar codebases incrementally
- [ ] Communicate limitations to user
- [ ] Always have Plan B

## When to Ask User for Help

**Ask user when:**

- Cannot find directory/files they mentioned
- Framework detection failed and you're unsure which to use
- Need specific files to understand pattern
- Permission denied and no alternative exists
- After 2-3 failed recovery attempts
- Codebase structure is unusual/unknown

**How to ask:**

```
"I'm trying to [goal], but I'm having trouble.
Could you help by providing:
- [Specific information needed]
- Or [Alternative information]
- Or [Different approach]"
```

## Related Documentation

- [Integration Protocol](integration-protocol.md) - When errors might occur
- [Output Interpretation](output-interpretation.md) - Parsing error messages
- [Token Optimization](token-optimization.md) - Not wasting tokens on retries

---

**Key Principle:** Every error has a recovery. Know the recovery, implement it, and don't get stuck. If truly stuck, ask user or gracefully degrade to alternative approach.
