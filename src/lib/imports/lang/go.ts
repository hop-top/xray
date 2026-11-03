/**
 * Go static imports: one record per `import_spec`.
 *
 * Range: the whole declaration for `import "x"`, the spec inside a group.
 * Evidence is the range text (each grouped spec is a complete import).
 * Locality / package come from go.mod in the resolution pass.
 *
 * Unsupported (the static record is kept): `import "C"` (cgo: the preamble
 * can pull in C code), `import "plugin"` (plugin.Open loads shared objects
 * at run time), and every `//go:linkname` directive comment (detail = the
 * target symbol, or the local name for the one-argument push form).
 */

import type { ImportRecord, UnsupportedRecord } from '../types';
import { record, walk, type LanguageExtractor, type SyntaxNode } from '../record';
import { unsupportedAt } from '../unsupported';

/** Path without quotes, raw (backtick) or interpreted. Escapes left as written. */
function unquote(lit: SyntaxNode): string {
  const t = lit.text;
  return t.length >= 2 ? t.slice(1, -1) : t;
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
      const name = spec.childForFieldName('name');
      const span = grouped ? spec : decl;
      out.push(record({
        at: span, kind: 'static', form: 'import', module, normalized: module, locality: 'unknown', alias: name?.text,
      }));
      if (unsupported && module === 'C') unsupported.push(unsupportedAt(span, 'cgo', 'cgo preamble can include C code'));
      if (unsupported && module === 'plugin') {
        unsupported.push(unsupportedAt(span, 'plugin', 'plugin.Open loads shared objects at run time'));
      }
    }
  }
  if (unsupported) linknames(root, unsupported);
  return out;
};

