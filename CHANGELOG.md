# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
