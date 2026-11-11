---
name: xray-cli
description: Codebase structure, dependencies and callers from the xray CLI. Use when onboarding to an unfamiliar repo, before changing a function (blast radius), or when tracing control or data flow.
---

# xray

xray answers structural questions from a parsed graph: ask it before reading files in bulk. `xray --help-all` lists every command and flag; this file holds what help does not say.

## Escalate

Start cheap. Add detail only when the cheaper output leaves the question open.

1. `xray strategy detect`, on a new repo: names the stacks present. Each has its own commands (`xray react components`, `xray cicd workflows`, `xray build targets`).
2. `xray map --with incs`: structure plus who imports and calls whom. The default.
3. Add `--with vars` when state or data shapes matter.
4. Add `--with docs` when intent is still unclear.
5. `xray graph --with cf` or `--with df`: control or data flow of one complex file or directory.

Keep every call narrow: `--path <dir>`, `--depth <n>`, `--anchor <file>` (ranks the graph around that file), `--catch '*Name*'` (function and class names).

`map` and `graph` write files into the current directory and print only a summary: read `.xray_*.md` (chunks), or `.xray.txt` with `--no-chunk`, or the path given to `-o`. `impact`, `query` and strategy commands print to stdout.

On a first map, `--preset onboarding` appends clusters and suggested questions.

## Before changing a symbol

`xray impact <symbol>` shows transitive callers by area, three levels deep. `--depth 1 --strict` keeps direct, resolved callers only. Globs work: `xray impact 'Auth*'`.

- **EXTRACTED** edges are resolved through imports: trust them. **INFERRED** edges are name matches: read the call site.
- `no matching symbol in the graph`: fall back to `xray map --catch '*Name*' --with incs`.
- One hop in either direction: `xray query "callers(fn)"`, `xray query "calls(fn)"`.

## Many questions, one graph

Build once with `xray map --format json -o graph.json`, then pass `--graph graph.json` to `impact` and `query`.

## Gotchas

- Empty output: wrong `--path`, or the strategy was not detected.
- Stale output: `xray --confirm=yes cache clear`.
- Destructive commands (`cache clear`, `build exec <target>`) refuse to run without a terminal unless given `--confirm=yes`. `build run --target <name>` only prints the command.
- Tools instead of shell: `claude mcp add xray -- xray -C <project> mcp`.
