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
 *
 * Unsupported: deferred calls (dynamic-import, detail = the reason); calls
 * into other importlib loaders through import bindings (`importlib.util.*`,
 * `importlib.machinery.*`, `importlib.__import__`, names imported from
 * them; not reload / invalidate_caches / resources / metadata / abc)
 * (dynamic-import); `exec(...)` (exec) and `eval(...)` (eval), any argument:
 * the string is code xray does not read; `sys.path` mutation (`insert`,
 * `append`, `extend`, assignment, augmented or slice assignment) and
 * `site.addsitedir(...)` (sys-path). Names are matched as written (`sys`,
 * `site`, `exec`, `eval`), not through aliases or rebindings.
 */

import type Parser from 'tree-sitter';
import * as path from 'path';
import type { ImportName, ImportRecord, RelativeRef, UnsupportedRecord } from '../types';
import { joinChildren, joinModule, MODULE_WINDOW, moduleText, name, record, traverse, type ExtractContext } from '../record';
import { unsupportedAt } from '../unsupported';

const STATEMENTS = new Set(['import_statement', 'import_from_statement', 'future_import_statement']);
const SCAN = new Set([...STATEMENTS, 'call', 'identifier', 'assignment', 'augmented_assignment']);

const isIdentifier = (type: string) => type === 'identifier';

/**
 * `a . b` -> `a.b` (dotted_name identifiers joined), for imported names.
 * Only identifiers: a `\` line continuation inside the name is a named
 * child too, and is not part of it.
 */
function dottedName(n: Parser.SyntaxNode): string {
  return n.type === 'dotted_name' ? n.namedChildren.filter(c => c.type === 'identifier').map(c => c.text).join('.') : n.text;
}

/** dottedName for a module: bounded reads (joinChildren / moduleText). */
function dotted(n: Parser.SyntaxNode): string {
  return n.type === 'dotted_name' ? joinChildren(n, '.', isIdentifier) : moduleText(n);
}

/** Python reads identifiers NFKC-normalized (PEP 3131): the name an import binds or loads. */
const nfkc = (s: string) => s.normalize('NFKC');

/** `.` tokens of an import_prefix (`. .` is level 2), without reading its text. */
function prefixLevel(prefix: Parser.SyntaxNode): number {
  const c = prefix.walk();
  let level = 0;
  if (c.gotoFirstChild()) do if (c.nodeType === '.') level++; while (c.gotoNextSibling());
  return level;
}

/**
 * `identifiers`: `module` was written as source identifiers, so `normalized`
 * is NFKC; a string argument (`__import__('x')`) is used as given.
 */
