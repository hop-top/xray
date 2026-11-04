/**
 * Rust static imports.
 *
 * - `use` trees flattened: one record per leaf, `::`-joined, leading `::`
 *   stripped; `self` leaf = its prefix; `as` -> alias; `*` -> wildcard.
 * - `extern crate x [as y]`: form extern-crate.
 * - `mod x;` (no body): kind include, form mod; a `#[path]` attribute widens
 *   the range and evidence to include it (the file is resolved later).
 *
 * Range: the declaration when it yields one record, else the leaf.
 * Evidence: the declaration. Package only when certain from syntax: leading
 * `::` (a crate) or crate/self/super (`crate`, locality local). A bare first
 * segment may be a local module (2018 paths) and is left to resolution.
 *
 * References (kind reference, form path-root): the root of every path used
 * outside `use` / `extern crate` — leftmost segment of scoped_identifier /
 * scoped_type_identifier chains (expressions, patterns, types, impl headers,
 * qualified types, macro and attribute paths), plus a token scan of
 * token_trees (attribute and macro arguments, macro_rules bodies), which the
 * grammar leaves unparsed: an identifier followed by `::` and another
 * identifier, not preceded by `::` or `.`. Skipped: crate/self/super/Self/`$crate`/metavariable
 * roots, CamelCase roots (types, enum variants), primitive types (`u32::MAX`)
 * and roots bound in the file by a `use` leaf, `extern crate`, `mod` or a
 * named item. A leading `::` root names a crate whatever the bindings and is
 * `syntactic`; others are `inferred`. std/core/alloc are `stdlib`. One
 * record per root per file: the first occurrence gives range and evidence
 * (the path text), `occurrences` counts all.
 *
 * Unsupported: `include!` (include-macro: a file compiled in place) and
 * `include_str!` / `include_bytes!` (include-data), as macro invocations or
 * inside other macros' token trees, with an optional `std::` / `core::`
 * path; detail says whether the path is a string literal. Build scripts
 * (`build.rs`) are a filename rule applied by the caller.
 */

import type { ImportRecord, UnsupportedRecord } from '../types';
import { joinModule, moduleText, nodeEvidence, record, type LanguageExtractor, type SyntaxNode } from '../record';

const LOCAL_ROOTS = new Set(['crate', 'self', 'super']);

/** Identifier without the raw prefix: `r#serde` and `serde` are one name. */
export const rawIdent = (s: string): string => (s.startsWith('r#') ? s.slice(2) : s);

interface Path { segments: string[]; leadingColons: boolean }

interface Leaf {
  node: SyntaxNode;
  path: Path;
  alias?: string;
  wildcard?: boolean;
}

/**
 * Segments of a path node (identifier, crate/self/super, scoped_identifier); iterative (chains can be arbitrarily long).
 * Each segment is a bounded read (moduleText); joins go through joinModule.
 */
function pathOf(n: SyntaxNode): Path {
  const names: string[] = [];
  let cur: SyntaxNode | null = n;
  while (cur && cur.type === 'scoped_identifier') {
    const name = cur.childForFieldName('name');
    if (name) names.push(moduleText(name));
    cur = cur.childForFieldName('path');
  }
  names.reverse();
  return cur ? { segments: [moduleText(cur), ...names], leadingColons: false } : { segments: names, leadingColons: true };
}

const join = (a: Path, b: Path): Path =>
  ({ segments: [...a.segments, ...b.segments], leadingColons: a.leadingColons || (a.segments.length === 0 && b.leadingColons) });

/** Use-tree prefix shared by nested lists (linked, so deep nesting stays linear). */
interface Prefix { up: Prefix | null; segments: string[]; len: number; leadingColons: boolean }

const ROOT_PREFIX: Prefix = { up: null, segments: [], len: 0, leadingColons: false };

/** Same result as `join(path(p), head)`, without copying `p`. */
const extend = (p: Prefix, head: Path): Prefix =>
  ({ up: p, segments: head.segments, len: p.len + head.segments.length, leadingColons: p.leadingColons || (p.len === 0 && head.leadingColons) });

function path(p: Prefix): Path {
  const chunks: string[][] = [];
  for (let q: Prefix | null = p; q; q = q.up) chunks.push(q.segments);
  const segments: string[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) for (const s of chunks[i]) segments.push(s);
  return { segments, leadingColons: p.leadingColons };
}

/**
 * Leaves of a use tree, document order. Explicit stack: lists nest without
 * bound in untrusted input.
 */
