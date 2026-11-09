# MCP server

`xray mcp` serves xray's analysis commands as
[Model Context Protocol](https://modelcontextprotocol.io) tools over
stdin/stdout, so an MCP client (Claude Code, Cursor, any stdio MCP host)
can map, search and query a codebase without shelling out. No tool writes
into the project: `map` and `graph`, which the CLI runs by writing
`.xray_*.md` files next to the code, write to a private temp directory
under MCP and return its content (details under Tools).

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
| `graph` | `xray graph` | CFG/DFG output |
| `explore` | `xray explore` | match / search / stats rows |
| `query` | `xray query <query>` | call-graph query result |
| `impact` | `xray impact <symbol>` | transitive callers by area ("what breaks if I change X") |
| `imports` | `xray imports [paths...]` | the [`xray.imports/v1`](imports-contract.md) document: per-file imports, parse errors, unsupported constructs |
| `strategy_list` | `xray strategy list` | available strategies |
| `strategy_detect` | `xray strategy detect` | strategies detected for the project |
| `<strategy>_<noun>` | `xray <strategy> <noun>` | strategy insight, e.g. `react_hooks`, `express_routes`, `markdown_toc` |

Tool names join the command path with `_`. Input schemas are derived
from the command tree: each option is a property named after its long
flag (`no-chunk`, `skip-detect`, `format`), repeatable options are string
arrays, positional arguments are properties named after the argument
(`query`), and every tool with a project scope takes an optional `root`.
`tools/list` shows the exact schemas, including any project strategies.

Options are allowlisted per tool: a tool exposes only the options on its
list (none writes into the project, loads code or reveals secrets), and a
call with any other argument is a tool error.
Built-in strategy nouns get `path`, `format` and the extension-override
flags, plus the options vetted per noun (`config-files list --pattern`,
`config-files keys|values --file`, `build run --target`, `markdown toc
--depth`). Options a project strategy declares for its own nouns are not
exposed.

`impact` takes `symbol`, `depth`, `strict`, `format`, `lens`, `scope`
and `root`; its graph is always built over the call root, so `--graph`
(and `--path`, `--lang`) are not exposed.

`imports` takes `paths`, `path`, `lang`, `format`, `no-ignore` and `root`. Every entry
of `paths` is a path argument: resolved against `root` and held inside
the server root like `path`; `--output` is not exposed.

Only strategy commands declared `read` are tools; `build exec` (runs the
repo's build recipe; `destructive-local`) is not exposed.

Not exposed: commands that change state (`cache clear`, `alias set`,
`strategy install`, `lang add`, ...) and flags that write files, load
code or reveal secrets: `--output`, `--share`, `--template`, `--preset`,
`--config`, go-cli's `--exec-binary` / `--binary` /
`--unsafe-no-sandbox` / `--allow-cgo`, and `config-files values
--show-secrets`.

Behaviour per tool:

- `map`, `graph` write their output to a private temp directory, not the
  project (the CLI writes `.xray_*.md` next to the code); the tool result
  is that output (chunked runs return every chunk with a `== <file> ==`
  header), and the temp directory is removed. Running both over a project
  leaves its tree byte-identical.
- `query` without `graph` first builds one (`xray map --format json`) in
  a temp directory, then runs the query against it.
- `impact` builds its graph in memory over the call root (same config,
  `lens` and `scope` resolution as `map`) and writes no file.
- Everything else returns the command's stdout.

## Errors

- Unknown tool: JSON-RPC error `-32602`.
- Bad argument (unknown or unlisted name, wrong type, path outside the
  server root, URL where a path is expected, sub-root with its own config
  when the server root has none):
  tool result with `isError: true` and the reason.
- Command failure (non-zero exit): tool result with `isError: true`,
  stdout and the command's stderr (`[stderr] ...`).

The server never exits on a failed call.

## Trust model

Project strategy code (`.xray/strategies/*.js|ts`, strategies in
`node_modules`) loads only when you set `XRAY_ALLOW_PROJECT_STRATEGIES=1`
in the environment of the server (and therefore of its calls); by default
none runs, and `strategy_list` reports what was skipped. Declarative YAML
strategies and built-ins always load. Config files are JSON data and never
run. With the opt-in set, running xray in a directory trusts that
directory, and `xray mcp` fixes the trusted directory at startup:

- **Server root** = the directory the server starts in (working
  directory, or `-C <dir>`). You choose it when you configure the client.
- **Server config** = the config file `xray` run in the server root
  would use, resolved once at startup: `xray mcp --config <file>` when
  given (a missing or JavaScript file fails startup), else the first `.xrayrc`,
  `.xrayrc.json`, `xray.config.json` or `package.json` with an `xray` key
  found walking up from the server root.
- Every call's child process runs with the server root as its working
  directory, so project strategies (when opted in), aliases and config load from the
  server root only, exactly as for `xray` run there. With a server
  config, children also get `-C <server root> --config <server config>`:
  every config load in the call reads that file.
- `root` selects the project directory a tool analyzes, inside the
  server root (absolute, or relative to the server root); anything
  outside, including through symlinks, is refused. It never becomes the
  working directory: it reaches the command as its `--path` (map,
  graph, explore, impact, imports, strategy detect, `<strategy>_<noun>`), and `query`
  builds its graph over it. `strategy_list` has no project scope and
  takes no `root`. Relative path arguments resolve against `root`.
- Sub-roots with their own config (`.xrayrc`, `.xrayrc.json`, `xray.config.json`, a
  `package.json` `xray` key), such as monorepo packages:

  | Server config | Sub-root config | map / graph / query / impact on it |
  |---------------|-----------------|----------------------------------|
  | yes | no  | runs with the server config |
  | yes | yes | runs with the server config; the sub-root's never loads |
  | no  | no  | runs with no project config |
  | no  | yes | refused |

  Without `--config`, map, graph and impact look for config by walking up
  from their `--path`, so with no server config to pin, a sub-root's
  own file would load in place of the server's; that case is refused.
  Add a config file to the server root, or start the server with
  `--config <file>`, to scope such sub-roots.
- Every path-valued argument is held inside the server root: `path`,
  `anchor`, `graph`, `config-files keys|values --file`, `imports` `paths`, and each path in
  map's `query` (`path`, `.ext:path`, comma lists). URLs are refused
  wherever a path is expected; the server never makes the CLI fetch a
  remote query file.
- Config is held inside the root too. The server config's `paths`,
  `queries` and the like that resolve outside the root (symlinks
  resolved) are refused, as for any run of `xray` (see
  [configuration](configuration.md#paths-stay-inside-the-project)); its
  `output` and `share` never apply, because every call writes to its own
  temp directory. A cloned repo's config cannot make a call read or
  write outside the server root.
- So project code only ever loads from the tree you started the server
  in, and only from its root. A client cannot point the server at
  another checkout, or at a subtree's own strategies or config.
- Each call runs the CLI command in a child process with
  `--no-telemetry --offline`: no consent prompt, no consent
  write, no upgrade check. The analysis cache lives in the user cache dir (keyed by
  the server root), not in the root; nothing is written into the server
  root.
- No tool writes outside those caches and the per-call temp directory, or
  deletes anything.

The server runs with your user's permissions; tools read whatever the
CLI command reads under the server root. Serve only projects you would
run `xray` in.

## See also

- [Harness Integration Guide](harness-integration.md): MCP next to
  instructions and push hooks, per harness (Claude Code, nerv, Gemini
  CLI, Codex, Cursor)
- [Use Cases](use-cases.md): what the `impact` tool answers, with real output
