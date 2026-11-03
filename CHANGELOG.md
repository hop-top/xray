# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Telemetry off regardless of saved consent for non-TTY stdout, machine
  formats (`--format json|yaml|csv|xml`, `--json`/`--csv`/`--xml`), CI,
  `xray mcp`, `XRAY_NO_TELEMETRY` / `DO_NOT_TRACK`; rules in `xray describe`.
- Telemetry also off for commands whose default output is json (`xray
  imports`, `xray describe`) unless `--format text|table|txt` is given: a
  plain interactive `xray imports` no longer records under the scanned root.

- Harness hooks (`hooks/harness/`) only trust a graph the user's own
  `lib/save-graph.sh` wrote. A cloned repo could ship a crafted
  `.xray/graph.json` whose symbol names or paths land in the model's
  context (prompt injection). The impact core now stays silent unless
  the graph is untracked by git (and nothing in `.xray/` is tracked), is
  not a symlink and resolves inside the git work tree, and its sha256
  matches a per-user sidecar written after the save
  (`${XDG_STATE_HOME:-~/.local/state}/xray/hooks/`, mode 700/600);
  same for `$XRAY_GRAPH`. Control characters and ANSI escapes are
  stripped from the impact text.
- `lib/save-graph.sh` no longer writes through symlinks: it refuses when
  `.xray/`, the graph or its lock is a symlink or the target resolves
  outside the work tree, and writes via a `mktemp` file plus atomic
  rename. Shared checks in `lib/graph-trust.sh`. A graph written by plain
  `xray map` is no longer read by the hooks.

### Added

- `xray.imports/v1` coverage: `unsupported[]` per file (Go cgo/plugin/linkname,
  Rust include macros + build scripts, PHP eval/dynamic include/new/calls,
  TS/JS non-literal require/import(), eval, createRequire, Python dynamic
  imports, importlib loaders, exec/eval, sys.path), `parseErrors[]` with
  `status: parse-error`, `complete`, other-language source as
  `unsupported-language`; one file's extractor failure no longer aborts the run.
- `xray.imports/v1` call forms with literal arguments: TS/JS `require()`,
  `import()` (type-position `import()` as `import-type`), Python
  `__import__` and `importlib.import_module` (extractor 0.3.0).
- Imports call-form passes (TS/JS, Python) linear in nesting depth: ancestor
  state carried down the walk, no `.parent` climbs; output unchanged.
- Imports extractor: kind `reference` records for Rust path roots
  (`serde_json::to_string`, `#[derive(::serde::Serialize)]`) and PHP qualified
  names (`\Vendor\Pkg\Thing`), one per root / name per file with `occurrences`.
- Imports contract resolution pass: `locality`, `package`, `resolved` per
  language from the scanned tree (go.mod/go.work, package.json, `__init__.py`,
  Cargo crate layout, literal PHP includes); extractor 0.3.0.
- Imports resolution: Node builtin list vendored (Node 26.13.0); TS/JS
  `stdlib` locality no longer varies with the Node version running xray.
- `xray imports [paths...]`: per-file imports as the `xray.imports/v1`
  JSON document (json default; yaml/table/csv/text); `describe` entry with
  its schema id and path; MCP tool `imports` with `paths` held inside the
  server root.
- Imports extractor (library, no command yet): Go, Rust, PHP static imports
  per `xray.imports/v1` — Go specs (alias/dot/blank, raw strings, `"C"`),
  Rust use trees flattened per leaf + `extern crate` + `mod x;`, PHP `use`
  (grouped, function/const) + literal `require`/`include*`.
- Imports contract schema `xray.imports/v1` (draft): `schemas/xray.imports.v1.json`
  (shipped in the package), `docs/user/imports-contract.md`.
- Imports extractor: static imports for TS/JS (`.mjs/.cjs/.mts/.cts` too) and
  Python per the `xray.imports/v1` contract; `.tsx` now parsed with the tsx
  grammar (`map` no longer loses symbols/imports after JSX).
