# Contributing to xray

Thank you for your interest in contributing to xray! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Adding Language Support](#adding-language-support)
- [Release Process](#release-process)

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow. Please be respectful, constructive, and professional in all interactions.

## Getting Started

Before contributing, please:

1. Check existing [issues](https://github.com/hop-top/xray/issues) to see if your contribution is already being discussed
2. For major changes, open an issue first to discuss what you would like to change
3. Fork the repository and create a feature branch off `next`

## Development Setup

### Prerequisites

- Node.js 22.12+
- npm or yarn
- C++ build tools (for tree-sitter compilation)
  - **macOS**: Xcode Command Line Tools (\`xcode-select --install\`)
  - **Linux**: build-essential (\`sudo apt-get install build-essential\`)
  - **Windows**: Visual Studio Build Tools

### Installation

\`\`\`bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/xray.git
cd xray

# Install dependencies
npm ci

# Enable the pre-commit hook (once per clone)
npm run hooks

# Build the project
npm run build

# Link for local development
npm link

# Verify installation
xray --version
\`\`\`

### Development Commands

\`\`\`bash
# Build TypeScript to JavaScript
npm run build

# Run in development mode (with ts-node)
npm run dev

# Run tests
npm test

# Run tests with coverage
npm test:coverage

# Run specific test file
npm test -- tests/cli.test.ts

# Watch mode for development
npm test -- --watch
\`\`\`

## Project Structure

This repository contains the xray CLI tool, GitHub Action, and Git Hook all in one place.

\`\`\`
xray/
├── src/
│   ├── cli.ts                     # CLI entry point
│   ├── index.ts                   # Main Xray class
│   ├── config.ts                  # Configuration handling
│   ├── parser/                    # AST parsing
│   ├── graph/                     # Graph analysis
│   └── renderer/                  # Output formatting
├── tests/                         # Test files
├── docs/                          # Documentation
├── hooks/                         # Git hooks
├── .github/workflows/             # CI/CD
├── action.yaml                    # GitHub Action
└── README.md
\`\`\`

**What's in this repo:**
- **CLI tool**: \`npm install -g xray\`
- **GitHub Action**: \`uses: hop-top/xray@xray/v0.1.0-rc.0\`
- **Git Hooks**: Pre-commit hook

## Development Workflow

### 1. Create a Feature Branch

\`\`\`bash
git checkout -b feature/your-feature-name
\`\`\`

### 2. Make Your Changes

- Write clean, readable code
- Follow existing patterns
- Add tests for new functionality
- Update documentation

### 3. Test Your Changes

\`\`\`bash
npm test
npm run build
\`\`\`

## Testing

Place test files in \`tests/\` directory. Follow existing patterns in \`tests/cli.test.ts\`.

**Test categories:**
1. Unit tests
2. Integration tests
3. E2E CLI tests

## Coding Standards

- Use TypeScript strict mode
- Prefer \`const\` over \`let\`
- Add JSDoc for public APIs
- Use descriptive names
- Handle errors properly

## Commit Guidelines

Follow conventional commits:

\`\`\`
feat(cli): add completion command
fix(parser): handle empty files
docs: update README
test: add completion tests
\`\`\`

## Pull Request Process

1. Target the `next` branch (fixes for the current stable release: `main`; see [RELEASING.md](RELEASING.md))
2. Update your branch with its target branch
3. Run tests and build
4. Update documentation
5. Use conventional commit format for PR title
6. Wait for review approval

## Release Process

Releases are automated with release-please: `next` cuts rc prereleases, `main` cuts stable versions. See [RELEASING.md](RELEASING.md). Do not edit `CHANGELOG.md`, the manifest or `package.json` `version` by hand.

## Adding Language Support

1. Install tree-sitter parser
2. Update \`src/parser/language-registry.ts\`
3. Create query file in \`src/parser/queries/\`
4. Add tests
5. Update README

## License

By contributing, you agree your contributions will be licensed under the MIT License.

---

Thank you for contributing to xray! 🎉
