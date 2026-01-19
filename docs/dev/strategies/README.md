# Strategy Design Documents

This directory contains technical design documents for individual xray strategies. These documents provide in-depth specifications for how each strategy detects frameworks and analyzes code.

## Purpose

These documents serve as:
- **Design specifications** for strategy implementations
- **Reference guides** for understanding detection patterns
- **Templates** for creating new strategies
- **Technical documentation** for maintainers

## Available Strategy Specifications

### Framework Strategies

- **[React Strategy](react.md)** - React component analysis
  - Component detection (function, class, arrow function)
  - Custom hook detection (use* pattern)
  - Context detection (createContext)
  - AST-based parsing with regex fallback

- **[Express Strategy](express.md)** - Deep analysis for Express.js applications
  - Route detection (all HTTP methods)
  - Router mounting and organization
  - Middleware detection (global and route-specific)
  - Error handler detection

- **[REST API Strategy](rest-api.md)** - Cross-framework REST API analysis
  - Multi-language support (Node.js, Python, Go)
  - Endpoint detection across frameworks
  - HTTP method normalization
  - Path parameter handling

- **[Go CLI Strategy](go-cli.md)** - Go command-line applications
  - Cobra framework support
  - urfave/cli support
  - Standard flag package support
  - Command hierarchy detection

## Strategy Development Resources

The general **[Strategy Development Guide](../strategy-development.md)** covers:
- Strategy interface and lifecycle
- Context API usage
- Best practices
- Testing strategies
- Auto-loading mechanism

The **[Strategy API Reference](../strategy-api.md)** documents:
- Command implementation
- Handler patterns
- Display formatting
- Error handling

## Document Structure

Each strategy design document follows this structure:

### 1. Detection
- Package dependencies to check
- File patterns to look for
- Code patterns that indicate the framework

### 2. Analysis Features
- What the strategy analyzes
- Patterns it detects
- Metadata it extracts

### 3. Tags
- File tags applied during analysis
- When tags are applied
- Tag naming conventions

### 4. Commands
- Available strategy commands
- What each command does
- Example output

### 5. Implementation Details
- AST parsing approach
- Regex fallback patterns (if applicable)
- Edge cases handled
- Version history

## Using These Documents

### For Understanding Existing Strategies

Read these documents to understand:
- How a strategy detects a framework
- What patterns it looks for in code
- What information it extracts
- What commands it provides

### For Creating New Strategies

Use these as templates:
1. Copy structure from similar strategy document
2. Adapt detection criteria for your framework
3. Define analysis patterns for your use case
4. Implement commands relevant to your framework
5. Create the corresponding `.ts` implementation

### For Debugging Strategies

Reference these when:
- Strategy isn't detecting your project
- Expected patterns aren't being found
- Commands return unexpected results
- Adding new detection patterns

## Relationship to Code

These design documents correspond to implementation files:

```
docs/dev/strategies/react.md      →  strategies/react.ts
docs/dev/strategies/express.md    →  strategies/express.ts
docs/dev/strategies/rest-api.md   →  strategies/rest-api.ts
docs/dev/strategies/go-cli.md     →  strategies/go-cli.ts
```

The `.md` files describe **what** and **why**.
The `.ts` files implement **how**.

## Strategy Development Workflow

When creating a new strategy:

1. **Design First**: Create a design document in this directory
   - Define detection criteria
   - Specify analysis features
   - Design command interface
   - Document expected output

2. **Review**: Get feedback on detection approach and features
   - Ensure detection is reliable
   - Verify commands are useful
   - Check for edge cases

3. **Implement**: Code the strategy in `strategies/` directory
   - Implement `Strategy` interface
   - Add detection logic
   - Implement analysis method
   - Create command handlers

4. **Test**: Add tests in `tests/strategies/`
   - Test detection logic
   - Test analysis accuracy
   - Test command output
   - Add fixtures for edge cases

5. **Document**: Update user guide at `docs/user/strategies.md`
   - Add strategy to strategy list
   - Document user-facing commands
   - Provide usage examples
   - Add troubleshooting tips

See [Contributing Guide](../contributing.md) for full development workflow.

## Strategy Template

When creating a new strategy design document, use this template:

```markdown
# [Framework Name] Strategy

Brief description of what this strategy detects and analyzes.

## Detection

Detection criteria:
- Package dependencies
- File patterns
- Code patterns

## Analysis Approach

How the strategy analyzes code:
- AST parsing details
- Regex patterns (if applicable)
- What gets extracted

## Tags

File tags applied:
- `framework:tag-name` - Description

## Metadata

Metadata structure extracted.

## Commands

Available commands and their output.

## Implementation Details

Technical details, edge cases, fallbacks.

## See Also

Related documentation links.
```

## See Also

- [Strategy Development Guide](../strategy-development.md) - How to create strategies
- [Strategy API Reference](../strategy-api.md) - Command implementation
- [User Strategy Guide](../../user/strategies.md) - Using strategies
- [Architecture](../architecture.md) - Strategy system design
- [Contributing](../contributing.md) - Development workflow

---

These documents represent the technical specifications for xray's framework detection and analysis capabilities.
