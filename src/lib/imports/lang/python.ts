/**
 * Imports for Python.
 *
 * Forms: `import` (one record per imported module: `import a.b as c, d` ->
 * two records, range = the clause, evidence = the statement) and `from`
 * (one record per statement with `names`; `*` -> wildcard; relative ->
 * `relative: {level, module?}`; `from __future__ import x` included).
 *
 * Relative imports stay `normalized: null` here: resolving them needs the
 * file's package (`__init__.py` chain), which is resolution, not syntax.
 *
 * Call forms (kind `dynamic`), literal name only (literalArg), at any depth:
 * `__import__('m'[, ..., level=N])` (form `__import__`) while `__import__`
 * is the builtin (any binding of the name in the file shadows it
 * file-wide), and `import_module('m'[, package])` (form `import_module`)
 * through a binding made by an import in the same file: `import importlib`
 * / `import importlib.x` (`importlib.import_module`), `import importlib as
 * il` (`il.import_module`), `from importlib import import_module [as f]`.
 * Bindings are file-wide, not scope-aware. Relative names:
 * - literal `package`: `normalized` per importlib's resolve_name, no
 *   `relative` (the anchor is not the file's package);
 * - `package=__package__`: `relative` as for `from . import`;
 * - `package=__name__`: anchored at the module itself, rewritten to the
 *   package-relative form (`.a` in `pkg/mod.py` = `{level: 1, module:
 *   "mod.a"}`; in `__init__.py` `__name__` is the package);
 * - `__import__(..., level=N)`, N > 0: `relative` `{level: N, module}`.
 * `normalized` stays null for the `relative` cases (resolution). Calls that
 * yield no record are returned as `deferred` by scanPython for the
 * unsupported pass.
 */

import type Parser from 'tree-sitter';
import * as path from 'path';
import type { ImportName, ImportRecord, RelativeRef } from '../types';
import { name, record, traverse, type ExtractContext } from '../record';

const STATEMENTS = new Set(['import_statement', 'import_from_statement', 'future_import_statement']);
const SCAN = new Set([...STATEMENTS, 'call', 'identifier']);

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

/** A call site that yields no record; the unsupported pass reports these. */
export interface DeferredCall {
  node: Parser.SyntaxNode;
  construct: 'dynamic-import';
  reason: 'non-literal' | 'shadowed' | 'relative-without-package';
}

export interface PythonScan {
  imports: ImportRecord[];
  deferred: DeferredCall[];
}

/**
 * Literal value of a call argument: a str literal without interpolation
 * (f-string allowed when it has none), or a concatenated_string of such;
 * undefined otherwise. Bytes are not str; escape sequences are not decoded,
 * so a non-raw string with one is not treated as literal.
 */
