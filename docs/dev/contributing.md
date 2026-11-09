# Contributing to xray

Thank you for your interest in contributing to xray! This guide will help you get started with development.

## Development Setup

### Prerequisites

- Node.js 22.12+
- npm or yarn
- C++ build tools:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: build-essential (`sudo apt-get install build-essential`)
  - **Windows**: Visual Studio Build Tools

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/hop-top/xray.git
cd xray

# Install dependencies
npm ci

# Build the project
npm run build

# Link for local development
npm link
```

### Project Structure

Following Node.js/TypeScript best practices, the project is organized as:

```
xray/
├── src/                    # Source code
│   ├── index.ts           # CLI bootstrap entry point
│   ├── commands/          # CLI command definitions
│   │   ├── index.ts       # Command registration
│   │   ├── common.ts      # Shared utilities and options
│   │   ├── generate.ts    # map, graph commands
│   │   ├── explore.ts     # explore command
│   │   ├── strategy.ts    # strategy * commands
│   │   ├── strategy-cmd.ts # Strategy command execution
│   │   ├── clear-cache.ts # Cache commands
│   │   └── completion.ts  # Completion commands
│   ├── types/             # TypeScript type definitions
│   │   ├── index.ts       # Barrel export
│   │   ├── xray-config.ts # Configuration types
│   │   └── cli-options.ts # CLI option types
│   └── lib/               # Core business logic
│       ├── xray.ts        # Main Xray analysis class
│       ├── config.ts      # Configuration loading/merging
│       ├── scanner.ts     # File system scanning
│       ├── query-resolver.ts # Custom query handling
│       ├── logger.ts      # Logging utilities
│       ├── parser/        # AST parsing components
│       ├── graph/         # Graph building and ranking
│       ├── renderer/      # Output rendering
│       │   ├── map-renderer.ts      # Single-file renderer
│       │   └── chunked-renderer.ts  # Multi-file chunked renderer
│       ├── cache/         # SQLite caching
│       └── strategy/      # Strategy framework
├── strategies/            # Strategy implementations
│   ├── react.ts          # React strategy
│   ├── express.ts        # Express strategy
│   ├── rest-api.ts       # REST API strategy
│   └── go-cli.ts         # Go CLI strategy
├── __tests__/            # Test files (Jest convention)
│   ├── chunked-renderer.test.ts
│   ├── auto-configure.test.ts
│   ├── strategy/         # Strategy tests
│   └── integration/      # Integration tests
├── dist/                 # Compiled output (built by npm run build)
├── docs/                 # Documentation
│   ├── user/             # User documentation
│   └── dev/              # Developer documentation
└── hooks/                # Git hooks
```

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name origin/next
```

### 2. Make Your Changes

Follow the project's coding style and conventions. The codebase enforces:
- TypeScript strict mode
- 120 character line length (enforced by prettier)
- Async/await patterns (no promises)
- Proper error handling with meaningful messages

### 3. Update Types (if needed)

If your changes introduce new configuration or options:

1. Add types to `src/types/xray-config.ts` or `src/types/cli-options.ts`
2. Export from `src/types/index.ts`
3. Update affected commands in `src/commands/`

### 4. Update Command Options (if needed)

If adding new CLI options:

1. Add option to `addCommonOptions()` in `src/commands/common.ts`
2. Update type definitions in `src/types/`
3. Handle option merging in `src/lib/config.ts`
4. Document in user-facing docs and command reference

### 5. Write Tests

Add tests for new functionality. Follow Jest conventions:

```typescript
// __tests__/my-feature.test.ts
import { describe, it, expect } from '@jest/globals';
import { myFunction } from '../src/lib/my-module';

describe('MyFeature', () => {
  it('should handle basic case', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should handle edge cases', () => {
    expect(myFunction('')).toBe('default');
  });
});
```

**Test File Locations:**
- Command tests: `__tests__/commands/`
- Library tests: `__tests__/lib/`
- Strategy tests: `__tests__/strategies/`
- Integration tests: `__tests__/integration/`

### 6. Run Tests Locally

```bash
# Run all tests sequentially (recommended)
npm test

# Run specific test file
npm test -- chunked-renderer

# Run in watch mode (during development)
npm test -- --watch

# Run with coverage
npm run test:coverage

# Run tests in parallel (faster, use for CI/CD)
npm run test:parallel
```

### 7. Build the Project

```bash
npm run build
```

Verify the build completes without errors and examine `dist/` directory contains compiled output.

### 8. Test Locally

```bash
# Test the CLI with built version
node dist/index.js map --path ./test-project

# Or link for testing globally
npm link
xray map --path ./test-project

# Unlink when done
npm unlink -g xray
```

