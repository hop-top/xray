/**
 * Coverage helpers: unsupported records, parse errors, and the one
 * filename rule (Cargo build scripts), all per-file syntax.
 */

import * as posix from 'path/posix';
import { evidence, nodeEvidence, type SyntaxNode } from './record';
import type { ParseError, Position, UnsupportedConstruct, UnsupportedRecord } from './types';

/** Unsupported record at the start of `at`; evidence = `at`'s text unless given. */
export function unsupportedAt(at: SyntaxNode, construct: UnsupportedConstruct, detail?: string, text?: string): UnsupportedRecord {
  const r: UnsupportedRecord = { line: at.startPosition.row + 1, column: at.startPosition.column + 1, construct } as UnsupportedRecord;
  if (detail !== undefined) r.detail = detail;
  r.evidence = text !== undefined ? evidence(text) : nodeEvidence(at);
  return r;
}

const pos = (p: { row: number; column: number }): Position => ({ line: p.row + 1, column: p.column + 1 });

/**
 * ERROR and MISSING nodes, document order. Only subtrees that contain an
 * error are entered, and an ERROR node's own subtree is not (nested errors
 * are part of it). Explicit stack: error regions nest without bound.
 */
export function parseErrors(root: SyntaxNode): ParseError[] {
  if (!root.hasError) return [];
  const out: ParseError[] = [];
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === 'ERROR' || n.isMissing) {
      out.push({ kind: n.isMissing ? 'missing' : 'error', start: pos(n.startPosition), end: pos(n.endPosition) });
      continue;
    }
    if (!n.hasError) continue;
    const cs = n.children;
    for (let i = cs.length - 1; i >= 0; i--) stack.push(cs[i]);
  }
  return out.sort((a, b) => a.start.line - b.start.line || a.start.column - b.start.column);
}

/** Position just past the last character of `text` (1-based, UTF-16), for whole-file ranges. */
export function endOf(text: string): Position {
  const lines = text.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Value of `build = ...` in the `[package]` table: a path, true (default), false, or undefined (absent). */
function cargoBuild(toml: string): { inPackage: boolean; build?: string | boolean; line?: string } {
  let table = '';
  let inPackage = false;
  let build: string | boolean | undefined;
  let line: string | undefined;
  for (const raw of toml.split(/\r?\n/)) {
    const l = raw.trim();
    // Table header `[name]`: first `]`, no regex (a long unclosed `[` line must stay linear).
    const close = l.startsWith('[') ? l.indexOf(']') : -1;
    if (close > 1 && !l.startsWith('[[')) {
      table = l.slice(1, close).trim();
      if (table === 'package') inPackage = true;
      continue;
    }
    if (l.startsWith('[[')) { table = ''; continue; }
    if (table !== 'package') continue;
    const m = /^build\s*=\s*(?:"([^"]*)"|'([^']*)'|(true|false))\s*(?:#.*)?$/.exec(l);
    if (!m) continue;
    build = m[3] !== undefined ? m[3] === 'true' : (m[1] ?? m[2]);
    line = l;
  }
  return { inPackage, build, line };
}

/**
 * Cargo build scripts in the file set, by posix path: `build.rs` beside a
 * Cargo.toml that has a `[package]` table, unless `build = false`; or the
 * path named by `build = "..."` (relative to the manifest). The record sits
 * at 1:1 of the script; evidence is the `build = ...` line, else the file name.
 */
export function cargoBuildScripts(files: readonly { path: string; content: string | Buffer }[]): Map<string, UnsupportedRecord> {
  const out = new Map<string, UnsupportedRecord>();
  for (const f of files) {
    if (posix.basename(f.path) !== 'Cargo.toml') continue;
    const toml = typeof f.content === 'string' ? f.content : f.content.toString('utf8');
    const { inPackage, build, line } = cargoBuild(toml);
    if (!inPackage || build === false) continue;
    const dir = posix.dirname(f.path);
    const script = typeof build === 'string' ? posix.normalize(posix.join(dir, build)) : posix.join(dir, 'build.rs');
    out.set(script.startsWith('./') ? script.slice(2) : script, {
      line: 1,
      column: 1,
      construct: 'build-script',
      detail: `Cargo build script of ${f.path}: runs before compilation, may generate code`,
      evidence: evidence(line ?? posix.basename(script)),
    });
  }
  return out;
}