function leaves(root: SyntaxNode, out: Leaf[]): void {
  const stack: { node: SyntaxNode; at: Prefix }[] = [{ node: root, at: ROOT_PREFIX }];
  for (let top = stack.pop(); top; top = stack.pop()) {
    const { node: n, at } = top;
    switch (n.type) {
      case 'use_list': {
        const cs = n.namedChildren;
        for (let i = cs.length - 1; i >= 0; i--) stack.push({ node: cs[i], at });
        break;
      }
      case 'scoped_use_list': {
        const p = n.childForFieldName('path');
        const list = n.childForFieldName('list');
        // `::{a, b}` has no path but a leading `::` token.
        const head = p ? pathOf(p) : { segments: [], leadingColons: n.children.some(c => c.type === '::') };
        if (list) stack.push({ node: list, at: extend(at, head) });
        break;
      }
      case 'use_as_clause': {
        const p = n.childForFieldName('path');
        const alias = n.childForFieldName('alias');
        if (p) out.push({ node: n, path: leafPath(path(at), p), alias: alias?.text });
        break;
      }
      case 'use_wildcard': {
        const p = n.namedChildren.find(c => c.type !== 'comment');
        // `*` alone in a list (`a::{*}`) has no path child.
        const head = p ? pathOf(p) : { segments: [], leadingColons: n.children.some(c => c.type === '::') };
        out.push({ node: n, path: join(path(at), head), wildcard: true });
        break;
      }
      case 'identifier': case 'scoped_identifier': case 'self': case 'crate': case 'super': case 'metavariable':
        out.push({ node: n, path: leafPath(path(at), n) });
        break;
      default:
        break;
    }
  }
}

/** `self` as a list leaf names the prefix itself. */
function leafPath(prefix: Path, n: SyntaxNode): Path {
  if (n.type === 'self' && prefix.segments.length > 0) return prefix;
  return join(prefix, pathOf(n));
}

function useForm(written: string[], leadingColons: boolean): Pick<ImportRecord, 'normalized' | 'package' | 'locality'> {
  const segments = written.map(rawIdent);
  const first = segments[0];
  if (first !== undefined && LOCAL_ROOTS.has(first)) {
    return { normalized: first === 'crate' ? joinModule(segments, '::') : null, package: 'crate', locality: 'local' };
  }
  return { normalized: joinModule(segments, '::'), package: leadingColons && first ? first : undefined, locality: 'unknown' };
}

function useRecords(decl: SyntaxNode, out: ImportRecord[]): void {
  const arg = decl.childForFieldName('argument');
  if (!arg) return;
  const ls: Leaf[] = [];
  leaves(arg, ls);
  for (const l of ls) {
    if (l.path.segments.length === 0) continue;
    out.push(record({
      at: ls.length === 1 ? decl : l.node, evidenceOf: decl, kind: 'static', form: 'use',
      module: joinModule(l.path.segments, '::'), ...useForm(l.path.segments, l.path.leadingColons),
      alias: l.alias, wildcard: l.wildcard,
    }));
  }
}

function externCrate(decl: SyntaxNode, out: ImportRecord[]): void {
  const name = decl.childForFieldName('name');
  if (!name) return;
  const alias = decl.childForFieldName('alias');
  const crate = moduleText(name);
  const real = rawIdent(crate);
  const self = real === 'self';
  out.push(record({
    at: decl, kind: 'static', form: 'extern-crate', module: crate,
    normalized: self ? null : real, package: self ? 'crate' : real, locality: self ? 'local' : 'unknown',
    alias: alias?.text,
  }));
}

/** Earliest outer `#[path = ...]` attribute directly above an item. */
function pathAttribute(item: SyntaxNode): SyntaxNode | undefined {
  let found: SyntaxNode | undefined;
  for (let s = item.previousNamedSibling; s; s = s.previousNamedSibling) {
    if (s.type === 'line_comment' || s.type === 'block_comment') continue;
    if (s.type !== 'attribute_item') break;
    const attr = s.namedChildren.find(c => c.type === 'attribute');
    if (attr?.namedChildren[0]?.text === 'path') found = s;
  }
  return found;
}

function modItem(item: SyntaxNode, out: ImportRecord[]): void {
  if (item.childForFieldName('body')) return;
  const name = item.childForFieldName('name');
  if (!name) return;
  const start = pathAttribute(item) ?? item;
  out.push(record({
    at: start, end: item, kind: 'include', form: 'mod', module: moduleText(name), normalized: null, package: 'crate', locality: 'local',
  }));
}

