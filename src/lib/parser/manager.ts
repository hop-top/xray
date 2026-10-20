import * as path from 'path';
import Parser from 'tree-sitter';
import { getLanguageConfig } from './language-registry';
import { isUnavailable } from './grammars';
import { Tag, Import } from './types';
import { Logger } from '../logger';

import { graphManager } from './flow-analysis';
import { CGraphGenerator } from './graphs/c';
import { CPPGraphGenerator } from './graphs/cpp';
import { CSharpGraphGenerator } from './graphs/csharp';
import { GoGraphGenerator } from './graphs/go';
import { JavaGraphGenerator } from './graphs/java';
import { RustGraphGenerator } from './graphs/rust';
import { SwiftGraphGenerator } from './graphs/swift';
import { PythonGraphGenerator } from './graphs/python';
import { JavaScriptGraphGenerator } from './graphs/javascript';
import { TypeScriptGraphGenerator } from './graphs/typescript';

// Register Generators
graphManager.register('.c', 'internal', new CGraphGenerator());
graphManager.register('.h', 'internal', new CGraphGenerator());
graphManager.register('.cpp', 'internal', new CPPGraphGenerator());
graphManager.register('.hpp', 'internal', new CPPGraphGenerator());
graphManager.register('.cc', 'internal', new CPPGraphGenerator());
graphManager.register('.cxx', 'internal', new CPPGraphGenerator());
graphManager.register('.cs', 'internal', new CSharpGraphGenerator());
graphManager.register('.go', 'internal', new GoGraphGenerator());
graphManager.register('.java', 'internal', new JavaGraphGenerator());
graphManager.register('.rs', 'internal', new RustGraphGenerator());
graphManager.register('.swift', 'internal', new SwiftGraphGenerator());
graphManager.register('.py', 'internal', new PythonGraphGenerator());
graphManager.register('.js', 'internal', new JavaScriptGraphGenerator());
graphManager.register('.jsx', 'internal', new JavaScriptGraphGenerator());
graphManager.register('.ts', 'internal', new TypeScriptGraphGenerator());
graphManager.register('.tsx', 'internal', new TypeScriptGraphGenerator());

export class ParserManager {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  async parse(relPath: string, content: string, includeVariables: boolean = false, docConfig: string = 'none', enableCfg: boolean = false, enableDfg: boolean = false): Promise<{ tags: Tag[], imports: Import[], skipped?: boolean }> {
    // Validate docConfig
    if (docConfig && docConfig !== 'none' && docConfig !== 'all') {
      const validKinds = ['class', 'interface', 'type', 'enum', 'function', 'method', 'const', 'field'];
      const allowed = docConfig.split(',').map(s => s.trim());
      for (const k of allowed) {
        if (!validKinds.includes(k)) {
          throw new Error(`Invalid doc config: '${k}'. Valid options are: all, none, ${validKinds.join(', ')}`);
        }
      }
    }

    const ext = path.extname(relPath);
    const langConfig = getLanguageConfig(ext);

    if (!langConfig) {
      // `skipped`: a supported language we could not parse (grammar missing or
      // deselected). Callers must not cache this empty result.
      return { tags: [], imports: [], skipped: isUnavailable(ext) };
    }

    const parser = new Parser();
    parser.setLanguage(langConfig.grammar);

    const tree = parser.parse(content);

    const tags = await this.extractTags(tree, langConfig.grammar, langConfig.tagsQuery, relPath, content, includeVariables, docConfig, enableCfg, enableDfg);

    let imports: Import[] = [];
    if (langConfig.importsQuery) {
      imports = await this.extractImports(tree, langConfig.grammar, langConfig.importsQuery, relPath);
    }

    return { tags, imports };
  }

