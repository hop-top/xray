/**
 * PHP static imports.
 *
 * - `use` (namespace_use_declaration): one record per clause, grouped use
 *   expanded with its prefix, FQN without leading `\`. Form by clause type:
 *   use-function / use-const (per clause or per declaration), else group-use
 *   for a group, else use. Trait `use` inside classes is a different node.
 * - `require`/`require_once` (kind require) and `include`/`include_once`
 *   (kind include) with a literal path: quoted string without interpolation,
 *   optionally parenthesised, or `__DIR__ . 'lit'` (normalized folded against
 *   the file's directory). `module` keeps escapes as written, `normalized`
 *   is the unescaped value. Anything else is left to the unsupported pass.
 *
 * Range: the declaration when it yields one record, else the clause.
 * Evidence: the declaration / statement.
 *
 * References (kind reference, form fqn): every qualified_name / relative_name
 * outside `use` clauses (new, static and function calls, instanceof, types,
 * `X::class`, attributes, trait `use`), resolved per PHP rules for qualified
 * names: leading `\` = fully qualified; `namespace\X` = current namespace;
 * first segment matching a class `use` alias of the same namespace block
 * (case-insensitive) -> alias target; else prefixed by the current
 * namespace. Unqualified names are skipped (same namespace or use-bound,
 * already reported). All `syntactic`: PHP resolves qualified names at
 * compile time from these rules alone. One record per resolved name per file: the first occurrence
 * gives range and evidence (the name), `occurrences` counts all.
 *
 * Unsupported: `eval` (any argument); `require`/`include*` whose path is
 * not literal (dynamic-include); `new $v` / `new (expr)` / `new $o->p`
 * (dynamic-new: anything but a name, `static`/`self`/`parent` or an
 * anonymous class); `$v::m()` and other non-name scopes
 * (dynamic-static-call); variable functions `$f()` / `[$a, 'm']()` and
 * `call_user_func` / `call_user_func_array` with a non-literal callable
 * (dynamic-call). Any of these can autoload or load a class or file whose
 * name only exists at run time.
 */

import * as posix from 'path/posix';
import type { ImportForm, ImportKind, ImportRecord, UnsupportedRecord } from '../types';
import { moduleSlice, moduleSource, record, walk, type LanguageExtractor, type SyntaxNode } from '../record';
import { unsupportedAt } from '../unsupported';

/**
 * Texts of a name's PHP-mode stretches, whitespace squeezed. A close tag
 * ends PHP mode and the text after it up to the next open tag is HTML, not
 * part of any name, but the grammar keeps running names across it
 * (`\A\B ?>html\C\D <?php \E\F` is one qualified_name holding a
 * text_interpolation). Each stretch is its own name; a stretch with no name
 * characters (`?>` straight after `\`) is dropped. Bounded reads (moduleSlice).
 */
function nameTexts(n: SyntaxNode): string[] {
  const html: SyntaxNode[] = [];
  const c = n.walk();
  let descend = true;
  for (;;) {
    if (descend && c.nodeType === 'text_interpolation') { html.push(c.currentNode); descend = false; }
    if (descend && c.gotoFirstChild()) continue;
    if (c.gotoNextSibling()) { descend = true; continue; }
    if (!c.gotoParent()) break;
    descend = false;
  }
  return stretches(n, html);
}

function stretches(n: SyntaxNode, html: SyntaxNode[]): string[] {
  if (html.length === 0) return [moduleSlice(n.tree, n.startIndex, n.endIndex, true)];
  const out: string[] = [];
  let from = n.startIndex;
  for (const h of html) {
    out.push(moduleSlice(n.tree, from, h.startIndex, true));
    from = h.endIndex;
  }
  out.push(moduleSlice(n.tree, from, n.endIndex, true));
  return out.filter(t => /[^\\]/.test(t));
}

/** Qualified name text without whitespace or a leading `\`, up to a close tag; bounded read. */
const fqn = (n: SyntaxNode) => nameTexts(n)[0]?.replace(/^\\/, '') ?? '';

function clauseType(n: SyntaxNode): string | undefined {
  return n.childForFieldName('type')?.text.toLowerCase();
}

interface UseClause { clause: SyntaxNode; module: string; alias?: string; type?: string; group: boolean }

