/**
 * Go static imports: one record per `import_spec`.
 *
 * Range: the whole declaration for `import "x"`, the spec inside a group.
 * Evidence is the range text (each grouped spec is a complete import).
 * Locality / package come from go.mod in the resolution pass.
 * `module` is the path as written; `normalized` the value of an interpreted
 * string (`"\x63obra"` -> `cobra`). An escape Go rejects leaves `normalized`
 * null and adds an `invalid-escape` unsupported record.
 *
 * Unsupported (the static record is kept): `import "C"` (cgo: the preamble
 * can pull in C code), `import "plugin"` (plugin.Open loads shared objects
 * at run time), and every `//go:linkname` directive comment (detail = the
 * target symbol, or the local name for the one-argument push form).
 */

import type { ImportRecord, UnsupportedRecord } from '../types';
import { decodeGoString } from '../escapes';
import { MODULE_WINDOW, moduleSource, record, walk, type LanguageExtractor, type SyntaxNode } from '../record';
import { unsupportedAt } from '../unsupported';

/** Path without quotes, raw (backtick) or interpreted, escapes as written. Bounded read (moduleSource). */
function unquote(lit: SyntaxNode): string {
  const { text: t, cut } = moduleSource(lit);
  if (cut) return t.slice(1);
  return t.length >= 2 ? t.slice(1, -1) : t;
}

/**
 * Value of the path: interpreted strings decoded; raw ones without their
 * carriage returns (the spec drops them); cut reads (oversized, capped
 * later) as written; undefined = bad escape.
 */
function valueOf(lit: SyntaxNode, written: string): string | undefined {
  if (written.length >= MODULE_WINDOW - 1) return written;
  return lit.type === 'interpreted_string_literal' ? decodeGoString(written) : written.replace(/\r/g, '');
}

function specs(decl: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (const c of decl.namedChildren) {
    if (c.type === 'import_spec') out.push(c);
    else if (c.type === 'import_spec_list') out.push(...c.namedChildren.filter(s => s.type === 'import_spec'));
  }
  return out;
}

const COMMENTS = new Set(['comment']);

/** `//go:linkname local [target]` directives anywhere in the file. */
function linknames(root: SyntaxNode, out: UnsupportedRecord[]): void {
  for (const c of walk(root, COMMENTS)) {
    const m = /^\/\/go:linkname\s+(\S+)(?:\s+(\S+))?/.exec(c.text);
    if (m) out.push(unsupportedAt(c, 'linkname', m[2] ?? m[1]));
  }
}

export const extractGo: LanguageExtractor = (root, ctx) => {
  const out: ImportRecord[] = [];
  const unsupported = ctx.unsupported;
  for (const decl of root.namedChildren) {
    if (decl.type !== 'import_declaration') continue;
    const list = specs(decl);
    const grouped = decl.namedChildren.some(c => c.type === 'import_spec_list');
    for (const spec of list) {
      const pathNode = spec.childForFieldName('path');
      if (!pathNode) continue;
      const module = unquote(pathNode);
      const value = valueOf(pathNode, module);
      const name = spec.childForFieldName('name');
      const span = grouped ? spec : decl;
      out.push(record({
        at: span, kind: 'static', form: 'import', module, normalized: value ?? null, locality: 'unknown', alias: name?.text,
      }));
      if (unsupported && value === undefined) {
        unsupported.push(unsupportedAt(span, 'invalid-escape', 'import path has an escape sequence Go rejects'));
      }
      if (unsupported && value === 'C') unsupported.push(unsupportedAt(span, 'cgo', 'cgo preamble can include C code'));
      if (unsupported && value === 'plugin') {
        unsupported.push(unsupportedAt(span, 'plugin', 'plugin.Open loads shared objects at run time'));
      }
    }
  }
  if (unsupported) linknames(root, unsupported);
  return out;
};

