/**
 * Imports for TypeScript / TSX / JavaScript (one walker: the JS grammar
 * never produces the TS-only nodes).
 *
 * Forms: `import` (default, named, namespace, side-effect; `import type`
 * -> typeOnly), `export-from` (`export {x} from`, `export * from`,
 * `export * as ns from`, `export type {...} from`), `import-equals`
 * (`import x = require('m')`). Import attributes (`with {...}`) ignored.
 *
 * Bindings: default import -> name `default` aliased to the local; namespace
 * import / `export * as ns` / import-equals -> `alias`; named -> `names`.
 *
 * Call forms, literal argument only (literalArg), at any depth:
 * `require('m')` (kind `require`), `import('m')` (kind `dynamic`, form
 * `import()`), and TS type-position `import('m').T` (kind `static`, form
 * `import-type`, typeOnly: erased at compile time, no runtime load). A
 * `require` call counts only while `require` is the unbound global: any
 * binding of the name anywhere in the file (declaration, parameter,
 * destructuring, import, assignment; TS `declare` excluded) shadows it
 * file-wide. Calls that yield no record (non-literal argument, shadowed
 * `require`) are returned as `deferred` by scanEcmaScript for the
 * unsupported pass.
 *
 * Unsupported: deferred calls (dynamic-require, dynamic-import, detail =
 * the reason); `createRequire(...)` / `x.createRequire(...)`
 * (create-require: a second `require` the binding rules cannot follow);
 * `eval(...)`, `new Function(...)`, `Function(...)` (eval). Type-position
 * `import()` with a non-literal argument is not reported (no runtime load).
 */

import type Parser from 'tree-sitter';
import type { ImportName, ImportRecord, UnsupportedRecord } from '../types';
import { name, record, traverse, type ExtractContext } from '../record';
import { unsupportedAt } from '../unsupported';

const STATEMENTS = new Set(['import_statement', 'export_statement']);
const SCAN = new Set([...STATEMENTS, 'call_expression', 'new_expression', 'identifier', 'shorthand_property_identifier_pattern']);

/** Unquoted string literal (or identifier) text. */
function unquote(n: Parser.SyntaxNode): string {
  if (n.type !== 'string') return n.text;
  return n.namedChildren.map(c => c.text).join('');
}

const hasToken = (n: Parser.SyntaxNode, tok: string) => n.children.some(c => !c.isNamed && c.type === tok);

/**
 * typescript 0.23.2 predates `export type * [as ns] from` (TS 5.0): it wraps
 * the lone `type` keyword in an ERROR child and parses the rest normally.
 */
const typeKeywordInError = (stmt: Parser.SyntaxNode) =>
  stmt.namedChildren.some(c => c.type === 'ERROR' && c.text === 'type');

/** npm package of a bare specifier: `@scope/name` or `name`; undefined for relative, absolute, `#` and URL-like. */
export function specifierPackage(spec: string): string | undefined {
  if (spec === '' || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return undefined;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec)) return undefined;
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.length >= 2 && parts[0].length > 1 && parts[1] ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0];
}

function moduleFields(spec: string): Pick<ImportRecord, 'module' | 'normalized' | 'package' | 'locality'> {
  if (spec.startsWith('node:') && spec.length > 5) {
    const normalized = spec.slice(5);
    return { module: spec, normalized, package: normalized.split('/')[0], locality: 'stdlib' };
  }
  return { module: spec, normalized: spec, package: specifierPackage(spec), locality: 'unknown' };
}

function specifiers(list: Parser.SyntaxNode, type: string): ImportName[] {
  return list.namedChildren
    .filter(s => s.type === type)
    .map(s => {
      const n = s.childForFieldName('name');
      const a = s.childForFieldName('alias');
      return name(n ? unquote(n) : s.text, a ? unquote(a) : undefined);
    });
}

function importStatement(stmt: Parser.SyntaxNode): ImportRecord | undefined {
  const typeOnly = hasToken(stmt, 'type');
  const req = stmt.namedChildren.find(c => c.type === 'import_require_clause');
  if (req) {
    const src = req.childForFieldName('source');
    if (!src) return undefined;
    const alias = req.namedChildren.find(c => c.type === 'identifier');
    return record({ at: stmt, kind: 'static', form: 'import-equals', ...moduleFields(unquote(src)), alias: alias?.text, typeOnly });
  }
  const src = stmt.childForFieldName('source');
  if (!src) return undefined;
  const names: ImportName[] = [];
  let alias: string | undefined;
  const clause = stmt.namedChildren.find(c => c.type === 'import_clause');
  for (const c of clause?.namedChildren ?? []) {
    if (c.type === 'identifier') names.push(name('default', c.text));
    else if (c.type === 'namespace_import') alias = c.namedChildren.find(x => x.type === 'identifier')?.text;
    else if (c.type === 'named_imports') names.push(...specifiers(c, 'import_specifier'));
  }
  return record({ at: stmt, kind: 'static', form: 'import', ...moduleFields(unquote(src)), alias, names, typeOnly });
}

