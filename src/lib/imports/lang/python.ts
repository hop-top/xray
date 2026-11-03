/**
 * Static imports for Python.
 *
 * Forms: `import` (one record per imported module: `import a.b as c, d` ->
 * two records, range = the clause, evidence = the statement) and `from`
 * (one record per statement with `names`; `*` -> wildcard; relative ->
 * `relative: {level, module?}`; `from __future__ import x` included).
 *
 * Relative imports stay `normalized: null` here: resolving them needs the
 * file's package (`__init__.py` chain), which is resolution, not syntax.
 * Call forms (`__import__`, `importlib.import_module`) are not static.
 */

import type Parser from 'tree-sitter';
import type { ImportName, ImportRecord, RelativeRef } from '../types';
import { name, record, walk, type ExtractContext } from '../record';

const STATEMENTS = new Set(['import_statement', 'import_from_statement', 'future_import_statement']);

/** `a . b` -> `a.b` (dotted_name identifiers joined). */
function dotted(n: Parser.SyntaxNode): string {
  return n.type === 'dotted_name' ? n.namedChildren.map(c => c.text).join('.') : n.text;
}

function absolute(module: string): Pick<ImportRecord, 'module' | 'normalized' | 'package' | 'locality'> {
  return { module, normalized: module, package: module.split('.')[0], locality: 'unknown' };
}

function importStatement(stmt: Parser.SyntaxNode): ImportRecord[] {
  return stmt.childrenForFieldName('name').map(clause => {
    const aliased = clause.type === 'aliased_import';
    const target = aliased ? clause.childForFieldName('name') : clause;
    const alias = aliased ? clause.childForFieldName('alias')?.text : undefined;
    return record({ at: clause, evidenceOf: stmt, kind: 'static', form: 'import', ...absolute(dotted(target ?? clause)), alias });
  });
}

function importedNames(stmt: Parser.SyntaxNode): ImportName[] {
  return stmt.childrenForFieldName('name').map(c => {
    if (c.type !== 'aliased_import') return name(dotted(c));
    const n = c.childForFieldName('name');
    return name(n ? dotted(n) : c.text, c.childForFieldName('alias')?.text);
  });
}

function fromStatement(stmt: Parser.SyntaxNode): ImportRecord | undefined {
  const names = importedNames(stmt);
  const wildcard = stmt.namedChildren.some(c => c.type === 'wildcard_import');
  if (stmt.type === 'future_import_statement') {
    return record({ at: stmt, kind: 'static', form: 'from', ...absolute('__future__'), names });
  }
  const mod = stmt.childForFieldName('module_name');
  if (!mod) return undefined;
  if (mod.type !== 'relative_import') {
    return record({ at: stmt, kind: 'static', form: 'from', ...absolute(dotted(mod)), names, wildcard });
  }
  const prefix = mod.namedChildren.find(c => c.type === 'import_prefix');
  const level = prefix ? prefix.text.replace(/[^.]/g, '').length : 0;
  const sub = mod.namedChildren.find(c => c.type === 'dotted_name');
  const relative: RelativeRef = sub ? { level, module: dotted(sub) } : { level };
  return record({
    at: stmt,
    kind: 'static',
    form: 'from',
    module: '.'.repeat(level) + (sub ? dotted(sub) : ''),
    normalized: null,
    locality: 'unknown',
    relative,
    names,
    wildcard,
  });
}

export function extractPython(root: Parser.SyntaxNode, _ctx: ExtractContext): ImportRecord[] {
  const out: ImportRecord[] = [];
  for (const stmt of walk(root, STATEMENTS)) {
    if (stmt.type === 'import_statement') out.push(...importStatement(stmt));
    else {
      const r = fromStatement(stmt);
      if (r) out.push(r);
    }
  }
  return out;
}
