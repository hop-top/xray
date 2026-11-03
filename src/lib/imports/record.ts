/**
 * Shared helpers for language extractors: positions, evidence and records
 * built with the schema's key order (goldens compare serialized output).
 */

import type Parser from 'tree-sitter';
import type { ImportName, ImportRecord, Resolved, RelativeRef, UnsupportedRecord } from './types';

/** What an extractor gets per file. */
export interface ExtractContext {
  /** Posix path relative to the scan root. */
  path: string;
  /** Contract language name (registry key). */
  language: string;
  /** Sink for constructs that can load code no record names; any order, the caller sorts. Absent = not collected. */
  unsupported?: UnsupportedRecord[];
}

export type SyntaxNode = Parser.SyntaxNode;

/** Records in any order; the caller sorts. */
export type LanguageExtractor = (root: SyntaxNode, ctx: ExtractContext) => ImportRecord[];

export const EVIDENCE_MAX = 240;

/**
 * UTF-16 units of source read for one evidence string: EVIDENCE_MAX code
 * points with room for surrogate pairs and collapsed whitespace. Evidence
 * work is bounded by this, never by the size of the node.
 */
export const EVIDENCE_WINDOW = EVIDENCE_MAX * 4;

/**
 * Whitespace-collapsed text, at most EVIDENCE_MAX code points (truncation
 * ends in `…`). `cut`: the text is a window of a longer range, so the
 * result is truncated even when the window collapses short.
 */
function collapse(text: string, cut: boolean): string {
  // A window ending inside a surrogate pair: drop the lone high half.
  const last = text.charCodeAt(text.length - 1);
  const t = cut && last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
  const cps = Array.from(t.replace(/\s+/g, ' ').trim());
  return !cut && cps.length <= EVIDENCE_MAX ? cps.join('') : cps.slice(0, EVIDENCE_MAX - 1).join('') + '…';
}

/** Evidence of `source[start, end)`, reading at most EVIDENCE_WINDOW units of it. */
export function evidenceRange(source: string, start: number, end: number): string {
  const stop = Math.min(end, start + EVIDENCE_WINDOW);
  return collapse(source.slice(start, stop), stop < end);
}

/** Evidence of an arbitrary string (bounded the same way). */
export function evidence(text: string): string {
  return evidenceRange(text, 0, text.length);
}

/**
 * Evidence of the source from the start of `from` through the end of `to`
 * (`to` at or after `from`, same tree). Reads at most EVIDENCE_WINDOW units
 * straight from the tree's input: never the node's full `.text`, no
 * `.parent` climbs.
 */
export function nodeEvidence(from: SyntaxNode, to: SyntaxNode = from): string {
  const start = from.startIndex;
  const end = Math.max(start, to.endIndex);
  const stop = Math.min(end, start + EVIDENCE_WINDOW);
  // Tree#getText reads only startIndex/endIndex of its argument.
  const text = from.tree.getText({ startIndex: start, endIndex: stop } as SyntaxNode);
  return collapse(text, stop < end);
}

/**
 * 1-based line / column from the start of `from` to the end of `to`
 * (defaults to one node). The node binding parses JS strings, so columns
 * are UTF-16 code units; `endColumn` is exclusive (the column just past the
 * last character).
 */
export function span(from: SyntaxNode, to: SyntaxNode = from): Pick<ImportRecord, 'line' | 'column' | 'endLine' | 'endColumn'> {
  return {
    line: from.startPosition.row + 1,
    column: from.startPosition.column + 1,
    endLine: to.endPosition.row + 1,
    endColumn: to.endPosition.column + 1,
  };
}

export interface RecordFields {
  at: SyntaxNode;
  /** Range end node (defaults to `at`): the range spans `at`..`end`. */
  end?: SyntaxNode;
  kind: ImportRecord['kind'];
  form: ImportRecord['form'];
  module: string;
  normalized: string | null;
  package?: string;
  locality: ImportRecord['locality'];
  relative?: RelativeRef;
  alias?: string;
  names?: ImportName[];
  wildcard?: boolean;
  typeOnly?: boolean;
  resolved?: Resolved;
  confidence?: ImportRecord['confidence'];
  /** kind `reference` only. */
  occurrences?: number;
  /** Node whose text is the evidence (defaults to the range text). */
  evidenceOf?: SyntaxNode;
}

/** Record in schema key order; optional fields omitted when absent / false. */
export function record(f: RecordFields): ImportRecord {
  const r: ImportRecord = {
    ...span(f.at, f.end),
    kind: f.kind,
    form: f.form,
    module: f.module,
    normalized: f.normalized,
  } as ImportRecord;
  if (f.package !== undefined) r.package = f.package;
  r.locality = f.locality;
  if (f.relative) r.relative = f.relative;
  if (f.alias !== undefined) r.alias = f.alias;
  if (f.names && f.names.length > 0) r.names = f.names;
  if (f.wildcard) r.wildcard = true;
  if (f.typeOnly) r.typeOnly = true;
  if (f.resolved) r.resolved = f.resolved;
  r.confidence = f.confidence ?? 'syntactic';
  if (f.occurrences !== undefined) r.occurrences = f.occurrences;
  r.evidence = f.evidenceOf ? nodeEvidence(f.evidenceOf) : nodeEvidence(f.at, f.end ?? f.at);
  return r;
}

/** Named descendants of the given types, document order (iterative). */
export function* walk(root: SyntaxNode, types: ReadonlySet<string>): Generator<SyntaxNode> {
  const cursor = root.walk();
  let descend = true;
  for (;;) {
    if (descend && cursor.nodeIsNamed && types.has(cursor.nodeType)) yield cursor.currentNode;
    if (descend && cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) { descend = true; continue; }
    if (!cursor.gotoParent()) return;
    descend = false;
  }
}

/**
 * Document-order cursor walk over every node with enter / leave callbacks,
 * so callers carry ancestor state down a stack instead of climbing
 * `.parent` (O(depth) per access in node-tree-sitter). `enter` sees the
 * cursor on the node; `leave` runs after its subtree, in reverse order.
 */
export function traverse(root: SyntaxNode, enter: (c: Parser.TreeCursor) => void, leave: () => void): void {
  const cursor = root.walk();
  for (;;) {
    enter(cursor);
    if (cursor.gotoFirstChild()) continue;
    for (;;) {
      leave();
      if (cursor.gotoNextSibling()) break;
      if (!cursor.gotoParent()) return;
    }
  }
}

/** Imported name; `alias` kept whenever written (`import { x as x }` is explicit). */
export function name(n: string, alias?: string): ImportName {
  return alias !== undefined ? { name: n, alias } : { name: n };
}
