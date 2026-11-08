# xray Architecture

Technical overview of xray's design and implementation.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Interface                         │
│                      (Commander.js)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│    Map     │  │   Graph    │  │  Explore   │
│  Command   │  │  Command   │  │  Command   │
└─────┬──────┘  └─────┬──────┘  └─────┬──────┘
      │               │               │
      │               │               │
      ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Core Analysis Engine                    │
├─────────────────────────────────────────────────────────────┤
│  • File Scanner (glob + ignore patterns)                    │
│  • AST Parser (tree-sitter multi-language)                  │
│  • Graph Builder (graphology)                               │
│  • PageRank Algorithm (importance scoring)                  │
│  • Strategy System (framework detection & analysis)         │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│   SQLite   │  │  Tree      │  │  Output    │
│   Cache    │  │  Renderer  │  │  Formatters│
└────────────┘  └────────────┘  └────────────┘
```

## Core Components

### 1. CLI Interface (`src/index.ts` and `src/commands/`)

Modern command-based architecture using Commander.js. Commands are organized in separate modules:
- Command routing and registration
- Option parsing and validation
- Configuration loading and merging
- Output coordination

**Key Files:**
- `src/index.ts` - Lightweight CLI bootstrap
- `src/commands/index.ts` - Command registration
- `src/commands/common.ts` - Shared CLI utilities and common options
- `src/commands/generate.ts` - Map, graph commands
- `src/commands/explore.ts` - Strategy-based exploration
- `src/commands/strategy.ts` - Strategy system commands
- `src/commands/strategy-cmd.ts` - Strategy command runner
- `src/commands/clear-cache.ts` - Cache management
- `src/commands/completion.ts` - Shell completion

### 2. File Scanner

Discovers and filters files based on patterns and ignore rules.

**Features:**
- Glob pattern matching
- `.gitignore` integration via `ignore` package
- File type detection
- Exclusion patterns (node_modules, .git, etc.)

**Key Files:**
- `src/lib/scanner.ts` - File scanning implementation
- Pattern matching logic
- Ignore rule processing

### 3. AST Parser (`src/lib/parser/`)

Parses source files into Abstract Syntax Trees using tree-sitter.

**Features:**
- Multi-language support (19+ languages)
- Custom query definitions (`.scm` files)
- Incremental parsing
- Error recovery

**Key Files:**
- `src/lib/parser/language-registry.ts` - Language configuration
- `src/lib/parser/queries/` - Tree-sitter query files (.scm)
- Parser initialization and execution

**Supported Elements:**
- Functions/methods
- Classes/structs
- Variables/constants
- Imports/exports
- Comments/docstrings

### 4. Graph Builder

Constructs dependency and call graphs using graphology.

**Graph Types:**
- **Dependency Graph**: File-level imports and exports
- **Call Graph**: Function invocation relationships
- **Control Flow Graph (CFG)**: Statement-level control flow
- **Data Flow Graph (DFG)**: Variable definitions and data dependencies

**Algorithm:**
1. Parse all files into ASTs
2. Extract symbols (functions, classes, variables)
3. Build edges (calls, imports, data flow)
4. Apply PageRank for importance scoring
5. Generate compact representation

### 5. PageRank Algorithm

Scores code elements by importance using PageRank + heuristics.

**Scoring Factors:**
- **InDegree**: How many files import/call this element
- **OutDegree**: How many dependencies this element has
- **Centrality**: Position in the dependency graph
- **Anchor Proximity**: Distance from focus file (if specified)

**Personalized PageRank:**
When `--anchor` is specified, the algorithm biases scores toward elements related to the anchor file.

### 6. Strategy System (`src/lib/strategy/`)

Framework-specific analysis and exploration capabilities.

**Architecture:**
```
┌─────────────────────────────────────────┐
│         Strategy Registry               │
│  (Auto-loads from strategies/ dir)      │
└──────────────┬──────────────────────────┘
               │
       ┌───────┼───────┐
       │       │       │
       ▼       ▼       ▼
   [React] [Express] [Go-CLI] ...
