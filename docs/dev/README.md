# Developer Documentation

Technical documentation for xray developers, maintainers, and contributors.

## Quick Navigation

### Getting Started
- **[Contributing Guide](contributing.md)** - Development setup, workflow, and how to contribute
  - Project structure overview
  - Development workflow
  - Adding new features (commands, languages, strategies)
  - Testing and verification
  - Code style guidelines

### Understanding the System
- **[Architecture Overview](architecture.md)** - System design, components, and data flow
  - High-level architecture diagram
  - Core components and their responsibilities
  - Complete data flow for all operations
  - Strategy system design
  - Performance optimizations
  - Configuration system
  - Extension points

### Technical Deep Dives
- **[Command Structure](command-structure.md)** - CLI architecture and command system
  - Command organization and registration
  - Detailed documentation for each command
  - Common options and utilities
  - Configuration merging strategy
  - Strategy auto-configuration
  - Scope and lens support

- **[Chunked Output Architecture](chunked-output-architecture.md)** - Multi-file rendering system
  - ChunkedRenderer implementation details
  - Token limit management per chunk
  - Navigation system algorithms
  - Performance characteristics
  - Testing approach
  - Backward compatibility notes

### Strategy Development
- **[Strategy Development Guide](strategy-development.md)** - Creating custom strategies
  - Strategy interface specification
  - Strategy context API
  - File metadata structure
  - Testing strategies
  - Best practices
  - Auto-loading mechanism

- **[Strategy API Reference](strategy-api.md)** - Strategy command implementation reference
  - Command invocation patterns
  - Available strategy commands
  - Output formats and examples
  - Implementation patterns

- **[Strategy Design Documents](strategies/)** - Technical specs for built-in strategies
  - [React Strategy](strategies/react.md) - Component, hook, and context analysis
  - [Express Strategy](strategies/express.md) - Route, middleware, and handler detection
  - [REST API Strategy](strategies/rest-api.md) - Cross-framework endpoint analysis
  - [Go CLI Strategy](strategies/go-cli.md) - Go CLI application analysis

## Project Structure

```
xray/
├── src/
│   ├── index.ts                    # CLI bootstrap
│   ├── commands/                   # Command definitions
│   │   ├── index.ts               # Command registration
│   │   ├── common.ts              # Shared utilities
│   │   ├── generate.ts            # map, graph commands
│   │   ├── explore.ts             # explore command
│   │   ├── strategy.ts            # strategy * commands
│   │   ├── strategy-cmd.ts        # Strategy execution
│   │   ├── clear-cache.ts         # Cache commands
│   │   └── completion.ts          # Completion
│   ├── types/                      # Type definitions
│   │   ├── xray-config.ts
│   │   └── cli-options.ts
│   └── lib/                        # Core business logic
│       ├── xray.ts                # Main analysis class
│       ├── config.ts              # Config loading
│       ├── scanner.ts             # File discovery
│       ├── query-resolver.ts      # Query handling
│       ├── logger.ts              # Logging
│       ├── parser/                # AST parsing
│       ├── graph/                 # Graph building
│       ├── renderer/              # Output rendering
│       │   ├── map-renderer.ts
│       │   └── chunked-renderer.ts
│       ├── cache/                 # SQLite caching
│       └── strategy/              # Strategy system
├── strategies/                     # Strategy implementations
│   ├── react.ts
│   ├── express.ts
│   ├── rest-api.ts
│   └── go-cli.ts
├── __tests__/                      # Tests (Jest convention)
├── docs/
│   ├── user/                       # User-facing documentation
│   └── dev/                        # Developer documentation (this dir)
└── dist/                           # Compiled output (generated)
```

## Key Concepts

### Chunked Output
The system automatically splits large codebases into multiple files organized by directory. This is **enabled by default** and can be disabled with `--no-chunk`.

**Key benefits:**
- Handles large codebases within LLM token limits
- Intuitive navigation through directory structure
- Per-chunk optimization of content

**Read:** [Chunked Output Architecture](chunked-output-architecture.md)

### Strategy System
Strategies enable framework-specific code analysis and exploration. xray auto-detects applicable strategies and provides framework-specific commands.

**Built-in strategies:**
- React (components, hooks, contexts)
- Express (routes, middleware, handlers)
- REST API (cross-framework endpoints)
- Go CLI (commands and flags)

**Read:** [Strategy Development Guide](strategy-development.md)

### Configuration System
Configuration comes from multiple sources (config files, scopes, lenses, CLI flags) and is merged intelligently with CLI flags taking precedence.

**Features:**
- Multiple scopes for different analysis configurations
- Named lenses for quick CLI option overlays
- File-based and CLI-based configuration
- Auto-configuration from detected strategies

**Read:** [Command Structure](command-structure.md) - Configuration Merging section

### Auto-Configuration
When enabled (default), xray detects applicable strategies and automatically configures file patterns and filters.

**Example:** Analyzing a React project automatically includes only `.tsx` and `.jsx` files.

## Development Workflows

### Adding a New Command

1. Create file in `src/commands/your-command.ts`
2. Implement command handler
3. Register in `src/commands/index.ts`
4. Add tests in `__tests__/commands/`
5. Follow: [Contributing Guide](contributing.md) → Adding New Features → Adding a New Command

### Adding a New Language

