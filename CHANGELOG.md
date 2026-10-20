# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- Bare `-v` before the subcommand (`xray -v map`) swallowed the
  subcommand name and reset verbosity; all `-v` / `--verbose` forms now
  resolve identically.

### Changed

- **BREAKING:** renamed two CLI flags in a single release to resolve a
  naming collision with no backward compatibility:
  - Old `--preset <name>` (config-file option overlay) → new
    `--lens <name>`. Config-file key `presets:` → `lenses:`.
  - Old `--use <spec>` (plugin bundle loader) → new `--preset <spec>`,
    now repeatable. Matches the internal `Preset` type, the
    `BUILTIN_PRESETS` catalog, and the `preset:applied` telemetry
    event. Runtime behaviour unchanged.
  Combined example: `xray map --lens quick --preset insights`.

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
