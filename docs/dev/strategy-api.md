# Strategy API Reference

Technical reference for creating and implementing strategy commands in xray.

## Overview

Strategy commands provide framework-specific exploration capabilities through the xray explore interface. Commands are executed using the `<strategy> <command>` syntax.

## Usage

Strategy commands can be invoked in two ways:

**Shorthand (explore is default):**
```bash
xray <strategy> <command> [options]
```

**Explicit:**
```bash
xray <strategy> <command> [options]
```

**Options:**
- `-p, --path <path>` - Project path to analyze (default: current directory)

## Available Strategies and Commands

### React Strategy

The React strategy provides commands for exploring React codebases.

#### `react components`

Lists all React components in the project.

```bash
xray react components
xray react components -p /path/to/project
```

**Output:**
```
React Components:
  Button (function) - src/components/Button.tsx
  Card (class) - src/components/Card.tsx
  Header (function) - src/components/Header.tsx

Total: 3 component(s)
```

**Detection:**
- Function components: `function MyComponent()`, `const MyComponent = () => {}`
- Class components: `class MyComponent extends Component`, `class MyComponent extends React.PureComponent`
- TypeScript patterns: generics, multi-line parameters
- React.FC and React.FunctionComponent annotations

#### `react hooks`

Lists all custom React hooks in the project.

```bash
xray react hooks
xray react hooks -p /path/to/project
```

**Output:**
```
Custom React Hooks:
  useCounter - src/hooks/useCounter.ts
  useToggle - src/hooks/useToggle.ts
  useLocalStorage - src/hooks/useLocalStorage.ts

Total: 3 hook(s)
```

**Detection:**
- Function declarations: `function useMyHook()`
- Arrow functions: `const useMyHook = () => {}`
- Naming convention: must start with `use` followed by uppercase letter

#### `react contexts`

Lists all React contexts in the project.

```bash
xray react contexts
xray react contexts -p /path/to/project
```

**Output:**
```
React Contexts:
  ThemeContext - src/contexts/ThemeContext.ts
  AuthContext - src/contexts/AuthContext.ts
  UserContext - src/contexts/UserContext.ts

Total: 3 context(s)
```

**Detection:**
- Context creation: `const MyContext = createContext(...)`
- Naming convention: typically ends with `Context`

## Creating Custom Strategy Commands

Strategies can define custom commands by adding a `commands` property:

```typescript
import type { Strategy, StrategyContext, StrategyCommand } from '@hop-top/xray/strategy';

export default class MyStrategy implements Strategy {
  name = 'my-strategy';
  version = '1.0.0';

  // ... detection and analysis methods ...

  commands = {
    'my-command': {
      description: 'Description of what this command does',
      async handler(ctx: StrategyContext, opts?: any) {
        // Find files with specific tags
        const files = await ctx.findFiles({ tagged: 'my-strategy:tag' });

        // Collect results
        const results: Array<{ name: string; file: string }> = [];
        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'my-strategy');
          if (metadata?.name) {
            results.push({ name: metadata.name, file });
          }
        }

        return results;
      }
    }
  };
}
```

### Command Handler

The command handler receives:
- `ctx: StrategyContext` - Context for file operations and metadata access
- `opts?: any` - Optional command-line options passed by the user

The handler should return structured data (typically an array) that will be displayed by the CLI.

### Command Execution Flow

1. User runs `xray <strategy> <command>`
2. CLI parses the query and extracts strategy name and command name
3. Strategy is loaded and validated
4. Project files are analyzed with the strategy
5. Tags and metadata are stored in the context
6. Command handler is executed with the populated context
7. Results are formatted and displayed

### Display Formatting

The CLI automatically formats results based on command name:
- `components` - Shows name, type, and file
- `hooks` - Shows name and file
- `contexts` - Shows name and file
- Other commands - JSON output

**Custom Formatting Example:**

You can implement custom display logic in your command handler by returning formatted strings:

```typescript
commands = {
  'routes': {
    description: 'List all routes with custom formatting',
    async handler(ctx: StrategyContext, opts?: any) {
      const files = await ctx.findFiles({ tagged: 'express:route' });
      const routes: Array<{ method: string; path: string; file: string }> = [];

      for (const file of files) {
        const metadata = ctx.getMetadata(file, 'express');
        if (metadata?.routes) {
          routes.push(...metadata.routes.map((r: any) => ({ ...r, file })));
        }
      }

      // Custom formatting: group by method
      const byMethod = routes.reduce((acc, route) => {
        if (!acc[route.method]) acc[route.method] = [];
        acc[route.method].push(route);
        return acc;
      }, {} as Record<string, typeof routes>);

      // Return formatted output
      console.log('\nExpress Routes:\n');
      for (const [method, methodRoutes] of Object.entries(byMethod)) {
        console.log(`${method}:`);
        methodRoutes.forEach(r => {
          console.log(`  ${r.path} → ${r.file}`);
        });
        console.log();
      }

      return routes; // Still return data for JSON export if needed
    }
  }
};
```

This approach gives you full control over formatting while maintaining compatibility with JSON output.

## Best Practices

### Command Naming

- Use descriptive names: `components`, `hooks`, `stores`
- Use plural forms for listing commands
- Use colons for namespacing: `react:components`, `vue:stores`

### Command Design

- **Return structured data**: Commands should return arrays or objects, not strings
- **Use tags for filtering**: Tag files during analysis, query tags in commands
- **Store rich metadata**: Include all relevant information in metadata
- **Handle empty results**: Return empty arrays when no matches found

### Performance

- **Analyze once, query many**: Analysis happens once, commands query the cached metadata
- **Efficient file scanning**: Use `ctx.findFiles()` with tag queries instead of manual iteration
- **Cache expensive operations**: Use `ctx.getCached()` for AST parsing or heavy computations

### Error Handling

- **Validate strategy exists**: CLI handles this automatically
- **Validate command exists**: CLI handles this automatically
- **Graceful degradation**: Return empty results instead of throwing errors
- **Informative messages**: Include helpful context in error messages

## Examples

### List All Strategy Commands

```bash
# See available strategies
xray strategy list

# Detect strategies in current project
xray strategy detect

# Run strategy commands
xray react components
xray react hooks
xray react contexts
```

### Multiple Projects

```bash
# Analyze different projects
xray react components -p ~/projects/app1
xray react components -p ~/projects/app2
xray react hooks -p ~/projects/app3
```

### Integration with Other Commands

Strategy commands work seamlessly with other xray features:

```bash
# Explore files, then query strategy
xray -m "*.tsx" -s "useState"
xray react hooks
```

## Future Enhancements

Potential future improvements to strategy commands:

- **Filter options**: e.g. a `--type function` filter (not implemented)
- **Output formats**: already available via `--format json|yaml|table|csv`
- **Sorting**: e.g. a `--sort name` option (not implemented)
- **Interactive mode**: TUI for browsing results
- **Composition**: Combine multiple strategy queries
