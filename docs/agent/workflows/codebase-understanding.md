# Workflow: Understanding a New Codebase

Step-by-step protocol for understanding an unfamiliar codebase from first xray invocation to actionable knowledge.

**Time:** 10-15 minutes of analysis
**Tokens:** 500-1000
**Outcome:** Can explain architecture, know frameworks, identify key files and patterns

## Prerequisites

- You have access to the codebase directory
- You can run xray commands
- You need to understand the codebase before doing specific work

## Protocol Steps

### Step 1: Detect Frameworks

**Action:** Run framework detection to understand the tech stack

```bash
xray strategy detect
```

**Expected Output:**
```
Detected Strategies:
  - react (v0.0.1): React framework detected
  - express (v0.0.1): Express.js detected
  - rest-api (v0.0.1): REST API patterns detected
```

**Success Criteria:**
- [ ] Command completed without error
- [ ] Output shows detected frameworks (or says "No strategies detected")
- [ ] If no strategies detected, proceed anyway (might be custom framework)

**What You Learned:**
- Framework ecosystem (React, Express, Vue, Angular, etc.)
- Technology decisions made in project
- What specialized commands are available (`xray react ...`, `xray express ...`, etc.)

**Next If Unclear:** If frameworks are unclear, continue to Step 2 to understand structure

### Step 2: Map High-Level Structure

**Action:** Get directory structure with limited depth to see organization

```bash
xray map --path ./src --depth 2
```

(Adjust `./src` if main code is elsewhere: `./app`, `./lib`, `/server`, etc.)

**Expected Output:**
```
src/ (L1-L50):
│ [main module files]
├── api/
│   │ [API-related files]
│   ├── routes.ts
│   ├── middleware.ts
│   └── controllers/
├── components/
│   │ [UI components]
│   ├── Button.tsx
│   └── Card.tsx
└── services/
    │ [Business logic]
    ├── auth.ts
    └── db.ts
```

**Success Criteria:**
- [ ] Command completed without error
- [ ] Output shows directory structure (tree view)
- [ ] Can see at least top-level directories
- [ ] Files are listed with line ranges

**What You Learned:**
- How code is organized (by feature, by layer, by type)
- What directories exist
- Approximate size of each directory
- Naming conventions

**If Too Broad:**
```bash
# Try smaller depth
xray map --path ./src --depth 1
```

**If Too Narrow:**
```bash
# Try larger depth or no limit
xray map --path ./src
```

### Step 3: Explore Framework-Specific Patterns

**Action:** For each detected framework, explore what exists

**For React projects:**
```bash
xray react components
```

**For Express projects:**
```bash
xray express routes
```

**For REST API projects:**
```bash
xray rest-api endpoints
```

**For Go CLI projects:**
```bash
xray go-cli commands
```

**Expected Output (React example):**
```
React Components:
  App - src/App.tsx
  Button - src/components/Button.tsx
  Header - src/components/Header.tsx
  UserProfile - src/components/UserProfile.tsx
```

**Success Criteria:**
- [ ] Command completed without error
- [ ] Output lists specific items (components, routes, endpoints)
- [ ] Can see file paths for each item
- [ ] Shows what you were looking for

**What You Learned:**
- What high-level building blocks exist (components, routes, etc.)
- Where key files are located
- What patterns are used
- Overall architecture at this level

**If No Output:** Might not be applicable, skip and continue

### Step 4: Examine Entry Points

**Action:** Understand how the application starts/initializes

```bash
# For frontend (React, Vue, Angular)
xray map --anchor src/index.ts --with incs
# or
xray map --anchor src/main.ts --with incs
# or
xray map --anchor src/App.tsx --with incs

# For backend (Express, Django, etc.)
xray map --anchor src/server.ts --with incs
# or
xray map --anchor src/index.ts --with incs
```

**Expected Output:**
```
src/App.tsx (L1-L150):
│ [imports]
├── react dependencies
├── component imports
│ [main component]
├── function App
│ [sub-components and logic]

## External Dependencies
| Library | Used By |
|---------|---------|
| react | App.tsx, hooks.ts |
| react-router-dom | App.tsx |
| axios | services/api.ts |
```

**Success Criteria:**
- [ ] Command completed without error
- [ ] Output shows entry point content
- [ ] Can see what's imported
- [ ] Understand dependencies

**What You Learned:**
- What initialization looks like
- Main dependencies
- Structure of entry point
- How things are connected

**If Wrong File:**
Based on your framework, look for:
- React/Vue/Angular: `index.tsx`, `main.tsx`, `App.tsx`, `bootstrap.ts`
- Express/Node: `server.ts`, `index.ts`, `app.ts`
- Python: `main.py`, `wsgi.py`, `manage.py`

### Step 5: Understand Configuration & Environment

**Action:** Check for important configuration files

```bash
xray explore --path ./ --match ".env*" --match "*config*" --match "package.json" --match "*.yaml"
```

**Expected Output:**
```
Found 12 files:
  .env
  .env.example
  .env.local
  config/
    development.ts
    production.ts
    index.ts
  package.json
```

**Success Criteria:**
- [ ] Command completed without error
- [ ] Found config files
- [ ] Found package.json or equivalent
- [ ] Know about environment variables

**What You Learned:**
- How configuration is managed
- What environment variables are used
- Project dependencies (from package.json)
- Development vs. production setup

### Step 6: Map Dependencies & Architecture

**Action:** Get complete picture of relationships

```bash
xray map --path ./src --with incs --depth 2
```

