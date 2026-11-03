/**
 * Shared helpers for language extractors: positions, evidence and records
 * built with the schema's key order (goldens compare serialized output).
 */

import type Parser from 'tree-sitter';
import type { ImportName, ImportRecord, Resolved, RelativeRef } from './types';

/** What an extractor gets per file. */
export interface ExtractContext {
  /** Posix path relative to the scan root. */
  path: string;
  /** Contract language name (registry key). */
  language: string;
}

export type SyntaxNode = Parser.SyntaxNode;

/** Records in any order; the caller sorts. */
export type LanguageExtractor = (root: SyntaxNode, ctx: ExtractContext) => ImportRecord[];

export const EVIDENCE_MAX = 240;

/** Whitespace-collapsed text, at most EVIDENCE_MAX code points (truncation ends in `…`). */
export function evidence(text: string): string {
  const cps = Array.from(text.replace(/\s+/g, ' ').trim());
  return cps.length <= EVIDENCE_MAX ? cps.join('') : cps.slice(0, EVIDENCE_MAX - 1).join('') + '…';
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

/** Source text from the start of `from` through the end of `to` (`to` at or after `from`). */
export function textBetween(from: SyntaxNode, to: SyntaxNode): string {
  if (from === to) return to.text;
  let p: SyntaxNode | null = to.parent;
  while (p && p.startIndex > from.startIndex) p = p.parent;
  if (!p) return to.text;
  return p.text.slice(from.startIndex - p.startIndex, to.endIndex - p.startIndex);
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
  r.evidence = evidence(f.evidenceOf ? f.evidenceOf.text : textBetween(f.at, f.end ?? f.at));
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

/** Imported name; `alias` kept whenever written (`import { x as x }` is explicit). */
export function name(n: string, alias?: string): ImportName {
  return alias !== undefined ? { name: n, alias } : { name: n };
}