### 9. Verify Specific Features

For chunked output:
```bash
xray map --path ./src
# Check: .xray_root.md, .xray_src.md, etc. are created with navigation links
```

For strategy auto-configuration:
```bash
xray map --path ./test-react-app
# Check: React files are automatically included
```

For config file support:
```bash
echo '{"chunked": false, "limit": 8192}' > .xrayrc.json
xray map  # Should use config
```

### 10. Commit Your Changes

Follow conventional commit format:

```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in parser"
git commit -m "docs: update contributing guide"
git commit -m "test: add chunked renderer tests"
git commit -m "refactor: improve command structure"
```

**Commit Types:**
- `feat:` - New feature or capability
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style/formatting (prettier)
- `refactor:` - Code refactoring without behavior change
- `test:` - Adding or updating tests
- `chore:` - Maintenance, dependencies, tooling

### 11. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a pull request against the `next` branch with a clear description of changes.

## Testing

### Running Tests

```bash
# Sequential (recommended)
npm test

# Parallel
npm run test:parallel

# Watch mode
npm test -- --watch

# Coverage report
npm run test:coverage
```

### Writing Tests

**Unit Tests:**
```typescript
// tests/unit/parser.test.ts
import { describe, it, expect } from '@jest/globals';
import { parseFile } from '../../src/parser';

describe('Parser', () => {
  it('should parse TypeScript files', async () => {
    const ast = await parseFile('test.ts');
    expect(ast).toBeDefined();
  });
});
```

**Integration Tests:**
```typescript
// tests/integration/strategy.test.ts
import { describe, it, expect } from '@jest/globals';
import { ReactStrategy } from '../../strategies/react';

describe('React Strategy Integration', () => {
  it('should detect React projects', async () => {
    const strategy = new ReactStrategy();
    const detected = await strategy.detect(context);
    expect(detected).toBe(true);
  });
});
```

### Test Coverage Requirements

- Core functionality: >80%
- Strategy system: >75%
- CLI commands: >70%

## Adding New Features

### Adding a New Command

1. **Create command file** in `src/commands/`:
```typescript
// src/commands/my-command.ts
import { Command } from 'commander';
import { addCommonOptions } from './common';

export const registerMyCommand = (program: Command) => {
  const cmd = program
    .command('my-command')
    .description('What this command does');

  addCommonOptions(cmd);

  cmd.action(async (options) => {
    // Command implementation
    console.log('Command executed');
  });

  return cmd;
};
```

2. **Register the command** in `src/commands/index.ts`:
```typescript
export const registerCommands = (program: Command) => {
  // ... existing commands
  registerMyCommand(program);
};
```

3. **Add tests** in `__tests__/commands/`:
```typescript
// __tests__/commands/my-command.test.ts
import { describe, it, expect } from '@jest/globals';
// Test implementation
```

### Adding a New Language

1. **Install tree-sitter parser:**
```bash
npm install tree-sitter-<language> --save-dev
```

2. **Update language registry:**
```typescript
// src/lib/parser/language-registry.ts
import LanguageParser from 'tree-sitter-<language>';

export const languages = {
  // ... existing languages
  '<language>': {
    extensions: ['.ext'],
    parser: LanguageParser,
    queryFile: 'queries/<language>.scm'
  }
};
```

3. **Create query file:**
```scheme
; src/lib/parser/queries/<language>.scm
(function_definition
  name: (identifier) @name.definition.function) @definition.function
```

4. **Test with sample files:**
```bash
xray map --path ./test-files/<language>
npm test
```

### Creating a New Strategy

See [Strategy Development Guide](strategy-development.md) for detailed instructions.

**Quick Start:**

1. **Create strategy file** in `strategies/`:
```typescript
// strategies/my-framework.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';

export default class MyFrameworkStrategy implements Strategy {
  name = 'my-framework';
  version = '1.0.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    return ctx.hasDependency('my-framework') || ctx.hasFiles('**/*.myf');
  }

  fileTypes(): string[] {
    return ['.myf'];
  }

  ignorePatterns(): string[] {
    return ['**/*.test.myf'];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];

    if (content.includes('export')) {
      tags.push('my-framework:public');
    }

    return { tags, metadata: {} };
  }
}
```

2. **Add tests** in `__tests__/strategies/`:
```typescript
// __tests__/strategies/my-framework.test.ts
import { describe, it, expect } from '@jest/globals';
import MyFrameworkStrategy from '../../strategies/my-framework';

describe('MyFrameworkStrategy', () => {
  it('should detect my-framework projects', async () => {
    // Test detection logic
  });

  it('should analyze files correctly', async () => {
    // Test analysis logic
  });
});
```