function exportFrom(stmt: Parser.SyntaxNode): ImportRecord | undefined {
  const src = stmt.childForFieldName('source');
  if (!src) return undefined;
  const ns = stmt.namedChildren.find(c => c.type === 'namespace_export');
  const clause = stmt.namedChildren.find(c => c.type === 'export_clause');
  const nsName = ns?.namedChildren[0];
  return record({
    at: stmt,
    kind: 'static',
    form: 'export-from',
    ...moduleFields(unquote(src)),
    alias: nsName ? unquote(nsName) : undefined,
    names: clause ? specifiers(clause, 'export_specifier') : undefined,
    wildcard: !ns && !clause && hasToken(stmt, '*'),
    typeOnly: hasToken(stmt, 'type') || typeKeywordInError(stmt),
  });
}

/** A call site that yields no record; the unsupported pass reports these. */
export interface DeferredCall {
  node: Parser.SyntaxNode;
  construct: 'dynamic-require' | 'dynamic-import';
  reason: 'non-literal' | 'shadowed';
}

export interface EcmaScriptScan {
  imports: ImportRecord[];
  deferred: DeferredCall[];
  /** Other constructs (create-require, eval), document order. */
  unsupported: UnsupportedRecord[];
}

const DEFERRED_DETAIL: Record<DeferredCall['construct'], Record<DeferredCall['reason'], string>> = {
  'dynamic-require': {
    'non-literal': 'require with a non-literal argument',
    shadowed: 'require is rebound in this file',
  },
  'dynamic-import': {
    'non-literal': 'import() with a non-literal argument',
    shadowed: 'import() is not resolved',
  },
};

/** Unsupported record for a deferred call. */
export function deferredRecord(d: DeferredCall): UnsupportedRecord {
  return unsupportedAt(d.node, d.construct, DEFERRED_DETAIL[d.construct][d.reason]);
}

/** `eval(...)`, `Function(...)`, `createRequire(...)`, `x.createRequire(...)`. */
function callSite(n: Parser.SyntaxNode, fn: Parser.SyntaxNode | null): UnsupportedRecord | undefined {
  if (!fn) return undefined;
  if (fn.type === 'identifier') {
    if (fn.text === 'eval') return unsupportedAt(n, 'eval', 'eval of code');
    if (fn.text === 'Function') return unsupportedAt(n, 'eval', 'Function constructor compiles code');
    if (fn.text === 'createRequire') return unsupportedAt(n, 'create-require', 'createRequire makes a require the file does not bind');
  } else if (fn.type === 'member_expression' && fn.childForFieldName('property')?.text === 'createRequire') {
    return unsupportedAt(n, 'create-require', 'createRequire makes a require the file does not bind');
  }
  return undefined;
}

/**
 * Literal value of a call argument: a string or a template string without
 * substitutions; undefined otherwise. Escape sequences are not decoded, so
 * an argument with one is not treated as literal.
 */
export function literalArg(n: Parser.SyntaxNode | undefined): string | undefined {
  if (!n || (n.type !== 'string' && n.type !== 'template_string')) return undefined;
  const parts = n.namedChildren;
  if (parts.some(c => c.type !== 'string_fragment')) return undefined;
  return parts.map(c => c.text).join('');
}

/** Parents whose `name` field binds; other binding positions by field below. */
const NAME_BINDERS = new Set([
  'variable_declarator', 'function_declaration', 'function_expression', 'function',
  'generator_function_declaration', 'generator_function', 'class_declaration', 'class',
]);
const CHILD_BINDERS = new Set(['formal_parameters', 'array_pattern', 'rest_pattern', 'namespace_import', 'import_clause', 'import_require_clause']);
const FIELD_BINDERS: Record<string, string> = {
  assignment_expression: 'left',
  assignment_pattern: 'left',
  object_assignment_pattern: 'left',
  pair_pattern: 'value',
  arrow_function: 'parameter',
  required_parameter: 'pattern',
  optional_parameter: 'pattern',
  catch_clause: 'parameter',
};

/** Type nodes: an `import()` under one is a TS type import. */
const TYPE_CONTEXTS = new Set([
  'type_annotation', 'type_alias_declaration', 'type_query', 'type_arguments', 'type_parameters',
  'interface_declaration', 'implements_clause', 'extends_type_clause', 'opting_type_annotation',
  'omitting_type_annotation', 'asserts_annotation', 'type_predicate_annotation', 'constraint', 'default_type',
]);

/** Where the climb for a type position stops: statements, declarations, the program. */
const typeBoundary = (type: string) => type.endsWith('_statement') || type.endsWith('_declaration') || type === 'program';

/**
 * Ancestor state carried down the walk (no `.parent` climbs: each access is
 * O(depth) in node-tree-sitter, which made the pass quadratic on deep input).
 */
interface Frame {
  type: string;
  /** Named children entered so far. */
  named: number;
  /** Under an `ambient_declaration` (strict ancestor). */
  ambient: boolean;
  /**
   * Type position: the nearest ancestor that decides is a type context, or
   * the type side of `as` / `satisfies` (not their first named child); a
   * statement, declaration or the program decides "not a type".
   */
  typePos: boolean;
  /** import_specifier: a `require` in its `name` field, and whether an `alias` follows. */
  specifierName?: boolean;
  specifierAlias?: boolean;
}