- Docs: `docs/user/harness-integration.md` (instructions / MCP / hooks;
  event table, hook rules, saved graph, trust model, setup for Claude
  Code, nerv, Gemini CLI, Codex, Cursor and any harness, troubleshooting)
  and `docs/user/use-cases.md` (template + impact analysis with real
  output); cross-linked from README, user and agent indexes, `AGENTS.md`,
  integration protocol ("Pushed Context"), MCP, automation and cookbook.
- `__tests__/docs-links.test.ts`: every relative link in README, AGENTS,
  `docs/`, `skills/` and `hooks/**/README.md` resolves, and `#anchors`
  match GitHub heading slugs. Broken links it found are fixed.
- Harness hook scripts under `hooks/harness/` (in the repo, not the npm
  package): when an agent greps for a function or method name, `xray
  impact` (who calls it) lands in the model's context, from a graph saved
  at session start to `.xray/graph.json` (gitignore it). Core
  `xray-impact-context <symbol>` (POSIX sh, 5 s budget, always exit 0,
  silent on no graph / no match / zero callers, once per symbol per
  session); `lib/extract-symbol.sh` (plain identifiers only; regexes,
  paths and `xray …` commands ignored); `lib/save-graph.sh` (background
  save, git work trees only). Adapters: Claude Code (`SessionStart`,
  `PreToolUse` `additionalContext`), nerv (`SessionStart` +
  `PreToolUse` handlers using the decision `context` field, with
  `test-xray-impact.sh`), Gemini CLI (`SessionStart`, `AfterTool`
  `additionalContext`). Config snippets in each `hooks/harness/<harness>/README.md`;
  CI runs shellcheck on them.
- `xray impact --format brief`: header, one line per group (top 3
  callers, ` (inferred)` kept), `edges:` footer; at most 1200 chars, cut
  at a line end with `…`; prints nothing (exit 0) on no match or zero
  callers. For hook scripts: `xray --quiet impact X --graph g.json
  --format brief`.
- `xray impact <symbol>`: transitive callers of a function or method
  ("what breaks if I change X?"), each at its shortest depth, grouped by
  root label (merged graphs) or top-level directory. `--depth N`
  (default 3), `--strict` (EXTRACTED edges only), `--graph <file>`
  (exclusive with `-p`/`--lens`/`--scope`), `--format
  text|tree|json|yaml|table|csv`. Without `--graph` the graph is built in
  memory (stderr `coverage:` line); no map file is written. Exit 2 on bad
  arguments, 3 when the graph file or a root is missing; no match prints
  `no matching symbol in the graph` and exits 0. Also an `xray mcp` tool.
  See `docs/user/commands.md` and `docs/agent/workflows/impact-analysis.md`.
- Merged multi-root graphs (`map --format json` with several `-p`,
  `impact --lens`) link calls across roots: a call that found no definition
  in its own root resolves against the other roots, `EXTRACTED` through an
  import mapping to that root (Go module path from its `go.mod`, npm
  package name from its `package.json`), else `INFERRED` by same-language
  name. Edges carry `crossRoot: true`; `impact` groups such callers under
  the caller's root.
- Multi-root `impact` (several `-p`, `--lens`) caches per-root and merged
  graphs in `.xray_cache.db` (cwd): a root whose scanned files (path,
  mtime, size), `package.json` and `go.mod`/`go.work` are unchanged is not
  re-analyzed; a changed root alone is rebuilt and re-linked. stderr shows
  `cache: <label> hit|miss` per root.
- `--log-level <level>` (`silent|error|warn|info|debug`, case-insensitive)
  sets an explicit log level; beats `-V`, loses to `--quiet`. Bad value
  exits 2.
- `--format table|json|yaml|csv`, `--cols`, `-o`, `--template`,
  `--format-help` on `query`, `explore`, `paths`, `alias list`,
  `strategy list` and strategy commands. JSON output is byte-identical to
  before.