```

**Components:**
- `src/lib/strategy/types.ts` - Strategy interface definitions
- `src/lib/strategy/registry.ts` - Strategy registration and lookup
- `src/lib/strategy/loader.ts` - Loading from built-in, user and project strategy locations
- `src/lib/strategy/detector.ts` - Project type detection
- `src/lib/strategy/runner.ts` - Strategy execution
- `src/lib/strategy/context.ts` - Context API for strategies

**Strategy Lifecycle:**
1. **Detection**: Check if strategy applies to project
2. **Analysis**: Scan files and extract metadata
3. **Tagging**: Mark files with strategy-specific tags
4. **Command Execution**: Run strategy commands using cached metadata

### 7. Cache System (`src/lib/cache/`)

SQLite-based caching for parsed ASTs and analysis results.

**Features:**
- File modification time tracking
- Automatic invalidation on changes
- Strategy detection caching
- AST parse result caching

**Key Files:**
- `src/lib/cache/sqlite-cache.ts` - Cache implementation

**Cache Location:**
- `<cache-dir>/projects/<project-key>/xray_cache.db` in the user cache dir (SQLite database; key from `src/lib/storage.ts`, never in the project)

**Cache Keys:**
- File path + modification time
- Strategy detection results
- Parsed AST structures

### 8. Output Formatters and Rendering

Renders analysis results in various formats with support for both single-file and chunked output.

**Components:**
- `src/lib/renderer/map-renderer.ts` - Single-file tree-structured output
- `src/lib/renderer/chunked-renderer.ts` - Multi-file chunked output (default)

**Output Formats:**
- **Text**: Tree-structured output (default)
- **JSON**: Raw graph data
- **CSV**: Tabular data
- **XML**: Structured markup

**Chunked Renderer Features:**
- Automatic directory-based chunking
- Parent-child navigation links
- Token limit enforcement per chunk
- Depth-based filtering
- Single-file fallback (--no-chunk flag)

**Key Features:**
- Token limit enforcement (per chunk or global)
- Depth limiting
- Cross-reference generation
- External dependency tables
- Relative path navigation for chunk linking

## Data Flow

### Map Command Flow

```
1. CLI Parsing
   ├─ Load configuration (.xrayrc.json)
   ├─ Parse command-line options
   └─ Merge config with CLI options

2. Strategy Auto-Configuration (unless --skip-detect)
   ├─ Detect applicable strategies
   ├─ Apply strategy-specific file patterns
   └─ Configure match/catch patterns

3. File Discovery
   ├─ Glob pattern matching (--path)
   ├─ Apply ignore patterns
   ├─ Filter by file patterns (--match)
   └─ Generate file list

4. AST Parsing
   ├─ For each file:
   │  ├─ Check cache (file path + mtime)
   │  ├─ If cached: retrieve AST
   │  └─ If not: parse with tree-sitter
   └─ Store results in cache

5. Graph Construction
   ├─ Extract symbols from ASTs
   ├─ Build dependency edges (imports)
   ├─ Build call edges (function calls)
   ├─ Apply PageRank scoring
   └─ Filter by depth and patterns (--catch)

6. Output Generation
   ├─ If --no-chunk: Single-file output
   │  ├─ Apply token limit (--limit)
   │  ├─ Sort by importance (PageRank)
   │  ├─ Render tree structure
   │  ├─ Add cross-references (--with incs)
   │  └─ Write to output file (--output)
   │
   └─ If chunked (default): Multi-file output
      ├─ Organize files by directory
      ├─ For each directory chunk:
      │  ├─ Apply token limit per chunk
      │  ├─ Sort files by importance
      │  ├─ Render tree structure
      │  ├─ Add parent-child navigation
      │  └─ Write to chunk file
      └─ Display summary with chunk tree
```

### Strategy Command Flow

```
1. Strategy Detection
   ├─ Check cache for detection results
   ├─ If not cached:
   │  ├─ Load all strategies from strategies/
   │  ├─ Run detect() on each strategy
   │  └─ Cache results
   └─ Return applicable strategies

2. File Analysis
   ├─ For each file matching strategy fileTypes():
   │  ├─ Check cache for analysis results
   │  ├─ If not cached:
   │  │  ├─ Run strategy.analyze(file)
   │  │  ├─ Extract tags and metadata
   │  │  └─ Cache results
   │  └─ Store tags and metadata in context

3. Command Execution
   ├─ Look up command in strategy.commands
   ├─ Populate StrategyContext with:
   │  ├─ Tagged files
   │  ├─ Metadata for each file
   │  └─ Project info
   ├─ Execute command handler
   └─ Format and display results
```

## Strategy System Design

### Strategy Interface

```typescript
interface Strategy {
  name: string;
  version: string;
  detect(ctx: StrategyContext): boolean | Promise<boolean>;
  analyze(file: string, ctx: StrategyContext): Promise<FileMetadata>;
  fileTypes?(): string[];
  ignorePatterns?(): string[];
  commands?: Record<string, StrategyCommand>;
}
```

### Strategy Context API

Provides utilities for strategy implementation:

```typescript
interface StrategyContext {
  // Dependency checks
  hasDependency(name: string): boolean;
  hasDevDependency(name: string): boolean;

