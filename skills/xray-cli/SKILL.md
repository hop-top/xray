---
name: xray-cli-agent
description: Use when an agent needs to onboard to a new codebase or analyze control/data flow using the xray CLI. Covers agent-first command selection, token-efficient maps, strategy discovery, dependency tracing, symbol impact (transitive callers), control/data flow graphs, MCP server use, and common workflows (onboarding, bug tracing, refactor impact, code review, AI prep, monorepo scan).
metadata:
  short-description: xray CLI use cases for agents
---

# xray CLI for Agent Onboarding and Flow Analysis

## Scope
Use xray to get structure, dependencies, control flow, data flow. Optimize for tokens. Prefer maps and strategies before reading many files.

## Command Index (Use Cases)
1. Onboard stack + structure (see `commands/onboard-stack-structure.md`)
2. Framework surface scan (see `commands/framework-surface.md`)
3. Dependency map (see `commands/dependency-map.md`)
4. Control flow (see `commands/control-flow.md`)
5. Data flow (see `commands/data-flow.md`)
6. Bug trace path (see `commands/bug-trace.md`)
7. Refactor impact / blast radius (see `commands/refactor-impact.md`)
8. Code review prep (see `commands/code-review-prep.md`)
9. AI‑friendly summary / chunking (see `commands/ai-summary.md`)
10. Monorepo or multi‑project scan (see `commands/monorepo-scan.md`)
11. Pattern search / hotspots (see `commands/pattern-search.md`)
12. Package dependencies (see `commands/package-dependencies.md`)
13. Build system (see `commands/build-system.md`)
14. Container configuration (see `commands/container-config.md`)
15. CI/CD pipeline (see `commands/ci-cd-pipeline.md`)
16. Configuration files (see `commands/config-files.md`)
17. Infrastructure as code (see `commands/infrastructure-scan.md`)
18. MCP server: xray as agent tools (see `commands/mcp-server.md`)

## Core Rules
- Default: `map --with incs` for relationships.
- Before changing a function: `impact <symbol>` for its callers.
- Add `--with vars` for state/structure.
- Add `--with docs` only if unclear intent.
- Use `graph --with cf/df` only for complex logic.
- Start with `strategy detect` when new repo.
- Keep scope narrow: `--path`, `--depth`, `--anchor`.

## Onboard stack + structure
Goal: identify frameworks + top-level layout.

Commands:
```bash
xray strategy detect
xray map --path ./src --depth 2 --with incs
```

## Framework surface scan
Goal: list key surface area fast.

Commands:
```bash
# Framework-specific
xray react components
xray react hooks
xray express routes
xray rest-api endpoints

# Infrastructure & tooling
xray package-manager list-dependencies
xray package-manager summary
xray build targets
xray build graph
xray container analyze
xray container services
xray container stages
xray config-files list
xray config-files keys
xray config-files values
xray cicd workflows
xray cicd graph
xray cicd deploy
xray cicd triggers
xray infrastructure resources
xray infrastructure providers
xray infrastructure graph
xray infrastructure summary
```

## Dependency map (who calls/imports)
Goal: callers/callees, imports, dependents.

Commands:
```bash
xray map --anchor <file> --with incs
xray map --path <dir> --with incs
```

## Control flow (CFG)
Goal: branch/loop execution shape.

Commands:
```bash
xray graph --path <dir> --with cf
xray graph --anchor <file> --with cf
```

## Data flow (DFG)
Goal: variable mutations, data propagation.

Commands:
```bash
xray graph --path <dir> --with df
xray graph --anchor <file> --with df
```

## Bug trace path
Goal: trace error path up/down stack.

Commands:
```bash
xray map --path <suspect-area> --with incs
xray map --anchor <suspect-file> --with incs --with vars
xray graph --anchor <suspect-file> --with df
```

## Refactor impact / blast radius
Goal: find callers and public surface.

Commands:
```bash
xray impact <symbol>                        # transitive callers by area (default --depth 3)
xray impact <symbol> --depth 1 --strict     # direct callers, EXTRACTED edges only
xray impact 'Auth*' --format json           # glob; machine-readable counts + groups
xray map --anchor <subsystem>/index.ts --with incs   # public surface
```

Edges: EXTRACTED = resolved via caller's file/dir/imports (trust); INFERRED =
name match only (verify). Many queries: `xray map --format json -o graph.json`
once, then `xray impact <symbol> --graph graph.json`.

Fallback (text search, when `impact` says `no matching symbol in the graph`):
```bash
xray map --catch "*Auth*" --with incs
```

## Code review prep
Goal: understand change impact.

Commands:
```bash
xray impact <changed-symbol> --depth 2
xray map --anchor <changed-file> --with incs
xray map --path <changed-area> --with incs
```

## AI‑friendly summary / chunking
Goal: token‑bounded summary for LLM.

Commands:
```bash
xray map --path ./src --depth 2 --with incs --limit 4000
xray map --anchor <entry-file> --with incs --with vars
```

## Monorepo or multi‑project scan
Goal: map each package/service quickly.

Commands:
```bash
for p in packages/*/; do xray map -p "$p" --depth 2 --with incs; done
```

## Pattern search / hotspots
Goal: find candidates by name or usage.

Commands:
```bash
xray map --catch "*Handler" --with incs
xray map --catch "*Controller" --with incs
xray map --with incs --no-chunk -o map.txt
grep -i "auth\|jwt\|oauth" map.txt
```

## Package dependencies
Goal: understand project dependencies and package managers.

Commands:
```bash
xray package-manager list-dependencies
xray package-manager summary
```

## Build system
Goal: understand how project builds.

Commands:
```bash
xray build targets
xray build graph
```

## Container configuration
Goal: understand Docker/container setup.

Commands:
```bash
xray container analyze
xray container services
xray container stages
```

## CI/CD pipeline
Goal: understand deployment flow.

Commands:
```bash
xray cicd workflows
xray cicd deploy
xray cicd graph
xray cicd triggers
```

## Configuration files
Goal: understand project configuration.

Commands:
```bash
xray config-files list
xray config-files keys --file <file>
xray config-files values --file <file>
```

## Infrastructure as code
Goal: understand cloud resources.

Commands:
```bash
xray infrastructure resources
xray infrastructure providers
xray infrastructure graph
xray infrastructure summary
```

## MCP server
Goal: expose xray commands as MCP tools (map, graph, query, impact,
explore, strategy list/detect, `<strategy>_<noun>`).

Commands:
```bash
xray -C <project> mcp
claude mcp add xray -- xray -C <project> mcp
```

## Decision Cheatsheet
- Need structure: `map`.
- Need dependencies: `map --with incs`.
- Need callers of a symbol / blast radius: `impact <symbol>`.
- Need xray as agent tools: `mcp`.
- Need variable context: add `--with vars`.
- Need logic flow: `graph --with cf/df`.
- Need framework surface: `strategy detect` + `explore`.
- Need project setup: `strategy detect` + infrastructure commands.
- Need package dependencies: `package-manager list-dependencies`.
- Need build process: `build targets`.
- Need deployment flow: `cicd workflows` + `cicd deploy`.
- Need infrastructure: `infrastructure resources` + `infrastructure providers`.

## Failure Modes
- Empty output: narrow scope, wrong path, or strategy not detected.
- Stale output: run `xray --confirm=yes cache clear` then retry (destructive: scripts and agents must pass `--confirm=yes`).

Commands:
```bash
xray --confirm=yes cache clear
```