- `xray paths` reports `config-dir`, `data-dir`, `cache-dir`, `state-dir`
  (text) / `configDir`, `dataDir`, `cacheDir`, `stateDir` (JSON).
- `xray completion powershell` and `--no-descriptions`.
- `xray mcp`: stdio MCP server exposing read-only analysis (`map`,
  `scan`, `graph`, `explore`, `query`, `impact`, `strategy_list`,
  `strategy_detect`, `<strategy>_<noun>`) as tools. Calls are confined
  to the server root (start dir or `-C`); see `docs/user/mcp.md`.
- Help shows an ARGUMENTS section for described arguments; `help <cmd>`
  prints that command's help; root help groups commands into ANALYZE,
  STRATEGY and MANAGEMENT.

- `--lens <name>` CLI flag and `lenses:` config-file key. A lens is a
  named set of CLI option defaults you can recall with one flag —
  "view the same repo through this angle" (e.g. `quick`, `detailed`,
  `api-only`).

- `--format <fmt>` on `map`, `scan`, `graph` (`txt|csv|xml|json`, diagrams
  `mermaid|dot`) and `lang list` (`text|json`), matching the rest of the
  CLI family. `--json`, `--csv`, `--xml`, `--txt`, `--mermaid`, `--dot`
  stay as aliases; `--format` wins, conflicting aliases exit 2.

- `--format json|csv|xml` accept several `--path` roots and write ONE merged
  graph: ids/files prefixed `<root-label>/`, roots listed in
  `metadata.roots`. Single-root output is unchanged. Replaces the exit-2
  usage error for multi-path JSON.
- Real `--format csv` / `--csv` (two files, `<out>.nodes.csv` and
  `<out>.edges.csv`) and `--format xml` / `--xml` (one `<graph>` document)
  renderers for `map`, `scan`, `graph`; node and edge sets equal the JSON
  graph's, sorted deterministically. Shapes: `docs/user/commands.md`.

### Fixed
- `npm run typecheck:tests` failed under pnpm installs (TS2307): four query
  test files imported the undeclared `@jest/globals`; they now use the
  global jest types like every other test.

- Louvain clustering seeded by default (`42`): community ids and bridge /
  low-cohesion questions now identical across runs.
- `--lens` with `--scope` or `--all-scopes` is a usage error (exit 2,
  "--scope and --lens are exclusive"); the lens was silently dropped.
- TS/JS and Rust calls on import-bound names (`import * as path from
  'path'; path.parse()`, `use std::fs; fs::read()`) no longer link INFERRED
  to same-named user methods: stdlib bindings (Node builtins, Rust
  std/core/alloc) record no reference; repo-local ones (`./util`,
  `crate::`) record the imported name and resolve EXTRACTED through
  `imports` edges; package bindings unchanged. Cache schema 6.
- `xray markdown stale` resolves link targets against the linking file
  (bare `x.md`, `./`, `../`; `/x` against the scan root), strips `#anchor`
  and `?query`, skips links inside code, and honours a relative `--path`
  (previously 0 results relative, hundreds of false positives absolute).
- `hooks/pre-commit` and `action.yaml` installed the unrelated npm package
  `xray`; both now install `@xray-codes/xray`, as do the user docs.
- `hooks/pre-commit` used the bash-only `&>` under `#!/bin/sh`: with dash
  as `/bin/sh` an installed xray was reported missing and maps were never
  regenerated. Now POSIX `> /dev/null 2>&1`; shellcheck clean.
- `action.yaml` never committed regenerated maps with the default
  `skip-if-no-changes: 'true'`. Changed maps are now always committed;
  `skip-if-no-changes` only decides, when nothing changed, between a no-op
  (`true`, default) and a failed step (`false`). `docs/user/automation.md`
  inputs table now lists `scope` and `all-scopes`.
