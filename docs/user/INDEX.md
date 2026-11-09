# xray Documentation Index

Everything you need to know about xray, organized by how you'll use it.

## Choose Your Path

### I'm New to xray

Start here, then pick your next path based on what you want to do.

1. **[Getting Started Guide](getting-started.md)** (10 min)
   - Installation (30 sec)
   - Your first map (30 sec)
   - Understanding output (5 min)
   - Quick examples (3 min)

2. **[Quick Reference](quick-reference.md)** (2 min)
   - 10 most used commands
   - Common flags
   - Copy-paste templates

3. **Pick your scenario below**

---

### I Want to Understand My Codebase

**[Workflows: Onboarding](workflows.md#workflow-onboarding-to-a-new-codebase)** (5-10 min)
- Detect frameworks
- Map structure
- Explore key areas
- Drill into core files

**[Commands: xray map](commands.md#xray-map)**
- Basic usage
- All options
- Advanced features

**[Best Practices: Iterative Exploration](best-practices.md#iterative-exploration)**
- How deep to go
- When to stop exploring
- Moving through the funnel

---

### I Need to Help an AI Understand My Code

**[Workflows: Preparing for AI Analysis](workflows.md#workflow-preparing-code-for-ai-analysis)** (5 min)
- Focus on what matters
- Generate with right options
- Share with Claude/GPT

**[Best Practices: AI Integration](best-practices.md#integration-with-ai-workflows)**
- Before asking AI
- AI-friendly output
- Iterating with AI

**[Harness Integration](harness-integration.md)** (10 min)
- Instructions, MCP or hooks: three ways into an agent session
- Claude Code, nerv, Gemini CLI, Codex, Cursor setup
- [Use cases](use-cases.md) with real output

---

### I'm Debugging Something

**[Workflows: Debugging Complex Issues](workflows.md#workflow-debugging-a-complex-issue)** (15-30 min)
- Identify affected area
- Map error path
- Trace upward
- Visualize flow

**[Cookbook: Finding Where Functions Are Called](cookbook.md#recipe-debugging---finding-where-a-function-is-called)** (5 min)
- Step-by-step debugging
- Finding imports
- Tracing deeper

---

### I'm Planning a Refactor

**[Workflows: Planning a Refactor](workflows.md#workflow-planning-a-refactor)** (30-60 min)
- Snapshot current state
- Understand target subsystem
- Identify breaking changes
- Estimate impact
- Verify after refactor

**[Cookbook: Before/After Comparison](cookbook.md#recipe-refactoring---beforeafter-comparison)** (30 min)
- Automated comparison
- Change verification
- Documentation

---

### I Have a React App

**[Strategies: React](strategies.md#react-strategy)**
- List components
- Find hooks
- Find contexts

**[Cookbook: React App Architecture](cookbook.md#recipe-react-app---understanding-component-architecture)** (5 min)
- 4-step guide
- Save documentation

---

### I Have an Express API

**[Strategies: Express](strategies.md#express-strategy)**
- List routes
- Find middleware
- Find routers
- Find error handlers

**[Cookbook: Express API Mapping](cookbook.md#recipe-express-api---mapping-all-routes)** (2 min)
- Quick routes inventory
- Find middleware
- Verify security

---

### I Have Multiple Services (Microservices)

**[Strategies: REST API](strategies.md#rest-api-strategy)**
- Find all endpoints
- Group by method
- Find middleware

**[Cookbook: Polyglot API Inventory](cookbook.md#recipe-polyglot-api---finding-all-endpoints-across-services)** (10 min)
- Multi-service scanning
- Finding conflicts
- Versioning audit

---

### I'm Onboarding Someone (or Being Onboarded)

**[Workflows: Onboarding](workflows.md#workflow-onboarding-to-a-new-codebase)** (5-10 min)
- Fast understanding
- Key areas
- Next steps

**[Cookbook: Onboarding New Developers](cookbook.md#recipe-onboarding---teaching-someone-your-project)** (60 min)
- Create onboarding guide
- Auto-generate docs
- Regular updates

---

### I'm Creating Documentation

**[Workflows: Documenting Your Project](workflows.md#workflow-documenting-your-project)** (30-60 min)
- Architecture docs
- API docs
- Component docs
- Keep docs current

**[Cookbook: Auto-Generate Docs](cookbook.md#recipe-documentation---auto-generating-api-specs)** (5 min setup)
- Automated API docs
- Pre-commit hooks
- GitHub Actions

---

### I'm Doing a Code Review

**[Workflows: Code Review Preparation](workflows.md#workflow-code-review-preparation)** (10-15 min)
- Compare branches
- See what changed
- Understand impact

**[Commands: xray impact](commands.md#xray-impact)**
- What breaks if I change a function (transitive callers by area)

---

### I Need Real-World Examples

**[Cookbook](cookbook.md)** - Copy-paste ready solutions
1. Quick reference commands
2. React app architecture
3. Express API mapping
4. Polyglot API inventory
5. Debugging techniques
6. Refactoring verification
7. Onboarding guide
8. Auto-documentation

---

## By Topic

### Installation & Setup
- [Getting Started](getting-started.md)
- [Language Packs](language-packs.md)
- [Installation Troubleshooting](troubleshooting.md#installation-issues)

### Learning Commands
- [Commands Reference](commands.md) - Complete command list
- [Quick Reference](quick-reference.md) - Cheat sheet
- [Strategies Guide](strategies.md) - Framework-specific analysis

### Using Features
- [Configuration Guide](configuration.md) - Setup .xrayrc.json
- [Command Aliases](aliases.md) - Create shortcuts for frequently-used commands
- [Chunked Output Guide](README.md#3-chunked-output) - Multi-file output
- [Automation Guide](automation.md) - GitHub Actions & hooks
- [MCP Server](mcp.md) - Expose xray analysis to MCP clients over stdio

### Integrations
- [Harness Integration](harness-integration.md) - Skill, MCP and hooks for coding agents
- [MCP Server](mcp.md) - MCP client configuration and tools
- [Use Cases](use-cases.md) - What xray does inside an agent session
- [Imports Contract](imports-contract.md) - `xray.imports/v1` schema for consumers of import data (draft)

### Problem-Solving
- [Troubleshooting Guide](troubleshooting.md) - Common issues
- [Workflows: Debugging](workflows.md#workflow-debugging-a-complex-issue)

### Learning Best Practices
- [Best Practices Guide](best-practices.md)
- [Common Workflows](workflows.md)
- [Cookbook](cookbook.md)

---

## By Skill Level

### Beginner (Just Starting)
1. [Getting Started](getting-started.md)
2. [Quick Reference](quick-reference.md)
3. [Commands: xray map](commands.md#xray-map)
4. One [Cookbook Recipe](cookbook.md) matching your scenario

### Intermediate (Regular User)
1. [All Commands](commands.md)
2. [Strategies Guide](strategies.md)
3. [Configuration Guide](configuration.md)
4. [Workflows](workflows.md) for your scenario

### Advanced (Power User)
1. [Best Practices](best-practices.md)
2. [Chunked Output](README.md#3-chunked-output)
3. [Automation](automation.md)
4. [All Workflows](workflows.md)

---

## By Time Available

### 5 Minutes
- [Getting Started: Your First Map](getting-started.md)
- [Quick Reference Card](quick-reference.md)

### 15 Minutes
- [One Cookbook Recipe](cookbook.md)
- [Workflows: Quick scenario](workflows.md)

### 30 Minutes
- [Getting Started](getting-started.md)
- [Commands Reference](commands.md)
- [One Workflow](workflows.md)

### 60+ Minutes
- [Full Getting Started](getting-started.md)
- [Strategies Guide](strategies.md)
- [Configuration Guide](configuration.md)
- [Best Practices](best-practices.md)
- [Relevant Workflow](workflows.md)

---

## By Use Case

| Use Case | Start Here | Then Read |
|----------|---|---|
| Understand my codebase | [Workflows: Onboarding](workflows.md#workflow-onboarding-to-a-new-codebase) | [Commands](commands.md) |
| Help AI understand code | [Workflows: AI Analysis](workflows.md#workflow-preparing-code-for-ai-analysis) | [Best Practices](best-practices.md) |
| Debug an issue | [Workflows: Debugging](workflows.md#workflow-debugging-a-complex-issue) | [Cookbook: Debugging](cookbook.md) |
| Plan a refactor | [Workflows: Refactor](workflows.md#workflow-planning-a-refactor) | [Cookbook: Refactor](cookbook.md) |
| What breaks if I change X? | [Commands: xray impact](commands.md#xray-impact) | [Query guide: impact](query-guide.md#impact-analysis-with-xray-impact) |
| Feed imports to an audit tool | [Commands: xray imports](commands.md#xray-imports) | [Imports contract](imports-contract.md) |
| Give my coding agent xray | [Harness Integration](harness-integration.md) | [Use Cases](use-cases.md), [MCP Server](mcp.md) |
| Document project | [Workflows: Documentation](workflows.md#workflow-documenting-your-project) | [Cookbook: Docs](cookbook.md) |
| Set up team | [Configuration](configuration.md) | [Automation](automation.md) |
| Optimize performance | [Best Practices: Performance](best-practices.md#performance-tips) | [Best Practices: Caching](best-practices.md#caching--performance) |
| Fix a problem | [Troubleshooting](troubleshooting.md) | Relevant workflow |

---

## Quick Navigation

| Need | Link |
|------|------|
| 60-second setup | [Getting Started](getting-started.md) |
| Cheat sheet | [Quick Reference](quick-reference.md) |
| All commands | [Commands](commands.md) |
| React help | [Strategies: React](strategies.md#react-strategy) |
| Express help | [Strategies: Express](strategies.md#express-strategy) |
| API help | [Strategies: REST API](strategies.md#rest-api-strategy) |
| Go CLI help | [Strategies: Go CLI](strategies.md#go-cli-strategy) |
| Stuck? | [Troubleshooting](troubleshooting.md) |
| Real examples | [Cookbook](cookbook.md) |

---

## Reading Flow (Recommended)

### For Your First Hour

1. [Getting Started](getting-started.md) (10 min)
   - Install
   - Run first command
   - Understand output

2. [Quick Reference](quick-reference.md) (5 min)
   - See common commands
   - Bookmark for later

3. [Relevant Workflow](workflows.md) (15-20 min)
   - Find your use case
   - Follow steps
   - Get results

### For the First Week

- Try 2-3 [Cookbook recipes](cookbook.md)
- Read [Configuration Guide](configuration.md)
- Skim [Best Practices](best-practices.md)

### For Ongoing Use

- Keep [Quick Reference](quick-reference.md) handy
- Reference [Commands](commands.md) as needed
- Explore [Best Practices](best-practices.md) for optimization
- Check [Troubleshooting](troubleshooting.md) when stuck

---

## By Framework

| Framework | Relevant Docs |
|-----------|---|
| React | [Strategies: React](strategies.md#react-strategy), [Cookbook](cookbook.md#recipe-react-app---understanding-component-architecture) |
| Express | [Strategies: Express](strategies.md#express-strategy), [Cookbook](cookbook.md#recipe-express-api---mapping-all-routes) |
| REST APIs | [Strategies: REST API](strategies.md#rest-api-strategy), [Cookbook](cookbook.md#recipe-polyglot-api---finding-all-endpoints-across-services) |
| Go CLI | [Strategies: Go CLI](strategies.md#go-cli-strategy) |
| Python | [Strategies: REST API](strategies.md#rest-api-strategy) |
| Any | [Commands](commands.md), [Best Practices](best-practices.md) |

---

## Searching Tips

- **By problem**: Search [Troubleshooting](troubleshooting.md)
- **By command**: Search [Commands Reference](commands.md)
- **By scenario**: Search [Workflows](workflows.md) or [Cookbook](cookbook.md)
- **By concept**: Search [Best Practices](best-practices.md)

---

## Still Lost?

1. Check [Quick Reference](quick-reference.md) for common commands
2. Look at [Cookbook](cookbook.md) for similar examples
3. Read [Troubleshooting](troubleshooting.md) if something broke
4. Ask on [GitHub Issues](https://github.com/hop-top/xray/issues)

---

## Documentation Map

```
xray User Manual
├── README.md (you are here)
│   ├── Quick navigation by use case
│   └── Links to all docs
│
├── Getting Started (New? Start here!)
│   └── Installation, first command, understanding output
│
├── Quick Reference (Bookmark this)
│   └── Cheat sheet of common commands
│
├── Commands Reference (Complete reference)
│   ├── xray map
│   ├── xray explore / strategies
│   ├── xray graph
│   ├── xray impact (what breaks if I change X)
│   ├── xray strategy detect/list
│   ├── xray alias (manage shortcuts)
│   ├── xray clear-cache
│   └── xray completion
│
├── Strategies Guide (Framework-specific)
│   ├── React (components, hooks, contexts)
│   ├── Express (routes, middleware, error handlers)
│   ├── REST API (endpoints across frameworks)
│   └── Go CLI (command tree and flags)
│
├── Configuration Guide (Setup once, use everywhere)
│   ├── Basic config
│   ├── Scopes (multiple outputs)
│   ├── Presets (legacy)
│   └── Real examples
│
├── Chunked Output Guide (For large codebases)
│   ├── How it works
│   ├── When to use
│   └── Navigation
│
├── Automation Guide (CI/CD integration)
│   ├── GitHub Actions
│   ├── Pre-commit hooks
│   └── Examples
│
├── MCP Server (pull: xray as MCP tools)
│   ├── Client configuration (Claude Code, Cursor)
│   └── Tools, errors, trust model
│
├── Harness Integration (skill, MCP, hooks)
│   ├── Three ways in
│   ├── Hook rules, saved graph
│   └── Claude Code, nerv, Gemini CLI, Codex, Cursor, any harness
│
├── Use Cases (jobs inside an agent session)
│   └── Impact analysis
│
├── Workflows (Real-world scenarios)
│   ├── Onboarding to new codebase
│   ├── Debugging complex issues
│   ├── Planning refactors
│   ├── Preparing for AI analysis
│   ├── Code review prep
│   ├── Documentation
│   ├── Multi-project analysis
│   └── Finding patterns
│
├── Best Practices (Tips & patterns)
│   ├── Token budget management
│   ├── Iterative exploration
│   ├── Caching & performance
│   ├── Output organization
│   ├── AI workflows
│   └── Common patterns
│
├── Cookbook (Copy-paste solutions)
│   ├── Quick reference commands
│   ├── React app architecture
│   ├── Express API mapping
│   ├── Polyglot API inventory
│   ├── Debugging techniques
│   ├── Refactoring verification
│   ├── Onboarding guide
│   └── Auto-documentation
│
└── Troubleshooting (When things don't work)
    ├── Installation issues
    ├── Runtime issues
    ├── Strategy issues
    ├── Automation issues
    ├── Output issues
    └── Getting help
```

---

## Recommended Starting Points by Role

### Developer
1. [Getting Started](getting-started.md)
2. [Quick Reference](quick-reference.md)
3. [Relevant Workflow](workflows.md)

### Team Lead
1. [Getting Started](getting-started.md)
2. [Configuration Guide](configuration.md)
3. [Automation Guide](automation.md)

### DevOps/Platform Engineer
1. [Configuration Guide](configuration.md)
2. [Automation Guide](automation.md)
3. [Troubleshooting](troubleshooting.md)

### New Team Member
1. [Getting Started](getting-started.md)
2. [Workflows: Onboarding](workflows.md#workflow-onboarding-to-a-new-codebase)
3. [Relevant Workflow](workflows.md) for your assignment

### Tech Lead
1. [Best Practices](best-practices.md)
2. [Workflows](workflows.md)
3. [Configuration Guide](configuration.md)

---

**Pick a starting point above and dive in. Everything is linked, so you can navigate easily.**