/** Names a use declaration binds: alias, else the leaf's last segment (`_` / `*` bind nothing usable). */
function useBindings(decl: SyntaxNode, out: Set<string>): void {
  const arg = decl.childForFieldName('argument');
  if (!arg) return;
  const ls: Leaf[] = [];
  leaves(arg, ls);
  for (const l of ls) {
    if (l.wildcard) continue;
    const name = l.alias ?? l.path.segments[l.path.segments.length - 1];
    if (name !== undefined && rawIdent(name) !== '_') out.add(rawIdent(name));
  }
}

const NAMED_ITEMS = new Set([
  'mod_item', 'function_item', 'function_signature_item', 'struct_item', 'enum_item', 'union_item',
  'trait_item', 'type_item', 'const_item', 'static_item',
]);

const PRIMITIVES = new Set([
  'bool', 'char', 'str', 'f32', 'f64',
  'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
]);

const STDLIB = new Set(['std', 'core', 'alloc']);

const SCOPED = new Set(['scoped_identifier', 'scoped_type_identifier']);

/** One path-root occurrence: range `at`..`end`, root name, written with a leading `::`. */
interface Occurrence { at: SyntaxNode; end: SyntaxNode; root: string; leadingColons: boolean }

/**
 * Occurrence for a parsed path chain, given its outermost link (preorder
 * reaches it first). Follows `path` fields down to the innermost link,
 * marking each in `inner` so the walk skips them; the root is a plain
 * identifier (or absent: leading `::`); other roots (crate/self/super,
 * metavariable, generic or bracketed types) are not crates. Range = the
 * outermost link. Iterative and linear: chains can be arbitrarily long.
 */
function scopedOccurrence(top: SyntaxNode, inner: Set<number>): Occurrence | undefined {
  let n = top;
  for (let p = n.childForFieldName('path'); p && SCOPED.has(p.type); p = n.childForFieldName('path')) {
    inner.add(p.id);
    n = p;
  }
  const p = n.childForFieldName('path');
  if (!p) {
    const name = n.childForFieldName('name');
    if (!name || !n.children.some(c => c.type === '::')) return undefined;
    return { at: top, end: top, root: moduleText(name), leadingColons: true };
  }
  return p.type === 'identifier' ? { at: top, end: top, root: moduleText(p), leadingColons: false } : undefined;
}

const INCLUDE_MACROS: Record<string, UnsupportedRecord['construct']> = {
  include: 'include-macro', include_str: 'include-data', include_bytes: 'include-data',
};

/** An include-family macro use: name token, its token tree (absent in broken input). */
interface IncludeUse { at: SyntaxNode; name: string; tree?: SyntaxNode }

const isStringLiteral = (n: SyntaxNode) => n.type === 'string_literal' || n.type === 'raw_string_literal';

/** Path argument is one string literal (`include!("x.rs")`). */
function literalPath(tree: SyntaxNode | undefined): boolean {
  if (!tree) return false;
  const args = tree.namedChildren.filter(c => c.type !== 'line_comment' && c.type !== 'block_comment');
  return args.length === 1 && isStringLiteral(args[0]);
}

/** Macro name of a macro_invocation if it is an include-family macro (`include`, `std::include`, `core::include`). */
function includeMacroName(n: SyntaxNode): string | undefined {
  const m = n.childForFieldName('macro');
  if (!m) return undefined;
  if (m.type === 'identifier') return INCLUDE_MACROS[m.text] ? m.text : undefined;
  if (m.type !== 'scoped_identifier') return undefined;
  const root = m.childForFieldName('path');
  const name = m.childForFieldName('name');
  if (!root || !name || (root.text !== 'std' && root.text !== 'core')) return undefined;
  return INCLUDE_MACROS[name.text] ? name.text : undefined;
}

function includeRecords(uses: IncludeUse[], out: UnsupportedRecord[]): void {
  for (const u of uses) {
    const end = u.tree ?? u.at;
    const literal = literalPath(u.tree);
    out.push({
      line: u.at.startPosition.row + 1,
      column: u.at.startPosition.column + 1,
      construct: INCLUDE_MACROS[u.name],
      detail: literal ? `${u.name}! with a literal path` : `${u.name}! with a non-literal path`,
      evidence: nodeEvidence(u.at, end),
    });
  }
}

/** Tokens that make a following `::` a path continuation rather than a leading `::`. */
const PATH_HEAD = new Set(['identifier', 'self', 'super', 'crate', 'metavariable', 'primitive_type', '>']);

/**
 * `ident (:: ident)*` sequences in a token_tree, nested trees included,
 * document order. Explicit stack: token trees nest without bound in
 * untrusted input.
 */
