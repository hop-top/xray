import * as path from 'path';
import Parser from 'tree-sitter';
import { getLanguageConfig, CallShape } from './language-registry';
import { isUnavailable } from './grammars';
import { Tag, Import } from './types';
import type { Cfg, Dfg } from '../flow/types';
import { Logger } from '../logger';
import { extractTreeImports } from '../imports/tree';
import type { ImportRecord } from '../imports/types';

import { buildFlow, flowTableFor, functionOfName, MAX_FILE_FLOW_NODES } from '../flow';
import type { FlowResult } from '../flow';
import { terminalSafe } from '../terminal-safe';

export class ParserManager {
  private root: string;
  /** Functions without flow graphs, by why (see FlowResult.skipped); reported once after a run. */
  readonly flowSkipped: Partial<Record<NonNullable<FlowResult['skipped']>, number>> = {};

  constructor(root: string) {
    this.root = root;
  }

  /**
   * Tags and imports of one file. Contract languages (src/lib/imports) also
   * return their contract `records` (resolution input for the graph); their
   * `imports` are derived from those records, other languages' from the
   * `.scm` import captures.
   */
  async parse(relPath: string, content: string, includeVariables: boolean = false, docConfig: string = 'none', enableCfg: boolean = false, enableDfg: boolean = false): Promise<{ tags: Tag[], imports: Import[], records?: ImportRecord[], skipped?: boolean }> {
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
    const langConfig = getLanguageConfig(ext, relPath);

    if (!langConfig) {
      // `skipped`: a supported language we could not parse (grammar missing or
      // deselected). Callers must not cache this empty result.
      return { tags: [], imports: [], skipped: isUnavailable(ext) };
    }

    const parser = new Parser();
    parser.setLanguage(langConfig.grammar);

    const tree = parser.parse(content);

    const records = extractTreeImports(tree.rootNode, relPath.split(path.sep).join('/'));
    let imports: Import[] = [];
    if (records) {
      imports = legacyImports(records, relPath);
    } else if (langConfig.importsQuery) {
      imports = await this.extractImports(tree, langConfig.grammar, langConfig.importsQuery, relPath);
    }

    const calls = langConfig.callShape
      ? callContext(imports, langConfig.callShape, tree.rootNode)
      : undefined;
    const tags = await this.extractTags(tree, langConfig.grammar, langConfig.tagsQuery, relPath, content, includeVariables, docConfig, enableCfg, enableDfg, calls);

    return records ? { tags, imports, records } : { tags, imports };
  }