function absolute(module: string, identifiers = true): Pick<ImportRecord, 'module' | 'normalized' | 'package' | 'locality'> {
  const normalized = identifiers ? nfkc(module) : module;
  return { module, normalized, package: normalized.split('.')[0], locality: 'unknown' };
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
    if (c.type !== 'aliased_import') return name(dottedName(c));
    const n = c.childForFieldName('name');
    return name(n ? dottedName(n) : c.text, c.childForFieldName('alias')?.text);
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
  const level = prefix ? prefixLevel(prefix) : 0;
  const sub = mod.namedChildren.find(c => c.type === 'dotted_name');
  const relative: RelativeRef = sub ? { level, module: nfkc(dotted(sub)) } : { level };
  return record({
    at: stmt,
    kind: 'static',
    form: 'from',
    // Dots past MODULE_WINDOW only lengthen a module capModules truncates anyway.
    module: '.'.repeat(Math.min(level, MODULE_WINDOW)) + (sub ? dotted(sub) : ''),
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
  /** Other constructs (importlib loaders, exec / eval, sys.path), any order. */
  unsupported: UnsupportedRecord[];
}

const DEFERRED_DETAIL: Record<DeferredCall['reason'], string> = {
  'non-literal': 'with a non-literal argument',
  shadowed: 'is rebound in this file',
  'relative-without-package': 'with a relative name and no package',
};

/** Unsupported record for a deferred call: detail = callee as written + reason. */
export function deferredRecord(d: DeferredCall): UnsupportedRecord {
  const fn = d.node.childForFieldName('function');
  return unsupportedAt(d.node, d.construct, `${fn ? fn.text.replace(/\s+/g, '') : 'call'} ${DEFERRED_DETAIL[d.reason]}`);
}

/** importlib members that load nothing by name (or are covered by import_module records). */
const IMPORTLIB_INERT = new Set(['import_module', 'reload', 'invalidate_caches', 'resources', 'metadata', 'abc']);
/** Submodules whose members are loaders (any call reported). */
const IMPORTLIB_LOADERS = new Set(['importlib.util', 'importlib.machinery']);
const SYS_PATH_MUTATORS = new Set(['insert', 'append', 'extend']);

/** `a.b.c` attribute chain as a dotted string, or undefined for anything else. */
function attributeChain(n: Parser.SyntaxNode | null | undefined): string | undefined {
  const parts: string[] = [];
  let cur = n;
  while (cur && cur.type === 'attribute') {
    const a = cur.childForFieldName('attribute');
    if (!a) return undefined;
    parts.push(a.text);
    cur = cur.childForFieldName('object');
  }
  if (!cur || cur.type !== 'identifier') return undefined;
  parts.push(cur.text);
  return parts.reverse().join('.');
}

/** `sys.path` or `sys.path[...]` as an assignment target. */
function isSysPath(n: Parser.SyntaxNode | null): boolean {
  if (!n) return false;
  if (n.type === 'subscript') return attributeChain(n.childForFieldName('value')) === 'sys.path';
  return attributeChain(n) === 'sys.path';
}

/** Import bindings to importlib modules (local name -> dotted module) and loader functions (local name -> qualified). */
interface LoaderBindings { modules: Map<string, string>; functions: Map<string, string> }

function collectLoaders(stmt: Parser.SyntaxNode, b: LoaderBindings): void {
  if (stmt.type === 'import_statement') {
    for (const c of stmt.childrenForFieldName('name')) {
      const target = c.type === 'aliased_import' ? c.childForFieldName('name') : c;
      if (!target) continue;
      const mod = nfkc(dotted(target));
      if (mod !== 'importlib' && !mod.startsWith('importlib.')) continue;
      const alias = c.type === 'aliased_import' ? c.childForFieldName('alias')?.text : undefined;
      // `import importlib.util` binds `importlib`; `import importlib.util as u` binds `u` to the submodule.
      if (alias) b.modules.set(alias, mod);
      else b.modules.set('importlib', 'importlib');
    }
  } else if (stmt.type === 'import_from_statement') {
    const mod = stmt.childForFieldName('module_name');
    if (!mod || mod.type === 'relative_import') return;
    const from = nfkc(dotted(mod));
    if (from !== 'importlib' && !IMPORTLIB_LOADERS.has(from)) return;
    for (const n of importedNames(stmt)) {
      const qualified = `${from}.${n.name}`;
      if (IMPORTLIB_LOADERS.has(qualified)) b.modules.set(n.alias ?? n.name, qualified);
      else b.functions.set(n.alias ?? n.name, qualified);
    }
  }
}

/** Qualified importlib callee (`importlib.util.spec_from_file_location`) when it is a loader call. */
function loaderCall(fn: Parser.SyntaxNode | null, b: LoaderBindings): string | undefined {
  if (!fn) return undefined;
  let qualified: string | undefined;
  if (fn.type === 'identifier') qualified = b.functions.get(fn.text);
  else {
    const chain = attributeChain(fn);
    if (!chain) return undefined;
    const head = chain.split('.')[0];
    const mod = b.modules.get(head);
    if (mod) qualified = mod + chain.slice(head.length);
  }
  if (!qualified) return undefined;
  const rest = qualified.split('.');
  // importlib.<member>: inert members, and importlib.<sub> calls outside the loader submodules, are not reported.
  if (rest.length < 2 || IMPORTLIB_INERT.has(rest[1])) return undefined;
  if (rest.length > 2 && !IMPORTLIB_LOADERS.has(`${rest[0]}.${rest[1]}`)) return undefined;
  if (rest.length === 2 && IMPORTLIB_LOADERS.has(qualified)) return undefined;
  return qualified;
}

/** exec / eval / sys.path / site.addsitedir at a call. */
function callSite(call: Parser.SyntaxNode, fn: Parser.SyntaxNode | null, loaders: LoaderBindings): UnsupportedRecord | undefined {
  if (!fn) return undefined;
  if (fn.type === 'identifier') {
    if (fn.text === 'exec') return unsupportedAt(call, 'exec', 'exec of code');
    if (fn.text === 'eval') return unsupportedAt(call, 'eval', 'eval of code');
  }
  const chain = attributeChain(fn);
  if (chain === 'site.addsitedir') return unsupportedAt(call, 'sys-path', 'site.addsitedir extends the module search path');
  if (chain && chain.startsWith('sys.path.') && SYS_PATH_MUTATORS.has(chain.slice('sys.path.'.length))) {
    return unsupportedAt(call, 'sys-path', `${chain} changes the module search path`);
  }
  const loader = loaderCall(fn, loaders);
  if (loader) return unsupportedAt(call, 'dynamic-import', `${loader}: importlib loader API, can load a module xray cannot name`);
  return undefined;
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
    return parts.every(p => p !== undefined) ? joinModule(parts as string[], '') : undefined;
  }
  if (n.type !== 'string') return undefined;
  const prefix = (n.namedChildren.find(c => c.type === 'string_start')?.text ?? '').replace(/['"]/g, '').toLowerCase();
  if (prefix.includes('b')) return undefined;
  const parts: Parser.SyntaxNode[] = [];
  for (const c of n.namedChildren) {
    if (c.type === 'string_start' || c.type === 'string_end') continue;
    if (c.type !== 'string_content' || c.namedChildCount > 0) return undefined;
    parts.push(c);
  }
  // Bounded reads: every part is checked above, text is read only up to MODULE_WINDOW.
  let out = '';
  for (let i = 0; i < parts.length && out.length < MODULE_WINDOW; i++) out += moduleText(parts[i]);
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
        if (n && a && nfkc(dotted(n)) === 'importlib') b.modules.add(a.text);
      } else if (nfkc(dotted(c)).split('.')[0] === 'importlib') {
        b.modules.add('importlib');
      }
    }
  } else if (stmt.type === 'import_from_statement') {
    const mod = stmt.childForFieldName('module_name');
    if (!mod || nfkc(dotted(mod)) !== 'importlib') return;
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
  return record({ at: call, kind: 'dynamic', form, ...absolute(module, false) });
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
  const loaders: LoaderBindings = { modules: new Map(), functions: new Map() };
  const unsupported: UnsupportedRecord[] = [];
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
    } else if (type === 'assignment' || type === 'augmented_assignment') {
      if (isSysPath(n.childForFieldName('left'))) unsupported.push(unsupportedAt(n, 'sys-path', 'assignment to sys.path changes the module search path'));
    } else {
      collectImportlib(n, importlib);
      collectLoaders(n, loaders);
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
    const site = callSite(call, fn, loaders);
    if (site) unsupported.push(site);
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
  return { imports, deferred, unsupported };
}

export function extractPython(root: Parser.SyntaxNode, ctx: ExtractContext): ImportRecord[] {
  const scan = scanPython(root, ctx);
  if (ctx.unsupported) ctx.unsupported.push(...scan.deferred.map(deferredRecord), ...scan.unsupported);
  return scan.imports;
}
