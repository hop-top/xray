# Strategy and Extension Usage Guide

This guide covers how to use xray's dynamic strategy and extension system to
explore framework-specific code patterns in your projects.

## Table of Contents

- [Quick Start](#quick-start)
- [What Are Strategies?](#what-are-strategies)
- [Command Syntax](#command-syntax)
- [Extension Runtime Overrides](#extension-runtime-overrides)
- [Built-in Strategies](#built-in-strategies)
  - [React Strategy](#react-strategy)
  - [Express Strategy](#express-strategy)
  - [REST API Strategy](#rest-api-strategy)
  - [Go CLI Strategy](#go-cli-strategy)
- [Common Workflows](#common-workflows)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
# Detect which strategies apply to your project
xray strategy detect

# List all available strategies
xray strategy list

# Use a strategy command (React example)
xray react components

# Analyze a different project
xray react components -p /path/to/other/project
```

## What Are Strategies?

Strategies are intelligent analyzers that understand framework-specific
conventions and patterns. Internally, xray now registers them through a
generic extension contract, which lets future capabilities share the same
detection, config, and command plumbing.

When you run a dynamic command, xray:

1. **Detects** if the strategy applies to your project
2. **Analyzes** your codebase using framework-specific patterns
3. **Tags** files with relevant markers (e.g., `react:component`, `express:route`)
4. **Extracts** metadata (component names, route paths, etc.)
5. **Executes** the requested command using cached analysis

**Key Benefits:**
- 🎯 Framework-aware analysis (understands React, Express, etc.)
- 🔍 Automatic detection (no configuration needed; project code strategies need an explicit opt-in)
- ⚡ Smart caching (detection and analysis results cached in SQLite)
- 🛠️ Custom commands (each strategy provides specialized queries)

## Command Syntax

All strategy commands follow the `<strategy> <command>` pattern. The
strategy is the command group; the operation is the subcommand:

```bash
xray <strategy> <command> [options]
```

**Available Options:**
- `-p, --path <path>` - Project path to analyze (default: current directory)

Dynamic extension commands also accept runtime extension overrides:
- `--enable-extension <name>`
- `--disable-extension <name>`
- `--extension-threshold <name=value>`
- `--extension-hint <name=value>`
- `--enable-surface <name:surface>`
- `--disable-surface <name:surface>`

**Examples:**
```bash
xray react components
xray express routes
xray rest-api endpoints -p ~/projects/my-api
xray react components --extension-threshold glossary=0.9
xray react components --disable-extension glossary
```

## Extension Runtime Overrides

Use runtime overrides when you want one command run to behave differently
without editing your config file.

```bash
# Turn one extension on or off for a single run
xray map --enable-extension glossary
xray map --disable-extension glossary

# Override threshold and add repeatable hints
xray map --extension-threshold glossary=0.85 \
  --extension-hint glossary=domain-term \
  --extension-hint glossary=approved-lexicon

# Gate extension surfaces independently
xray map --enable-surface glossary:detect
xray react components --disable-surface glossary:export
```

These flags layer on top of config file settings with runtime precedence.
They work for:
- analysis commands such as `map` and `graph`
- dynamic extension command groups such as `react ...` and `express ...`

If you are authoring an extension, the resolved values are exposed through the
shared strategy context:

```typescript
ctx.getExtensionConfig('glossary');
ctx.getConfig('glossary.threshold');
ctx.getConfig('glossary.enabledSurfaces.detect');
```

## Built-in Strategies

### React Strategy

Automatically detects and analyzes React projects.

#### Detection Criteria

The React strategy activates when:
- `react` or `react-dom` is in `package.json` dependencies/devDependencies
- `.jsx` or `.tsx` files exist in the project

#### Available Commands

##### `react components`

Lists all React components in the project.

```bash
xray react components
```

**Example Output:**
```
React Components:
  App (function) - src/App.tsx
  Button (function) - src/components/Button.tsx
  UserProfile (class) - src/components/UserProfile.tsx
  Card (function) - src/components/Card.tsx

Total: 4 component(s)
```

**What it detects:**
- Function components: `function MyComponent()`, `const MyComponent = () => {}`
- Arrow function components: `const MyComponent: React.FC = () => {}`
- Class components: `class MyComponent extends Component`, `class MyComponent extends React.PureComponent`
- TypeScript patterns with generics and complex type annotations

##### `react hooks`

Lists all custom React hooks.

```bash
xray react hooks
```

**Example Output:**
```
Custom React Hooks:
  useCounter - src/hooks/useCounter.ts
  useToggle - src/hooks/useToggle.ts
  useLocalStorage - src/hooks/useLocalStorage.ts
  useDebounce - src/hooks/useDebounce.ts

Total: 4 hook(s)
```

**What it detects:**
- Functions starting with `use` followed by an uppercase letter
- Both function declarations and arrow function assignments
- Example: `function useMyHook()`, `const useMyHook = () => {}`

##### `react contexts`

Lists all React contexts.

```bash
xray react contexts
```

**Example Output:**
```
React Contexts:
  ThemeContext - src/contexts/ThemeContext.ts
  AuthContext - src/contexts/AuthContext.ts
  UserContext - src/contexts/UserContext.ts

Total: 3 context(s)
```

**What it detects:**
- Context creation via `createContext()`: `const MyContext = createContext(...)`
- Both `React.createContext` and imported `createContext`

#### Use Cases

**Inventory components before refactoring:**
```bash
xray react components > components-before.txt
# ... perform refactoring ...
xray react components > components-after.txt
diff components-before.txt components-after.txt
```

**Find all custom hooks in a monorepo:**
```bash
xray react hooks -p packages/ui
xray react hooks -p packages/admin
xray react hooks -p packages/customer
```

**Audit context usage:**
```bash
xray react contexts
# Review the list to identify unnecessary contexts
```

---

### Express Strategy

Deep analysis for Express.js applications.

#### Detection Criteria

The Express strategy activates when:
- `express` is in `package.json` dependencies
- `express()` instantiation found in code
- `app.listen()` calls detected
- Express imports: `require('express')` or `from 'express'`

#### Available Commands

##### `express routes`

Lists all Express routes with HTTP methods, paths, handlers, and middleware chains.

```bash
xray express routes
```

**Example Output:**
```
Express Routes:
  GET    /api/users          - src/routes/users.ts [handler: getUsers]
  POST   /api/users          - src/routes/users.ts [handler: createUser, middleware: authenticate, validateUser]
  PUT    /api/users/:id      - src/routes/users.ts [handler: updateUser, middleware: authenticate]
  DELETE /api/users/:id      - src/routes/users.ts [handler: deleteUser, middleware: authenticate, isAdmin]
  GET    /protected          - src/routes/auth.ts [middleware: authenticate, authorize]

Total: 5 route(s)
```

**What it detects:**
- Route definitions: `app.get()`, `router.post()`, etc.
- All HTTP methods: GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
- Route paths including parameters (`:id`, `:userId`)
- Handler function names
- Middleware chains in route definitions

##### `express routers`

Lists all Express Router instances and their mount points.

```bash
xray express routers
```

**Example Output:**
```
Express Routers:
  userRouter - src/routes/users.ts
    Mounted at: /api/users (src/app.ts)

  authRouter - src/routes/auth.ts
    Mounted at: /auth (src/app.ts)

  adminRouter - src/routes/admin.ts
    Mounted at: /admin (src/app.ts)

Total: 3 router(s)
```

**What it detects:**
- Router creation: `express.Router()`, `Router()`
- Router mounting: `app.use('/path', router)`
- Router variable names and mount paths

##### `express middleware`

Lists all middleware (global and path-specific).

```bash
xray express middleware
```

**Example Output:**
```
Express Middleware:
  Global:
    - express.json() - src/app.ts
    - cors() - src/app.ts
    - morgan('combined') - src/app.ts
    - helmet() - src/app.ts

  Path-Specific:
    - /api - authenticate - src/middleware/auth.ts
    - /admin - isAdmin - src/middleware/admin.ts

Total: 6 middleware
```

**What it detects:**
- Global middleware: `app.use(middleware)`
- Path-specific middleware: `app.use('/path', middleware)`
- Built-in Express middleware: `express.json()`, `express.static()`
- Third-party middleware: `cors()`, `helmet()`, `morgan()`
- Custom middleware functions

##### `express error-handlers`

Lists all error handling middleware (4-parameter functions).

```bash
xray express error-handlers
```

**Example Output:**
```
Express Error Handlers:
  errorHandler - src/middleware/error.ts
  validationErrorHandler - src/middleware/validation.ts
  notFoundHandler - src/middleware/notFound.ts

Total: 3 error handler(s)
```

**What it detects:**
- Error handlers with signature: `(err, req, res, next) => {}`
- Both named and anonymous error handlers
- Error handler middleware registration

#### Use Cases

**API documentation generation:**
```bash
# Get all routes and generate OpenAPI spec
xray express routes > routes.txt
# Parse routes.txt to build API docs
```

**Security audit:**
```bash
# Check which routes have authentication middleware
xray express routes | grep -v "authenticate"
# These routes might be unprotected!
```

**Refactoring router structure:**
```bash
# See current router organization
xray express routers
# Plan consolidation or splitting
```

**Middleware order analysis:**
```bash
# Verify middleware is in correct order
xray express middleware
# Ensure security middleware (helmet, cors) comes first
```

---

### REST API Strategy

Cross-framework REST API analysis for Node.js, Python, and Go.

#### Detection Criteria

The REST API strategy activates when:

**Node.js:**
- `express`, `fastify`, or `koa` in dependencies

**Python:**
- FastAPI, Flask, or Django imports in `.py` files

**Go:**
- `net/http`, Gorilla Mux, Gin, or Echo imports in `.go` files

#### Available Commands

##### `rest-api endpoints`

Lists all REST endpoints across all detected frameworks.

```bash
xray rest-api endpoints
```

**Example Output:**
```
REST API Endpoints:
  GET    /api/users          - src/routes/users.ts (Express/Node.js)
  POST   /api/users          - src/routes/users.ts (Express/Node.js)
  PUT    /api/users/:id      - src/routes/users.ts (Express/Node.js)
  GET    /api/items/{id}     - main.py (FastAPI/Flask/Django)
  POST   /api/items          - main.py (FastAPI/Flask/Django)
  GET    /api/health         - handlers.go (Go HTTP)
  PUT    /api/items/{id}     - handlers.go (Go HTTP)

Total: 7 endpoint(s) across 3 framework(s)
```

**What it detects:**
- **Express/Node.js**: `app.get()`, `router.post()`, etc.
- **FastAPI/Python**: `@app.get()`, `@router.post()`, etc.
- **Flask/Python**: `@app.route('/path', methods=['GET'])`
- **Django/Python**: `path()` in URL configurations
- **Go HTTP**: `http.HandleFunc()`, `mux.HandleFunc()`, `mux.Handle("GET /path", ...)`
- **Gin/Go**: `router.GET()`, `router.POST()`, etc.
- **Echo/Go**: `e.GET()`, `e.POST()`, etc.

##### `rest-api methods`

Groups endpoints by HTTP method.

```bash
xray rest-api methods
```

**Example Output:**
```
Endpoints by HTTP Method:

GET:
  - /api/users - src/routes/users.ts (Express)
  - /api/items/{id} - main.py (FastAPI)
  - /api/health - handlers.go (Go HTTP)

POST:
  - /api/users - src/routes/users.ts (Express)
  - /api/items - main.py (FastAPI)

PUT:
  - /api/users/:id - src/routes/users.ts (Express)
  - /api/items/{id} - handlers.go (Go HTTP)

Total: 7 endpoint(s)
```

##### `rest-api middleware`

Lists middleware and interceptors (framework-specific).

```bash
xray rest-api middleware
```

#### Use Cases

**Polyglot API inventory:**
```bash
# Microservices with different tech stacks
xray rest-api endpoints
# See all endpoints across Node, Python, Go services
```

**API versioning audit:**
```bash
xray rest-api endpoints | grep "/v1"
xray rest-api endpoints | grep "/v2"
# Identify which endpoints need v2 migration
```

**HTTP method consistency check:**
```bash
xray rest-api methods
# Verify REST conventions (GET = read, POST = create, etc.)
```

---

### Go CLI Strategy

Analyzes Go CLI applications using Cobra, urfave/cli, or standard `flag` package.

#### Detection Criteria

The Go CLI strategy activates when:
- `github.com/spf13/cobra` or `github.com/urfave/cli` in `go.mod`
- `cmd/` directory structure exists
- Standard `flag` package usage detected in `.go` files

#### Available Commands

##### `go-cli commands`

Shows the CLI command tree: each command with its description, source
location and flags. Persistent flags sit under their command; a subcommand's
own flags follow it. This is the only `go-cli` command.

```bash
xray go-cli commands
xray go-cli commands --format json
```

**Example Output:**
```
myapp commands [source: AST (tree-sitter-go)]
myapp  A CLI application  (cmd/root.go:5)
│    --verbose  Enable verbose logging
└─ serve  Start the server  (cmd/root.go:7)
        -p, --port <int>  Server port
```

`--format json` returns `{source, tool, commands: [{path, short, flags, file,
line}]}`; each flag has `name`, `type`, `description`, `persistent`.

**What it detects:**
- **Cobra**: `&cobra.Command{Use: "...", Short: "..."}`, `AddCommand()` nesting,
  `Flags()` / `PersistentFlags()` declarations
- Command names, descriptions, flags (name, shorthand, type, default)

#### Use Cases

**CLI documentation:**
```bash
# Generate command reference
xray go-cli commands > CLI-COMMANDS.md
```

**Command completeness check:**
```bash
# Commands without a description
xray go-cli commands --format json | jq -r '.commands[] | select(.short == "" or .short == null) | .path | join(" ")'
```

**Flag audit:**
```bash
# One line per flag: command, flag, type
xray go-cli commands --format json | jq -r '.commands[] | .path as $p | .flags[]? | "\($p | join(" ")) --\(.name) \(.type)"'
```

---

## Common Workflows

### Workflow 1: New Project Exploration

When joining a new project or exploring unfamiliar code:

```bash
# Step 1: Detect which strategies apply
xray strategy detect

# Output:
# Detected Strategies:
#   - react (v0.0.1-alpha.1): React framework detected
#   - express (v0.0.1-alpha.1): Express.js detected

# Step 2: Explore React structure
xray react components
xray react hooks

# Step 3: Explore API structure
xray express routes
xray express middleware

# Step 4: Save exploration results
xray react components > docs/react-components.txt
xray express routes > docs/api-routes.txt
```

### Workflow 2: Pre-Refactoring Audit

Before major refactoring:

```bash
# Snapshot current state
xray react components > before-refactor/components.txt
xray react hooks > before-refactor/hooks.txt
xray express routes > before-refactor/routes.txt

# Perform refactoring...

# Compare after refactoring
xray react components > after-refactor/components.txt
diff before-refactor/components.txt after-refactor/components.txt

# Verify nothing was lost or broken
```

### Workflow 3: Multi-Project Analysis

Analyzing multiple related projects:

```bash
# Monorepo package analysis
for package in packages/*/; do
  echo "=== $package ==="
  xray react components -p "$package"
done

# Microservices API inventory
xray rest-api endpoints -p services/user-api > user-api-endpoints.txt
xray rest-api endpoints -p services/order-api > order-api-endpoints.txt
xray rest-api endpoints -p services/payment-api > payment-api-endpoints.txt

# Consolidate into single API catalog
cat *-endpoints.txt > api-catalog.txt
```

### Workflow 4: Code Review Assistance

During code reviews:

```bash
# Before reviewing PR that adds new components
xray react components > components-main.txt

# Switch to PR branch
git checkout feature/new-dashboard

# See what components were added
xray react components > components-pr.txt
diff components-main.txt components-pr.txt

# Review new components specifically
```

### Workflow 5: Documentation Generation

Automatically generate documentation:

```bash
# API Documentation
echo "# API Endpoints" > API.md
xray express routes >> API.md

# Component Library
echo "# Component Library" > COMPONENTS.md
xray react components >> COMPONENTS.md

# CLI Reference
echo "# CLI Commands" > CLI.md
xray go-cli commands >> CLI.md
```

## Troubleshooting

### Your own strategy is not loaded

**Problem**: a strategy in `.xray/strategies/` or an `xray-strategy-*` package in `node_modules` does not appear in `xray strategy list`.

**Solutions**:
1. `.js` and `.ts` strategies and packages run code, so xray loads them from the project only when you set `XRAY_ALLOW_PROJECT_STRATEGIES=1` in your own environment (never through repo config); use it only for repos you trust. `xray strategy list` names what was skipped.
2. Declarative YAML strategies (`xray strategy create <name> --yaml`) load without it.

### Strategy not detected

**Problem**: `xray strategy detect` doesn't show your framework.

**Solutions**:
1. Verify detection criteria are met (see each strategy's "Detection Criteria" section)
2. For React: Check `package.json` has `react` or `react-dom` dependency
3. For Express: Check `express` is in dependencies (not just devDependencies)
4. For Go CLI: Check `go.mod` includes Cobra or urfave/cli
5. Clear cache and retry: `xray clear-cache --confirm=yes && xray strategy detect`

### No results from command

**Problem**: Strategy command returns "Total: 0".

**Solutions**:
1. Verify files exist in the expected locations
2. Check file extensions match what strategy expects
3. For React: Ensure components are exported (not just internal functions)
4. For Express: Ensure routes are actually defined (not commented out)
5. Run with `-p` flag to specify correct project path

### Slow performance

**Problem**: Strategy commands take a long time to run.

**Solutions**:
1. First run is slower (AST parsing + detection). Subsequent runs use cache.
2. Clear stale cache if you've made many changes: `xray clear-cache --confirm=yes`
3. Reduce project size by excluding `node_modules`, `dist`, etc. (automatically excluded)
4. Check the cache file size (`cache-db` in `xray paths`) - delete if too large (it will regenerate)

### Outdated results

**Problem**: Strategy command shows old results after code changes.

**Solutions**:
1. Cache invalidates based on file modification time (should be automatic)
2. Force cache clear: `xray clear-cache --confirm=yes`
3. Verify files were actually saved (check file timestamps)

### Command not found

**Problem**: `xray strategy list` shows strategy, but command fails.

**Solutions**:
1. Verify command name matches exactly (case-sensitive)
2. Use `xray strategy list` to see available commands for each strategy
3. Some strategies may have limited commands (not all strategies implement all commands)

### Path issues

**Problem**: Command works in one directory but not another.

**Solutions**:
1. Always use absolute paths with `-p` flag: `xray react components -p /full/path/to/project`
2. Check you're in the project root when running without `-p`
3. Verify the path contains `package.json` or framework-specific files

## Advanced Tips

### Combining with xray map

Use strategies to identify targets, then use `xray map` for detailed analysis:

```bash
# Find all components
xray react components

# Deep dive into specific component
xray map --anchor src/components/Button.tsx --with incs --with vars
```

### Scripting and automation

Use strategy commands in scripts:

```bash
#!/bin/bash
# Check if new components follow naming convention

components=$(xray react components)

if echo "$components" | grep -qv "^[A-Z]"; then
  echo "Error: Component names must be PascalCase"
  exit 1
fi
```

### CI/CD integration

Add to CI pipeline:

```yaml
# .github/workflows/code-analysis.yml
- name: Analyze API routes
  run: |
    xray express routes > api-routes.txt
    git add api-routes.txt
    git commit -m "docs: update API route inventory" || true
```

### Filtering and processing results

Use standard Unix tools to filter results:

```bash
# Find components in specific directory
xray react components | grep "src/features/"

# Count endpoints by method
xray rest-api endpoints | grep "GET" | wc -l

# Find unprotected routes
xray express routes | grep -v "authenticate"

# Extract just component names
xray react components | awk '{print $1}'
```

## Next Steps

- **Explore Strategy Development**: See [Strategy Development Guide](../dev/strategy-development.md) to create custom strategies
- **Read Command Reference**: See [Strategy API Reference](../dev/strategy-api.md) for complete command documentation
- **Review Strategy Source**: Check `strategies/*.ts` for implementation examples in the repository
- **Join Development**: See [Contributing Guide](../dev/contributing.md) to contribute new strategies

## See Also

- [Commands Reference](commands.md) - All xray commands
- [Configuration](configuration.md) - Config files and lenses
- [Troubleshooting](troubleshooting.md) - Common issues

---

For questions or issues, please visit: https://github.com/hop-top/xray/issues