function useClauses(decl: SyntaxNode): UseClause[] {
  const declType = clauseType(decl);
  const group = decl.childForFieldName('body');
  const prefixNode = group ? decl.namedChildren.find(c => c.type === 'namespace_name') : undefined;
  const prefix = prefixNode ? fqn(prefixNode) : '';
  const out: UseClause[] = [];
  for (const clause of (group ?? decl).namedChildren) {
    if (clause.type !== 'namespace_use_clause') continue;
    const alias = clause.childForFieldName('alias');
    const nameNode = clause.namedChildren.find(c => c !== alias && (c.type === 'qualified_name' || c.type === 'name'));
    if (!nameNode) continue;
    const name = fqn(nameNode);
    out.push({ clause, module: prefix ? `${prefix}\\${name}` : name, alias: alias?.text, type: clauseType(clause) ?? declType, group: !!group });
  }
  return out;
}

function useRecords(decl: SyntaxNode, clauses: UseClause[], out: ImportRecord[]): void {
  for (const c of clauses) {
    const form: ImportForm = c.type === 'function' ? 'use-function' : c.type === 'const' ? 'use-const' : c.group ? 'group-use' : 'use';
    out.push(record({
      at: clauses.length === 1 ? decl : c.clause, evidenceOf: decl, kind: 'static', form,
      module: c.module, normalized: c.module, package: c.module.split('\\')[0], locality: 'unknown', alias: c.alias,
    }));
  }
}

const INCLUDES: Record<string, { kind: ImportKind; form: ImportForm }> = {
  require_expression: { kind: 'require', form: 'require' },
  require_once_expression: { kind: 'require', form: 'require_once' },
  include_expression: { kind: 'include', form: 'include' },
  include_once_expression: { kind: 'include', form: 'include_once' },
};

interface Literal { raw: string; value: string }

const DQ_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', v: '\v', e: '\x1b', f: '\f', '\\': '\\', $: '$', '"': '"' };