  private async extractTags(tree: Parser.Tree, language: any, queryStr: string, file: string, content: string, includeVariables: boolean, docConfig: string, enableCfg: boolean, enableDfg: boolean): Promise<Tag[]> {
    const tags: Tag[] = [];
    if (!queryStr) {
      return tags;
    }

    try {
      // In tree-sitter v0.21.0+, use new Parser.Query(language, queryString)
      const query = new Parser.Query(language, queryStr);
      const captures = query.captures(tree.rootNode);

      // Track seen names to avoid duplicates (e.g., arrow functions matched as both function and variable)
      const seen = new Set<string>();

      for (const capture of captures) {
        if (capture.name.startsWith('name.definition')) {
          const node = capture.node;
          const tagName = node.text;

          // Heuristic: Determine kind based on capture name or parent
          let kind = 'def';
          if (capture.name.includes('class')) kind = 'class';
          if (capture.name.includes('interface')) kind = 'interface';
          if (capture.name.includes('type')) kind = 'type';
          if (capture.name.includes('enum')) kind = 'enum';
          if (capture.name.includes('function')) kind = 'function';
          if (capture.name.includes('method')) kind = 'method';
          if (capture.name.includes('variable')) kind = 'const';
          if (capture.name.includes('field')) kind = 'field';

          // Skip if we've already seen this name (prefer function over variable for arrow functions)
          const tagKey = `${file}::${tagName}`;
          if (seen.has(tagKey)) continue;
          seen.add(tagKey);

          // Filter out local variables if includeVariables is false
          if (!includeVariables && kind === 'const') {
            // Check if this variable is inside a function/method (local variable)
            if (this.isLocalVariable(node)) {
              continue;
            }
          }

          // Extract signature for functions/methods
          let signature: string | undefined;
          if (kind === 'function' || kind === 'method') {
            signature = this.extractSignature(node, content);
          }

          // Extract Docstring
          let doc: string | undefined;
          // console.log('Processing tag:', tagName, 'Kind:', kind, 'Config:', docConfig);
          if (this.shouldIncludeDoc(kind, docConfig)) {
            doc = this.extractDoc(node, content);
          }

          // Generate CFG/DFG for functions/methods
          let cflogram: any;
          let dflogram: any;
          if ((enableCfg || enableDfg) && (kind === 'function' || kind === 'method')) {
            // Find the function definition node (parent of the name usually)
            // The capture is on the *name*, so we need the parent which is the function_definition
            let defNode = node.parent;
            while (defNode && !defNode.type.includes('definition') && !defNode.type.includes('declaration')) {
              defNode = defNode.parent;
            }
            if (defNode) {
              const ext = path.extname(file);
              // Use internal strategy by default for now
              const graphs = await graphManager.generateGraphs(ext, { node: defNode, file, code: content }, 'internal', enableCfg, enableDfg);
              cflogram = graphs.cfg;
              dflogram = graphs.dfg;
            }
          }

          // Find definition node for endLine
          let defNodeForLine = node.parent;
          while (defNodeForLine && !defNodeForLine.type.includes('definition') && !defNodeForLine.type.includes('declaration')) {
            defNodeForLine = defNodeForLine.parent;
          }
          // Fallback to name node if no definition found (e.g. variable declarator might be tricky)
          if (!defNodeForLine) defNodeForLine = node;

          // Extract function call references for functions/methods
          let references: string[] | undefined;
          if (kind === 'function' || kind === 'method') {
            references = this.extractReferences(defNodeForLine);
          }

          tags.push({
            file,
            name: tagName,
            kind,
            line: node.startPosition.row,
            endLine: defNodeForLine.endPosition.row,
            col: node.startPosition.column,
            signature,
            doc,
            references,
            cfg: cflogram,
            dfg: dflogram
          });
        }
      }
    } catch (e) {
      Logger.warn(`Query error in ${file}: ${e}`);
    }

    return tags;
  }

  private shouldIncludeDoc(kind: string, config: string): boolean {
    if (!config || config === 'none') return false;
    if (config === 'all') return true;

    const allowed = config.split(',').map(s => s.trim());
    return allowed.includes(kind);
  }

  private extractDoc(nameNode: Parser.SyntaxNode, content: string): string | undefined {
    // Look for comments preceding the definition
    let node = nameNode.parent;

    // Traverse up to find the main declaration node
    while (node && !node.type.includes('declaration') && !node.type.includes('definition') && !node.type.includes('statement')) {
      node = node.parent;
    }

    if (!node) node = nameNode.parent; // Fallback
    if (!node) return undefined;

    let prev = node.previousSibling;

    // Skip empty nodes or whitespace (if any)
    while (prev) {
      const type = prev.type;

      if (type === 'comment' || type === 'string' || type === 'expression_statement') {
        let text = prev.text.trim();
        // console.log('Checking sibling:', type, text);
        if (text.startsWith('/**')) {
          const doc = text.replace(/^\/\*\*|\*\/$/g, '').split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).join(' ').trim();
          return doc;
        }
        if (text.startsWith('//')) {
          return text.replace(/^\/\/\s?/, '').trim();
        }
        if (text.startsWith('"""') || text.startsWith("'''")) {
          return text.slice(3, -3).trim();
        }
        return text;
      }

      // If it's not a comment and not whitespace/empty, stop
      if (prev.text.trim().length > 0) break;

      // If it is empty/whitespace, we could continue, but tree-sitter usually doesn't give us these.
      // For safety/coverage, we can just break here too or assume it's unreachable.
      // Let's just break.
      break;
    }

