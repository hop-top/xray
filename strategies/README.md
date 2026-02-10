# Xray Strategies

This directory contains built-in strategies for the xray analysis tool. Strategies extend xray's capabilities to understand different project types, frameworks, and patterns.

## Available Strategies

### Framework Strategies

#### React Strategy (`react.ts`)
Detects and analyzes React components, hooks, and contexts.

**Detects:**
- React dependencies in package.json
- JSX/TSX files
- Components (function, arrow, class)
- Custom hooks
- Context providers

**Commands:**
- `react components` - List all React components
- `react hooks` - List all custom hooks
- `react contexts` - List all React contexts

#### Next.js Strategy (`nextjs.ts`)
Detects and analyzes Next.js projects.

**Detects:**
- Next.js dependency
- Pages directory
- App directory (Next.js 13+)
- API routes

#### Express Strategy (`express.ts`)
Detects and analyzes Express.js applications.

**Detects:**
- Express dependency
- Route definitions
- Middleware
- API endpoints

**Commands:**
- `express routes` - List all routes
- `express middleware` - List all middleware

#### REST API Strategy (`rest-api.ts`)
Generic REST API detection and analysis.

**Detects:**
- REST API patterns
- HTTP method usage
- Endpoint definitions

### Language Strategies

#### Go CLI Strategy (`go-cli.ts`)
Detects Go command-line applications.

**Detects:**
- go.mod file
- CLI frameworks (Cobra, urfave/cli)
- cmd/ directory structure
- Flag usage

### Package Manager Strategy (`package-manager.ts`)

Unified dependency analysis across multiple ecosystems.

**Detects:**
- npm/yarn/pnpm (package.json)
- Cargo (Cargo.toml)
- pip/poetry (requirements.txt, pyproject.toml)
- go mod (go.mod)

**Commands:**
- `package-manager list-dependencies` - List all dependencies
- `package-manager summary` - Summary of package managers

**Supported:**
- JavaScript/TypeScript (npm, yarn, pnpm)
- Rust (Cargo)
- Python (pip, poetry)
- Go (go modules)

See [detailed documentation](../docs/strategies/package-manager.md) for more information.

### Infrastructure Strategy (`infrastructure.ts`)

Unified infrastructure-as-code analysis across multiple tools.

**Detects:**
- Terraform (*.tf) - resources, modules, providers, data sources, variables, outputs
- Kubernetes (*.yaml) - Deployments, Services, ConfigMaps, Secrets, Ingress, etc.
- Helm (Chart.yaml, values.yaml) - Charts and values
- CloudFormation (*.template.*) - Resources, Parameters, Outputs, intrinsic functions

**Commands:**
- `infrastructure resources` - List all infrastructure resources (filterable by type, tool, provider)
- `infrastructure providers` - List cloud providers used
- `infrastructure graph` - Generate dependency graph (JSON or DOT format)
- `infrastructure summary` - Infrastructure summary
- `infrastructure validate` - Validate configuration for common issues

**Features:**
- Dependency extraction and validation
- Circular dependency detection
- Multi-tool support in single project
- Cloud provider detection (AWS, Google Cloud, Azure)

**Test Coverage:** 117 tests, 98%+ coverage across all metrics

See [detailed documentation](../docs/strategies/infrastructure.md) for more information.

## Creating Custom Strategies

### Quick Start

Create a new strategy using the CLI:

```bash
# Create a YAML strategy (simpler)
xray strategy create my-strategy --yaml

# Create a TypeScript strategy (full control)
xray strategy create my-strategy --ts
```

### Strategy Structure

A strategy is a TypeScript/JavaScript module that implements the `Strategy` interface:

