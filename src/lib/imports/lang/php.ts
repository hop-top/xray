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
 */

import * as posix from 'path/posix';
import type { ImportForm, ImportKind, ImportRecord } from '../types';
import { record, walk, type LanguageExtractor, type SyntaxNode } from '../record';

/** Qualified name text without whitespace or a leading `\`. */
const fqn = (n: SyntaxNode) => n.text.replace(/\s+/g, '').replace(/^\\/, '');

function clauseType(n: SyntaxNode): string | undefined {
  return n.childForFieldName('type')?.text.toLowerCase();
}

function useRecords(decl: SyntaxNode, out: ImportRecord[]): void {
  const declType = clauseType(decl);
  const group = decl.childForFieldName('body');
  const prefixNode = group ? decl.namedChildren.find(c => c.type === 'namespace_name') : undefined;
  const prefix = prefixNode ? fqn(prefixNode) : '';
  const clauses = (group ?? decl).namedChildren.filter(c => c.type === 'namespace_use_clause');
  for (const clause of clauses) {
    const alias = clause.childForFieldName('alias');
    const nameNode = clause.namedChildren.find(c => c !== alias && (c.type === 'qualified_name' || c.type === 'name'));
    if (!nameNode) continue;
    const name = fqn(nameNode);
    const module = prefix ? `${prefix}\\${name}` : name;
    const type = clauseType(clause) ?? declType;
    const form: ImportForm = type === 'function' ? 'use-function' : type === 'const' ? 'use-const' : group ? 'group-use' : 'use';
    out.push(record({
      at: clauses.length === 1 ? decl : clause, evidenceOf: decl, kind: 'static', form,
      module, normalized: module, package: module.split('\\')[0], locality: 'unknown', alias: alias?.text,
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
  const t = n.text;
  if (t.length < 2) return undefined;
  const raw = t.slice(1, -1);
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

function includeRecord(n: SyntaxNode, filePath: string, out: ImportRecord[]): void {
  const spec = INCLUDES[n.type];
  const arg = n.namedChildren.find(c => c.type !== 'comment');
  if (!spec || !arg) return;
  const target = includeTarget(arg, filePath);
  if (!target) return;
  const stmt = n.parent?.type === 'expression_statement' ? n.parent : n;
  out.push(record({
    at: n, evidenceOf: stmt, kind: spec.kind, form: spec.form,
    module: target.module, normalized: target.normalized, locality: 'unknown',
  }));
}

const STATEMENTS = new Set(['namespace_use_declaration', ...Object.keys(INCLUDES)]);

export const extractPhp: LanguageExtractor = (root, ctx) => {
  const out: ImportRecord[] = [];
  for (const n of walk(root, STATEMENTS)) {
    if (n.type === 'namespace_use_declaration') useRecords(n, out);
    else if (n.type in INCLUDES) includeRecord(n, ctx.path, out);
  }
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