1. Install tree-sitter parser: `npm install tree-sitter-<lang>`
2. Update `src/lib/parser/language-registry.ts`
3. Create query file in `src/lib/parser/queries/`
4. Test with sample files
5. Follow: [Contributing Guide](contributing.md) → Adding New Features → Adding a New Language

### Creating a New Strategy

1. Create file in `strategies/your-strategy.ts`
2. Implement `Strategy` interface
3. Add tests in `__tests__/strategies/`
4. Strategy auto-loads automatically
5. Follow: [Strategy Development Guide](strategy-development.md)

### Improving Documentation

1. Edit relevant file in `docs/dev/`
2. Verify accuracy against code
3. Check cross-references
4. Run `npm test` if documentation includes code examples
5. Follow: [Contributing Guide](contributing.md)

## Testing

### Running Tests

```bash
# All tests sequentially (recommended)
npm test

# Specific test file
npm test -- chunked-renderer

# Watch mode
npm test -- --watch

# Coverage report
npm run test:coverage
```

### Test Organization

- `__tests__/chunked-renderer.test.ts` - Chunked output tests
- `__tests__/auto-configure.test.ts` - Auto-configuration tests
- `__tests__/commands/` - Command tests
- `__tests__/strategies/` - Strategy tests
- `__tests__/lib/` - Library tests

## Build and Deployment

### Building

```bash
npm run build
# Output: dist/index.js
```

### Local Testing

```bash
npm link              # Link for global use
xray map --help      # Test CLI
npm unlink -g xray   # Unlink when done
```

### Publishing

```bash
npm version patch|minor|major
npm publish
```

## Key Files Reference

### Core Implementation

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI bootstrap |
| `src/commands/index.ts` | Command registration |
| `src/lib/xray.ts` | Main analysis engine |
| `src/lib/config.ts` | Configuration handling |
| `src/lib/renderer/chunked-renderer.ts` | Multi-file output |
| `src/lib/renderer/map-renderer.ts` | Single-file output |
| `src/lib/strategy/` | Strategy system |

### Configuration

| File | Purpose |
|------|---------|
| `src/types/xray-config.ts` | Configuration types |
| `src/types/cli-options.ts` | CLI option types |
| `src/lib/config.ts` | Config loading and merging |

### Testing

| File | Purpose |
|------|---------|
| `__tests__/chunked-renderer.test.ts` | Chunked output tests |
| `__tests__/auto-configure.test.ts` | Auto-config tests |
| `jest.config.js` | Jest configuration |

## Common Tasks

### I want to...

**...add a new CLI option**
→ [Command Structure](command-structure.md) → Adding Configuration Options in [Contributing](contributing.md)

**...fix a bug in chunked output**
→ [Chunked Output Architecture](chunked-output-architecture.md) → Troubleshooting

**...add support for a new framework**
→ [Strategy Development Guide](strategy-development.md)

**...improve rendering performance**
→ [Chunked Output Architecture](chunked-output-architecture.md) → Performance Characteristics

**...understand how configuration works**
→ [Command Structure](command-structure.md) → Configuration Merging

**...debug strategy detection**
→ [Strategy Development Guide](strategy-development.md) → StrategyContext API

**...add a test**
→ [Contributing Guide](contributing.md) → Writing Tests

## Recent Changes

### January 2026

**Major Refactoring:**
- Migrated to Node.js/TypeScript CLI best practices
- New modular command structure in `src/commands/`
- Chunked output feature enabled by default
- Strategy auto-configuration system
- Improved test organization (`__tests__/` convention)

**Documentation Updated:**
- Architecture doc updated with new structures
- New command structure documentation
- New chunked output architecture guide
- Contributing guide updated with new workflows

## Getting Help

### For Questions About...

**System Architecture** → [Architecture Overview](architecture.md)

**Command Implementation** → [Command Structure](command-structure.md)

**Rendering and Output** → [Chunked Output Architecture](chunked-output-architecture.md)

**Creating Strategies** → [Strategy Development Guide](strategy-development.md)

**Development Process** → [Contributing Guide](contributing.md)

**Specific Strategy** → [Strategy Design Docs](strategies/)

## Standards and Conventions

### Code Style

- TypeScript strict mode
- Async/await patterns (not promises)
- Proper error handling
- JSDoc comments for public APIs
- 120 character line length

### Documentation Style

- Clear hierarchy with markdown headings
- Code examples that actually work
- Cross-references between documents
- Diagrams for complex flows
- Tables for reference material

### Testing

- Jest test framework
- Tests in `__tests__/` directory (not `tests/`)
- Descriptive test names
- Good coverage: Core >80%, Strategies >75%, CLI >70%

### Commits

- Conventional commit format (feat:, fix:, docs:, test:, etc.)
- Descriptive commit messages
- One feature per commit when possible
- Related documentation updated in same commit as code

## Related Documentation

- **User Documentation:** `docs/user/` - For end-users
- **README:** `README.md` - Project overview
- **MIGRATION_COMPLETED.md** - Summary of structural migration
- **CHUNKED_OUTPUT_IMPLEMENTATION.md** - Chunked feature details

## Maintenance

This documentation is maintained alongside the codebase. When making code changes:

1. Update related documentation files
2. Verify code examples still work
3. Check cross-references
4. Update this README if structure changes

## Version

- **Last Updated:** January 22, 2026
- **Documentation Status:** Current with codebase (commit fa49a4a)
- **Coverage:** All major features and systems documented

---

**Welcome to xray development!** Start with [Contributing Guide](contributing.md) for your first contribution.
