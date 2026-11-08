# xray Cookbook: Ready-to-Use Recipes

Copy, paste, adapt these practical solutions for common tasks.

## Table of Contents

1. [Quick Reference: The 10 Commands You'll Use 90% of the Time](#quick-reference-the-10-commands-youll-use-90-of-the-time)
2. [React App: Understanding Component Architecture](#recipe-react-app---understanding-component-architecture)
3. [Express API: Mapping All Routes](#recipe-express-api---mapping-all-routes)
4. [Polyglot API: Finding All Endpoints Across Services](#recipe-polyglot-api---finding-all-endpoints-across-services)
5. [Debugging: Finding Where a Function is Called](#recipe-debugging---finding-where-a-function-is-called)
6. [Refactoring: Before/After Comparison](#recipe-refactoring---beforeafter-comparison)
7. [Onboarding: Teaching Someone Your Project](#recipe-onboarding---teaching-someone-your-project)
8. [Documentation: Auto-Generating API Specs](#recipe-documentation---auto-generating-api-specs)
9. [Agent Sessions: Callers on Every Grep](#recipe-agent-sessions---callers-on-every-grep)

---

## Quick Reference: The 10 Commands You'll Use 90% of the Time

### 1. Basic Overview
```bash
xray map
```

### 2. Focused Overview
```bash
xray map --depth 2 --limit 3000
```

### 3. Show Dependencies
```bash
xray map --with incs
```

### 4. Show All Details
```bash
xray map --with incs --with vars --with docs
```

### 5. Focus on One Area
```bash
xray map --anchor src/api --with incs
```

### 6. Framework Analysis (React)
```bash
xray react components
```

### 7. Framework Analysis (Express)
```bash
xray express routes
```

### 8. Detect Frameworks
```bash
xray strategy detect
```

### 9. Clear Stale Cache
```bash
xray clear-cache --confirm=yes && xray map
```

### 10. Generate for AI
```bash
xray map --anchor src/main.ts --with incs --with vars --limit 4000 --no-chunk
cat .xray.txt | xclip
```

**That's it. These 10 commands solve 90% of use cases.**

---

## Recipe: React App - Understanding Component Architecture

**Goal**: Understand how a React app is organized.

**Time**: 5 minutes

### Step 1: List Components

```bash
xray react components
```

**Output looks like**:
```
React Components:
  App (function) - src/App.tsx
  Dashboard (function) - src/pages/Dashboard.tsx
  UserProfile (class) - src/components/UserProfile.tsx
  Button (function) - src/components/Button.tsx
  Card (function) - src/components/Card.tsx

Total: 5 component(s)
```

**What it shows**: Every component in your app and where it lives.

### Step 2: Find Custom Hooks

```bash
xray react hooks
```

**Output looks like**:
```
Custom React Hooks:
  useAuth - src/hooks/useAuth.ts
  useFetch - src/hooks/useFetch.ts
  useLocalStorage - src/hooks/useLocalStorage.ts

Total: 3 hook(s)
```

**What it shows**: Reusable logic patterns in your app.

### Step 3: Find Context Providers

```bash
xray react contexts
```

**Output looks like**:
```
React Contexts:
  AuthContext - src/contexts/AuthContext.ts
  ThemeContext - src/contexts/ThemeContext.ts

Total: 2 context(s)
```

**What it shows**: Where global state is managed.

### Step 4: Deep Dive into Complex Component

```bash
xray map --anchor src/components/ComplexComponent.tsx --with incs --with vars
```

**What it shows**: What this component uses, what uses it, and why.

### Save This Understanding

```bash
# Create a component architecture document
cat > COMPONENT_ARCHITECTURE.md << 'EOF'
# Component Architecture

## Components
EOF

xray react components >> COMPONENT_ARCHITECTURE.md

cat >> COMPONENT_ARCHITECTURE.md << 'EOF'

## Custom Hooks
EOF

xray react hooks >> COMPONENT_ARCHITECTURE.md

cat >> COMPONENT_ARCHITECTURE.md << 'EOF'

## Context Providers
EOF

xray react contexts >> COMPONENT_ARCHITECTURE.md

# Commit it
git add COMPONENT_ARCHITECTURE.md
git commit -m "docs: document component architecture"
```

---

## Recipe: Express API - Mapping All Routes

**Goal**: Get a complete inventory of all API routes.

**Time**: 2 minutes

### Step 1: List All Routes

```bash
xray express routes
```

**Output looks like**:
```
Express Routes:
  GET    /api/users           - src/routes/users.ts [handler: getUsers]
  POST   /api/users           - src/routes/users.ts [handler: createUser]
  GET    /api/users/:id       - src/routes/users.ts [handler: getUserById]
  PUT    /api/users/:id       - src/routes/users.ts [handler: updateUser]
  DELETE /api/users/:id       - src/routes/users.ts [handler: deleteUser]
  POST   /auth/login          - src/routes/auth.ts [handler: login, middleware: validateInput]
  POST   /auth/logout         - src/routes/auth.ts [handler: logout, middleware: authenticate]

Total: 7 route(s)
```

**What it shows**: Every endpoint, method, path, and handler.

### Step 2: Find Middleware

```bash
xray express middleware
```

**Output looks like**:
```
Express Middleware:
  Global:
    - express.json() - src/app.ts
    - cors() - src/app.ts
    - morgan('combined') - src/app.ts

  Path-Specific:
    - /api - authenticate - src/middleware/auth.ts
    - /admin - isAdmin - src/middleware/admin.ts

Total: 5 middleware
```

**What it shows**: Request pipeline and security enforcement.

### Step 3: Find Error Handlers

```bash
xray express error-handlers
```

**Output looks like**:
```
Express Error Handlers:
  errorHandler - src/middleware/error.ts
  validationErrorHandler - src/middleware/validation.ts

Total: 2 error handler(s)
```

**What it shows**: How errors are handled.

### Step 4: Deep Dive into Route Handler

```bash
xray map --anchor src/routes/users.ts --with incs --with vars
```

**What it shows**: What each route depends on, how data flows.

### Generate API Documentation

```bash
# Create automated API docs
cat > API-REFERENCE.md << 'EOF'
# API Reference

This document is auto-generated from xray analysis.

## Endpoints

EOF

xray express routes >> API-REFERENCE.md

cat >> API-REFERENCE.md << 'EOF'

## Middleware Stack

EOF

xray express middleware >> API-REFERENCE.md

cat >> API-REFERENCE.md << 'EOF'

## Error Handling

EOF

xray express error-handlers >> API-REFERENCE.md

# Keep it updated automatically
git add API-REFERENCE.md
git commit -m "docs: auto-generated API reference"
```

### Verify No Unprotected Routes

```bash
# Find routes without authentication
xray express routes | grep -v "authenticate"
# These should be intentional (login, health check, etc.)
```

---

## Recipe: Polyglot API - Finding All Endpoints Across Services

**Goal**: Inventory all API endpoints in a microservices architecture (Node, Python, Go mixed).

**Time**: 10 minutes

### For a Single Microservice

```bash
xray rest-api endpoints -p ./services/user-api
```

### For All Microservices

```bash
# Create master API inventory
echo "# Complete API Inventory" > API-INVENTORY.md
echo "" >> API-INVENTORY.md

for service in services/*/; do
  name=$(basename "$service")
  echo "## $name" >> API-INVENTORY.md
  xray rest-api endpoints -p "$service" >> API-INVENTORY.md 2>/dev/null || echo "No API found"
  echo "" >> API-INVENTORY.md
done

# View results
cat API-INVENTORY.md

# Commit to documentation
git add API-INVENTORY.md
git commit -m "docs: api inventory across all services"
```

### Find Endpoint Conflicts

```bash
# Find duplicate paths across services
xray rest-api endpoints | cut -d' ' -f 2 | sort | uniq -d

# These might need consolidation
```

### API Versioning Audit

```bash
# Find all v1 endpoints
xray rest-api endpoints | grep "/v1"

# Find all v2 endpoints
xray rest-api endpoints | grep "/v2"

# Migration checklist:
# [ ] All v1 endpoints have v2 equivalents?
# [ ] Deprecation timeline clear?
# [ ] Client migrations planned?
```

---

## Recipe: Debugging - Finding Where a Function is Called

**Goal**: Find who's calling a specific function (for bug hunting).

**Time**: 5 minutes

### Scenario: Bug in `validateUser` function

```bash
# Step 1: Find the file
xray map --catch "*validateUser*"

# Step 2: Get detailed view with who uses it
xray map --anchor src/middleware/validation.ts --with incs

# Output shows:
# [L20-L35] function validateUser
#       → used by: [routes/users.ts:L10](L5-L25)
#       → used by: [routes/admin.ts:L15](L10-L30)

# Step 3: Look at each call site
xray map --anchor src/routes/users.ts --with incs
xray map --anchor src/routes/admin.ts --with incs

# Step 4: Trace deeper if needed
xray map --anchor src/routes/admin.ts --with incs --with vars --with df
# --with df shows data flow: which assignment reaches which use (TypeScript, JavaScript, Python, Go)
```

### Find All Imports of a Library

```bash
# Write the map (with imports) to one file, then search it
xray map --with incs --no-chunk -o map.txt

# Find all places using axios
grep -i "axios" map.txt

# Get detailed context
grep -B 2 -A 2 "axios" map.txt

# Now you know exactly where HTTP calls happen
```

### Find All Database Queries

```bash
# Find all files using database
xray map --with incs --no-chunk -o map.txt
grep -E "database|db|prisma|mongoose" map.txt

# Enumerate each file
grep -E "database|db|prisma|mongoose" map.txt | cut -d' ' -f1 | sort | uniq
```

---

## Recipe: Refactoring - Before/After Comparison

**Goal**: Verify refactoring didn't break anything.

**Time**: 30 minutes

### Step 1: Snapshot Before

```bash
# Create a before-refactor directory
mkdir -p refactor-audit/before

# Snapshot components (if React)
xray react components > refactor-audit/before/components.txt

# Snapshot routes (if Express)
xray express routes > refactor-audit/before/routes.txt

# Snapshot full analysis
xray map --no-chunk -o refactor-audit/before/map.txt

# Snapshot module structure
xray map --path ./src/moduleBeingRefactored --no-chunk -o refactor-audit/before/module.txt
```

### Step 2: Do the Refactoring

```bash
# ... make your changes ...
git diff  # Review changes
```

### Step 3: Snapshot After

```bash
mkdir -p refactor-audit/after

# Same snapshots
xray clear-cache --confirm=yes  # Important: clear cache to see fresh analysis
xray react components > refactor-audit/after/components.txt
xray express routes > refactor-audit/after/routes.txt
xray map --no-chunk -o refactor-audit/after/map.txt
xray map --path ./src/moduleBeingRefactored --no-chunk -o refactor-audit/after/module.txt
```

### Step 4: Compare

```bash
# See what changed
diff refactor-audit/before/components.txt refactor-audit/after/components.txt
diff refactor-audit/before/routes.txt refactor-audit/after/routes.txt
diff refactor-audit/before/module.txt refactor-audit/after/module.txt

# Create a report
cat > refactor-audit/REPORT.md << 'EOF'
# Refactoring Verification Report

## Component Changes
EOF

diff refactor-audit/before/components.txt refactor-audit/after/components.txt >> refactor-audit/REPORT.md || echo "No changes"

# Commit audit as proof
git add refactor-audit/
git commit -m "refactor: document changes before/after"
```

### Checklist

- [ ] Component count same? (Or intentionally changed?)
- [ ] Route count same?
- [ ] New exports? Intentional?
- [ ] Dependencies removed? Check they're not needed elsewhere
- [ ] Tests still pass?

---

## Recipe: Onboarding - Teaching Someone Your Project

**Goal**: Create a comprehensive onboarding guide.

**Time**: 60 minutes

### Step 1: Project Overview

```bash
mkdir -p docs/onboarding

# What frameworks?
xray strategy detect > docs/onboarding/1-frameworks.txt

# High-level structure
xray map --depth 2 --no-chunk -o docs/onboarding/2-structure.txt

# Component inventory (if React)
xray react components > docs/onboarding/3-components.txt

# API inventory (if Express)
xray express routes > docs/onboarding/4-routes.txt
```

### Step 2: Create Onboarding Guide

```bash
cat > docs/onboarding/GUIDE.md << 'EOF'
# Project Onboarding Guide

## Welcome!

Welcome to the project. This guide will help you understand the architecture in 15 minutes.

### Time Budget

- 5 min: Understand tech stack
- 5 min: Understand structure
- 5 min: Explore your specific area

### Step 1: Tech Stack (5 min)

Here's what we use:

EOF

cat docs/onboarding/1-frameworks.txt >> docs/onboarding/GUIDE.md

cat >> docs/onboarding/GUIDE.md << 'EOF'

### Step 2: Project Structure (5 min)

Here's how we organize code:

EOF

cat docs/onboarding/2-structure.txt >> docs/onboarding/GUIDE.md

cat >> docs/onboarding/GUIDE.md << 'EOF'

### Step 3: Explore Your Area

If you're working on:

- **Frontend**: See [Components](3-components.txt)
- **API**: See [Routes](4-routes.txt)

### Step 4: Next Steps

1. Run `npm install && npm run dev`
2. Open http://localhost:3000
3. Set a breakpoint in your area
4. Ask questions in Slack #dev-help

Welcome aboard!
EOF

echo "Created docs/onboarding/GUIDE.md"
```

### Step 3: Add to README

Add this to your project's own README. `docs/onboarding/GUIDE.md` is the file Step 2 creates in your project; the link resolves there.

```markdown
# Quickstart for New Developers

New to the project? Start here: [Onboarding Guide](docs/onboarding/GUIDE.md)

Takes about 15 minutes to understand the basics.
```

### Step 4: Regularly Update

```bash
# Run this monthly to keep guides fresh
xray clear-cache --confirm=yes
xray strategy detect > docs/onboarding/1-frameworks.txt
xray map --depth 2 --no-chunk -o docs/onboarding/2-structure.txt
# etc.

git add docs/onboarding/
git commit -m "docs: refresh onboarding materials"
```

---

## Recipe: Documentation - Auto-Generating API Specs

**Goal**: Keep API documentation automatically in sync with code.

**Time**: 5 minutes setup, then automatic

### Step 1: Create Script

```bash
# create-api-docs.sh
#!/bin/bash

echo "# API Reference" > API.md
echo "" >> API.md
echo "Auto-generated at $(date)" >> API.md
echo "" >> API.md

echo "## Endpoints" >> API.md
xray express routes >> API.md

echo "" >> API.md
echo "## Middleware" >> API.md
xray express middleware >> API.md

echo "" >> API.md
echo "## Error Handlers" >> API.md
xray express error-handlers >> API.md

echo "✓ Generated API.md"
```

### Step 2: Automate with Pre-commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash

if [ -f create-api-docs.sh ]; then
  ./create-api-docs.sh
  git add API.md
fi

exit 0
```

```bash
chmod +x create-api-docs.sh
chmod +x .git/hooks/pre-commit
```

### Step 3: Automate with GitHub Action

```yaml
# .github/workflows/update-api-docs.yml
name: Update API Documentation

on:
  push:
    branches: [main]
    paths:
      - 'src/routes/**'
      - 'src/middleware/**'

jobs:
  update-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g @hop-top/xray
      - run: |
          echo "# API Reference" > API.md
          echo "" >> API.md
          echo "Auto-generated at $(date)" >> API.md
          echo "" >> API.md
          echo "## Endpoints" >> API.md
          xray express routes >> API.md
          echo "" >> API.md
          echo "## Middleware" >> API.md
          xray express middleware >> API.md
      - uses: actions/upload-artifact@v4
        with:
          name: api-docs
          path: API.md
```

### Result

Every time you push code changes, API documentation auto-updates. No manual maintenance!

---

## Recipe: Agent Sessions - Callers on Every Grep

**Scenario:** your coding agent greps for a function before changing it,
and you want it to see who calls it without asking.

Save the graph once per session, and let a hook run `xray impact` on each
identifier the agent searches for:

```bash
xray impact <symbol> --graph .xray/graph.json --format brief --quiet
```

Setup per harness (Claude Code, nerv, Gemini CLI, Codex, Cursor):
[Harness Integration Guide](harness-integration.md). Real output and
limits: [Use case: impact analysis](use-cases.md#use-case-impact-analysis).

---

## Pro Tips Across All Recipes

1. **Save outputs**: Keep before/after for comparison
2. **Commit to git**: Makes history searchable and auditable
3. **Use grep**: Pipe xray output through grep for filtering
4. **Automate**: Set up hooks/actions for repeated tasks
5. **Share with team**: Use documentation generated from xray
6. **Version your outputs**: `map-$(date +%Y-%m-%d).txt`

---

## Troubleshooting These Recipes

**"Command not found"** → Use `npx @hop-top/xray` instead of `xray`

**"No results"** → Add path: `xray express routes -p ./src`

**"Stale results"** → Clear cache: `xray clear-cache --confirm=yes`

**"Lost in output"** → Use `--depth 2` or `--limit 2000` to reduce size

**"How do I X?"** → Check [Workflows](workflows.md) or [Best Practices](best-practices.md)

---

## Next Steps

- Adapt these recipes to your workflow
- Create your own recipes and share with your team
- Check [Commands](commands.md) for more options
- Join the community and share your uses!

**Remember**: These recipes are templates. Adapt them to your actual needs. The best recipe is the one you've customized for your project.
