# Command Structure and Architecture

Technical documentation of xray's command system architecture and implementation.

## Overview

xray uses a modular command architecture built on Commander.js. Commands are organized in `src/commands/` with shared utilities and a central registration system.

## Command Organization

```
src/commands/
├── index.ts              # Command registration and setup
├── common.ts            # Shared utilities and common options
├── generate.ts          # map, scan, graph, generate commands
├── explore.ts           # explore command with strategy support
├── strategy.ts          # strategy * commands and routing
├── strategy-cmd.ts      # Strategy command execution engine
├── clear-cache.ts       # cache management
└── completion.ts        # shell completion
```

## Core Commands

### 1. Map Command (`generate.ts`)

Generates intelligent code maps with multiple output options.

**Command Definition:**
```
xray map [options]
```

**Implementation:**
- File: `src/commands/generate.ts`
- Handler: `runSingleXray()` and chunked/single-file routing logic
- Supports scopes and lenses from config files

**Key Features:**
- **Chunked Output** (default): Splits into multiple files by directory
- **Single-File Output**: Use `--no-chunk` for single output
- **Token Limits**: Per-chunk limits (default: 4096 tokens)
- **Features**: vars, incs, docs, cost, cf, df
- **Filtering**: depth, match patterns, catch patterns
- **Focus**: anchor files with Personalized PageRank

**Data Flow:**
1. `runSingleXray()` processes options
2. Strategy auto-configuration (if enabled)
3. `Xray.run()` builds analysis
4. `ChunkedRenderer` or `MapRenderer` generates output
5. Files written to disk with navigation links (if chunked)

**Configuration Options:**
```typescript
interface MapCommandOptions {
  path?: string[];              // Paths to analyze
  output?: string;              // Output file base path
  limit?: number;               // Token limit per chunk
  with?: string[];              // Features to include
  anchor?: string;              // Focus file
  depth?: number;               // Directory depth
  match?: string[];             // File patterns
  catch?: string[];             // Function patterns
  query?: string[];             // Custom queries
  noChunk?: boolean;            // Disable chunking
  autoConfiguration?: boolean;  // Auto-detect strategies
  config?: string;              // Config file path
  lens?: string;                // Named lens (config-file overlay)
  scope?: string;               // Config scope
  allScopes?: boolean;          // Run all scopes
}
```

### 2. Explore Command (`explore.ts` and `strategy-cmd.ts`)

Framework-specific code exploration using strategies.

**Command Definition:**
```
xray explore [strategy:]<command> [options]
xray [strategy:]<command> [options]  # Shorthand
```

**Implementation:**
- File: `src/commands/explore.ts` (routing)
- File: `src/commands/strategy-cmd.ts` (execution)
- Supports all strategy-defined commands

**Key Features:**
- Strategy detection
- Command routing
- File filtering and analysis
- Metadata extraction
- Framework-specific output formatting

**Available Strategies:**
- `react` - React components, hooks, contexts
- `express` - Routes, middleware, handlers
- `rest-api` - REST endpoints (cross-framework)
- `go-cli` - CLI commands and flags

**Example Commands:**
```bash
xray react components     # List React components
xray express routes              # List Express routes (shorthand)
xray rest-api endpoints          # List REST endpoints
```

**Command Execution Flow:**
1. Parse `<strategy> <command>` syntax
2. Load and detect applicable strategies
3. Analyze files matching strategy patterns
4. Execute strategy command handler
5. Format and display results

### 3. Scan Command (`generate.ts`)

Discovers and lists files matching patterns.

**Command Definition:**
```
xray scan [options]
```

**Features:**
- Glob pattern matching
- File type filtering
- Path filtering
- Displays total count and file list

**Implementation:**
```bash
xray scan --path ./src --match "*.ts" --match "!*.test.ts"
```

### 4. Graph Command (`generate.ts`)

Generates control flow and data flow graphs.

**Command Definition:**
```
xray graph [options]
```

**Features:**
- Control Flow Graph (CFG)
- Data Flow Graph (DFG)
- Multiple output formats (mermaid, dot, txt)

