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
 */

import type Parser from 'tree-sitter';
import type { ImportName, ImportRecord } from '../types';
import { name, record, walk, type ExtractContext } from '../record';

const STATEMENTS = new Set(['import_statement', 'export_statement']);
const SCAN = new Set([...STATEMENTS, 'call_expression', 'identifier', 'shorthand_property_identifier_pattern']);

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

const same = (a: Parser.SyntaxNode | null | undefined, b: Parser.SyntaxNode) =>
  !!a && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type;

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

function insideAmbient(n: Parser.SyntaxNode): boolean {
  for (let p = n.parent; p; p = p.parent) if (p.type === 'ambient_declaration') return true;
  return false;
}

/** Whether this identifier (or shorthand pattern) occurrence binds its name. */
function binds(id: Parser.SyntaxNode): boolean {
  if (id.type === 'shorthand_property_identifier_pattern') return true;
  const p = id.parent;
  if (!p) return false;
  let hit: boolean;
  if (NAME_BINDERS.has(p.type)) hit = same(p.childForFieldName('name'), id);
  else if (CHILD_BINDERS.has(p.type)) hit = true;
  else if (p.type === 'import_specifier') hit = same(p.childForFieldName('alias') ?? p.childForFieldName('name'), id);
  else if (FIELD_BINDERS[p.type]) hit = same(p.childForFieldName(FIELD_BINDERS[p.type]), id);
  else hit = false;
  return hit && !insideAmbient(id);
}

/** Type nodes: an `import()` under one is a TS type import. */
const TYPE_CONTEXTS = new Set([
  'type_annotation', 'type_alias_declaration', 'type_query', 'type_arguments', 'type_parameters',
  'interface_declaration', 'implements_clause', 'extends_type_clause', 'opting_type_annotation',
  'omitting_type_annotation', 'asserts_annotation', 'type_predicate_annotation', 'constraint', 'default_type',
]);

function inTypePosition(call: Parser.SyntaxNode): boolean {
  let child = call;
  for (let p = call.parent; p; child = p, p = p.parent) {
    if (TYPE_CONTEXTS.has(p.type)) return true;
    // `x as T` / `x satisfies T`: the type is the second named child.
    if ((p.type === 'as_expression' || p.type === 'satisfies_expression') && !same(p.namedChild(0), child)) return true;
    if (p.type.endsWith('_statement') || p.type.endsWith('_declaration') || p.type === 'program') return false;
  }
  return false;
}

const firstArgument = (call: Parser.SyntaxNode) => call.childForFieldName('arguments')?.namedChildren.find(c => c.type !== 'comment');

/** One walk: statements, call sites, and bindings of `require`. */
export function scanEcmaScript(root: Parser.SyntaxNode): EcmaScriptScan {
  const imports: ImportRecord[] = [];
  const deferred: DeferredCall[] = [];
  const requires: Parser.SyntaxNode[] = [];
  let shadowed = false;
  for (const n of walk(root, SCAN)) {
    if (n.type === 'identifier' || n.type === 'shorthand_property_identifier_pattern') {
      // Byte-length test first: skips materializing the text of most identifiers.
      if (!shadowed && n.endIndex - n.startIndex === 7 && n.text === 'require' && binds(n)) shadowed = true;
      continue;
    }
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'import') {
        const arg = firstArgument(n);
        const spec = literalArg(arg);
        if (spec === undefined) {
          if (arg && !inTypePosition(n)) deferred.push({ node: n, construct: 'dynamic-import', reason: 'non-literal' });
        } else if (inTypePosition(n)) {
          imports.push(record({ at: n, kind: 'static', form: 'import-type', ...moduleFields(spec), typeOnly: true }));
        } else {
          imports.push(record({ at: n, kind: 'dynamic', form: 'import()', ...moduleFields(spec) }));
        }
      } else if (fn?.type === 'identifier' && fn.text === 'require' && firstArgument(n)) {
        requires.push(n);
      }
      continue;
    }
    const r = n.type === 'import_statement' ? importStatement(n) : exportFrom(n);
    if (r) imports.push(r);
  }
  for (const n of requires) {
    const spec = literalArg(firstArgument(n));
    if (shadowed) deferred.push({ node: n, construct: 'dynamic-require', reason: 'shadowed' });
    else if (spec === undefined) deferred.push({ node: n, construct: 'dynamic-require', reason: 'non-literal' });
    else imports.push(record({ at: n, kind: 'require', form: 'require', ...moduleFields(spec) }));
  }
  deferred.sort((a, b) => a.node.startIndex - b.node.startIndex);
  return { imports, deferred };
}

export function extractEcmaScript(root: Parser.SyntaxNode, _ctx: ExtractContext): ImportRecord[] {
  return scanEcmaScript(root).imports;
}
