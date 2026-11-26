# Changelog

## [0.1.0-rc.1](https://github.com/hop-top/xray/compare/xray/v0.1.0-rc.0...xray/v0.1.0-rc.1) (2026-11-26)


### ⚠ BREAKING CHANGES

* **cli:** Removed `graph`, `mcp`, `clear-cache`, `paths`, `describe`, `lang`, `skills`, boolean format flags, `--log-level`, `--skip-detect`, `--catch`, `--list-strategies`, and `remove`/`info` aliases in favor of the consolidated CLI surface.

### Features

* **agent:** add BYOK codebase Q&A and diff-grounded PR review commands ([15d4071](https://github.com/hop-top/xray/commit/15d40710ad56cdcb61764560880c7bd57af56d82))
* **cli:** default generated outputs under .xray/{maps,graphs,handbook,skills,strategies} ([c41d1fe](https://github.com/hop-top/xray/commit/c41d1fec4420de2602b47a29888138179dafb658))
* **cross-root:** resolve TypeScript tsconfig, Rust Cargo, and Python package edges ([1c0b9b4](https://github.com/hop-top/xray/commit/1c0b9b47ebc890d50ab77b92ea35858e01325bf0))
* **diagram:** add deterministic Mermaid architecture, call, CFG, and DFG exporter ([fa6f402](https://github.com/hop-top/xray/commit/fa6f40271aaa1fb70516a440facbb8f81dc69c09))
* **git:** add shared read-only git reader for diff, commits, blame, branches, and churn ([7cc109b](https://github.com/hop-top/xray/commit/7cc109b079660efd588102d3d77f716e720ef75a))
* **go-cli:** propagate flags from helper functions taking *cobra.Command ([5496db0](https://github.com/hop-top/xray/commit/5496db0cce2f3c3088a712af2677804615f3779b))
* **graph:** capture and render exact call-site line numbers on calls edges ([56d87d9](https://github.com/hop-top/xray/commit/56d87d916566c16f068e34c8b337d57ee7024d22))
* **handbook:** add deterministic structural handbook generator and search indexing ([9fc3210](https://github.com/hop-top/xray/commit/9fc3210b517abbf785320e2675d6a4f50cb71195))
* **handbook:** add optional BYOK 3-stage LLM enrichment and delta refresh ([81041c8](https://github.com/hop-top/xray/commit/81041c8bd3019682d576dd702446124108a5bd9d))
* **impact:** add diff-scoped impact/map and git-churn hotspot weighting ([391edb9](https://github.com/hop-top/xray/commit/391edb9a38f16e5a5b65018e2982a2a93de0b645))
* **markdown:** replace mdq requirement and add symbol/SHA staleness checks ([79e6788](https://github.com/hop-top/xray/commit/79e678856d1fe8d9f5a087c4c71c463097b7a269))
* **mcp:** add primitive read/git tools, Streamable HTTP transport, and scoped tokens ([511df07](https://github.com/hop-top/xray/commit/511df07c93ed5d47467b831b6992336e4f966b9b))
* **mcp:** run built-in analysis tools in-process via warm workspace manager ([d7f677d](https://github.com/hop-top/xray/commit/d7f677dfe0d4e5afe8934b7374e72ebaef089550))
* **multi-root:** add named contexts, merged chunked maps, and global PageRank ([9721901](https://github.com/hop-top/xray/commit/972190140103fd2de2ced67fc86c161c79e149ee))
* **parser:** add Linguist language map and Universal Ctags fallback extractor ([2b9e1a6](https://github.com/hop-top/xray/commit/2b9e1a6181247e951949a027b212519ba3a0a01c))
* **query:** add boolean filter DSL and implementations/cycles/deadcode queries ([7a79937](https://github.com/hop-top/xray/commit/7a79937eb4337a566cd51edf6f232341036ec8c2))
* **search:** add SQLite FTS5 trigram index and regex/windowed explore search ([2a67755](https://github.com/hop-top/xray/commit/2a677551a53d18ddd647943af921dcc7771cb60b))
* **serve:** add local Web UI and read-only REST API server ([ddc8612](https://github.com/hop-top/xray/commit/ddc8612aa2f838fba9dbb1258b2b59288f1abaa0))
* **serve:** add optional MCP gateway proxy, portal deep links, and JSONL audit log ([a09ac95](https://github.com/hop-top/xray/commit/a09ac956af3f377bd2329069fa3aac3484005e13))
* **skills:** add workspace skill discovery, CLI, and MCP exposure ([5e09d6a](https://github.com/hop-top/xray/commit/5e09d6a994eb5499e998df6ed35b99c495b7b9be))
* **tui:** add interactive terminal codebase explorer ([a16477c](https://github.com/hop-top/xray/commit/a16477c38d2a1019f7f6594cfe7811df74333c14))
* **watch:** add live incremental background indexer ([585858b](https://github.com/hop-top/xray/commit/585858bd88daa81ed39cfe9fa17cbf0aec6f3a18))


### Bug Fixes

* **diagram:** distinguish no-match from no-flow-data in cfg/dfg views ([d367148](https://github.com/hop-top/xray/commit/d36714872f1ef36367d159eb6b34c7e119a03746))
* **handbook:** return graph from analyzeHandbook for mermaid embedding ([3bb3aa4](https://github.com/hop-top/xray/commit/3bb3aa4a0043b9b1e4dc64b33ca2c1b9453beeef))
* **hooks:** pass --offline to xray in harness hooks to avoid upgrade-check network/cache writes ([7164783](https://github.com/hop-top/xray/commit/71647834ef2466dffe5b0e195f4069b74573ebc7))
* **markdown,go-cli:** resolve relative/table orphan links and loop/kit AST registrations ([146980d](https://github.com/hop-top/xray/commit/146980ddab7a7d2d6e34852e32fb483854e2e919))
* **mcp:** align in-process arg error phrasing and mcp help snapshot ([6f27e45](https://github.com/hop-top/xray/commit/6f27e45237b29b96ce195f70118d4d9e30d040fc))
* **test:** fix test types, docs command forms, and CLI golden snapshots on next ([e913260](https://github.com/hop-top/xray/commit/e91326066e003cfbbbdc279940c30f07dc0ba284))
* **test:** give registerCommands beforeAll hooks 30s timeout ([fe8be80](https://github.com/hop-top/xray/commit/fe8be804ad696529fd56d34a7ed41dcf8c99cc9a))
* **test:** run strategy-execution and micro-timing suites solo to prevent CI contention ([4f58ebc](https://github.com/hop-top/xray/commit/4f58ebc9a44703e66bb1036bdd78435fd9b355a1))
* **test:** set async sweep timeout and isolate timing-sensitive suites in parallel runner ([7c81a3d](https://github.com/hop-top/xray/commit/7c81a3db0891af957e6725d487d09b0c67b3fe20))
* **watch:** register SIGINT/SIGTERM handlers before watcher.start() to avoid shutdown race ([def5cd3](https://github.com/hop-top/xray/commit/def5cd32b351b983ca5322f22f66f13d4f5a5997))


### Performance

* **cache:** enable single-root GraphCache and incremental per-file patching ([8099347](https://github.com/hop-top/xray/commit/809934781be6383ebfa8cf73a5b900010fb8ae94))
* **parser:** pool parsers by grammar, add hostile-file/output guardrails, sub-chunk communities ([dd180a1](https://github.com/hop-top/xray/commit/dd180a1fd1e443b435e51a0131afdbe0396e1bfd))
* **test:** parallelize isolated test runner, shard CI matrix, skip upgrade checks in CLI E2E ([8468ccb](https://github.com/hop-top/xray/commit/8468ccb01165a72b46353ebdfe46e0ba4eb03000))


### Refactoring

* **cli:** streamline CLI surface, collapse overlaps, align conventions ([af4ee0c](https://github.com/hop-top/xray/commit/af4ee0cde1291c7d77005eff5d540dd63a7b3c9f))

## 0.1.0-rc.0 (2026-11-11)


### Features

* xray 0.1.0-rc.0 ([91184df](https://github.com/hop-top/xray/commit/91184dfbe5f6e5e4da1c1f03766826c29a9cba5f))


### Bug Fixes

* **cli:** map and graph print to stdout with -o - ([2d3fcc2](https://github.com/hop-top/xray/commit/2d3fcc29a2876c1f1b5584c4710d9974662fb295))
* **test:** signal whole process group in precommit-hook hang tests ([99975b0](https://github.com/hop-top/xray/commit/99975b095265bbeae6a1aa9d08fd8a708861efdb))
