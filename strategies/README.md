# Xray Strategies

This directory contains built-in strategies for the xray analysis tool.
Strategies extend xray's capabilities to understand project types, frameworks,
and code patterns.

For documentation on the broader Extension system that powers these strategies,
see [docs/dev/extensions.md](../docs/dev/extensions.md).

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

#### Markdown Strategy (`markdown.ts`)
Analyzes markdown structure, cross-references, and code examples. Requires [mdq](https://github.com/yshavit/mdq) to be installed:
macOS `brew install mdq`; Linux x64 / Windows x64 download the prebuilt asset from the
[release page](https://github.com/yshavit/mdq/releases/tag/v0.10.0); Linux arm64, macOS x64 and
other platforms `cargo install mdq --version 0.10.0 --locked`. When missing, xray logs an
info-level hint with the right command for your platform.

**Detects:**
- `mdq` binary availability
- Markdown files (*.md, *.mdx)

**Commands:**
- `markdown toc` - Generate table of contents
- `markdown refs` - Show cross-references between docs
- `markdown orphans` - Find unlinked markdown files
- `markdown code-refs` - Find code references in docs
- `markdown coverage` - Source file documentation coverage
- `markdown stale` - Find broken links (`markdown_link`) and inline-code path mentions that resolve nowhere (`code_path_reference`; looked up against the doc dir, scan root, repo root; mentions with spaces/globs are skipped)

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

### Infrastructure Strategy (`infrastructure.ts`)

Unified infrastructure-as-code analysis across multiple tools.

**Detects:**
- Terraform (*.tf) - resources, modules, providers, data sources, variables, outputs
- Kubernetes (*.yaml) - Deployments, Services, ConfigMaps, Secrets, Ingress, etc.
- Helm (Chart.yaml, values.yaml) - Charts and values
- CloudFormation (*.template.*) - Resources, Parameters, Outputs, intrinsic functions

**Commands:**
- `infrastructure resources` - List all infrastructure resources
- `infrastructure providers` - List cloud providers used
- `infrastructure graph` - Generate dependency graph
- `infrastructure summary` - Infrastructure summary
- `infrastructure validate` - Validate configuration

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

A strategy is a TypeScript/JavaScript module that implements the `Strategy`
interface:

```typescript
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';

export default class MyStrategy implements Strategy {
  name = 'my-strategy';
  version = '0.1.0';

  // Required: Detection logic
  async detect(ctx: StrategyContext): Promise<boolean> {
    return ctx.hasFiles('**/*.myext') || ctx.hasDependency('my-framework');
  }

  // Optional: File types to analyze
  fileTypes(): string[] {
    return ['.myext'];
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
        return { /* results */ };
      }
    }
  };
}
```

## Strategy Discovery

Strategies are discovered from multiple locations (in priority order):

1. **Environment Variable**: `XRAY_STRATEGIES_PATH`
2. **Local Project**: `.xray/strategies/`
3. **User Directory**
4. **NPM Packages**: `node_modules/xray-strategy-*/`
5. **Built-in**: `strategies/`

## Contributing

To contribute a new strategy:

1. Create the strategy file in `strategies/`
2. Write comprehensive tests in `__tests__/strategies/`
3. Add documentation in `docs/strategies/`
4. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