```typescript
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';

export default class MyStrategy implements Strategy {
  name = 'my-strategy';
  version = '1.0.0';

  // Required: Detection logic
  async detect(ctx: StrategyContext): Promise<boolean> {
    return ctx.hasFiles('**/*.myext') || ctx.hasDependency('my-framework');
  }

  // Optional: File types to analyze
  fileTypes(): string[] {
    return ['.myext'];
  }

  // Optional: Patterns to ignore
  ignorePatterns(): string[] {
    return ['**/node_modules/**', '**/.git/**'];
  }

  // Required: File analysis logic
  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];
    const metadata: Record<string, any> = {};

    // Your analysis logic here

    return {
      tags,
      metadata,
      exports: [],
      imports: []
    };
  }

  // Optional: Custom commands
  commands = {
    'info': {
      description: 'Show information about the strategy',
      async handler(ctx: StrategyContext) {
        // Command implementation
        return { /* results */ };
      }
    }
  };
}
```

### Strategy Context API

The `StrategyContext` provides utilities for analyzing projects:

```typescript
interface StrategyContext {
  // Check for dependencies
  hasDependency(name: string): boolean;
  hasDevDependency(name: string): boolean;

  // File operations
  hasFiles(pattern: string): boolean;
  globFiles(pattern: string): string[];
  readFile(file: string): Promise<string>;
  findFiles(query: FileQuery): Promise<string[]>;

  // Metadata and tags
  hasTag(file: string, tag: string): boolean;
  getTags(file: string): string[];
  getMetadata(file: string, strategy: string): any;

  // Caching
  getCached(key: string): any;
  setCached(key: string, value: any): void;

  // Project info
  getProjectRoot(): string;
  getConfig(key: string): any;
}
```

### Best Practices

1. **Detection**: Make detection fast - use file checks before expensive operations
2. **Tags**: Use consistent tag naming: `strategy:type` (e.g., `react:component`)
3. **Error Handling**: Always handle errors gracefully - don't fail the entire analysis
4. **Performance**: Cache expensive computations using `getCached/setCached`
5. **Testing**: Write comprehensive tests for your strategy
6. **Documentation**: Document what your strategy detects and analyzes

### Testing Your Strategy

Create a test file in `__tests__/strategies/`:

```typescript
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import MyStrategy from '../../strategies/my-strategy';

describe('MyStrategy', () => {
  let strategy: MyStrategy;

  beforeEach(() => {
    strategy = new MyStrategy();
  });

  it('should detect my-strategy projects', async () => {
    // Test detection logic
  });

  it('should analyze files correctly', async () => {
    // Test analysis logic
  });
});
```

## Strategy Discovery

Strategies are discovered from multiple locations (in priority order):

1. **Environment Variable**: `XRAY_STRATEGIES_PATH`
2. **Local Project**: `.xray/strategies/`
3. **User Directory**:
   - macOS: `~/Library/Application Support/xray/strategies/`
   - Linux: `~/.local/share/xray/strategies/`
   - Windows: `%APPDATA%/xray/strategies/`
4. **NPM Packages**: `node_modules/xray-strategy-*/`
5. **Built-in**: `strategies/` (this directory)

## Publishing Strategies

### As NPM Package

1. Create package with prefix `xray-strategy-`:

```json
{
  "name": "xray-strategy-my-framework",
  "version": "1.0.0",
  "xray-strategy": {
    "name": "my-framework",
    "entry": "dist/index.js"
  }
}
```

2. Publish to npm:

```bash
npm publish
```

3. Users install with:

```bash
npm install xray-strategy-my-framework
xray strategy detect  # Automatically discovers your strategy
```

## CLI Commands

### List Strategies
```bash
xray strategy list
```

### Detect Strategies
```bash
xray strategy detect
```

### Strategy Info
```bash
xray strategy info <name>
```

### Install Strategy
```bash
xray strategy install <path-or-npm-package>
```

### Remove Strategy
```bash
xray strategy remove <name>
```

### Validate Strategy
```bash
xray strategy validate <name>
```

## Examples

See the built-in strategies in this directory for examples:

- **Simple**: `go-cli.ts` - Basic detection and analysis
- **Medium**: `nextjs.ts` - Framework-specific patterns
- **Complex**: `react.ts` - AST parsing with fallbacks
- **Comprehensive**: `package-manager.ts` - Multi-format parsing

## Contributing

To contribute a new strategy:

1. Create the strategy file in `strategies/`
2. Write comprehensive tests in `__tests__/strategies/`
3. Add documentation in `docs/strategies/`
4. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
