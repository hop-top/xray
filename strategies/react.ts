// strategies/react.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import Parser from 'tree-sitter';
import { requireGrammarModule } from '../src/lib/parser/grammars';
import { Logger } from '../src/lib/logger';

export default class ReactStrategy implements Strategy {
  name = 'react';
  description = 'Inspect React components, hooks and contexts';
  version = '0.1.0';
  // Grammar is optional (language pack): detection is skipped when absent.
  requiresLanguages = ['typescript'];

  private getParser(): Parser {
    // Always create a fresh parser instance to avoid test interference
    const parser = new Parser();
    // Use TSX grammar for both .tsx and .jsx files (supports JSX syntax)
    // Load grammar only when needed to avoid module-level side effects
    const TSX = requireGrammarModule('typescript').tsx;
    parser.setLanguage(TSX);
    return parser;
  }

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Check for React dependencies
    const hasReact = ctx.hasDependency('react') || ctx.hasDevDependency('react');
    const hasReactDom = ctx.hasDependency('react-dom') || ctx.hasDevDependency('react-dom');

    // Check for JSX/TSX files
    const hasJsxFiles = ctx.hasFiles('**/*.jsx') || ctx.hasFiles('**/*.tsx');

    // Detect if any of these conditions are met
    return hasReact || hasReactDom || hasJsxFiles;
  }

  fileTypes(): string[] {
    return ['.jsx', '.tsx', '.ts', '.js'];
  }

  ignorePatterns(): string[] {
    return [
      '**/*.test.{js,jsx,ts,tsx}',
      '**/*.spec.{js,jsx,ts,tsx}',
      '**/__tests__/**',
      '**/node_modules/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];
    const metadata: Record<string, any> = {};

    try {
      // Primary: AST-based detection
      const tree = this.getParser().parse(content);
      const rootNode = tree.rootNode;

      // Check for JSX elements in the AST
      const hasJSX = this.hasJSXElements(rootNode);

      if (hasJSX) {
        // Detect components using AST
        const components = this.findComponents(rootNode);
        if (components.length > 0) {
          tags.push('react:component');
          metadata.componentName = components[0].name;
          metadata.componentType = components[0].type;
          metadata.components = components;
        }
      }

      // Detect custom hooks using AST
      const hook = this.findHook(rootNode);
      if (hook) {
        tags.push('react:hook');
        metadata.hookName = hook.name;
      }

      // Detect context using AST
      const context = this.findContext(rootNode);
      if (context) {
        tags.push('react:context');
        metadata.contextName = context.name;
      }
    } catch (error) {
      // Fallback: Regex-based detection if AST parsing fails
      this.analyzeWithRegex(content, tags, metadata);
    }

    return {
      tags,
      exports: [],
      imports: [],
      metadata
    };
  }

  private analyzeWithRegex(content: string, tags: string[], metadata: Record<string, any>): void {
    // Check for JSX syntax
    const hasJSX = /<[A-Z][\w]*|<[a-z][\w]*/.test(content);

    if (hasJSX) {
      // Detect function components
      const functionMatch = content.match(/(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\(/);
      if (functionMatch) {
        tags.push('react:component');
        metadata.componentName = functionMatch[1];
        metadata.componentType = 'function';
      }

      // Detect arrow function components
      const arrowMatch = content.match(/(?:export\s+)?const\s+([A-Z]\w*)\s*=\s*\([^)]{0,1000}\)\s*=>/);
      if (arrowMatch && !metadata.componentName) {
        tags.push('react:component');
        metadata.componentName = arrowMatch[1];
        metadata.componentType = 'function';
      }

      // Detect class components
      const classMatch = content.match(/(?:export\s+)?class\s+([A-Z]\w*)\s+extends\s+(?:React\.)?(?:Component|PureComponent)/);
      if (classMatch && !metadata.componentName) {
        tags.push('react:component');
        metadata.componentName = classMatch[1];
        metadata.componentType = 'class';
      }
    }

    // Detect custom hooks
    const funcHookMatch = content.match(/(?:export\s+)?(?:default\s+)?function\s+(use[A-Z]\w*)\s*\(/);
    if (funcHookMatch) {
      tags.push('react:hook');
      metadata.hookName = funcHookMatch[1];
    }

    const arrowHookMatch = content.match(/(?:export\s+)?const\s+(use[A-Z]\w*)\s*=\s*\([^)]{0,1000}\)\s*=>/);
    if (arrowHookMatch && !metadata.hookName) {
      tags.push('react:hook');
      metadata.hookName = arrowHookMatch[1];
    }

    // Detect context
    const contextMatch = content.match(/(?:export\s+)?const\s+([A-Z]\w*Context)\s*=\s*createContext/);
    if (contextMatch) {
      tags.push('react:context');
      metadata.contextName = contextMatch[1];
    }
  }

  private hasJSXElements(node: Parser.SyntaxNode): boolean {
    if (node.type === 'jsx_element' || node.type === 'jsx_self_closing_element') {
      return true;
    }

    for (const child of node.children) {
      if (this.hasJSXElements(child)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Every component declared in the tree, in source order: function
   * declarations, arrow / function-expression constants, and classes that
   * extend Component / PureComponent. A matched node is not searched again,
   * so helpers nested inside a component are not reported.
   */
  private findComponents(root: Parser.SyntaxNode): Array<{ name: string; type: 'function' | 'class' }> {
    const found: Array<{ name: string; type: 'function' | 'class' }> = [];
    const seen = new Set<string>();
    const add = (name: string, type: 'function' | 'class'): void => {
      if (seen.has(name)) return;
      seen.add(name);
      found.push({ name, type });
    };

    const visit = (node: Parser.SyntaxNode): void => {
      // function MyComponent() { ... }
      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode && this.isComponentName(nameNode.text)) {
          add(nameNode.text, 'function');
          return;
        }
      }

      // const MyComponent = () => { ... } / function expression / `as` cast
      if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
        let matched = false;
        for (const child of node.children) {
          if (child.type !== 'variable_declarator') continue;
          const nameNode = child.childForFieldName('name');
          const valueNode = child.childForFieldName('value');
          if (nameNode && valueNode && this.isComponentName(nameNode.text) &&
              (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression' ||
               valueNode.type === 'type_assertion' || valueNode.type === 'as_expression')) {
            add(nameNode.text, 'function');
            matched = true;
          }
        }
        if (matched) return;
      }

      // class MyComponent extends React.Component { ... }
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        const heritageNode = node.children.find(c => c.type === 'class_heritage');
        if (nameNode && heritageNode) {
          const extendsText = heritageNode.text;
          if (extendsText.includes('Component') || extendsText.includes('PureComponent')) {
            add(nameNode.text, 'class');
            return;
          }
        }
      }

      for (const child of node.children) visit(child);
    };

    visit(root);
    return found;
  }

  private findHook(node: Parser.SyntaxNode): { name: string } | null {
    // Check for function declarations: function useMyHook() { ... }
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && this.isHookName(nameNode.text)) {
        return { name: nameNode.text };
      }
    }

    // Check for variable declarators with arrow functions: const useMyHook = () => { ... }
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const child of node.children) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          const valueNode = child.childForFieldName('value');

          if (nameNode && valueNode && this.isHookName(nameNode.text)) {
            if (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression') {
              return { name: nameNode.text };
            }
          }
        }
      }
    }

    // Check for export statements
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const result = this.findHook(declaration);
        if (result) return result;
      }
    }

    // Recurse into children
    for (const child of node.children) {
      const result = this.findHook(child);
      if (result) return result;
    }

    return null;
  }

  private findContext(node: Parser.SyntaxNode): { name: string } | null {
    // Check for const MyContext = createContext(...)
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const child of node.children) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          const valueNode = child.childForFieldName('value');

          if (nameNode && valueNode && nameNode.text.endsWith('Context')) {
            // Check if value is a call to createContext
            if (valueNode.type === 'call_expression') {
              const funcNode = valueNode.childForFieldName('function');
              if (funcNode && funcNode.text === 'createContext') {
                return { name: nameNode.text };
              }
            }
          }
        }
      }
    }

    // Check for export statements
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const result = this.findContext(declaration);
        if (result) return result;
      }
    }

    // Recurse into children
    for (const child of node.children) {
      const result = this.findContext(child);
      if (result) return result;
    }

    return null;
  }

  private isComponentName(name: string): boolean {
    // Component names must start with uppercase letter
    return /^[A-Z]/.test(name);
  }

  private isHookName(name: string): boolean {
    // Hook names must start with "use" followed by uppercase letter
    return /^use[A-Z]/.test(name);
  }

  commands = {
    'components': {
      description: 'List all React components in the project',
      async handler(ctx: StrategyContext) {
        const files = await ctx.findFiles({ tagged: 'react:component' });
        const components: Array<{ name: string; type: string; file: string }> = [];

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'react');
          const all: Array<{ name: string; type?: string }> =
            metadata?.components ?? (metadata?.componentName
              ? [{ name: metadata.componentName, type: metadata.componentType }]
              : []);
          for (const c of all) {
            components.push({ name: c.name, type: c.type || 'unknown', file });
          }
        }

        if (components.length === 0) explainEmpty(ctx, 'components');
        return components;
      }
    },
    'hooks': {
      description: 'List all custom React hooks in the project',
      async handler(ctx: StrategyContext) {
        const files = await ctx.findFiles({ tagged: 'react:hook' });
        const hooks: Array<{ name: string; file: string }> = [];

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'react');
          if (metadata?.hookName) {
            hooks.push({
              name: metadata.hookName,
              file
            });
          }
        }

        if (hooks.length === 0) explainEmpty(ctx, 'hooks');
        return hooks;
      }
    },
    'contexts': {
      description: 'List all React contexts in the project',
      async handler(ctx: StrategyContext) {
        const files = await ctx.findFiles({ tagged: 'react:context' });
        const contexts: Array<{ name: string; file: string }> = [];

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'react');
          if (metadata?.contextName) {
            contexts.push({
              name: metadata.contextName,
              file
            });
          }
        }

        if (contexts.length === 0) explainEmpty(ctx, 'contexts');
        return contexts;
      }
    }
  };
}

