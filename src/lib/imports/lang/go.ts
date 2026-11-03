/**
 * Go static imports: one record per `import_spec`.
 *
 * Range: the whole declaration for `import "x"`, the spec inside a group.
 * Evidence is the range text (each grouped spec is a complete import).
 * Locality / package come from go.mod in the resolution pass.
 */

import type { ImportRecord } from '../types';
import { record, type LanguageExtractor, type SyntaxNode } from '../record';

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

export const extractGo: LanguageExtractor = root => {
  const out: ImportRecord[] = [];
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
    }
  }
  return out;
};