    // For Python, docstrings are often the *first child* of the function/class body
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      const body = node.childForFieldName('body');
      if (body && body.firstChild) {
        const first = body.firstChild;
        // console.log('Python Doc Check:', node.type, first.type, first.text);
        if (first.type === 'expression_statement' && (first.text.trim().startsWith('"""') || first.text.trim().startsWith("'''"))) {
          return first.text.trim().slice(3, -3).trim();
        }
      }
    }

    return undefined;
  }

  private extractSignature(nameNode: Parser.SyntaxNode, content: string): string {
    // Traverse up to find the function/method declaration
    let parent = nameNode.parent;

    while (parent) {
      const type = parent.type;

      // Check if this is a function-like node
      if (type === 'function_declaration' ||
        type === 'method_definition' ||
        type === 'arrow_function' ||
        type === 'function_signature' ||
        type === 'method_signature') {

        // Find parameters and return type
        const params = parent.childForFieldName('parameters');
        const returnType = parent.childForFieldName('return_type');

        let sig = '';
        if (params) {
          sig = params.text;
        }
        if (returnType) {
          // Return type text includes the colon, so just append it
          sig += ' ' + returnType.text;
        }

        return sig;
      }

      parent = parent.parent;
    }

    return '()';
  }

  private isLocalVariable(nameNode: Parser.SyntaxNode): boolean {
    // Traverse up to check if this variable is inside a function/method
    let parent = nameNode.parent;

    while (parent) {
      const type = parent.type;

      // If we find a function-like parent, this is a local variable
      if (type === 'function_declaration' ||
        type === 'method_definition' ||
        type === 'arrow_function' ||
        type === 'function_expression') {
        return true;
      }

      // If we hit a class boundary, stop (it's top-level)
      if (type === 'class_declaration') {
        return false;
      }

      parent = parent.parent;
    }

    return false;
  }

  private extractReferences(defNode: Parser.SyntaxNode): string[] {
    const references = new Set<string>();

    // Iterative traversal with stack to avoid stack overflow
    const stack: Parser.SyntaxNode[] = [defNode];

    while (stack.length > 0) {
      const node = stack.pop()!;

      // Check for call expressions (covers most languages)
      if (node.type === 'call_expression') {
        // Try to get the function name being called
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
          // Handle simple function calls: foo()
          if (funcNode.type === 'identifier') {
            references.add(funcNode.text);
          }
          // Handle member expressions: obj.method()
          else if (funcNode.type === 'member_expression' || funcNode.type === 'attribute') {
            const property = funcNode.childForFieldName('property') || funcNode.childForFieldName('attribute');
            if (property) {
              references.add(property.text);
            }
          }
        }
      }

      // Add children to stack in reverse order to maintain depth-first traversal order
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i);
        if (child) {
          stack.push(child);
        }
      }
    }

    return Array.from(references);
  }

  private async extractImports(tree: Parser.Tree, language: any, queryStr: string, file: string): Promise<Import[]> {
    const imports: Import[] = [];
    if (!queryStr) return imports;

    try {
      const query = new Parser.Query(language, queryStr);
      const captures = query.captures(tree.rootNode);

      // Map to store imports by range to combine source and text
      const importMap = new Map<string, { source?: string, text?: string }>();

      for (const capture of captures) {
        const id = `${capture.node.startIndex}-${capture.node.endIndex}`;
        if (!importMap.has(id)) {
          importMap.set(id, {});
        }
        const entry = importMap.get(id)!;

        if (capture.name === 'import.source') {
          let source = capture.node.text;
          // Clean up quotes
          if ((source.startsWith("'") && source.endsWith("'")) ||
            (source.startsWith('"') && source.endsWith('"'))) {
            source = source.slice(1, -1);
          }
          entry.source = source;
        } else if (capture.name === 'import.statement') {
          entry.text = capture.node.text;
        }
      }

      // Process map into array
      // We need to associate source with statement. 
      // The source node is a child of the statement node.
      // So the ranges will be different.
      // Strategy: 
      // 1. Collect all statements.
      // 2. Collect all sources.
      // 3. For each source, find the parent statement.

      // Let's retry the loop strategy.

      const statements: { node: Parser.SyntaxNode, text: string }[] = [];
      const sources: { node: Parser.SyntaxNode, source: string }[] = [];

      for (const capture of captures) {
        if (capture.name === 'import.statement') {
          statements.push({ node: capture.node, text: capture.node.text });
        } else if (capture.name === 'import.source') {
          let source = capture.node.text;
          if ((source.startsWith("'") && source.endsWith("'")) ||
            (source.startsWith('"') && source.endsWith('"'))) {
            source = source.slice(1, -1);
          }
          sources.push({ node: capture.node, source });
        }
      }

      // Match sources to statements
      for (const src of sources) {
        // Find parent statement
        // Simple check: source node range is within statement node range
        const stmt = statements.find(s =>
          src.node.startIndex >= s.node.startIndex &&
          src.node.endIndex <= s.node.endIndex
        );

        if (stmt) {
          let source = src.source;
          // Clean up Scala imports which capture the whole declaration
          if (file.endsWith('.scala') && source.startsWith('import ')) {
            source = source.replace(/^import\s+/, '').trim();
          }

          imports.push({
            file,
            source,
            text: stmt.text
          });
        } else {
          let source = src.source;
          if (file.endsWith('.scala') && source.startsWith('import ')) {
            source = source.replace(/^import\s+/, '').trim();
          }
          // Fallback if no statement captured (shouldn't happen with correct queries)
          imports.push({
            file,
            source,
            text: `import ${source}` // approximate
          });
        }
      }

    } catch (e) {
      Logger.warn(`Import query error in ${file}: ${e}`);
    }

    return imports;
  }
}
