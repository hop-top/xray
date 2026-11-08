# AGENTS.md

Agent guidance for xray. Full guide at [`docs/agent/`](docs/agent/).

## Quick start

| Intent | Command |
|--------|---------|
| First-pass codebase understanding | `xray map` |
| Find / discover files | `xray explore --match <pattern>` |
| Control + data flow graphs | `xray graph` |
| Call-graph queries | `xray query "calls(<fn>)"` |
| What breaks if I change X? | `xray impact <symbol>` ([workflow](docs/agent/workflows/impact-analysis.md)) |
| Framework-aware insights | `xray <strategy> <noun>` |
| List available strategies | `xray strategy list` |
| Detect applicable strategies | `xray strategy detect` |
| Search code for a keyword | `xray explore --search <keyword>` |

## Surface

`xray --help` — top-level commands. Functional groups:

- Analysis: `map`, `graph`, `query`, `impact`, `explore`
- Strategy: `strategy` + dynamic noun commands
- Management: `alias`, `clear-cache`, `completion`
- Integration: `mcp` — stdio MCP server ([`docs/user/mcp.md`](docs/user/mcp.md)); harness hooks in `hooks/harness/` push `xray impact` into Claude Code / nerv / Gemini CLI sessions ([`docs/user/harness-integration.md`](docs/user/harness-integration.md))

## Reference

- [`docs/agent/INDEX.md`](docs/agent/INDEX.md) — full index
- [`docs/agent/README.md`](docs/agent/README.md) — main entry point
- [`docs/agent/command-selection.md`](docs/agent/command-selection.md) — picking the right command
- [`docs/agent/decision-trees.md`](docs/agent/decision-trees.md) — when to use what
- [`docs/agent/optimal-usage-patterns.md`](docs/agent/optimal-usage-patterns.md) — best practices
- [`docs/agent/error-handling.md`](docs/agent/error-handling.md) — interpreting exit codes
- [`docs/agent/token-optimization.md`](docs/agent/token-optimization.md) — token budgeting