3. **Test the strategy:**
```bash
xray strategy detect                    # Should list your strategy
xray my-framework commands               # Run strategy commands
npm test -- my-framework.test.ts        # Run strategy tests
```

### Adding Configuration Options

1. **Define type** in `src/types/xray-config.ts`:
```typescript
export interface XrayScopeConfig {
  // ... existing fields
  myOption?: string;  // Your new option
}
```

2. **Update CLI option** in `src/commands/common.ts`:
```typescript
export const addCommonOptions = (cmd: Command) => {
  return cmd
    // ... existing options
    .option('--my-option <value>', 'Description of option')
    // ... rest of options
};
```

3. **Handle merging** in `src/lib/config.ts`:
```typescript
export const mergeConfig = (baseConfig: any, cliOptions: any) => {
  return {
    ...baseConfig,
    ...cliOptions,  // CLI takes precedence
    myOption: cliOptions.myOption || baseConfig.myOption || defaultValue
  };
};
```

4. **Use in command**:
```typescript
cmd.action(async (options) => {
  const config = mergeConfig(loadedConfig, options);
  console.log(config.myOption);  // Your option value
});
```

5. **Document in**:
   - `README.md` - Options table
   - `docs/user/commands.md` - Command reference
   - `docs/user/configuration.md` - Config file guide

## Code Style

### TypeScript Style Guide

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use descriptive variable names
- Add JSDoc comments for public APIs
- Use async/await over promises
- Avoid `any` types when possible

**Example:**
```typescript
/**
 * Parses a source file and returns its AST.
 * @param filePath - Absolute path to the file
 * @returns Parsed AST or null if parsing fails
 */
export async function parseFile(filePath: string): Promise<AST | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parse(content);
  } catch (error) {
    console.error(`Failed to parse ${filePath}:`, error);
    return null;
  }
}
```

### Code Quality

The project enforces code quality through:
- TypeScript strict mode compilation
- Git pre-commit hooks (via Husky)
- Automated test execution

Ensure your code passes all checks before committing.

## Documentation

### Updating Documentation

When adding new features, update relevant documentation:

- **User docs** (`docs/user/`): Features users interact with
- **Dev docs** (`docs/dev/`): Internal architecture, APIs
- **README.md**: High-level overview only

### Documentation Style

- Use clear, concise language
- Include code examples
- Add usage examples for new features
- Update table of contents if needed

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`npm test`)
- [ ] Code builds (`npm run build`)
- [ ] Documentation updated
- [ ] Conventional commit messages
- [ ] No merge conflicts

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How has this been tested?

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] All tests passing
- [ ] No breaking changes (or documented)
```

### Review Process

1. Automated checks run (tests, build)
2. Code review by maintainers
3. Address feedback
4. Approval and merge

## Release Process

Releases are automated with [release-please](https://github.com/googleapis/release-please); see [RELEASING.md](../../RELEASING.md) for the full rules.
`CHANGELOG.md` is generated by release-please and never edited by hand; do not add entries to it in pull requests.

1. Open pull requests against `next` (features, breaking changes, docs, chores). Fixes for the current stable release go to `main` and are forward-ported to `next`. Use [Conventional Commit](https://www.conventionalcommits.org/) titles.
2. The `release-please` workflow keeps one release PR open per branch. It holds the next version, the regenerated `CHANGELOG.md`, and the `package.json`, `package-lock.json` and manifest bumps.
3. A maintainer merges the release PR when ready to ship. That creates the `xray/v<version>` tag and GitHub release, then publishes `@hop-top/xray` to npm: prereleases (`x.y.z-rc.N`, from `next`) under the `next` dist-tag, stable releases (from `main`) under `latest`.

The branch decides the version: `next` cuts rc prereleases, `main` cuts the stable version the rc previewed. Only `feat`, `fix` and `perf` commits appear in the changelog and open a release PR; `docs`, `test`, `build`, `ci`, `chore`, `style` and `refactor` do not.

Do not edit `package.json` `version`, `.github/.release-please-manifest.json` or tags by hand, and do not write `Release-As` footers.

## Getting Help

- **Questions**: [GitHub Discussions](https://github.com/hop-top/xray/discussions)
- **Bugs**: [GitHub Issues](https://github.com/hop-top/xray/issues)

## Code of Conduct

Please read and follow our [Code of Conduct](../../CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## See Also

- [Architecture Guide](architecture.md) - System design
- [Strategy Development](strategy-development.md) - Creating strategies
- [Strategy API Reference](strategy-api.md) - Strategy commands