- Member and scoped calls on builtin receivers (`JSON.parse`, `Math.max`,
  `console.log`, Python stdlib modules such as `json.loads`, Go standard
  library packages such as `fmt.Println`, `System.out.println`,
  `std::fs::read`, PHP `\DateTime::...`) record no call reference; they
  no longer link `INFERRED` to every user method of the same name. Same
  method names on user receivers still resolve. Per-language sets in
  `src/lib/parser/builtin-receivers.ts`. Cache layout version 4 -> 5
  (cached references are rebuilt).
- Go `pkg.Func` calls resolved inside one root via go.mod/go.work module
  path are now `EXTRACTED`, matching the same resolution across roots
  (were `INFERRED`); `INFERRED` is left for name-only matches.
- Community detection (`insights` / `onboarding` presets) and the
  low-cohesion question ignore INFERRED `calls` edges (global name-match
  fallback, incl. cross-root name matches); communities no longer merge on
  name-match noise and symbols reached only by such edges stay unclustered.
  Edges without a confidence still count.
- `--lens <name>` (`map`, `scan`, `graph`, `impact`) with a name not under
  `lenses` — or with no config file — fails with exit 2 naming the lens,
  the config file consulted and the known lenses, instead of silently
  scanning the default paths and exiting 0.
- `alias set` and startup alias registration reserve every registered command name (incl. `cache`, hidden `clear-cache`, `help`); a conflicting alias already in config is skipped with a warning instead of breaking every run
- `infrastructure resources` accepts `--type`, `--tool` and `--provider`
  filters (declared as options; were rejected as unknown flags).
- `calls` edges resolve a bare name to the closest definition (same file,
  then same directory/package, then an imported file) instead of every
  same-named symbol; `callers(New)` no longer lists one package's callers
  under every `New`. Unscoped matches still link globally, stamped
  `confidence: INFERRED`.
- Map "used by" lines list EXTRACTED callers first; INFERRED callers are
  suffixed ` (inferred)`, capped at 3 per symbol, remainder shown as
  `+N inferred`. Surprise scoring (insights preset) skips INFERRED edges,
  so name-match noise no longer produces ambiguous-edge questions.
- Go `calls` edges follow imports: a member call (`r.Run()`) into a
  module-local package the file imports resolves `EXTRACTED`. A bare name
  only reaches another package through a dot import (`import . "pkg"`).
  Cross-package method candidates must be exported and not declared in a
  `_test.go` file. An unscoped Go member call links nowhere when the file
  imports no module-local package (e.g. `t.Errorf` in a test importing only
  `testing`) or when same-named methods exist in more than one package
  (`AMBIGUOUS`, recorded on `reference:resolve`, no edge).
- Go repos with `go.work` or nested `go.mod` files resolve package
  imports instead of disabling resolution: each file belongs to its nearest
  go.mod, an import maps to the module with the longest matching module
  path, and `go.work` (when present) limits modules to its `use` entries.
- Member calls (`r.run()`, `$r->run()`) only link to methods in the caller's
  language (TS/JS count as one, C/C++ as one); polyglot repos no longer get
  cross-language `calls` edges from same-named methods.

- Read-only commands no longer write `.xrayrc.json` or `.xray/.strategy-cache.json` into the working directory; the strategy cache now lives in the user cache dir and non-interactive runs no longer persist a telemetry decision.
- Argument-parser usage errors (unknown flag, missing argument or value, unknown help topic) print as `✖ <message>`, matching every other usage error; exit code stays 2.
- `map -o <path>` and `--share <path>` create missing parent directories instead of exiting 1.
- `query --format tree` shows `(file:L0)` for matches on line 0 instead of dropping the location.
- Alias dispatch (e.g. `xray rc`) runs the target command's full pipeline (detect, analyze, handler, output); it previously printed "(none found)".
- `--no-chunk` and other CLI options are honoured when no config file exists.
- Pre-commit `strategy:detect` script runs `xray strategy detect` instead of falling through to `explore`.
- Telemetry consent is asked once per user, not once per project: the
  decision is stored in the global user config (`telemetry.enabled` in
  `<config-dir>/config.json`, see `xray paths`) and never written to the
  cwd, `.xrayrc.json` or `--config`. A project or `--config` `telemetry`
  setting still wins. Non-interactive runs stay disabled and persist
  nothing, so a later interactive run still asks. Delete the global config
  to be asked again. Existing per-project decisions keep applying in that
  project but are not migrated.