  private async extractTags(tree: Parser.Tree, language: any, queryStr: string, file: string, content: string, includeVariables: boolean, docConfig: string, enableCfg: boolean, enableDfg: boolean, calls?: CallContext): Promise<Tag[]> {
    const tags: Tag[] = [];
    const flowBudget = { left: MAX_FILE_FLOW_NODES };
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

          // CFG/DFG of functions/methods, for languages with a flow table.
          let cflogram: Cfg | undefined;
          let dflogram: Dfg | undefined;
          if ((enableCfg || enableDfg) && (kind === 'function' || kind === 'method')) {
            const table = flowTableFor(file);
            const fnNode = table ? functionOfName(node, table) : null;
            if (table && fnNode) {
              const flow = buildFlow(fnNode, table, { cfg: enableCfg, dfg: enableDfg }, undefined, flowBudget);
              if (flow.skipped) this.flowSkipped[flow.skipped] = (this.flowSkipped[flow.skipped] ?? 0) + 1;
              cflogram = flow.cfg;
              dflogram = flow.dfg;
            }
          }

          // Find definition node for endLine
          let defNodeForLine = node.parent;
          while (defNodeForLine && !isDefinitionNode(defNodeForLine.type)) {
            defNodeForLine = defNodeForLine.parent;
          }
          // Fallback to name node if no definition found (e.g. variable declarator might be tricky)
          if (!defNodeForLine) defNodeForLine = node;

          // Extract function call references for functions/methods
          let references: string[] | undefined;
          if (kind === 'function' || kind === 'method') {
            references = this.extractReferences(defNodeForLine, calls);
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
      Logger.warn(`Query error in ${terminalSafe(file)}: ${e}`);
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
    const fn = signatureNode(nameNode);
    if (!fn) return '()';

    // `x => x` carries a bare `parameter` field instead of a list.
    const params = fn.childForFieldName('parameters');
    const single = params ? null : fn.childForFieldName('parameter');
    let sig = params ? params.text : single ? `(${single.text})` : '()';

    // Python: `-> T`; Go: `result` (bare type or tuple); TS: text already has the colon.
    const returnType = fn.childForFieldName('return_type') ?? fn.childForFieldName('result');
    if (returnType) {
      sig += fn.type === 'function_definition' ? ' -> ' + returnType.text : ' ' + returnType.text;
    }
    return sig;
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

  private extractReferences(defNode: Parser.SyntaxNode, calls?: CallContext): string[] {
    const references = new Set<string>();
    if (!calls) return [];

    // Iterative traversal with stack to avoid stack overflow
    const stack: Parser.SyntaxNode[] = [defNode];

    while (stack.length > 0) {
      const node = stack.pop()!;

      const name = calledName(node, calls);
      if (name) references.add(name);

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

  /** `@import.source` / `@import.statement` captures (languages outside the imports contract). */
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

          imports.push({ file, source, text: stmt.text });
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
      Logger.warn(`Import query error in ${terminalSafe(file)}: ${e}`);
    }

    return imports;
  }
}

/**
 * Map entries for contract records. `reference` records (Rust path roots,
 * PHP FQNs in code) are usages, not import statements: left out.
 */
function legacyImports(records: readonly ImportRecord[], file: string): Import[] {
  const out: Import[] = [];
  for (const r of records) {
    if (r.kind === 'reference') continue;
    const imp: Import = { file, source: r.module, text: r.evidence };
    if (r.alias !== undefined) imp.alias = r.alias;
    imp.line = r.line - 1;
    imp.kind = r.kind;
    out.push(imp);
  }
  return out;
}

// Definition nodes whose type names say neither "definition" nor "declaration".
const NAMED_DEFINITIONS = new Set(['function_item', 'method', 'singleton_method']); // rust, ruby

// Function-like nodes that carry parameters, across the supported grammars.
const SIGNATURE_NODES = new Set([
  'function_declaration', 'generator_function_declaration', 'method_definition',
  'arrow_function', 'function_expression', 'generator_function',
  'function_signature', 'method_signature',
  'function_definition', // python, c-family
  'method_declaration',  // go, java
]);

/** The function node a definition name belongs to, or null. Never an enclosing function. */
function signatureNode(nameNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let node = nameNode.parent;
  // `const f = (a) => ...`: the function is the declarator's value, not an ancestor.
  if (node?.type === 'variable_declarator') {
    const value = node.childForFieldName('value');
    return value && SIGNATURE_NODES.has(value.type) ? value : null;
  }
  return node && SIGNATURE_NODES.has(node.type) ? node : null;
}

function isDefinitionNode(type: string): boolean {
  return type.includes('definition') || type.includes('declaration') || NAMED_DEFINITIONS.has(type);
}

function step(node: Parser.SyntaxNode, path: string): Parser.SyntaxNode | null {
  if (path === '#first') return node.firstNamedChild;
  if (path === '#last') return node.lastNamedChild;
  return node.childForFieldName(path);
}

interface CallContext {
  shape: CallShape;
  /** Names the file's imports bind (receivers that are packages/modules, not values). */
  importNames: Set<string>;
  /** Receiver-chain roots that are builtins in this file (static set + stdlib imports). */
  builtinNames: Set<string>;
  /** Names imports bind to external modules: a plain call on one records nothing. */
  externalNames: Set<string>;
  /** Local name -> exported name, for aliased imports of repo code (`helper as h`). */
  renames: Map<string, string>;
}

function callContext(imports: Import[], shape: CallShape, root: Parser.SyntaxNode): CallContext {
  const importNames = new Set<string>();
  const builtinNames = new Set(shape.builtins?.names ?? []);
  const externalNames = new Set<string>();
  const renames = new Map<string, string>();
  const userImports = new Set<string>();
  for (const imp of imports) {
    if (imp.alias === '_' || imp.alias === '.') continue;
    // Only statement imports bind a module name (`__import__('x')`,
    // `require('x')` bind nothing by themselves). Aliases count only where
    // the shape maps imports to names; elsewhere bindings come from the AST.
    if (imp.kind !== undefined && imp.kind !== 'static') continue;
    if (!shape.importName) continue;
    const name = imp.alias || shape.importName(imp.source);
    if (!name) continue;
    importNames.add(name);
    if (shape.builtins?.imports?.(imp.source)) builtinNames.add(name);
    else userImports.add(name);
  }
  for (const b of shape.bindings?.(root) ?? []) {
    if (b.external) {
      builtinNames.add(b.name);
      externalNames.add(b.name);
      continue;
    }
    userImports.add(b.name);
    if (b.module) importNames.add(b.name);
    if (b.imported) renames.set(b.name, b.imported);
  }
  // A name a user import binds is never a builtin, even if a stdlib import shares it.
  for (const name of userImports) { builtinNames.delete(name); externalNames.delete(name); }
  return { shape, importNames, builtinNames, externalNames, renames };
}

/** Start of a receiver / scope chain: `JSON` in `JSON.x`, `std` in `::std::fs`. */
function chainRoot(node: Parser.SyntaxNode, shape: CallShape): Parser.SyntaxNode {
  let cur = node;
  for (let depth = 0; depth < 16; depth++) {
    const path = shape.receivers[cur.type] ?? shape.scopes?.[cur.type];
    if (!path) break;
    // Global-scope forms (`::std`, `::Kernel`) have no qualifier, only the name.
    const next = step(cur, path) ?? (cur.namedChildCount === 1 ? cur.firstNamedChild : null);
    if (!next) break;
    cur = next;
  }
  return cur;
}

function isBuiltin(qualifier: Parser.SyntaxNode, { shape, builtinNames }: CallContext): boolean {
  if (shape.builtins?.qualifier?.test(qualifier.text)) return true;
  const root = chainRoot(qualifier, shape);
  return root.namedChildCount === 0 && builtinNames.has(root.text);
}

/** Reference recorded for `node` when it is a call in this grammar (forms: see CallShape). */
function calledName(node: Parser.SyntaxNode, calls: CallContext): string | undefined {
  const { shape, importNames, externalNames, renames } = calls;
  const calleePath = shape.calls[node.type];
  if (!calleePath) return undefined;
  // Receiver of the member access closest to the call, if the callee is one.
  let receiver: Parser.SyntaxNode | null | undefined;
  // Qualifier of the scoped name closest to the call (`std::fs` in `std::fs::read`).
  let qualifier: Parser.SyntaxNode | undefined;
  const noteReceiver = (n: Parser.SyntaxNode) => {
    const path = shape.receivers[n.type];
    if (path && receiver === undefined) receiver = step(n, path);
    const scope = shape.scopes?.[n.type];
    if (scope && !qualifier) qualifier = step(n, scope) ?? undefined;
  };
  noteReceiver(node);
  let cur = step(node, calleePath);
  // Bounded: wrappers nest a few levels at most (a::b::c, generic member access).
  for (let depth = 0; cur && depth < 16; depth++) {
    if (shape.leaves.includes(cur.type)) {
      const name = cur.text;
      if ((receiver && isBuiltin(receiver, calls)) || (qualifier && isBuiltin(qualifier, calls))) return undefined;
      if (!receiver && !qualifier) {
        if (externalNames.has(name)) return undefined;
        return renames.get(name) ?? name;
      }
      if (!receiver) return name;
      if (receiver.type === 'identifier' && importNames.has(receiver.text)) {
        return shape.qualifyImports ? `${receiver.text}.${name}` : name;
      }
      return `.${name}`;
    }
    noteReceiver(cur);
    const next = shape.steps[cur.type];
    if (!next) return undefined;
    cur = step(cur, next);
  }
  return undefined;
}