/** Whether an identifier binds its name, given its parent frame and its field there. */
function binds(parent: Frame | undefined, field: string | null): boolean {
  if (!parent) return false;
  if (NAME_BINDERS.has(parent.type)) return field === 'name';
  if (CHILD_BINDERS.has(parent.type)) return true;
  if (FIELD_BINDERS[parent.type]) return field === FIELD_BINDERS[parent.type];
  return false;
}

const firstArgument = (call: Parser.SyntaxNode) => call.childForFieldName('arguments')?.namedChildren.find(c => c.type !== 'comment');

/** One walk: statements, call sites, and bindings of `require`. */
export function scanEcmaScript(root: Parser.SyntaxNode): EcmaScriptScan {
  const imports: ImportRecord[] = [];
  const deferred: DeferredCall[] = [];
  const unsupported: UnsupportedRecord[] = [];
  const requires: Parser.SyntaxNode[] = [];
  let shadowed = false;
  const stack: Frame[] = [];
  traverse(root, c => {
    const parent = stack[stack.length - 1];
    const type = c.nodeType;
    const isNamed = c.nodeIsNamed;
    const index = parent && isNamed ? parent.named++ : -1;
    let typePos = false;
    if (parent) {
      if (TYPE_CONTEXTS.has(parent.type)) typePos = true;
      // `x as T` / `x satisfies T`: the type is the second named child.
      else if ((parent.type === 'as_expression' || parent.type === 'satisfies_expression') && index !== 0) typePos = true;
      else if (!typeBoundary(parent.type)) typePos = parent.typePos;
    }
    const ambient = !!parent && (parent.ambient || parent.type === 'ambient_declaration');
    const frame: Frame = { type, named: 0, ambient, typePos };
    const field = parent ? c.currentFieldName ?? null : null;
    if (parent?.type === 'import_specifier' && field === 'alias') parent.specifierAlias = true;
    stack.push(frame);
    if (!isNamed || !SCAN.has(type)) return;
    if (type === 'identifier' || type === 'shorthand_property_identifier_pattern') {
      // Byte-length test first: skips materializing the text of most identifiers.
      if (shadowed || c.endIndex - c.startIndex !== 7 || c.nodeText !== 'require') return;
      // A shorthand pattern binds even in ambient context; other positions only outside it.
      if (type === 'shorthand_property_identifier_pattern') { shadowed = true; return; }
      if (ambient) return;
      // import_specifier: binds as the alias, or as the name when no alias follows (decided on leave).
      if (parent?.type === 'import_specifier') {
        if (field === 'alias') shadowed = true;
        else if (field === 'name') parent.specifierName = true;
      } else if (binds(parent, field)) shadowed = true;
      return;
    }
    const n = c.currentNode;
    if (type === 'new_expression') {
      const ctor = n.childForFieldName('constructor');
      if (ctor?.type === 'identifier' && ctor.text === 'Function') unsupported.push(unsupportedAt(n, 'eval', 'Function constructor compiles code'));
      return;
    }
    if (type === 'call_expression') {
      const fn = n.childForFieldName('function');
      const site = callSite(n, fn);
      if (site) unsupported.push(site);
      if (fn?.type === 'import') {
        const arg = firstArgument(n);
        const spec = literalArg(arg);
        if (spec === undefined) {
          if (arg && !typePos) deferred.push({ node: n, construct: 'dynamic-import', reason: 'non-literal' });
        } else if (typePos) {
          imports.push(record({ at: n, kind: 'static', form: 'import-type', ...moduleFields(spec), typeOnly: true }));
        } else {
          imports.push(record({ at: n, kind: 'dynamic', form: 'import()', ...moduleFields(spec) }));
        }
      } else if (fn?.type === 'identifier' && fn.text === 'require' && firstArgument(n)) {
        requires.push(n);
      }
      return;
    }
    const r = type === 'import_statement' ? importStatement(n) : exportFrom(n);
    if (r) imports.push(r);
  }, () => {
    const f = stack.pop()!;
    if (f.specifierName && !f.specifierAlias) shadowed = true;
  });
  for (const n of requires) {
    const spec = literalArg(firstArgument(n));
    if (shadowed) deferred.push({ node: n, construct: 'dynamic-require', reason: 'shadowed' });
    else if (spec === undefined) deferred.push({ node: n, construct: 'dynamic-require', reason: 'non-literal' });
    else imports.push(record({ at: n, kind: 'require', form: 'require', ...moduleFields(spec) }));
  }
  deferred.sort((a, b) => a.node.startIndex - b.node.startIndex);
  return { imports, deferred, unsupported };
}

export function extractEcmaScript(root: Parser.SyntaxNode, ctx: ExtractContext): ImportRecord[] {
  const scan = scanEcmaScript(root);
  if (ctx.unsupported) ctx.unsupported.push(...scan.deferred.map(deferredRecord), ...scan.unsupported);
  return scan.imports;
}
