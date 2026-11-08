# React Strategy

The React strategy automatically detects React projects and provides component-level analysis using AST parsing with regex fallback.

## Detection

The strategy activates when any of these conditions are met:
- `react` is listed in dependencies or devDependencies
- `react-dom` is listed in dependencies or devDependencies
- `.jsx` or `.tsx` files are present in the project

## Analysis Approach

### Primary: AST-based Detection (tree-sitter)
- Parses TypeScript/JSX using tree-sitter TSX grammar
- Handles complex patterns: multi-line parameters, TypeScript generics
- Supports React.FC, React.PureComponent, React.Component
- Robust JSX element detection

### Fallback: Regex-based Detection
- Activates if AST parsing fails
- Provides basic pattern matching for components, hooks, and contexts

## Tags

The React strategy adds the following tags to analyzed files:

- `react:component` - File contains a React component (function, arrow, or class)
- `react:hook` - File contains a custom React hook (functions starting with `use`)
- `react:context` - File contains a React context created with `createContext`

## Metadata

Components are analyzed and enriched with metadata:

### Components
```typescript
{
  componentName: string;    // Name of the component
  componentType: 'function' | 'class';  // Component type
}
```

### Hooks
```typescript
{
  hookName: string;  // Name of the custom hook
}
```

### Contexts
```typescript
{
  contextName: string;  // Name of the context
}
```

## File Types

The strategy processes:
- `.jsx` files
- `.tsx` files
- `.js` files (for hooks and contexts)
- `.ts` files (for hooks and contexts)

## Ignore Patterns

By default, the following patterns are ignored:
- `**/*.test.{js,jsx,ts,tsx}` - Test files
- `**/*.spec.{js,jsx,ts,tsx}` - Spec files
- `**/__tests__/**` - Test directories
- `**/node_modules/**` - Dependencies

## Commands

The React strategy provides the following commands via the explore interface:

### List Components
```bash
xray react components
# or
xray react components
```

**Example Output:**
```
React Components:
  Button (function) - src/components/Button.tsx
  Card (class) - src/components/Card.tsx
  Header (function) - src/components/Header.tsx

Total: 3 component(s)
```

**What it detects:**
- Function components: `function MyComponent()`, `const MyComponent = () => {}`
- Arrow function components: `const MyComponent: React.FC = () => {}`
- Class components: `class MyComponent extends Component`, `class MyComponent extends React.PureComponent`
- TypeScript patterns with generics and complex type annotations
- Every component in a file is listed, not just the first

**Not scanned:** `*.test.*`, `*.spec.*` and anything under `__tests__/`
(see Ignore Patterns). A project whose only components live there lists
nothing; the command says so on stderr, with the number of files skipped.
Wrapped components (`React.memo(...)`, `forwardRef(...)`) are not detected.

### List Custom Hooks
```bash
xray react hooks
# or
xray react hooks
```

**Example Output:**
```
Custom React Hooks:
  useCounter - src/hooks/useCounter.ts
  useToggle - src/hooks/useToggle.ts
  useLocalStorage - src/hooks/useLocalStorage.ts
  useDebounce - src/hooks/useDebounce.ts

Total: 4 hook(s)
```

**What it detects:**
- Functions starting with `use` followed by an uppercase letter
- Both function declarations and arrow function assignments
- Example: `function useMyHook()`, `const useMyHook = () => {}`

### List Contexts
```bash
xray react contexts
# or
xray react contexts
```

**Example Output:**
```
React Contexts:
  ThemeContext - src/contexts/ThemeContext.ts
  AuthContext - src/contexts/AuthContext.ts
  UserContext - src/contexts/UserContext.ts

Total: 3 context(s)
```

**What it detects:**
- Context creation via `createContext()`: `const MyContext = createContext(...)`
- Both `React.createContext` and imported `createContext`

## Implementation Details

### AST Parsing
The strategy uses tree-sitter to parse TypeScript and JSX files, looking for:
- Function declarations with JSX return statements
- Arrow functions with JSX return statements
- Class declarations extending React.Component or React.PureComponent
- createContext calls for context detection
- Function names matching the `use[A-Z]` pattern for hooks

### Regex Fallback
When AST parsing fails (malformed code, unsupported syntax), the strategy falls back to regex patterns:
- Component patterns: `/function\s+([A-Z]\w*)/`, `/const\s+([A-Z]\w*)\s*=/`
- Hook patterns: `/function\s+(use[A-Z]\w*)/`, `/const\s+(use[A-Z]\w*)\s*=/`
- Context patterns: `/const\s+(\w+Context)\s*=\s*createContext/`

### Edge Cases Handled
- Multi-line component definitions with complex type annotations
- Generic components with multiple type parameters
- Nested component definitions
- Conditional component rendering
- Higher-order components (HOCs)
- React.memo wrapped components

## Version

**v0.0.1-alpha.1** - Initial implementation
- AST-based detection using tree-sitter parsing
- Regex fallback for malformed code
- Component detection (function, class, arrow function)
- Custom hook detection (use* pattern)
- Context detection (createContext)
- TypeScript generic support
- Multi-line pattern handling

## See Also

- [User Guide: React Strategy](../../user/strategies.md#react-strategy) - Usage guide for users
- [Strategy Development Guide](../strategy-development.md) - Creating custom strategies
- [Strategy API Reference](../strategy-api.md) - Command implementation details

---

**Implementation:** `strategies/react.ts`
