# AGENTS.md

Agent guidance for xray. Full guide at [`docs/agent/`](docs/agent/).

## Quick start

| Intent | Command |
|--------|---------|
| First-pass codebase understanding | `xray map` |
| Generate architectural handbook | `xray handbook` |
| Export Mermaid diagram | `xray diagram --view architecture` |
| Find / discover files | `xray explore --match <pattern>` |
| Search code for a keyword (trigram/regex) | `xray explore --search <keyword>` |
| Control + data flow graphs | `xray graph` |
| Call-graph queries | `xray query "calls(<fn>)"` |
| What breaks if I change X? (or diff) | `xray impact <symbol>` / `xray impact --changed` ([workflow](docs/agent/workflows/impact-analysis.md)) |
| Review a git diff | `xray review --base <ref>` |
| Ask a codebase question (BYOK LLM) | `xray ask "<question>"` |
| Live incremental index | `xray watch` |
| Interactive terminal explorer / Web UI | `xray tui` / `xray serve` |
| Workspace skills | `xray skills list` |
| Framework-aware insights | `xray <strategy> <noun>` |
| List / detect strategies | `xray strategy list` / `xray strategy detect` |

## Surface

`xray --help` — top-level commands. Functional groups:

- Analysis: `map`, `graph`, `query`, `impact`, `imports`, `handbook`, `diagram`, `ask`, `review`, `watch`, `tui`, `serve`, `explore`
- Strategy: `strategy` + dynamic noun commands
- Management: `alias`, `skills`, `lang`, `cache`, `paths`, `describe`, `upgrade`, `mcp`, `completion`
- Integration: `mcp` — stdio and Streamable HTTP MCP server ([`docs/user/mcp.md`](docs/user/mcp.md)); `serve` — local Web UI, REST API, and optional `/mcp`; harness hooks in `hooks/harness/` push `xray impact` into Claude Code / nerv / Gemini CLI sessions ([`docs/user/harness-integration.md`](docs/user/harness-integration.md))

## Reference

- [`docs/agent/INDEX.md`](docs/agent/INDEX.md) — full index
- [`docs/agent/README.md`](docs/agent/README.md) — main entry point
- [`docs/agent/command-selection.md`](docs/agent/command-selection.md) — picking the right command
- [`docs/agent/decision-trees.md`](docs/agent/decision-trees.md) — when to use what
- [`docs/agent/optimal-usage-patterns.md`](docs/agent/optimal-usage-patterns.md) — best practices
- [`docs/agent/error-handling.md`](docs/agent/error-handling.md) — interpreting exit codes
- [`docs/agent/token-optimization.md`](docs/agent/token-optimization.md) — token budgeting