- Alias names that are empty or whitespace-only are now rejected.
- Colour honours `--no-color` > `NO_COLOR` > `FORCE_COLOR` > TTY; the
  progress bar is suppressed under `--quiet` and when stderr is not a TTY.

- Go calls written `pkg.Func()` now resolve to `calls` edges when `pkg` is an
  import (alias honoured) of a package inside the module declared by
  `go.mod`; the target is the exported function in that package's
  directory. Edges are `INFERRED`. External packages, blank imports and
  method calls on values (`x.Method()`) stay unresolved. `go.work` and
  nested `go.mod` layouts are not supported: resolution is disabled for
  them. Import-alias captured on `Import.alias`.
- A warm `.xray_cache.db` no longer drops file-level `imports` edges: the
  parse cache now persists imports (cache entries from older versions are
  reparsed once). Warm and cold runs produce identical graphs.

- `xray query` printed nothing; results now go to stdout per `--format`
  (`table` default, `tree`, `json`). A missing graph file exits 3; a bad
  query or missing `--graph` exits 2.
- `--csv` / `--xml` emitted the normal text output; they now write real
  CSV / XML.
- `docs/user/query-guide.md` referenced a nonexistent `map --save-graph`;
  it now documents `xray map --format json -o graph` then
  `xray query --graph graph.json`.
- `xray map --json` (chunked and `--no-chunk`) wrote text into `.json`
  files; it now writes one valid JSON graph document.
- Root `--config` now applies to map/scan/graph/lang instead of being
  overridden by config discovery from `--path`; aliases, telemetry
  consent, `alias list|set|remove` and `paths` read (and `alias set` /
  consent write) that file too. A relative value resolves against `-C`.
- Retry backoff skipped the wait before the first retry (delays ran
  0, base, 2×base instead of base, 2×base, 4×base); retries now back off
  from the first one.

### Changed

- Relative `paths` / `lenses.<name>.paths` / `scopes.<name>.paths` in a
  config file resolve against that file's directory, not the cwd; absolute
  paths and CLI `--path` unchanged.
- `xray impact` on several roots groups callers by root then top-level
  directory (`alpha/internal`, `beta/pkg`) instead of by root alone; json
  `groups[].name` uses the same flat key. Single-root output unchanged.
- **Behaviour change**: `xray query --format table|tree` and `xray impact
  --format table` print 1-based editor lines (graph line + 1), matching
  `impact` text and `map`; `json`, `yaml`, `csv` keep the raw 0-based
  graph value.
- `--offline` now also skips the upgrade check on every command.
- **BREAKING:** Node.js >= 22.12 required (`engines.node`); the CLI is
  built on `@hop-top/kit` and commander 15 (ESM-only). Upgrade Node
  before upgrading xray.
- **BREAKING:** `-v` now prints the version instead of raising
  verbosity. Verbosity is `-V` / `--verbose` (stackable, takes no value;
  any count = debug). `--verbose=debug` now exits 2; `-v debug` prints
  the version.
  Migrate: `xray -v map` -> `xray -V map`; `--verbose debug` ->
  `--log-level debug`.
- **BREAKING:** `--version` / `-v` prints `xray vX.Y.Z` (was `X.Y.Z`).
  Scripts parsing the version must strip the `xray v` prefix.
- **BREAKING:** shell completion is dynamic: generated scripts call back
  into `xray __complete` on each tab, so strategy commands, aliases and
  flag values stay current without regenerating. Bash needs
  bash-completion v2. Migrate: regenerate every saved completion script
  once (e.g. `xray completion fish > ~/.config/fish/completions/xray.fish`;
  re-source the `eval "$(xray completion bash|zsh)"` line).
