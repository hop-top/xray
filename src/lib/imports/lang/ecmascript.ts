/**
 * Static imports for TypeScript / TSX / JavaScript (one walker: the JS
 * grammar never produces the TS-only nodes).
 *
 * Forms: `import` (default, named, namespace, side-effect; `import type`
 * -> typeOnly), `export-from` (`export {x} from`, `export * from`,
 * `export * as ns from`, `export type {...} from`), `import-equals`
 * (`import x = require('m')`). Import attributes (`with {...}`) ignored.
 * Call forms (`require()`, `import()`) are not static and not emitted here.
 *
 * Bindings: default import -> name `default` aliased to the local; namespace
 * import / `export * as ns` / import-equals -> `alias`; named -> `names`.
 */

import type Parser from 'tree-sitter';
import type { ImportName, ImportRecord } from '../types';
import { name, record, walk, type ExtractContext } from '../record';

const STATEMENTS = new Set(['import_statement', 'export_statement']);

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

export function extractEcmaScript(root: Parser.SyntaxNode, _ctx: ExtractContext): ImportRecord[] {
  const out: ImportRecord[] = [];
  for (const stmt of walk(root, STATEMENTS)) {
    const r = stmt.type === 'import_statement' ? importStatement(stmt) : exportFrom(stmt);
    if (r) out.push(r);
  }
  return out;
}
