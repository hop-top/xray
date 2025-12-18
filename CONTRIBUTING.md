# Contributing to xray

Thank you for your interest in contributing to xray! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js >= 18
- npm
- C++ compiler (for native dependencies)
  - Linux: `build-essential`
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools

### Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/jadb/xray.git
   cd xray
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   
   On systems requiring C++20:
   ```bash
   CXXFLAGS="-std=c++20" npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

## Development Workflow

### Running in Development Mode

Use `ts-node` to run without building:
```bash
npm run dev -- generate --root ./test-repo
```

### Testing

- **Run all tests**: `npm test`
- **Run with coverage**: `npm run test:coverage`
- **Watch mode**: `npm test -- --watch`

### Code Quality

- Write tests for new features
- Ensure all tests pass before submitting a PR
- Follow existing code style and patterns
- Add JSDoc comments for public APIs

## Adding Language Support

To add support for a new language:

1. **Install the Tree-sitter grammar**:
   ```bash
   npm install --save-dev tree-sitter-yourlang
   ```

2. **Update the language registry** (`src/parser/language-registry.ts`):
   - Import the language
   - Add file extension mappings
   - Register the language parser

3. **Create a query file** (`src/parser/queries/yourlang.scm`):
   - Define patterns for extracting tags (functions, classes, etc.)
   - See existing `.scm` files for examples

4. **Add tests** (`tests/imports.test.ts` or similar):
   - Create test fixtures
   - Verify parsing works correctly

## Submitting Changes

1. **Fork the repository** and create a feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** with clear, descriptive commits:
   ```bash
   git commit -m "Add support for XYZ language"
   ```

3. **Push to your fork**:
   ```bash
   git push origin feature/my-new-feature
   ```

4. **Open a Pull Request**:
   - Describe what your changes do
   - Reference any related issues
   - Ensure CI checks pass

## Pull Request Guidelines

- One feature/fix per PR
- Include tests for new functionality
- Update documentation (README, JSDoc) as needed
- Keep commits focused and atomic
- Rebase on main before submitting if needed

## Reporting Issues

When reporting bugs, please include:
- xray version (`npm list xray`)
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Sample code/repository if possible

## Questions?

Feel free to open an issue for questions or discussions about development!
