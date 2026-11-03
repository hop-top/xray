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
 */

import type { ImportRecord } from '../types';
import { record, walk, type LanguageExtractor, type SyntaxNode } from '../record';

const LOCAL_ROOTS = new Set(['crate', 'self', 'super']);

interface Path { segments: string[]; leadingColons: boolean }

interface Leaf {
  node: SyntaxNode;
  path: Path;
  alias?: string;
  wildcard?: boolean;
}

/** Segments of a path node (identifier, crate/self/super, scoped_identifier). */
function pathOf(n: SyntaxNode): Path {
  if (n.type !== 'scoped_identifier') return { segments: [n.text], leadingColons: false };
  const parent = n.childForFieldName('path');
  const name = n.childForFieldName('name');
  const head: Path = parent ? pathOf(parent) : { segments: [], leadingColons: true };
  return { segments: name ? [...head.segments, name.text] : head.segments, leadingColons: head.leadingColons };
}

const join = (a: Path, b: Path): Path =>
  ({ segments: [...a.segments, ...b.segments], leadingColons: a.leadingColons || (a.segments.length === 0 && b.leadingColons) });

const EMPTY: Path = { segments: [], leadingColons: false };

/** Leaves of a use tree under `prefix`. */
function leaves(n: SyntaxNode, prefix: Path, out: Leaf[]): void {
  switch (n.type) {
    case 'use_list':
      for (const c of n.namedChildren) leaves(c, prefix, out);
      return;
    case 'scoped_use_list': {
      const p = n.childForFieldName('path');
      const list = n.childForFieldName('list');
      // `::{a, b}` has no path but a leading `::` token.
      const head = p ? pathOf(p) : { segments: [], leadingColons: n.children.some(c => c.type === '::') };
      if (list) leaves(list, join(prefix, head), out);
      return;
    }
    case 'use_as_clause': {
      const p = n.childForFieldName('path');
      const alias = n.childForFieldName('alias');
      if (p) out.push({ node: n, path: leafPath(prefix, p), alias: alias?.text });
      return;
    }
    case 'use_wildcard': {
      const p = n.namedChildren.find(c => c.type !== 'comment');
      // `*` alone in a list (`a::{*}`) has no path child.
      const head = p ? pathOf(p) : { segments: [], leadingColons: n.children.some(c => c.type === '::') };
      out.push({ node: n, path: join(prefix, head), wildcard: true });
      return;
    }
    case 'identifier': case 'scoped_identifier': case 'self': case 'crate': case 'super': case 'metavariable':
      out.push({ node: n, path: leafPath(prefix, n) });
      return;
    default:
      return;
  }
}

/** `self` as a list leaf names the prefix itself. */
function leafPath(prefix: Path, n: SyntaxNode): Path {
  if (n.type === 'self' && prefix.segments.length > 0) return prefix;
  return join(prefix, pathOf(n));
}

function useForm(segments: string[], leadingColons: boolean): Pick<ImportRecord, 'normalized' | 'package' | 'locality'> {
  const first = segments[0];
  if (first !== undefined && LOCAL_ROOTS.has(first)) {
    return { normalized: first === 'crate' ? segments.join('::') : null, package: 'crate', locality: 'local' };
  }
  return { normalized: segments.join('::'), package: leadingColons && first ? first : undefined, locality: 'unknown' };
}

function useRecords(decl: SyntaxNode, out: ImportRecord[]): void {
  const arg = decl.childForFieldName('argument');
  if (!arg) return;
  const ls: Leaf[] = [];
  leaves(arg, EMPTY, ls);
  for (const l of ls) {
    if (l.path.segments.length === 0) continue;
    out.push(record({
      at: ls.length === 1 ? decl : l.node, evidenceOf: decl, kind: 'static', form: 'use',
      module: l.path.segments.join('::'), ...useForm(l.path.segments, l.path.leadingColons),
      alias: l.alias, wildcard: l.wildcard,
    }));
  }
}

function externCrate(decl: SyntaxNode, out: ImportRecord[]): void {
  const name = decl.childForFieldName('name');
  if (!name) return;
  const alias = decl.childForFieldName('alias');
  const self = name.text === 'self';
  out.push(record({
    at: decl, kind: 'static', form: 'extern-crate', module: name.text,
    normalized: self ? null : name.text, package: self ? 'crate' : name.text, locality: self ? 'local' : 'unknown',
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
    at: start, end: item, kind: 'include', form: 'mod', module: name.text, normalized: null, package: 'crate', locality: 'local',
  }));
}

const DECLARATIONS = new Set(['use_declaration', 'extern_crate_declaration', 'mod_item']);

export const extractRust: LanguageExtractor = root => {
  const out: ImportRecord[] = [];
  for (const n of walk(root, DECLARATIONS)) {
    if (n.type === 'use_declaration') useRecords(n, out);
    else if (n.type === 'extern_crate_declaration') externCrate(n, out);
    else if (n.type === 'mod_item') modItem(n, out);
  }
  return out;
};