**Supported Languages:**
C, C++, C#, Go, Java, Rust, Swift

### 5. Strategy Commands (`strategy.ts`)

Framework detection and exploration.

**Command Definition:**
```
xray strategy detect    # Detect applicable strategies
xray strategy list      # List all available strategies
xray strategy info      # Show strategy information
```

**Implementation:**
- File: `src/commands/strategy.ts`
- Uses `StrategyDetector` and `StrategyLoader`
- Displays detection results and metadata

### 6. Clear Cache Command (`clear-cache.ts`)

Cache management utilities.

**Command Definition:**
```
xray clear-cache    # Clear the AST cache
```

**Cache Details:**
- Location: `.xray_cache.db` (SQLite)
- Stores: AST trees, strategy detection results
- Auto-invalidated on file changes
- Manual clear available for troubleshooting

### 7. Completion Command (`completion.ts`)

Shell completion for bash, zsh, fish and powershell via kit's dynamic
completion: generated scripts call back into the hidden `xray __complete`
command on each tab. The completion path never executes project-local code:
cwd strategy dirs and JS project config (`.xrayrc.js`, `xray.config.js`) are
skipped; data configs (`.xrayrc`, `.xrayrc.json`, `package.json`) are still read.

**Command Definition:**
```
xray completion bash         # bash (needs bash-completion v2)
xray completion zsh          # zsh
xray completion fish         # fish
xray completion powershell   # PowerShell
```

## Common Options

All commands share a set of common options defined in `src/commands/common.ts`:

```typescript
addCommonOptions(cmd: Command) {
  // Paths and output
  -p, --path <path>          // Root directory (repeatable)
  -o, --output <path>        // Output file path

  // Token and depth control
  -l, --limit <number>       // Token limit per chunk (default: 4096)
  -d, --depth <number>       // Directory depth

  // Features
  -w, --with <feature>       // Include feature (repeatable)
                             // Options: vars, incs, cost, docs, df, cf

  // Filtering
  -a, --anchor <path>        // Focus file (Personalized PageRank)
  -m, --match <pattern>      // File pattern (repeatable, ! to negate)
  -c, --catch <pattern>      // Function pattern (repeatable)
  -q, --query <item>         // Custom query (repeatable)

  // Output formats
  --txt                      // Text format (default)
  --csv                      // CSV format
  --xml                      // XML format
  --json                     // Raw JSON
  --mermaid                  // Mermaid diagram
  --dot                      // Graphviz format

  // Chunking
  --no-chunk                 // Disable chunked output

  // Configuration
  --config <path>            // Config file path
  --lens <name>              // Named lens (config-file overlay)
  --scope <name>             // Config scope
  --all-scopes               // Run all scopes
  --auto-configure           // Auto-detect strategies (default: true)
  --no-auto-configure        // Disable auto-configuration
}
```

## Command Registration

**File:** `src/commands/index.ts`

Commands are registered with the main program:

```typescript
export const registerCommands = (program: Command) => {
  // Generate commands (map, scan, graph)
  registerGenerateCommands(program);

  // Explore and strategy commands
  registerExploreCommand(program);
  registerStrategyCommands(program);

  // Utility commands
  registerClearCacheCommand(program);
  registerCompletionCommand(program);
};
```

## Configuration Merging

**File:** `src/lib/config.ts`

Configuration sources are merged in priority order:

1. **CLI flags** (highest priority)
2. **Custom config file** (--config)
3. **Project config files** (.xrayrc.json, .xrayrc.js, etc.)
4. **Default values** (lowest priority)

**Merging Strategy:**
```typescript
// CLI overrides config file for all options
mergedConfig = {
  ...configFile,
  ...cliOptions  // CLI takes precedence
}

// For scopes: merge scope config with base config
scopedConfig = {
  ...baseConfig,
  ...scopeConfig,  // Scope overrides base
  ...cliOptions    // CLI overrides both
}
```

## Helper Functions

**File:** `src/commands/common.ts`

### resolvePath()
Converts relative paths to absolute paths:
```typescript
const absPath = resolvePath('./src');  // Converts to absolute
```

