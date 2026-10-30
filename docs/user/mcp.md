# MCP server

`xray mcp` serves xray's read-only analysis commands as
[Model Context Protocol](https://modelcontextprotocol.io) tools over
stdin/stdout, so an MCP client (Claude Code, Cursor, any stdio MCP host)
can map, search and query a codebase without shelling out.

```bash
xray mcp                       # serve the current directory
xray -C /path/to/project mcp   # serve another directory
xray mcp --timeout 120         # per-call timeout in seconds (default 300)
```

The server speaks MCP `2024-11-05` (newline-delimited JSON-RPC on
stdio): `initialize`, `ping`, `tools/list`, `tools/call`. stdout carries
protocol messages only; diagnostics go to stderr.

## Client configuration

### Claude Code

```bash
claude mcp add xray -- xray -C /path/to/project mcp
```

or, checked into the project as `.mcp.json`:

```json
{
  "mcpServers": {
    "xray": {
      "command": "xray",
      "args": ["mcp"]
    }
  }
}
```

Without `-C` the server root is the directory the client starts the
server in; add `-C <project>` when that is not the project.

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "xray": {
      "command": "xray",
      "args": ["-C", "${workspaceFolder}", "mcp"]
    }
  }
}
```

Any other stdio client: run `xray -C <project> mcp`.

## Tools

| Tool | CLI equivalent | Result |
|------|----------------|--------|
| `map` | `xray map` | map text (or the `--format` output) |
| `scan` | `xray scan` | scan output |
| `graph` | `xray graph` | CFG/DFG output |
| `explore` | `xray explore [query]` | match / search / stats rows |
| `query` | `xray query <query>` | call-graph query result |
| `strategy_list` | `xray strategy list` | available strategies |
| `strategy_detect` | `xray strategy detect` | strategies detected for the project |
| `<strategy>_<noun>` | `xray <strategy> <noun>` | strategy insight, e.g. `react_hooks`, `express_routes`, `markdown_toc` |

Tool names join the command path with `_`. Input schemas are derived
from the command tree: each option is a property named after its long
flag (`no-chunk`, `skip-detect`, `format`), repeatable options are string
arrays, positional arguments are properties named after the argument
(`query`), and every tool takes an optional `root`. `tools/list` shows
the exact schemas, including any project strategies.

Not exposed: commands that change state (`cache clear`, `alias set`,
`strategy install`, `lang add`, ...) and flags that write files or run
code: `--output`, `--share`, `--template`, `--preset`, and go-cli's
`--exec-binary` / `--binary` / `--unsafe-no-sandbox` / `--allow-cgo`.
`config values --show-secrets` is not exposed either.

Behaviour per tool:

- `map`, `scan`, `graph` write their output to a private temp directory;
  the tool result is that output (chunked runs return every chunk with a
  `== <file> ==` header), and the temp directory is removed.
- `query` without `graph` first builds one (`xray map --format json`) in
  a temp directory, then runs the query against it.
- Everything else returns the command's stdout.

## Errors

- Unknown tool: JSON-RPC error `-32602`.
- Bad argument (unknown name, wrong type, path outside the server root):
  tool result with `isError: true` and the reason.
- Command failure (non-zero exit): tool result with `isError: true`,
  stdout and the command's stderr (`[stderr] ...`).

The server never exits on a failed call.

## Trust model

Running xray in a directory trusts that directory: project strategies
(`.xray/strategies`, strategies in `node_modules`) and a JS project config
(`.xrayrc.js`) are code, and xray loads them. `xray mcp` keeps that rule
and fixes the trusted directory at startup:

- **Server root** = the directory the server starts in (working
  directory, or `-C <dir>`). You choose it when you configure the client.
- Every call runs inside the server root. `root` selects a directory
  inside it (absolute, or relative to the server root); anything outside,
  including through symlinks, is refused. Path-valued arguments (`path`,
  `anchor`, `graph`) are held to the same rule.
- So project code only ever loads from the tree you started the server
  in. A client cannot point the server at another checkout.
- Each call runs the CLI command in a child process with
  `--no-telemetry --offline`: no consent prompt, no `.xrayrc.json`
  write, no upgrade check. Cache files (`.xray/`, `.xray_cache.db`) are
  written exactly as the same CLI command would write them.
- No tool writes outside those caches or deletes anything.

The server runs with your user's permissions; tools read whatever the
CLI command reads under the server root. Serve only projects you would
run `xray` in.
