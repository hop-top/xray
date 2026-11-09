# Strategy Development Guide

Learn how to create custom strategies for xray to add framework-specific analysis capabilities.

## Overview

Strategies enable xray to provide framework-specific analysis and insights for your codebase. Each strategy detects a specific framework or library and provides specialized file analysis, tagging, and metadata extraction.

## Built-in Strategies

xray includes several built-in strategies for popular frameworks. For detailed information about each strategy, see:

- **[React Strategy](strategies/react.md)** - React component, hook, and context analysis
- **[Express Strategy](strategies/express.md)** - Express.js route, middleware, and router detection
- **[REST API Strategy](strategies/rest-api.md)** - Cross-framework REST endpoint analysis
- **[Go CLI Strategy](strategies/go-cli.md)** - Go CLI application analysis (Cobra, urfave/cli, flag)

These strategy documents provide comprehensive details on detection criteria, analysis approaches, tags, metadata, and available commands.

## Adding New Strategies

Strategies are TypeScript classes that implement the `Strategy` interface. Create a new strategy by:

### 1. Create Strategy File

Create the file in `.xray/strategies/`, a directory on `XRAY_STRATEGIES_PATH`, or an npm package. Types come from the public `@hop-top/xray/strategy` entry (installed with `@hop-top/xray`); use `import type` so the strategy has no runtime dependency on xray. Built-in strategies in this repo's `strategies/` directory import `../src/lib/strategy/types` instead.

```typescript
// strategies/vue.ts
import type { Strategy, StrategyContext, FileMetadata } from '@hop-top/xray/strategy';

export default class VueStrategy implements Strategy {
  name = 'vue';
  version = '1.0.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Detection logic
    return ctx.hasDependency('vue') || ctx.hasFiles('**/*.vue');
  }

  fileTypes(): string[] {
    return ['.vue'];
  }

  ignorePatterns(): string[] {
    return ['**/*.spec.vue', '**/node_modules/**'];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];
    const metadata: Record<string, any> = {};

    // Analysis logic
    if (content.includes('<template>')) {
      tags.push('vue:component');
    }

    return { tags, metadata };
  }
}
```

### 2. Strategy Interface

All strategies must implement the `Strategy` interface:

```typescript
interface Strategy {
  // Required fields
  name: string;           // Unique strategy identifier
  version: string;        // Strategy version (semver)

  // Required methods
  detect(ctx: StrategyContext): boolean | Promise<boolean>;
  analyze(file: string, ctx: StrategyContext): Promise<FileMetadata>;

  // Optional methods
  fileTypes?(): string[];          // File extensions to process
  ignorePatterns?(): string[];     // Glob patterns to ignore
  commands?: Record<string, StrategyCommand>;  // Custom commands
}
```

### 3. Strategy Context

The `StrategyContext` provides utilities for strategy implementation:

```typescript
interface StrategyContext {
  // Dependency checks
  hasDependency(name: string): boolean;
  hasDevDependency(name: string): boolean;

  // File operations
  hasFiles(pattern: string): boolean;
  readFile(file: string): Promise<string>;
  findFiles(query: FileQuery): Promise<string[]>;
  globFiles(pattern: string): string[];

  // AST parsing
  parseAST(file: string): Promise<any>;

  // Tag and metadata access
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

### 4. File Metadata

The `analyze` method returns `FileMetadata`:

```typescript
interface FileMetadata {
  tags: string[];                    // Tags to apply to the file
  exports?: string[];                // Exported symbols
  imports?: string[];                // Imported symbols
  metadata?: Record<string, any>;    // Custom metadata
}
```

### 5. Testing Your Strategy

Create tests in `tests/strategies/`:

```typescript
// tests/strategies/vue.test.ts
import { describe, it, expect } from '@jest/globals';
import VueStrategy from '../../strategies/vue';

describe('VueStrategy', () => {
  it('should detect Vue projects', async () => {
    const strategy = new VueStrategy();
    // Test detection logic
  });
});
```

### 6. Best Practices

- **Keep detection fast**: Use simple checks in `detect()` to avoid slow initialization
- **Cache expensive operations**: Use `ctx.getCached()` and `ctx.setCached()` for parsed ASTs or heavy computations
- **Use specific tags**: Prefix tags with strategy name (e.g., `react:component`, `vue:store`)
- **Document metadata**: Clearly document the metadata structure your strategy provides
- **Handle edge cases**: Test with real-world projects to catch edge cases
- **Version appropriately**: Use semantic versioning to track strategy changes

## Strategy Auto-loading

Built-in strategies are loaded from the `strategies/` directory when xray starts. The loader:

1. Scans the `strategies/` directory for `.ts` and `.js` files
2. Imports each strategy module's default export
3. Validates the strategy implements the `Strategy` interface
4. Registers validated strategies in the registry

No configuration is needed for built-ins: drop the file in xray's own `strategies/` directory.

### Strategies in a project

A strategy file is code, and loading it runs it. From the working
directory (`.xray/strategies/`, `node_modules/xray-strategy-*`), xray
therefore loads only declarative YAML strategies unless you set
`XRAY_ALLOW_PROJECT_STRATEGIES=1` in your environment. Repo config
(`.xrayrc.json`, `package.json`, `.env`) cannot set it. With it set, xray
warns with the path of each project file it loads. Without it, project
`.js`/`.ts` strategies and packages are listed by `xray strategy list` and
named, with the variable, but never imported. While developing a code
strategy, export the variable in your shell. Strategies in
`XRAY_STRATEGIES_PATH` and `$XDG_DATA_HOME/xray/strategies` are yours and
need no opt-in. Shell completion never loads project code.