### resolveOutputPath()
Handles output path with smart extension handling:
```typescript
const outputPath = resolveOutputPath('.xray', 'txt');
// Returns: /absolute/path/.xray.txt

const outputPath = resolveOutputPath('output', 'txt');
// Returns: /absolute/path/output.txt (adds extension)
```

## Strategy Auto-Configuration

**File:** `src/commands/generate.ts`

When `--auto-configure` is enabled (default), xray automatically:

1. Detects applicable strategies
2. Extracts file type patterns
3. Applies ignore patterns
4. Configures match/catch options

**Detection Flow:**
```typescript
async configureFromStrategies(options) {
  const strategies = await detector.runDetection();

  for (const strategy of strategies) {
    const fileTypes = strategy.fileTypes();
    const ignorePatterns = strategy.ignorePatterns();

    // Add to match patterns
    for (const ext of fileTypes) {
      match.push(`*${ext}`);
    }

    // Add to catch patterns
    for (const pattern of ignorePatterns) {
      catchPatterns.push(pattern);
    }
  }

  return { match, catch: catchPatterns, detectedStrategies };
}
```

**Disabling Auto-Configuration:**
```bash
xray map --no-auto-configure  # Use only explicit patterns
```

## Scope and Lens Support

Scopes and lenses allow multiple configurations within a single config file.

**Config File Example:**
```json
{
  "paths": ["src/"],
  "limit": 4096,
  "scopes": {
    "backend": {
      "paths": ["src/backend"],
      "limit": 8192
    },
    "frontend": {
      "paths": ["src/frontend"],
      "limit": 6144
    }
  },
  "lenses": {
    "detailed": {
      "with": ["vars", "incs", "docs"]
    },
    "quick": {
      "limit": 2048
    }
  }
}
```

**Usage:**
```bash
xray map --scope backend           # Use backend scope
xray map --lens detailed           # Use detailed lens
xray map --all-scopes              # Run all scopes
```

## Error Handling

Commands implement consistent error handling:

```typescript
try {
  // Command logic
} catch (error) {
  Logger.error(`Operation failed: ${error.message}`);
  process.exit(1);
}
```

## Progress Reporting

Long-running operations use progress bars:

```typescript
const bar = new cliProgress.SingleBar({
  format: 'Analysis Progress |{bar}| {percentage}% || {value}/{total}',
  hideCursor: true
});

// Progress callbacks
config.onProgress = (current, total, file) => {
  bar.update(current);
};
```

## Integration with Core Services

Commands integrate with core xray services:

1. **Configuration**: `src/lib/config.ts`
   - Load and merge configuration files
   - Validate options
   - Handle lenses and scopes

2. **Analysis**: `src/lib/xray.ts`
   - Core analysis engine
   - Graph building and ranking
   - Returns analysis results

3. **Rendering**: `src/lib/renderer/`
   - ChunkedRenderer: Multi-file output
   - MapRenderer: Single-file output
   - Format-specific rendering

4. **Strategy System**: `src/lib/strategy/`
   - Auto-loading and registration
   - Detection and analysis
   - Command execution

5. **Caching**: `src/lib/cache/`
   - AST caching
   - Strategy detection caching
   - Automatic invalidation

## Testing Commands

**Test Files:**
- `__tests__/chunked-renderer.test.ts` - Chunked output tests
- `__tests__/auto-configure.test.ts` - Auto-configuration tests
- Additional command tests in `__tests__/`

**Running Tests:**
```bash
npm test                           # Run all tests
npm test -- chunked-renderer       # Test specific feature
npm run test:coverage              # Coverage report
```

## Future Enhancements

Planned command system improvements:

1. **Interactive Mode**: Interactive command prompts
2. **Streaming Output**: Real-time result streaming
3. **Custom Exporters**: Pluggable output formats
4. **Hooks System**: Pre/post command hooks
5. **Command Aliases**: Custom command shortcuts

## See Also

- [Architecture Overview](architecture.md) - System design
- [Strategy Development](strategy-development.md) - Creating strategies
- [Contributing Guide](contributing.md) - Development workflow
