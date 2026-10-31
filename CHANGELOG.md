# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
  `scan`, `graph`, `explore`, `query`, `strategy_list`,
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
