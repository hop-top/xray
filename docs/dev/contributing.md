# Contributing to xray

Thank you for your interest in contributing to xray! This guide will help you get started with development.

## Development Setup

### Prerequisites

- Node.js 20+
- npm or yarn
- C++ build tools:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: build-essential (`sudo apt-get install build-essential`)
  - **Windows**: Visual Studio Build Tools

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/IdeaCraftersLabs/oss-xray-codes.git
cd oss-xray-codes

# Install dependencies
# Note: --legacy-peer-deps is required due to tree-sitter peer dependency constraints
npm install --legacy-peer-deps

# Build the project
npm run build

# Link for local development
npm link
```

### Project Structure

```
oss-xray-codes/
├── src/                    # Source code
│   ├── cli.ts             # CLI entry point
│   ├── index.ts           # Programmatic API
│   ├── parser/            # AST parsing
│   ├── cache/             # SQLite caching
│   └── strategy/          # Strategy system
├── strategies/            # Strategy implementations
│   ├── react.ts          # React strategy
│   ├── express.ts        # Express strategy
│   └── ...
├── tests/                 # Test files
│   ├── cli.test.ts       # CLI tests
│   ├── strategy/         # Strategy tests
│   └── integration/      # Integration tests
├── bin/                   # Compiled output
├── docs/                  # Documentation
│   ├── user/             # User documentation
│   └── dev/              # Developer documentation
└── hooks/                 # Git hooks
```

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

Follow the project's coding style and conventions.

### 3. Write Tests

Add tests for new functionality:

```typescript
// tests/your-feature.test.ts
import { describe, it, expect } from '@jest/globals';

describe('YourFeature', () => {
  it('should do something', () => {
    // Your test
    expect(true).toBe(true);
  });
});
```

### 4. Run Tests

```bash
# Run all tests sequentially (recommended)
npm test

# Run tests in parallel (faster but may have race conditions)
npm run test:parallel

# Run with coverage
npm run test:coverage
```

### 5. Build the Project

```bash
npm run build
```

### 6. Test Locally

```bash
# Test the CLI
xray map --path ./test-project

# Or use the dev command
npm run dev -- map --path ./test-project
```

### 7. Commit Your Changes

Follow conventional commit format:

```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in parser"
git commit -m "docs: update README"
```

**Commit Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

### 8. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a pull request on GitHub.

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

### Adding a New Language

1. **Install tree-sitter parser:**
```bash
npm install tree-sitter-<language> --save-dev
```

2. **Update language registry:**
```typescript
// src/parser/language-registry.ts
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
; src/parser/queries/<language>.scm
(function_definition
  name: (identifier) @name.definition.function) @definition.function
```

4. **Test with sample files:**
```bash
xray map --path ./test-files/<language>
```

### Creating a New Strategy

See [Strategy Development Guide](strategy-development.md) for detailed instructions.

**Quick Start:**

1. **Create strategy file:**
```typescript
// strategies/my-framework.ts
import { Strategy, StrategyContext } from '../src/strategy/types';

export default class MyFrameworkStrategy implements Strategy {
  name = 'my-framework';
  version = '1.0.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    return ctx.hasDependency('my-framework');
  }

  fileTypes(): string[] {
    return ['.mf'];
  }

  async analyze(file: string, ctx: StrategyContext) {
    // Analysis logic
    return { tags: [], metadata: {} };
  }
}
```

2. **Add tests:**
```typescript
// tests/strategies/my-framework.test.ts
import { describe, it, expect } from '@jest/globals';
import MyFrameworkStrategy from '../../strategies/my-framework';

describe('MyFrameworkStrategy', () => {
  it('should detect my-framework projects', async () => {
    // Test detection logic
  });
});
```

3. **Test the strategy:**
```bash
xray strategy:detect
xray my-framework:commands
```

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

Releases are managed by maintainers:

1. Version bump in `package.json`
2. Update CHANGELOG.md
3. Create git tag
4. Publish to npm
5. Create GitHub release

## Getting Help

- **Questions**: [GitHub Discussions](https://github.com/IdeaCraftersLabs/oss-xray-codes/discussions)
- **Bugs**: [GitHub Issues](https://github.com/IdeaCraftersLabs/oss-xray-codes/issues)

## Code of Conduct

Please read and follow our [Code of Conduct](../../CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## See Also

- [Architecture Guide](architecture.md) - System design
- [Strategy Development](strategy-development.md) - Creating strategies
- [Strategy API Reference](strategy-api.md) - Strategy commands