/** Unescaped value of a quoted literal per PHP rules (unknown escapes stay verbatim). */
function unescape(raw: string, double: boolean): string {
  if (!double) return raw.replace(/\\([\\'])/g, '$1');
  return raw.replace(/\\(?:([nrtvef\\$"])|([0-7]{1,3})|x([0-9A-Fa-f]{1,2})|u\{([0-9A-Fa-f]+)\})/g,
    (m, c, oct, hex, uni) => c ? DQ_ESCAPES[c]
      : oct ? String.fromCharCode(parseInt(oct, 8) & 0xff)
      : hex ? String.fromCharCode(parseInt(hex, 16))
      : codePoint(uni) ?? m);
}

/** Code point for a `\u{…}` escape, or undefined when PHP would reject it (> U+10FFFF). */
function codePoint(hex: string): string | undefined {
  const cp = parseInt(hex, 16); // huge digit runs parse to Infinity, also rejected
  return cp <= 0x10ffff ? String.fromCodePoint(cp) : undefined;
}

/** Quoted string with no interpolation: text between the quotes and its value. */
function literal(n: SyntaxNode): Literal | undefined {
  if (n.type !== 'string' && n.type !== 'encapsed_string') return undefined;
  if (n.namedChildren.some(c => c.type !== 'string_content' && c.type !== 'escape_sequence')) return undefined;
  // Bounded read (moduleSource): a cut literal has no closing quote to drop; capModules truncates it and nulls its value.
  const { text: t, cut } = moduleSource(n);
  if (t.length < 2) return undefined;
  const raw = cut ? t.slice(1) : t.slice(1, -1);
  return { raw, value: unescape(raw, t[0] === '"') };
}

function unparen(n: SyntaxNode): SyntaxNode {
  while (n.type === 'parenthesized_expression' && n.namedChildCount === 1) n = n.namedChild(0)!;
  return n;
}

function includeTarget(arg: SyntaxNode, filePath: string): { module: string; normalized: string | null } | undefined {
  arg = unparen(arg);
  const lit = literal(arg);
  if (lit !== undefined) return { module: lit.raw, normalized: lit.value };
  if (arg.type !== 'binary_expression' || arg.childForFieldName('operator')?.text !== '.') return undefined;
  const left = arg.childForFieldName('left');
  const right = arg.childForFieldName('right');
  if (left?.type !== 'name' || left.text !== '__DIR__' || !right) return undefined;
  const tail = literal(unparen(right));
  if (tail === undefined) return undefined;
  // `__DIR__` has no trailing slash: only `/...` tails name a path under it.
  const folded = tail.value.startsWith('/') ? posix.normalize(posix.join(posix.dirname(filePath), tail.value)) : null;
  return { module: `__DIR__${tail.raw}`, normalized: folded };
}

/** `stmt`: the expression_statement holding `n` as a child, if any (the evidence). */
function includeRecord(n: SyntaxNode, stmt: SyntaxNode | undefined, filePath: string, out: ImportRecord[], unsupported: UnsupportedRecord[] | undefined): void {
  const spec = INCLUDES[n.type];
  const arg = n.namedChildren.find(c => c.type !== 'comment');
  if (!spec || !arg) return;
  const target = includeTarget(arg, filePath);
  if (!target) {
    unsupported?.push(unsupportedAt(n, 'dynamic-include', `${spec.form} with a non-literal path`));
    return;
  }
  out.push(record({
    at: n, evidenceOf: stmt ?? n, kind: spec.kind, form: spec.form,
    module: target.module, normalized: target.normalized, locality: 'unknown',
  }));
}

/**
 * Locator for the namespace region holding a node: the latest-starting
 * region whose [start, end) contains it, -1 outside any (regions can nest or
 * overlap in broken input). Queries must come in document order: regions
 * are pushed as they start (index order) and popped once ended, so each
 * query is amortized O(1) instead of a scan over every region.
 */
export function regionLocator(spaces: PhpNamespace[]): (n: SyntaxNode) => number {
  const open: number[] = [];
  let next = 0;
  return n => {
    const line = n.startPosition.row + 1;
    const column = n.startPosition.column + 1;
    const before = (l: number, c: number) => line < l || (line === l && column < c);
    while (next < spaces.length && !before(spaces[next].line, spaces[next].column)) open.push(next++);
    while (open.length > 0) {
      const s = spaces[open[open.length - 1]];
      if (before(s.endLine, s.endColumn)) return open[open.length - 1];
      open.pop();
    }
    return -1;
  };
}

interface Ref { node: SyntaxNode; module: string; normalized: string }

/** Resolved name of a qualified_name / relative_name, or undefined for an unqualified one. */
function resolveName(n: SyntaxNode, text: string, ns: string, aliases: Map<string, string> | undefined): Ref | undefined {
  const within = (rest: string) => (ns ? `${ns}\\${rest}` : rest);
  if (n.type === 'relative_name') {
    const rest = text.replace(/^namespace\\/i, '');
    return { node: n, module: text, normalized: within(rest) };
  }
  if (text.startsWith('\\')) {
    const name = text.slice(1);
    return { node: n, module: name, normalized: name };
  }
  const cut = text.indexOf('\\');
  if (cut < 0) return undefined;
  const target = aliases?.get(text.slice(0, cut).toLowerCase());
  return { node: n, module: text, normalized: target ? target + text.slice(cut) : within(text) };
}

function referenceRecords(refs: Ref[], out: ImportRecord[]): void {
  const byName = new Map<string, { first: Ref; count: number }>();
  for (const r of refs) {
    const seen = byName.get(r.normalized);
    if (seen) seen.count++;
    else byName.set(r.normalized, { first: r, count: 1 });
  }
  for (const { first, count } of byName.values()) {
    out.push(record({
      at: first.node, kind: 'reference', form: 'fqn', module: first.module, normalized: first.normalized,
      package: first.normalized.split('\\')[0], locality: 'unknown',
      occurrences: count,
    }));
  }
}

const NAMES = new Set(['qualified_name', 'relative_name']);
const DYNAMIC = new Set(['function_call_expression', 'object_creation_expression', 'scoped_call_expression']);
const STATEMENTS = new Set(['namespace_use_declaration', 'expression_statement', ...Object.keys(INCLUDES), ...NAMES, ...DYNAMIC]);

/** Class names a `new` / `::` can use without a run-time string. */
const STATIC_CLASS = new Set(['name', 'qualified_name', 'relative_name', 'anonymous_class']);

const CALL_USER_FUNC = new Set(['call_user_func', 'call_user_func_array']);

/** Immediately invoked closures name no function. */
const CLOSURES = new Set(['anonymous_function', 'arrow_function']);

/** A literal callable: a quoted string without interpolation (`'f'`, `'A::m'`). */
const literalCallable = (n: SyntaxNode | undefined) => !!n && literal(unparen(n)) !== undefined;

function firstArg(call: SyntaxNode): SyntaxNode | undefined {
  const a = call.childForFieldName('arguments')?.namedChildren.find(c => c.type === 'argument');
  return a?.namedChildren.find(c => c.type !== 'comment');
}

/** Unsupported record for a call / new / scoped call, or undefined when its target is static. */
function dynamicSite(n: SyntaxNode): UnsupportedRecord | undefined {
  if (n.type === 'object_creation_expression') {
    const cls = n.namedChildren.find(c => c.type !== 'comment' && c.type !== 'arguments' && c.type !== 'attribute_list');
    if (!cls || STATIC_CLASS.has(cls.type)) return undefined;
    return unsupportedAt(n, 'dynamic-new', 'new with a class name computed at run time');
  }
  if (n.type === 'scoped_call_expression') {
    const scope = n.childForFieldName('scope');
    if (!scope || STATIC_CLASS.has(scope.type) || scope.type === 'relative_scope') return undefined;
    return unsupportedAt(n, 'dynamic-static-call', 'static call on a class computed at run time');
  }
  const fn = n.childForFieldName('function');
  if (!fn) return undefined;
  // `\eval(...)` / `\call_user_func(...)`: the global function, fully qualified.
  const global = fn.type === 'qualified_name' && /^\\[^\\]+$/.test(fn.text.replace(/\s+/g, '')) ? fn.text.replace(/\s+/g, '').slice(1) : undefined;
  if (fn.type === 'name' || global !== undefined) {
    const lower = (global ?? fn.text).toLowerCase();
    if (lower === 'eval') return unsupportedAt(n, 'eval', 'eval of code');
    if (CALL_USER_FUNC.has(lower) && !literalCallable(firstArg(n))) {
      return unsupportedAt(n, 'dynamic-call', `${lower} with a non-literal callable`);
    }
    return undefined;
  }
  if (NAMES.has(fn.type) || CLOSURES.has(unparen(fn).type)) return undefined;
  return unsupportedAt(n, 'dynamic-call', 'call of a function named at run time');
}

export const extractPhp: LanguageExtractor = (root, ctx) => {
  const out: ImportRecord[] = [];
  const spaces = phpNamespaces(root);
  // Class / namespace `use` aliases per namespace region (lowercased: PHP names are case-insensitive).
  const aliases = new Map<number, Map<string, string>>();
  const names: SyntaxNode[] = [];
  // Names inside the last `use` declaration (preorder reaches it first) are
  // its clauses, not references; tracked by range since `.parent` costs
  // O(depth) per call (quadratic on deeply nested expressions).
  let useEnd = -1;
  // Include node id -> its expression_statement (preorder reaches the
  // statement first), again instead of `.parent`.
  const statementOf = new Map<number, SyntaxNode>();
  const useRegion = regionLocator(spaces);
  for (const n of walk(root, STATEMENTS)) {
    if (n.type === 'expression_statement') {
      for (const c of n.namedChildren) if (c.type in INCLUDES) statementOf.set(c.id, n);
    } else if (n.type === 'namespace_use_declaration') {
      useEnd = n.endIndex;
      const clauses = useClauses(n);
      useRecords(n, clauses, out);
      const region = useRegion(n);
      for (const c of clauses) {
        if (c.type === 'function' || c.type === 'const') continue;
        let m = aliases.get(region);
        if (!m) aliases.set(region, (m = new Map()));
        m.set((c.alias ?? c.module.slice(c.module.lastIndexOf('\\') + 1)).toLowerCase(), c.module);
      }
    } else if (NAMES.has(n.type)) {
      if (n.startIndex >= useEnd) names.push(n);
    } else if (n.type in INCLUDES) includeRecord(n, statementOf.get(n.id), ctx.path, out, ctx.unsupported);
    else if (ctx.unsupported) {
      const u = dynamicSite(n);
      if (u) ctx.unsupported.push(u);
    }
  }
  const refs: Ref[] = [];
  const nameRegion = regionLocator(spaces);
  for (const n of names) {
    const region = nameRegion(n);
    for (const text of nameTexts(n)) {
      const r = resolveName(n, text, spaces[region]?.name ?? '', aliases.get(region));
      if (r) refs.push(r);
    }
  }
  referenceRecords(refs, out);
  return out;
};

export interface PhpNamespace {
  /** Without leading `\`; '' for the global `namespace { }` block. */
  name: string;
  line: number;
  column: number;
  /** End of the block, or of the file region up to the next `namespace;`. */
  endLine: number;
  endColumn: number;
}

const NAMESPACE_DEFINITION = new Set(['namespace_definition']);

/**
 * Namespaces declared in a file, in order, for name resolution of
 * references (a file may hold several, braced or not).
 */
export function phpNamespaces(root: SyntaxNode): PhpNamespace[] {
  const defs = [...walk(root, NAMESPACE_DEFINITION)];
  return defs.map((d, i) => {
    const nameNode = d.childForFieldName('name');
    const braced = !!d.childForFieldName('body');
    const end = braced ? d.endPosition : (defs[i + 1]?.startPosition ?? root.endPosition);
    return {
      name: nameNode ? fqn(nameNode) : '',
      line: d.startPosition.row + 1,
      column: d.startPosition.column + 1,
      endLine: end.row + 1,
      endColumn: end.column + 1,
    };
  });
}

