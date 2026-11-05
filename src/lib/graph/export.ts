/**
 * Tabular / markup renderings of a SerializedGraph.
 *
 * - CSV: two tables, nodes + edges (each a standard RFC 4180 file, quoting
 *   by csv-stringify). Fixed column order; rows sorted by id / (source,
 *   target, type).
 * - XML: one `<graph>` document mirroring the JSON graph.
 *
 * Both are deterministic for a given graph and carry the same node/edge
 * sets as the JSON form (CSV omits `imports`, which the `imports` edges
 * already express). XML also carries a function's `cfg` / `dfg` (`--with
 * cf|df`); CSV has no form for them (the run refuses cf/df with csv).
 */
import { stringify } from 'csv-stringify/sync';
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../query/types';
import type { Cfg, Dfg } from '../flow/types';

export const NODE_COLUMNS = [
  'id', 'type', 'label', 'kind', 'file', 'line', 'endLine', 'signature', 'doc', 'rank', 'root',
] as const;
export const EDGE_COLUMNS = ['source', 'target', 'type', 'confidence', 'community'] as const;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const sortedNodes = (g: SerializedGraph): SerializedNode[] =>
  [...g.nodes].sort((a, b) => byCodeUnit(a.id, b.id));

export const sortedEdges = (g: SerializedGraph): SerializedEdge[] =>
  [...g.edges].sort(
    (a, b) =>
      byCodeUnit(a.source, b.source) || byCodeUnit(a.target, b.target) || byCodeUnit(a.type, b.type)
  );

/** Root label of a node in a merged graph (first id segment); '' otherwise. */
const rootOf = (g: SerializedGraph, id: string): string =>
  g.metadata.roots ? id.slice(0, id.indexOf('/')) : '';

export function graphToNodesCsv(g: SerializedGraph): string {
  const rows = sortedNodes(g).map(n => ({ ...n, root: rootOf(g, n.id) }));
  return stringify(rows, { header: true, columns: [...NODE_COLUMNS] });
}

export function graphToEdgesCsv(g: SerializedGraph): string {
  return stringify(sortedEdges(g), { header: true, columns: [...EDGE_COLUMNS] });
}

// XML 1.0 forbids most C0 controls, U+FFFE/U+FFFF and lone surrogates.
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Escape text content. */
export function escapeXmlText(s: string): string {
  return s
    .replace(XML_ILLEGAL, '�')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

/** Escape an attribute value (also preserves \t \n \r through parsing). */
export function escapeXmlAttr(s: string): string {
  return escapeXmlText(s)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;');
}

type Attr = [string, unknown];
const attrs = (pairs: Attr[]): string =>
  pairs
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(String(v))}"`)
    .join('');

const truncation = (t: { nodes: number; limit: number } | undefined): Attr[] =>
  t ? [['truncated', true], ['total', t.nodes], ['limit', t.limit]] : [];

/** `<cfg>`: `<step>` per CFG node, `<next>` per edge, `<closure>` per nested function. */
function cfgXml(cfg: Cfg, indent: string, out: string[], name: string, extra: Attr[] = []): void {
  out.push(`${indent}<${name}${attrs([...extra, ...truncation(cfg.truncated)])}>`);
  for (const n of cfg.nodes) {
    out.push(`${indent}  <step${attrs([
      ['id', n.id], ['kind', n.kind], ['line', n.line], ['label', n.label], ['calls', n.calls?.join(', ')],
    ])}/>`);
  }
  for (const e of cfg.edges) out.push(`${indent}  <next${attrs([['from', e.from], ['to', e.to], ['label', e.label]])}/>`);
  for (const c of cfg.closures ?? []) cfgXml(c, indent + '  ', out, 'closure', [['name', c.name], ['line', c.line]]);
  out.push(`${indent}</${name}>`);
}

/** `<dfg>`: `<def>` per definition, `<use>` per def-use edge, `<site>` per reading CFG node. */
function dfgXml(dfg: Dfg, indent: string, out: string[], name: string, extra: Attr[] = []): void {
  out.push(`${indent}<${name}${attrs([...extra, ...truncation(dfg.truncated)])}>`);
  for (const d of dfg.nodes) {
    out.push(`${indent}  <def${attrs([
      ['id', d.id], ['name', d.name], ['kind', d.kind], ['line', d.line], ['at', d.at],
      ['weak', d.weak], ['captured', d.captured],
    ])}/>`);
  }
  for (const e of dfg.edges) out.push(`${indent}  <use${attrs([['from', e.from], ['to', e.to]])}/>`);
  for (const s of dfg.sites) out.push(`${indent}  <site${attrs([['id', s.id], ['line', s.line], ['label', s.label]])}/>`);
  for (const c of dfg.closures ?? []) dfgXml(c, indent + '  ', out, 'closure', [['name', c.name], ['line', c.line]]);
  out.push(`${indent}</${name}>`);
}

export function graphToXml(g: SerializedGraph): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<graph>'];
  const m = g.metadata;
  const metaAttrs = attrs([
    ['version', m.version],
    ['timestamp', m.timestamp],
    ['projectPath', m.projectPath],
    ['nodeCount', m.nodeCount],
    ['edgeCount', m.edgeCount],
  ]);
  if (m.roots && m.roots.length > 0) {
    out.push(`  <metadata${metaAttrs}>`, '    <roots>');
    for (const r of m.roots) out.push(`      <root${attrs([['label', r.label], ['path', r.path]])}/>`);
    out.push('    </roots>', '  </metadata>');
  } else {
    out.push(`  <metadata${metaAttrs}/>`);
  }

  out.push('  <nodes>');
  for (const n of sortedNodes(g)) {
    const a = attrs([
      ['id', n.id], ['type', n.type], ['label', n.label], ['kind', n.kind], ['file', n.file],
      ['line', n.line], ['endLine', n.endLine], ['signature', n.signature], ['rank', n.rank],
      ['root', rootOf(g, n.id) || undefined],
    ]);
    const imports = n.imports ?? [];
    if (n.doc === undefined && imports.length === 0 && !n.cfg && !n.dfg) {
      out.push(`    <node${a}/>`);
      continue;
    }
    out.push(`    <node${a}>`);
    if (n.doc !== undefined) out.push(`      <doc>${escapeXmlText(String(n.doc))}</doc>`);
    if (imports.length > 0) {
      out.push('      <imports>');
      for (const imp of imports) {
        out.push(`        <import${attrs(Object.entries(imp as unknown as Record<string, unknown>))}/>`);
      }
      out.push('      </imports>');
    }
    if (n.cfg) cfgXml(n.cfg, '      ', out, 'cfg');
    if (n.dfg) dfgXml(n.dfg, '      ', out, 'dfg');
    out.push('    </node>');
  }
  out.push('  </nodes>', '  <edges>');
  for (const e of sortedEdges(g)) {
    out.push(
      `    <edge${attrs([
        ['source', e.source], ['target', e.target], ['type', e.type],
        ['confidence', e.confidence], ['community', e.community],
      ])}/>`
    );
  }
  out.push('  </edges>', '</graph>', '');
  return out.join('\n');
}
