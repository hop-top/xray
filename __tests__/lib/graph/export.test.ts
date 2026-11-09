import { parse } from 'csv-parse/sync';

const parseCsv = (text: string): any[] => parse(text, { columns: true }) as any[];
import { DOMParser } from '@xmldom/xmldom';

import {
  graphToEdgesCsv,
  graphToNodesCsv,
  graphToXml,
} from '../../../src/lib/graph/export';
import type { SerializedGraph } from '../../../src/lib/query/types';

const mk = (nodes: any[], edges: any[] = [], extra: any = {}): SerializedGraph => ({
  metadata: {
    version: '1.0',
    timestamp: 't',
    projectPath: '/p',
    nodeCount: nodes.length,
    edgeCount: edges.length,
    ...extra,
  },
  nodes,
  edges,
});

describe('CSV export', () => {
  const nasty = 'say "hi", a\nnewline, é\u{1F600}';
  const g = mk(
    [
      { id: 'z.ts', type: 'file', label: 'z.ts' },
      { id: 'a.ts::f', type: 'tag', label: 'f', kind: 'function', file: 'a.ts', line: 0, endLine: 3, signature: nasty, doc: 'd,"q"' },
    ],
    [
      { source: 'z.ts', target: 'a.ts::f', type: 'imports', confidence: 'EXTRACTED' },
      { source: 'a.ts', target: 'a.ts::f', type: 'defines', confidence: 'EXTRACTED', community: 'c1' },
      { source: 'q,"t".ts', target: 'a.ts::f', type: 'calls', confidence: 'EXTRACTED' },
    ]
  );

  test('round-trips through a real CSV parser, sorted, stable columns', () => {
    const nodes = parseCsv(graphToNodesCsv(g));
    expect(nodes.map((n: any) => n.id)).toEqual(['a.ts::f', 'z.ts']);
    expect(Object.keys(nodes[0])).toEqual([
      'id', 'type', 'label', 'kind', 'file', 'line', 'endLine', 'signature', 'doc', 'rank', 'root',
    ]);
    expect(nodes[0].signature).toBe(nasty);
    expect(nodes[0].doc).toBe('d,"q"');
    expect(nodes[0].line).toBe('0');
    const edges = parseCsv(graphToEdgesCsv(g));
    expect(edges.map((e: any) => e.source)).toEqual(['a.ts', 'q,"t".ts', 'z.ts']);
    expect(edges[0].community).toBe('c1');
    expect(edges[2].community).toBe('');
  });

  test('root column filled from id prefix for merged graphs', () => {
    const m = mk([{ id: 'a/x.ts', type: 'file', label: 'x.ts' }], [], { roots: [{ label: 'a', path: '/a' }] });
    expect(parseCsv(graphToNodesCsv(m))[0].root).toBe('a');
  });
});

describe('XML export', () => {
  const nasty = `<a href="x">&'q'</a>\n\ttab\u0001ctl \u{1F600}`;
  const g = mk(
    [
      { id: 'b"<>&\'.ts', type: 'file', label: 'l', imports: [{ file: 'b', source: './x"y', text: 'i&j' }] },
      { id: 'a.ts::f', type: 'tag', label: 'f', kind: 'function', file: 'a.ts', line: 0, signature: nasty, doc: nasty },
    ],
    [{ source: 'a.ts', target: 'b"<>&\'.ts', type: 'calls', confidence: 'EXTRACTED' }]
  );

  const parseXml = (xml: string) => {
    const errors: string[] = [];
    const doc = new DOMParser({
      onError: (level: string, msg: string) => { if (level !== 'warning') errors.push(msg); },
    }).parseFromString(xml, 'text/xml');
    expect(errors).toEqual([]);
    return doc;
  };

  test('well-formed; counts match; special characters round-trip', () => {
    const doc = parseXml(graphToXml(g));
    const nodes = Array.from(doc.getElementsByTagName('node'));
    const edges = Array.from(doc.getElementsByTagName('edge'));
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(nodes.map(n => n.getAttribute('id'))).toEqual(['a.ts::f', 'b"<>&\'.ts']);
    const cleaned = nasty.replace('\u0001', '�');
    expect(nodes[0].getAttribute('signature')).toBe(cleaned);
    expect(nodes[0].getElementsByTagName('doc')[0].textContent).toBe(cleaned);
    const imp = doc.getElementsByTagName('import')[0];
    expect(imp.getAttribute('source')).toBe('./x"y');
    expect(doc.documentElement?.tagName).toBe('graph');
  });

  test('roots listed in metadata for merged graphs', () => {
    const m = mk([{ id: 'a/x.ts', type: 'file', label: 'x.ts' }], [], { roots: [{ label: 'a', path: '/a' }] });
    const doc = parseXml(graphToXml(m));
    const root = doc.getElementsByTagName('root')[0];
    expect(root.getAttribute('label')).toBe('a');
    expect(root.getAttribute('path')).toBe('/a');
  });
});