- **BREAKING:** help layout follows the kit contract: `FLAGS` instead of
  `Options:`, grouped command sections, `[--flags]` / `[command]` terms.
  `help <unknown>` and `completion <unknown-shell>` exit 2 (usage error).
  Usage errors append the command's help on stderr; exit codes unchanged.
- `query --format table` renders a kit table (name/kind/file/line,
  `--cols` selectable); the `Results (N)` banner and query-time line are
  gone. Use `--format json` for machine parsing.
- Global config dir resolves via the platform default when
  `XDG_CONFIG_HOME` is unset (`~/Library/Preferences/xray` on macOS,
  `%APPDATA%\xray` on Windows); the legacy `~/.config/xray` is still read
  as a fallback. Project `.xrayrc` discovery and layering are unchanged.
- SQLite cache (`.xray_cache.db`) is stored in a new schema; caches from
  older versions are dropped and rebuilt on the next run.
- Aliases are visible commands with their own `--help`
  (`Alias for: <target>`); output unchanged.
- Logging and terminal styling run on `@hop-top/kit` (log, tui);
  output text and stdout/stderr routing unchanged.
- Unescaped negative numbers (e.g. `-1`) are parsed as arguments rather
  than rejected as unknown options.

- **BREAKING:** renamed two CLI flags in a single release to resolve a
  naming collision with no backward compatibility:
  - Old `--preset <name>` (config-file option overlay) → new
    `--lens <name>`. Config-file key `presets:` → `lenses:`.
  - Old `--use <spec>` (plugin bundle loader) → new `--preset <spec>`,
    now repeatable. Matches the internal `Preset` type, the
    `BUILTIN_PRESETS` catalog, and the `preset:applied` telemetry
    event. Runtime behaviour unchanged.
  Combined example: `xray map --lens quick --preset insights`.

### Removed

- Dependencies `chalk`, `cli-progress`, `better-sqlite3` (now provided
  through `@hop-top/kit`), unused `@opentelemetry/*` packages, and
  `@types/better-sqlite3`, `@types/cli-progress`, `@types/glob`.

### Security

- Tab completion never executes project-local code: strategies from the
  current directory (`.xray/strategies`, `node_modules`) and JS project
  config (`.xrayrc.js`, `xray.config.js`) are not loaded during
  completion. Data configs (`.xrayrc`, `.xrayrc.json`, `package.json`)
  are still read.

## [0.1.0] - 2025-02-13

### Added

- Intelligent PageRank-based code ranking for surfacing the most important files and functions
- AI-optimized, token-efficient output designed for LLM context windows
- Multi-language support for 19+ languages via tree-sitter (Bash, C, C#, C++, Dart, Elixir, Go, Haskell, Java, JavaScript, Kotlin, Lua, Perl, PHP, Python, Ruby, Rust, Scala, Swift, TypeScript)
- AST, CFG, and DFG visualization modes
- Chunked output for large codebases with navigable chunks
- Smart SQLite caching for fast subsequent runs
- Cross-file dependency tracking (imports, exports, relationships)
- Framework-aware strategies: React, Express, Next.js, Go CLI, REST API, Markdown, Build, CI/CD, Config, Container, Infrastructure, Package Manager
- Plugin system with event-driven architecture
- Built-in plugins: ProgressLogger, FilterPrivate, SkipTests, MetricsCollector, Sanitizer
- CLI commands: `map`, `explore`, `query`, `strategy`, `clear-cache`, `completion`
- Command aliasing system
- Shell completion for Bash, Zsh, and Fish
- GitHub Actions integration
- OpenTelemetry-based telemetry with first-run consent
- Configuration via `.xrayrc` (JSON/TOML) or `xray` key in `package.json`

[0.1.0]: https://github.com/xray-codes/xray/releases/tag/v0.1.0