function tokenOccurrences(tree: SyntaxNode, out: Occurrence[], includes: IncludeUse[]): void {
  const stack: { t: SyntaxNode[]; i: number }[] = [{ t: tree.children, i: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const { t, i } = frame;
    if (i >= t.length) { stack.pop(); continue; }
    frame.i = i + 1;
    if (t[i].type === 'token_tree') { stack.push({ t: t[i].children, i: 0 }); continue; }
    // `include!(...)` inside another macro's arguments; `x.include!` is not a macro call.
    if (t[i].type === 'identifier' && t[i + 1]?.type === '!' && t[i - 1]?.type !== '.' && INCLUDE_MACROS[t[i].text]) {
      const next = t[i + 2];
      includes.push({ at: t[i], name: t[i].text, tree: next?.type === 'token_tree' ? next : undefined });
    }
    if (t[i].type !== 'identifier' || t[i + 1]?.type !== '::' || t[i + 2]?.type !== 'identifier') continue;
    const prev = t[i - 1];
    if (prev?.type === '.' || prev?.type === '$') continue;
    let leadingColons = false;
    let at = t[i];
    if (prev?.type === '::') {
      const before = t[i - 2];
      if (before && PATH_HEAD.has(before.type)) continue;
      leadingColons = true;
      at = prev;
    }
    let j = i;
    while (t[j + 1]?.type === '::' && t[j + 2]?.type === 'identifier') j += 2;
    out.push({ at, end: t[j], root: moduleText(t[i]), leadingColons });
    frame.i = j + 1;
  }
}

function isCandidateRoot(root: string): boolean {
  return !/^[A-Z]/.test(root) && !LOCAL_ROOTS.has(root) && !PRIMITIVES.has(root);
}

/** Evidence = the occurrence's range, read from the tree's input (no `.parent` climbs). */
function referenceRecords(occs: Occurrence[], bound: Set<string>, out: ImportRecord[]): void {
  const byRoot = new Map<string, { first: Occurrence; count: number }>();
  for (const o of occs) {
    const real = rawIdent(o.root);
    if (!isCandidateRoot(real) || (!o.leadingColons && bound.has(real))) continue;
    const seen = byRoot.get(real);
    if (seen) seen.count++;
    else byRoot.set(real, { first: o, count: 1 });
  }
  for (const [root, { first, count }] of byRoot) {
    const r = record({
      at: first.at, end: first.end, kind: 'reference', form: 'path-root',
      module: first.root, normalized: root, package: root, locality: STDLIB.has(root) ? 'stdlib' : 'unknown',
      confidence: first.leadingColons ? 'syntactic' : 'inferred', occurrences: count,
    });
    out.push(r);
  }
}

export const extractRust: LanguageExtractor = (root, ctx) => {
  const out: ImportRecord[] = [];
  const bound = new Set<string>();
  const occs: Occurrence[] = [];
  const inner = new Set<number>();
  const includes: IncludeUse[] = [];
  // One preorder walk; use / extern crate subtrees hold no references.
  // Bindings are read like roots (moduleText), so the two compare alike.
  const cursor = root.walk();
  let descend = true;
  for (;;) {
    let enter = descend;
    if (descend && cursor.nodeIsNamed) {
      const n = cursor.currentNode;
      switch (n.type) {
        case 'use_declaration':
          useRecords(n, out); useBindings(n, bound); enter = false; break;
        case 'extern_crate_declaration': {
          externCrate(n, out); enter = false;
          const name = n.childForFieldName('alias') ?? n.childForFieldName('name');
          if (name) bound.add(rawIdent(moduleText(name)));
          break;
        }
        case 'scoped_identifier': case 'scoped_type_identifier': {
          if (inner.has(n.id)) break;
          const o = scopedOccurrence(n, inner);
          if (o) occs.push(o);
          break;
        }
        case 'token_tree':
          tokenOccurrences(n, occs, includes); enter = false; break;
        case 'macro_invocation': {
          const name = includeMacroName(n);
          if (name) includes.push({ at: n, name, tree: n.namedChildren.find(c => c.type === 'token_tree') });
          break;
        }
        default:
          if (n.type === 'mod_item') modItem(n, out);
          if (NAMED_ITEMS.has(n.type)) {
            const name = n.childForFieldName('name');
            if (name) bound.add(rawIdent(moduleText(name)));
          }
      }
    }
    if (enter && cursor.gotoFirstChild()) { descend = true; continue; }
    if (cursor.gotoNextSibling()) { descend = true; continue; }
    if (!cursor.gotoParent()) break;
    descend = false;
  }
  referenceRecords(occs, bound, out);
  if (ctx?.unsupported) includeRecords(includes, ctx.unsupported);
  return out;
};