  // File operations
  hasFiles(pattern: string): boolean;
  readFile(file: string): Promise<string>;
  findFiles(query: FileQuery): Promise<string[]>;

  // AST parsing
  parseAST(file: string): Promise<any>;

  // Tag and metadata
  hasTag(file: string, tag: string): boolean;
  getTags(file: string): string[];
  getMetadata(file: string, strategy: string): any;

  // Caching
  getCached(key: string): any;
  setCached(key: string, value: any): void;
}
```

### Auto-Loading Mechanism

1. On startup, `StrategyLoader` scans `strategies/` directory
2. Imports each `.ts` or `.js` file's default export
3. Validates export implements `Strategy` interface
4. Registers in `StrategyRegistry`

## Performance Optimizations

### 1. Incremental Parsing

Tree-sitter supports incremental parsing, but currently not utilized. Future enhancement.

### 2. Caching Strategy

**Three-tier caching:**
1. **File-level**: AST cache per file (keyed by path + mtime)
2. **Strategy-level**: Detection results cache
3. **Analysis-level**: Strategy analysis results per file

**Cache Invalidation:**
- File modification time changes → invalidate file AST
- package.json/go.mod changes → invalidate strategy detection
- Strategy version changes → invalidate analysis results

### 3. Parallel Processing

File processing is currently sequential. Future enhancement opportunity:
- Parallel file scanning
- Concurrent AST parsing
- Parallel strategy analysis

### 4. Token Limit Optimization

- Early termination when token limit reached
- Prioritization by PageRank score
- Selective inclusion of features (vars, incs, docs)

## Configuration System

### Configuration Loading Precedence

1. CLI flags (highest priority)
2. Custom config file (--config)
3. Project config files (.xrayrc.json, etc.)
4. Default values (lowest priority)

### Configuration Merging

Deep merge strategy:
- Objects: merged recursively
- Arrays: overridden completely
- Primitives: overridden

### Scopes vs Presets

**Scopes:**
- Multiple independent configurations
- Run all with `--all-scopes`
- Each produces separate output
- Best for automation

**Lenses:**
- Named config-file option overlays
- Apply one at a time with `--lens <name>`
- Override base configuration
- Best for manual CLI use

## Extension Points

### 1. Adding New Languages

1. Add tree-sitter parser dependency: `npm install tree-sitter-<language>`
2. Update `src/lib/parser/language-registry.ts`
3. Create query file: `src/lib/parser/queries/<language>.scm`
4. Test with sample files

### 2. Creating Custom Strategies

1. Create TypeScript file in `strategies/` directory
2. Implement `Strategy` interface
3. Export as default export
4. Strategy is auto-loaded on next run

### 3. Custom Output Formats

1. Create formatter in output formatters
2. Add format option to CLI
3. Wire up in output generation

## Testing Architecture

### Unit Tests

- Individual components (parser, scanner, graph builder)
- Mocked dependencies
- Fast execution

### Integration Tests

- Strategy system end-to-end
- File fixtures in `tests/strategy/fixtures/`
- Real AST parsing

### Test Coverage Goals

- Core analysis: >80%
- Strategy system: >75%
- CLI commands: >70%

## Future Enhancements

### Planned Improvements

1. **Incremental Parsing**: Utilize tree-sitter's incremental parsing
2. **Parallel Processing**: Concurrent file parsing
3. **Web UI**: Interactive codebase explorer
4. **Language Server**: IDE integration via LSP
5. **Plugin System**: External strategy loading
6. **Cloud Caching**: Shared cache across team
7. **Semantic Analysis**: Type inference and flow analysis

### Architecture Evolution

Current: Internal Strategy (tree-sitter)
Future: Hybrid Strategy (tree-sitter + external tools)

```
┌──────────────────────────────────┐
│     External Strategy Layer      │
│  (Python AST, Go Guru, etc.)     │
└────────────────┬─────────────────┘
                 │
                 ▼
┌──────────────────────────────────┐
│     Internal Strategy Layer      │
│     (tree-sitter parsing)        │
└──────────────────────────────────┘
```

## See Also

- [Strategy Development Guide](strategy-development.md) - Creating custom strategies
- [Contributing Guide](contributing.md) - Development workflow
- [Strategy API Reference](strategy-api.md) - Strategy command system
