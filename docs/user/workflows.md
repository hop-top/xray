# Common Workflows & Recipes

Real-world scenarios and step-by-step solutions for using xray in your daily work.

## Table of Contents

1. [Onboarding to a New Codebase](#workflow-onboarding-to-a-new-codebase)
2. [Debugging a Complex Issue](#workflow-debugging-a-complex-issue)
3. [Planning a Refactor](#workflow-planning-a-refactor)
4. [Preparing Code for AI Analysis](#workflow-preparing-code-for-ai-analysis)
5. [Code Review Preparation](#workflow-code-review-preparation)
6. [Documenting Your Project](#workflow-documenting-your-project)
7. [Multi-Project Analysis](#workflow-multi-project-analysis)
8. [Finding Specific Patterns](#workflow-finding-specific-patterns)

---

## Workflow: Onboarding to a New Codebase

**Scenario**: You're starting work on an unfamiliar project. You need to understand the architecture without spending hours reading code.

**Time to complete**: 5-10 minutes

### Step 1: Detect the Frameworks (30 seconds)

```bash
cd /path/to/project
xray strategy detect
```

Expected output:
```
Detected Strategies:
  - react (v0.0.1-alpha.1): React framework detected
  - express (v0.0.1-alpha.1): Express.js detected
  - rest-api (v0.0.1-alpha.1): REST API patterns detected
```

**What you learned**: This is a React + Express project with REST APIs. No need to waste time guessing about the tech stack.

### Step 2: Map the High-Level Structure (1-2 minutes)

```bash
xray map --path ./src --depth 3
```

This gives you a tree view of `src/` with limited depth. You'll see:
- What directories exist (components, services, routes, utils)
- Main files in each directory
- Important functions/classes

**What you learned**: Where things are organized.

### Step 3: Explore Key Areas (2-3 minutes)

```bash
# See all React components
xray react components

# See all API routes
xray express routes

# See all custom hooks
xray react hooks
```

**What you learned**:
- What components exist (high-level UI structure)
- What API endpoints are available
- How data flows (hooks usage patterns)

### Step 4: Drill Into Core Files (2-3 minutes)

```bash
# Entry point
xray map --anchor src/App.tsx --with incs

# API entry point
xray map --anchor src/server/index.ts --with incs --with vars
```

**What you learned**: How the main app initializes and how the API is structured.

### Result

In 5-10 minutes, you understand:
- Tech stack
- Project structure
- Main components and routes
- How the app starts
- Who calls who (dependencies)

**Pro tip**: Save this output to documentation:
```bash
xray strategy detect > ONBOARDING.md
xray react components >> ONBOARDING.md
xray express routes >> ONBOARDING.md
```

Share with teammates joining the project.

---

## Workflow: Debugging a Complex Issue

**Scenario**: There's a bug in production. You need to find where it's happening, what it affects, and why the code path is so convoluted.

**Time to complete**: 15-30 minutes

### Step 1: Identify the Affected Area

```bash
# If you know roughly where: focus on that directory
xray map --path ./src/api --with incs

# If it's vague: look at recent changes
git diff HEAD~10..HEAD --name-only | head -5
```

### Step 2: Map the Error Path

Once you know which file is problematic:

```bash
# Show what depends on this file
xray map --anchor src/api/userController.ts --with incs

# This shows:
# - What this file exports
# - What it imports (its dependencies)
# - What other files use it
```

Example output tells you:
```
userController.ts (L1-L150):
│ [L10-L45] function getUser
│       → used by: [routes/users.ts:L5](L1-L20)
│       → used by: [middleware/handlers.ts:L32](L28-L40)
│ [L50-L90] function updateUser
│       → used by: [routes/users.ts:L8](L1-L20)
```

**What you learned**: All the places calling the broken function.

### Step 3: Trace Upward Through the Call Stack

```bash
# Now look at the route
xray map --anchor src/routes/users.ts --with incs

# Then look at the middleware
xray map --anchor src/middleware/handlers.ts --with incs
```

Keep moving up the call stack until you see the entry point.

### Step 4: Visualize the Full Flow

```bash
# Get everything with dependencies and data flow
xray map --path ./src/api --with incs --with vars --with df
```

The data flow graph shows which variables are modified where, helping you spot the exact mutation causing the bug.

### Pro Tips for Debugging

```bash
# Search for specific patterns (e.g., functions named "handle*")
xray map --catch "handle*" --with incs

# Find all files using a specific library
xray map --with incs --no-chunk -o map.txt
grep "axios\|fetch" map.txt

# Get detailed analysis of one function
xray map --anchor src/buggyFunction.ts --with vars --with incs --with docs
```

---

## Workflow: Planning a Refactor

**Scenario**: You need to refactor a subsystem. Before touching code, you need to understand current structure, impact of changes, and test coverage.

**Time to complete**: 30-60 minutes

### Step 1: Snapshot Current State

```bash
# Create a snapshot before changes
xray strategy detect > refactor-plan/detected-frameworks.txt
xray map --path ./src/services --no-chunk -o refactor-plan/current-services-map.txt
xray express routes > refactor-plan/current-routes.txt
xray react components > refactor-plan/current-components.txt

# If monorepo:
for package in packages/*/; do
  xray map -p "$package" --no-chunk -o "refactor-plan/$(basename $package)-map.txt"
done
```

### Step 2: Understand the Target Subsystem

```bash
# What you're refactoring
xray map --path ./src/authentication --with incs

# Who calls it, transitively, grouped by area (default --depth 3)
xray impact createSession

# Direct callers only, resolved edges only
xray impact createSession --depth 1 --strict

# Several symbols at once (exact name or glob, as in `query`)
xray impact 'Auth*'
```

`impact` walks inbound call edges from every matching definition and lists
each caller once, at its shortest depth. Each edge is labelled:

- **EXTRACTED**: resolved in the caller's file, directory or imports. Trust it.
- **INFERRED**: matched by name only. Check it before counting it as a caller.

`--strict` follows EXTRACTED edges only. The `edges:` footer of the text
output gives the count of each.

Generate a report showing:
```bash
echo "# Refactor Impact Analysis" > refactor-plan/impact.md
echo "## Files to Refactor" >> refactor-plan/impact.md
xray map --path ./src/authentication --no-chunk -o refactor-plan/files.txt
cat refactor-plan/files.txt >> refactor-plan/impact.md
echo "" >> refactor-plan/impact.md
echo "## Callers" >> refactor-plan/impact.md
xray impact 'Auth*' >> refactor-plan/impact.md
```

### Step 3: Identify Breaking Changes

```bash
# What does the module export?
xray map --anchor ./src/authentication/index.ts --with incs

# Who uses each export? One row per caller, with depth and edge confidence
xray impact createSession --format table
```

Document all public interfaces that need to remain stable or migrate.

### Step 4: Estimate Impact

```bash
# Machine-readable: counts.callers, counts.byDepth, groups[]
xray impact createSession --format json -o refactor-plan/impact.json

# Repeated queries: save the graph once, query it many times
xray map --format json -o refactor-plan/graph.json
xray impact createSession --graph refactor-plan/graph.json
xray impact validateToken --graph refactor-plan/graph.json
```

**Fallback (text search)**: if `impact` reports `no matching symbol in the
graph` (language without call extraction, symbol built dynamically), fall back
to name matching and grep. These find definitions and text, not callers:

```bash
xray map --catch "*Auth*" --with incs
xray map --with incs --no-chunk -o map.txt
grep -i "auth" map.txt
```

### Step 5: Plan the Refactor

```bash
# After deciding on changes, create a new map to compare
# (Do this after refactor to verify nothing broke)
xray map --path ./src/authentication --no-chunk -o refactor-plan/after-refactor.txt
# Compare before and after
diff refactor-plan/current-services-map.txt refactor-plan/after-refactor.txt
```

### Refactor Checklist

- [ ] Identified all public exports
- [ ] Found all callers (`xray impact`), checked INFERRED edges
- [ ] Documented breaking changes
- [ ] Planned migration strategy
- [ ] Generated before/after maps
- [ ] Verified test coverage for dependent code
- [ ] Notified team members
- [ ] Performed refactor
- [ ] Verified maps after refactor
- [ ] Updated documentation

---

## Workflow: Preparing Code for AI Analysis

**Scenario**: You want help from Claude, GPT, or other AI assistant. You need to give it just enough context to help without wasting tokens.

**Time to complete**: 5 minutes

### Option A: Focused Single-File Context

Perfect for "help me refactor this function"

```bash
# Get detailed analysis of one file
xray map --anchor src/myComplexFunction.ts \
  --with incs \
  --with vars \
  --with docs \
  --limit 4000 \
  --no-chunk

# Copy to clipboard or share with AI
cat .xray.txt | xclip
```

Tell the AI:
> Here's my function and its context. Can you help me refactor this?

### Option B: System Overview

Perfect for "help me understand how this works"

```bash
# Get high-level map of main system
xray map --path ./src/services --depth 2 --with incs --limit 3000

# If it's an API
xray express routes

# Copy and share
```

Tell the AI:
> Here's an overview of my API. I need help understanding the flow when a user does X.

### Option C: Framework Analysis

Perfect for "help me improve my component architecture"

```bash
# For React
xray react components
xray react hooks

# Now drill into one component
xray map --anchor ./src/components/ComplexComponent.tsx --with incs --with vars
```

Tell the AI:
> Here are my React components and hooks. The ComplexComponent is bloated. Can you suggest how to break it down?

### Option D: Full Codebase Context (for large models)

For AI assistants with large context windows:

```bash
# Generate comprehensive map
xray map --with incs --with vars --with docs --limit 16000

# Multiple chunks if needed
xray map --path ./src/api --no-chunk -o api-context.txt
xray map --path ./src/ui --no-chunk -o ui-context.txt
# Share with AI
```

### Best Practices

1. **Start focused**: Share one area first
2. **Explain your goal**: "I want to fix a bug in..." vs "I want to refactor..."
3. **Use anchor**: Focus AI attention with `--anchor`
4. **Include imports**: `--with incs` shows dependencies
5. **Add variables**: `--with vars` shows data structures
6. **Iterate**: Share maps, get suggestions, regenerate focused maps

### Example Conversation

**You**: Here's my React component (xray output). It's handling too much. How should I split it?

**AI**: I see it manages state, data fetching, and rendering. Try extracting a custom hook for the data fetching logic.

**You**: Good idea. Let me see what my custom hooks look like:
```bash
xray react hooks
```

**You**: (Share xray output) Here are my hooks. Can you see if my new hook would conflict with existing patterns?

**AI**: No conflicts. Here's how to refactor...

---

## Workflow: Code Review Preparation

**Scenario**: You're reviewing a PR or preparing your own PR for review. You need to understand what changed and what it affects.

**Time to complete**: 10-15 minutes

### For Reviewing Someone Else's PR

```bash
# Step 1: Checkout main branch and get baseline
git checkout main
xray map --no-chunk -o before-pr.txt

# Step 2: Checkout PR branch
git checkout feature/awesome-feature

# Step 3: Generate new map
xray map --no-chunk -o after-pr.txt

# Step 4: See what changed
diff before-pr.txt after-pr.txt | head -50

# Step 5: Drill into changes
git diff main...HEAD --name-only | while read file; do
  echo "=== $file ==="
  xray map --anchor "$file" --with incs
done
```

### For Preparing Your Own PR

```bash
# Create a summary of changes
echo "# PR Summary: Add User Authentication" > PR-SUMMARY.md
echo "" >> PR-SUMMARY.md

echo "## What Changed" >> PR-SUMMARY.md
git diff main...HEAD --stat >> PR-SUMMARY.md

echo "" >> PR-SUMMARY.md
echo "## Architecture Impact" >> PR-SUMMARY.md
xray map --path ./src/auth --with incs --no-chunk -o pr-arch.txt
cat pr-arch.txt >> PR-SUMMARY.md

echo "" >> PR-SUMMARY.md
echo "## New Exports" >> PR-SUMMARY.md
xray map --anchor ./src/auth/index.ts --with incs --no-chunk -o pr-exports.txt
cat pr-exports.txt >> PR-SUMMARY.md
```

In PR description, add:
> See PR-SUMMARY.md for architecture changes and impact analysis.

### Checklist for Reviewers

```bash
# Verify new code structure
xray map --path ./src/[new-subsystem]

# Check for circular dependencies
xray map --with incs --no-chunk -o map.txt
grep -E "[A-Za-z0-9_]+.*→.*[A-Za-z0-9_]+" map.txt

# Verify no unintended exports
xray map --anchor ./src/[new-module]/index.ts --with incs

# See breaking changes
xray [react components | express routes]  # before and after
```

---

## Workflow: Documenting Your Project

**Scenario**: You need to write documentation for new developers or stakeholders. You want it to be accurate and current.

**Time to complete**: 30-60 minutes

### Architecture Documentation

```bash
# Generate the directory structure
xray map --path ./src --depth 2 --no-chunk -o structure.txt

# Add explanation
cat > ARCHITECTURE.md << 'EOF'
# Architecture Overview

See below for directory structure and main components:

EOF
cat structure.txt >> ARCHITECTURE.md
```

### API Documentation

```bash
# For Express/REST API
echo "# API Endpoints" > API-REFERENCE.md
echo "" >> API-REFERENCE.md
echo "## Endpoints" >> API-REFERENCE.md
xray express routes >> API-REFERENCE.md

echo "" >> API-REFERENCE.md
echo "## Middleware" >> API-REFERENCE.md
xray express middleware >> API-REFERENCE.md

echo "" >> API-REFERENCE.md
echo "## Error Handlers" >> API-REFERENCE.md
xray express error-handlers >> API-REFERENCE.md
```

### Component Documentation

```bash
# For React
echo "# Component Library" > COMPONENTS.md
echo "" >> COMPONENTS.md

echo "## All Components" >> COMPONENTS.md
xray react components >> COMPONENTS.md

echo "" >> COMPONENTS.md
echo "## Custom Hooks" >> COMPONENTS.md
xray react hooks >> COMPONENTS.md

echo "" >> COMPONENTS.md
echo "## Context Providers" >> COMPONENTS.md
xray react contexts >> COMPONENTS.md
```

### CLI Documentation

```bash
# For Go CLI apps
echo "# CLI Reference" > CLI-REFERENCE.md

echo "## Commands and flags" >> CLI-REFERENCE.md
xray go-cli commands >> CLI-REFERENCE.md
```

### Keep Documentation Current

```bash
# Set up pre-commit hook to auto-update docs
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# Auto-update xray-based documentation

xray express routes > API-REFERENCE.md 2>/dev/null || true
xray react components > COMPONENTS.md 2>/dev/null || true

git add API-REFERENCE.md COMPONENTS.md 2>/dev/null || true
EOF

chmod +x .git/hooks/pre-commit
```

---

## Workflow: Multi-Project Analysis

**Scenario**: You manage multiple related projects (monorepo, microservices, or multiple packages). You need a bird's-eye view of all projects.

**Time to complete**: Varies by project count

### Monorepo Analysis

```bash
# Analyze each package
for package in packages/*/; do
  name=$(basename "$package")
  echo "=== $name ==="
  xray map -p "$package" --depth 2
  echo ""
done > monorepo-analysis.txt

# Find component duplication
echo "# Potentially Duplicated Components" >> monorepo-analysis.txt
for package in packages/*/; do
  xray react components -p "$package" 2>/dev/null
done | sort | uniq -d >> monorepo-analysis.txt
```

### Microservices Analysis

```bash
# Inventory all APIs
echo "# Microservices API Inventory" > api-inventory.md

for service in services/*/; do
  name=$(basename "$service")
  echo "## $name" >> api-inventory.md
  xray rest-api endpoints -p "$service" >> api-inventory.md
  echo "" >> api-inventory.md
done

# Find API conflicts
echo "# Potential Route Conflicts" >> api-inventory.md
xray rest-api endpoints | sort | uniq -d >> api-inventory.md
```

### Cross-Project Dependencies

```bash
# Find all external dependencies
for project in projects/*/; do
  echo "=== $(basename $project) ==="
  xray map -p "$project" --with incs --no-chunk -o "$project/map.txt"
  grep -E "External|Library" "$project/map.txt"
done
```

---

## Workflow: Finding Specific Patterns

**Scenario**: You need to find all instances of a pattern (e.g., all API controllers, all error handlers, etc.).

**Time to complete**: 2-5 minutes

### Pattern: Find All Test Files and Their Targets

```bash
# Find test files
xray explore --match "*.test.ts" --match "*.spec.ts"

# Get test coverage map
xray map --match "*.test.ts" --with incs
```

### Pattern: Find Unused Functions

```bash
# Get all functions
xray map --with vars

# Functions not appearing in other files might be unused
xray map --with incs --no-chunk -o map.txt
grep -v "→ used by" map.txt
```

### Pattern: Find All Error Handlers

```bash
# For Express
xray express error-handlers

# Search map for error-related functions
xray map --catch "*Error*" --catch "*Handler*" --with incs
```

### Pattern: Find All Data Fetching Code

```bash
# All imports of fetch/axios/etc
xray map --with incs --no-chunk -o map.txt
grep -i "fetch\|axios\|http" map.txt

# All files using async/await
xray map --with vars --no-chunk -o vars.txt
grep -E "async|await" vars.txt
```

### Pattern: Find All Configuration

```bash
# Config files
xray explore --match "*.config.*" --match "*rc*" --match "*.env*"

# Configuration imports
xray map --with incs --no-chunk -o map.txt
grep -i "config" map.txt
```

### Pattern: Security Audit - Find All Authentication Points

```bash
# All auth-related code
xray map --catch "*Auth*" --catch "*Login*" --catch "*Token*" --with incs

# All places importing auth libraries
xray map --with incs --no-chunk -o map.txt
grep -i "jwt\|passport\|oauth\|auth" map.txt
```

---

## Tips for All Workflows

1. **Save outputs**: Keep before/after maps for comparison
2. **Use grep**: Pipe xray output through grep/awk for filtering
3. **Chain commands**: Use `&&` to run analysis sequences
4. **Script workflows**: Create bash scripts for repeated workflows
5. **Version your maps**: Commit important maps to git
6. **Share with team**: Document workflows in your team's wiki
7. **Iterate**: Start broad, then drill into specifics
8. **Trust the algorithm**: PageRank ordering usually shows important files first

## Next Steps

- Learn more about [Commands](commands.md)
- Explore [Strategies](strategies.md)
- Check [Best Practices](best-practices.md)
- See [Troubleshooting](troubleshooting.md) if you hit issues

---

**Remember**: xray is a tool for exploration. The goal is to understand your codebase quickly so you can make better decisions. Use these workflows as templates and adapt them to your needs.