/** Paths the strategy skips (see `ignorePatterns`). */
const TEST_PATH = /(^|\/)__tests__\/|\.(test|spec)\.[jt]sx?$/;

/**
 * An empty list is a result, not an explanation: say what was scanned and
 * what is skipped by design, on stderr so machine output stays clean.
 */
function explainEmpty(ctx: StrategyContext, what: 'components' | 'hooks' | 'contexts'): void {
  const exts = what === 'components' ? 'jsx,tsx' : 'js,jsx,ts,tsx';
  const label = what === 'components' ? '.jsx/.tsx' : '.js/.jsx/.ts/.tsx';
  const files = ctx.globFiles(`**/*.{${exts}}`).filter(f => !f.split('/').includes('node_modules'));
  const inTests = files.filter(f => TEST_PATH.test(f)).length;
  const skipped = 'test files (*.test.*, *.spec.*, anything under __tests__/) are not scanned';
  const head = `no React ${what} found`;
  if (files.length === 0) {
    Logger.warn(`${head}: no ${label} files in the project (${skipped})`);
  } else if (inTests > 0) {
    Logger.warn(`${head}: ${inTests} of ${files.length} ${label} file(s) are under test paths; ${skipped}`);
  } else {
    Logger.warn(`${head}: scanned ${files.length} ${label} file(s) (${skipped})`);
  }
}
