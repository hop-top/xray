---
name: xray-cli-agent
description: Use when an agent needs to onboard to a new codebase or analyze control/data flow using the xray CLI. Covers agent-first command selection, token-efficient maps, strategy discovery, dependency tracing, control/data flow graphs, and common workflows (onboarding, bug tracing, refactor impact, code review, AI prep, monorepo scan).
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

## Core Rules
- Default: `map --with incs` for relationships.
- Add `--with vars` for state/structure.
- Add `--with docs` only if unclear intent.
- Use `graph --with cf/df` only for complex logic.
- Start with `strategy:detect` when new repo.
- Keep scope narrow: `--path`, `--depth`, `--anchor`.

## UC1 Onboard stack + structure
Goal: identify frameworks + top-level layout.

Commands:
```bash
xray strategy:detect
xray map --path ./src --depth 2 --with incs
```

## UC2 Framework surface scan
Goal: list key surface area fast.

Commands:
```bash
xray react:components
xray react:hooks
xray express:routes
xray rest-api:endpoints
```

## UC3 Dependency map (who calls/imports)
Goal: callers/callees, imports, dependents.

Commands:
```bash
xray map --anchor <file> --with incs
xray map --path <dir> --with incs
```

## UC4 Control flow (CFG)
Goal: branch/loop execution shape.

Commands:
```bash
xray graph --path <dir> --with cf
xray graph --anchor <file> --with cf
```

## UC5 Data flow (DFG)
Goal: variable mutations, data propagation.

Commands:
```bash
xray graph --path <dir> --with df
xray graph --anchor <file> --with df
```

## UC6 Bug trace path
Goal: trace error path up/down stack.

Commands:
```bash
xray map --path <suspect-area> --with incs
xray map --anchor <suspect-file> --with incs --with vars
xray graph --anchor <suspect-file> --with df
```

## UC7 Refactor impact / blast radius
Goal: find dependents and public surface.

Commands:
```bash
xray map --path <subsystem> --with incs
xray map --catch "*Auth*" --with incs
xray map --anchor <subsystem>/index.ts --with incs
```

## UC8 Code review prep
Goal: understand change impact.

Commands:
```bash
xray map --anchor <changed-file> --with incs
xray map --path <changed-area> --with incs
```

## UC9 AI‑friendly summary / chunking
Goal: token‑bounded summary for LLM.

Commands:
```bash
xray map --path ./src --depth 2 --with incs --limit 4000
xray map --anchor <entry-file> --with incs --with vars
```

## UC10 Monorepo or multi‑project scan
Goal: map each package/service quickly.

Commands:
```bash
for p in packages/*/; do xray map -p "$p" --depth 2 --with incs; done
```

## UC11 Pattern search / hotspots
Goal: find candidates by name or usage.

Commands:
```bash
xray map --catch "*Handler" --with incs
xray map --catch "*Controller" --with incs
xray map --with incs | grep -i "auth\|jwt\|oauth"
```

## Decision Cheatsheet
- Need structure: `map`.
- Need dependencies: `map --with incs`.
- Need variable context: add `--with vars`.
- Need logic flow: `graph --with cf/df`.
- Need framework surface: `strategy:detect` + `explore`.

## Failure Modes
- Empty output: narrow scope, wrong path, or strategy not detected.
- Stale output: run `xray clear-cache` then retry.

Commands:
```bash
xray clear-cache
```