export function literalArg(n: Parser.SyntaxNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === 'concatenated_string') {
    const parts = n.namedChildren.map(literalArg);
    return parts.every(p => p !== undefined) ? parts.join('') : undefined;
  }
  if (n.type !== 'string') return undefined;
  const prefix = (n.namedChildren.find(c => c.type === 'string_start')?.text ?? '').replace(/['"]/g, '').toLowerCase();
  if (prefix.includes('b')) return undefined;
  let out = '';
  for (const c of n.namedChildren) {
    if (c.type === 'string_start' || c.type === 'string_end') continue;
    if (c.type !== 'string_content' || c.namedChildCount > 0) return undefined;
    out += c.text;
  }
  return out;
}

/**
 * importlib's resolve_name: `.b` from `app.pkg` -> `app.pkg.b`; null when
 * the name climbs above the package's top level.
 */
export function resolveName(name: string, pkg: string): string | null {
  const level = name.length - name.replace(/^\.+/, '').length;
  const rest = name.slice(level);
  const bits = pkg.split('.');
  if (bits.length < level) return null;
  const base = bits.slice(0, bits.length - (level - 1)).join('.');
  return rest ? `${base}.${rest}` : base;
}

/** Parents where any identifier child binds; others by field below. */
const CHILD_BINDERS = new Set(['parameters', 'lambda_parameters', 'typed_parameter', 'pattern_list', 'tuple_pattern', 'list_pattern', 'as_pattern_target', 'global_statement', 'nonlocal_statement']);
const FIELD_BINDERS: Record<string, string> = {
  function_definition: 'name',
  class_definition: 'name',
  assignment: 'left',
  augmented_assignment: 'left',
  default_parameter: 'name',
  typed_default_parameter: 'name',
  aliased_import: 'alias',
  for_statement: 'left',
  for_in_clause: 'left',
  named_expression: 'name',
};

/**
 * Ancestor state carried down the walk (no `.parent` climbs: each access is
 * O(depth) in node-tree-sitter, which made the pass quadratic on deep input).
 */
interface Frame {
  type: string;
  /** Field of this node in its parent. */
  field: string | null;
  /** Named children entered so far. */
  named: number;
  /** Parent's type. */
  parentType: string | undefined;
  /** dotted_name: an `__import__` identifier child (binds when it is the only segment). */
  dunder?: boolean;
}

/** Whether an identifier binds its name, given its parent frame and its field there. */
function binds(parent: Frame | undefined, field: string | null): boolean {
  if (!parent) return false;
  if (CHILD_BINDERS.has(parent.type)) return true;
  if (FIELD_BINDERS[parent.type]) return field === FIELD_BINDERS[parent.type];
  return false;
}

/** `from m import __import__` / `import __import__`: a one-segment dotted_name binds (decided on leave). */
const dottedBinds = (f: Frame) =>
  f.named === 1 && (f.parentType === 'import_statement' || (f.parentType === 'import_from_statement' && f.field !== 'module_name'));

/** Names bound to importlib (module) and to importlib.import_module (function) by imports. */
interface ImportlibBindings { modules: Set<string>; functions: Set<string> }

function collectImportlib(stmt: Parser.SyntaxNode, b: ImportlibBindings): void {
  if (stmt.type === 'import_statement') {
    for (const c of stmt.childrenForFieldName('name')) {
      if (c.type === 'aliased_import') {
        const n = c.childForFieldName('name');
        const a = c.childForFieldName('alias');
        if (n && a && dotted(n) === 'importlib') b.modules.add(a.text);
      } else if (dotted(c).split('.')[0] === 'importlib') {
        b.modules.add('importlib');
      }
    }
  } else if (stmt.type === 'import_from_statement') {
    const mod = stmt.childForFieldName('module_name');
    if (!mod || dotted(mod) !== 'importlib') return;
    for (const n of importedNames(stmt)) if (n.name === 'import_module') b.functions.add(n.alias ?? n.name);
  }
}

interface CallArgs { positional: Parser.SyntaxNode[]; keyword: Map<string, Parser.SyntaxNode>; splat: boolean }

function callArgs(call: Parser.SyntaxNode): CallArgs {
  const out: CallArgs = { positional: [], keyword: new Map(), splat: false };
  for (const a of call.childForFieldName('arguments')?.namedChildren ?? []) {
    if (a.type === 'comment') continue;
    if (a.type === 'list_splat' || a.type === 'dictionary_splat') out.splat = true;
    else if (a.type === 'keyword_argument') {
      const k = a.childForFieldName('name');
      const v = a.childForFieldName('value');
      if (k && v) out.keyword.set(k.text, v);
    } else out.positional.push(a);
  }
  return out;
}

const arg = (a: CallArgs, index: number, keyword: string) => a.positional[index] ?? a.keyword.get(keyword);

function absoluteCall(call: Parser.SyntaxNode, form: string, module: string): ImportRecord {
  return record({ at: call, kind: 'dynamic', form, ...absolute(module) });
}

function relativeCall(call: Parser.SyntaxNode, form: string, module: string, relative: RelativeRef): ImportRecord {
  return record({ at: call, kind: 'dynamic', form, module, normalized: null, locality: 'unknown', relative });
}

const relRef = (level: number, module: string): RelativeRef => (module ? { level, module } : { level });

type CallOutcome = ImportRecord | DeferredCall['reason'];

function dunderImport(call: Parser.SyntaxNode): CallOutcome {
  const a = callArgs(call);
  if (a.splat) return 'non-literal';
  const name = literalArg(arg(a, 0, 'name'));
  if (name === undefined) return 'non-literal';
  const levelNode = arg(a, 4, 'level');
  const level = levelNode === undefined ? 0 : levelNode.type === 'integer' && /^\d+$/.test(levelNode.text) ? Number(levelNode.text) : NaN;
  if (Number.isNaN(level)) return 'non-literal';
  return level === 0 ? absoluteCall(call, '__import__', name) : relativeCall(call, '__import__', name, relRef(level, name));
}

function importModule(call: Parser.SyntaxNode, filePath: string): CallOutcome {
  const a = callArgs(call);
  if (a.splat) return 'non-literal';
  const name = literalArg(arg(a, 0, 'name'));
  if (name === undefined) return 'non-literal';
  if (!name.startsWith('.')) return absoluteCall(call, 'import_module', name);
  const pkg = arg(a, 1, 'package');
  if (!pkg || pkg.type === 'none') return 'relative-without-package';
  const level = name.length - name.replace(/^\.+/, '').length;
  const rest = name.slice(level);
  if (pkg.type === 'identifier' && pkg.text === '__package__') {
    return relativeCall(call, 'import_module', name, relRef(level, rest));
  }
  if (pkg.type === 'identifier' && pkg.text === '__name__') {
    const stem = path.posix.basename(filePath, '.py');
    if (stem === '__init__') return relativeCall(call, 'import_module', name, relRef(level, rest));
    // __name__ = <package>.<stem>: one level less, or the stem prepended.
    const rel = level === 1 ? relRef(1, rest ? `${stem}.${rest}` : stem) : relRef(level - 1, rest);
    return relativeCall(call, 'import_module', name, rel);
  }
  const anchor = literalArg(pkg);
  if (anchor === undefined) return 'non-literal';
  if (anchor === '') return 'relative-without-package';
  const normalized = resolveName(name, anchor);
  return record({
    at: call, kind: 'dynamic', form: 'import_module', module: name, normalized,
    package: normalized ? normalized.split('.')[0] : undefined, locality: 'unknown',
  });
}

/** One walk: statements, call sites, bindings of `__import__` and importlib. */
export function scanPython(root: Parser.SyntaxNode, ctx: ExtractContext): PythonScan {
  const imports: ImportRecord[] = [];
  const deferred: DeferredCall[] = [];
  const calls: Parser.SyntaxNode[] = [];
  const importlib: ImportlibBindings = { modules: new Set(), functions: new Set() };
  let shadowed = false;
  const stack: Frame[] = [];
  traverse(root, c => {
    const parent = stack[stack.length - 1];
    const type = c.nodeType;
    const isNamed = c.nodeIsNamed;
    if (parent && isNamed) parent.named++;
    const field = parent ? c.currentFieldName ?? null : null;
    stack.push({ type, field, named: 0, parentType: parent?.type });
    if (!isNamed || !SCAN.has(type)) return;
    if (type === 'identifier') {
      // Byte-length test first: skips materializing the text of most identifiers.
      if (shadowed || c.endIndex - c.startIndex !== 10 || c.nodeText !== '__import__') return;
      if (parent?.type === 'dotted_name') parent.dunder = true;
      else if (binds(parent, field)) shadowed = true;
      return;
    }
    const n = c.currentNode;
    if (type === 'call') {
      calls.push(n);
    } else {
      collectImportlib(n, importlib);
      if (type === 'import_statement') imports.push(...importStatement(n));
      else {
        const r = fromStatement(n);
        if (r) imports.push(r);
      }
    }
  }, () => {
    const f = stack.pop()!;
    if (f.dunder && dottedBinds(f)) shadowed = true;
  });
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    let outcome: CallOutcome | undefined;
    if (fn?.type === 'identifier' && fn.text === '__import__') {
      outcome = shadowed ? 'shadowed' : dunderImport(call);
    } else if (fn?.type === 'identifier' && importlib.functions.has(fn.text)) {
      outcome = importModule(call, ctx.path);
    } else if (fn?.type === 'attribute') {
      const obj = fn.childForFieldName('object');
      const attr = fn.childForFieldName('attribute');
      if (obj?.type === 'identifier' && importlib.modules.has(obj.text) && attr?.text === 'import_module') {
        outcome = importModule(call, ctx.path);
      }
    }
    if (outcome === undefined) continue;
    if (typeof outcome === 'string') deferred.push({ node: call, construct: 'dynamic-import', reason: outcome });
    else imports.push(outcome);
  }
  return { imports, deferred };
}

export function extractPython(root: Parser.SyntaxNode, ctx: ExtractContext): ImportRecord[] {
  return scanPython(root, ctx).imports;
}