**Expected Output:**
```
## External Dependencies
| Library | Used By |
|---------|---------|
| express | server.ts, api/routes.ts |
| react | components/* |
| axios | services/api.ts |
| lodash | utils/helpers.ts |

## Internal Relationships
src/api/routes.ts:
  └─ imports from: services/auth.ts, services/db.ts

src/components/UserProfile.tsx:
  └─ imports from: components/Button.tsx, services/api.ts
```

**Success Criteria:**
- [ ] Command completed without error
- [ ] Can see external dependencies
- [ ] Can see internal relationships
- [ ] Dependencies make sense

**What You Learned:**
- External libraries used
- How files depend on each other
- Layering/architecture patterns
- Integration points

## Validation: Have You Succeeded?

You've successfully understood the codebase when you can:

- [ ] **Describe Architecture:** "This is a React frontend with Express backend using..."
- [ ] **Name Frameworks:** Specifically list technologies in use
- [ ] **Identify Key Files:** "The main entry point is X, API layer is in Y, components in Z"
- [ ] **Explain Organization:** "Code is organized by feature / by layer / by module"
- [ ] **Find Specific Things:** "React components are in components/, services are in services/"
- [ ] **Understand Patterns:** "Components use hooks, services use axios, routes use express decorators"
- [ ] **Trace Dependencies:** "Component A imports service B which uses library C"
- [ ] **Explain Next Steps:** "To implement feature X, I would modify Y files using pattern Z"

## If Validation Fails

### Problem: Can't describe architecture
**Recovery:**
- Run Step 2 again with smaller depth
- Use `xray map --path ./src --depth 1` for simpler view
- Ask yourself: "What are the main folders and what do they contain?"

### Problem: Frameworks unclear
**Recovery:**
- Run `xray strategy detect` again
- If still empty, codebase might use custom setup
- Look at package.json manually to see dependencies
- Look at main entry point for imports

### Problem: Too much information
**Recovery:**
- Use `xray map --path ./src --depth 1` for simpler view
- Use `xray map --path <single-directory>` to focus on one area
- Use `xray explore` to find specific files only
- Focus on one framework at a time

### Problem: Can't find entry point
**Recovery:**
- Check package.json for "main" field: `xray explore --match "package.json"`
- Look for common entry point names: `xray explore --match "index.*" --match "main.*" --match "app.*"`
- Check test files for imports to understand startup

### Problem: Dependencies seem random
**Recovery:**
- This is normal for unfamiliar codebases
- Try `xray <strategy> <command>` to understand patterns
- Look at similar files (by name) to understand patterns
- The structure will become clearer as you work

## Common Pitfalls

- **Pitfall:** Running xray on entire codebase including node_modules/vendor folders
  - **Fix:** Specify --path to ./src or specific directory only

- **Pitfall:** Trying to understand everything at once
  - **Fix:** Start with depth=1, then expand. Start with high-level, then drill down

- **Pitfall:** Ignoring --with incs flag
  - **Fix:** Always use --with incs to understand dependencies

- **Pitfall:** Getting confused by test files
  - **Fix:** Use --match to exclude test files: `--match "!*.test.ts"`

- **Pitfall:** Expecting xray to find files not in main codebase
  - **Fix:** Make sure you're pointing --path to correct directory

## What NOT to Do

- Don't run `xray map` on huge codebases without depth limits (use --depth 2-3)
- Don't try to understand everything in one go (iterate: high-level first, then drill down)
- Don't ignore what frameworks are detected (use that info in next steps)
- Don't skip the dependencies step (understanding relationships is key)
- Don't try to manually verify everything (xray output is your guide, trust it)

## Output Interpretation

When you see xray output:

**File Headers:**
```
src/api/routes.ts (L1-L150):
```
- Means: file "src/api/routes.ts" spans lines 1-150
- Important: tells you file size and scope

**Function/Class Entries:**
```
│ [L5-L20] function setupRoutes
│ [L25-L50] class Router
```
- Means: functions/classes and their line numbers
- Important: quick reference for where things are

**Cross-file References:**
```
│       → used by: [main.ts:L15](L10-L25)
```
- Means: this is used in main.ts at line 15, within a function that spans 10-25
- Important: understand what calls what

**Dependency Tables:**
```
| Library | Used By |
|---------|---------|
| react | components/*, hooks.ts |
```
- Means: react library is imported in those files
- Important: understand external dependencies

## Next Steps After Understanding

Once you understand the codebase:

1. **For Implementation:** Use [Feature Implementation Workflow](feature-implementation.md)
2. **For Debugging:** Use [Bug Investigation Workflow](bug-investigation.md)
3. **For Refactoring:** Use [Refactoring Workflow](refactoring.md)
4. **For Code Review:** Use [Code Review Workflow](code-review.md)
5. **For Questions:** Reference specific files from xray output

## Tips for Success

- **Progressive Disclosure:** Start simple (depth=1), add details only if needed
- **Reference Output:** Keep xray output as reference while implementing
- **Test Understanding:** Can you explain the structure to someone else?
- **Use Anchors:** When unsure what to look at, use xray map --anchor <main-file>
- **Combine Patterns:** Use explore (with --match, --search or a framework command) + map together for full picture

## Related Documentation

- [Command Selection](../command-selection.md) - Choosing specific commands
- [Output Interpretation](../output-interpretation.md) - Understanding xray output
- [Token Optimization](../token-optimization.md) - Managing token budget
- [Integration Protocol](../integration-protocol.md) - When to use workflows

---

**Key Takeaway:** Understanding a codebase is about building mental models progressively. Start high-level, verify frameworks, identify key areas, understand patterns, trace dependencies. You're done when you can navigate confidently and explain the structure to someone else.
