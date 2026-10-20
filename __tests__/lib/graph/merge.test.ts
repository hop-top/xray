import { deriveRootLabels, mergeSerializedGraphs } from '../../../src/lib/graph/merge';
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

describe('deriveRootLabels', () => {
  test('inside cwd: relative path flattened; outside: basename', () => {
    const l = deriveRootLabels(['/w/pkg/api', '/w/web', '/elsewhere/lib'], '/w');
    expect(l.map(r => r.label)).toEqual(['pkg-api', 'web', 'lib']);
    expect(l[0].path).toBe('/w/pkg/api');
  });

  test('colliding basenames get -2, -3 suffixes in input order', () => {
    const l = deriveRootLabels(['/x/app', '/y/app', '/z/app'], '/w');
    expect(l.map(r => r.label)).toEqual(['app', 'app-2', 'app-3']);
  });

  test('root equal to cwd falls back to basename; labels never contain /', () => {
    const l = deriveRootLabels(['/w', '/w/a/b/c'], '/w');
    expect(l.map(r => r.label)).toEqual(['w', 'a-b-c']);
    expect(l.every(r => !r.label.includes('/'))).toBe(true);
  });
});

describe('mergeSerializedGraphs', () => {
  const g1 = mk(
    [
      { id: 'main.ts', type: 'file', label: 'main.ts', imports: [{ file: 'main.ts', source: './u', text: 'x' }] },
      { id: 'main.ts::main', type: 'tag', label: 'main', file: 'main.ts', line: 1 },
    ],
    [{ source: 'main.ts', target: 'main.ts::main', type: 'defines' }]
  );
  const g2 = mk(
    [
      { id: 'main.ts', type: 'file', label: 'main.ts' },
      { id: 'main.ts::main', type: 'tag', label: 'main', file: 'main.ts', line: 9 },
    ],
    [{ source: 'main.ts', target: 'main.ts::main', type: 'defines' }]
  );

  test('single part is returned untouched', () => {
    expect(mergeSerializedGraphs([{ root: '/w/a', graph: g1 }], '/w')).toBe(g1);
  });

  test('namespaces ids/files/imports, unions edges, records roots', () => {
    const m = mergeSerializedGraphs(
      [{ root: '/w/a', graph: g1 }, { root: '/w/b', graph: g2 }],
      '/w'
    );
    expect(m.nodes.map(n => n.id)).toEqual([
      'a/main.ts', 'a/main.ts::main', 'b/main.ts', 'b/main.ts::main',
    ]);
    expect(new Set(m.nodes.map(n => n.id)).size).toBe(4);
    expect(m.nodes[1].file).toBe('a/main.ts');
    expect((m.nodes[0].imports as any)[0].file).toBe('a/main.ts');
    expect(m.edges).toEqual([
      { source: 'a/main.ts', target: 'a/main.ts::main', type: 'defines' },
      { source: 'b/main.ts', target: 'b/main.ts::main', type: 'defines' },
    ]);
    expect(m.metadata.roots).toEqual([
      { label: 'a', path: '/w/a' },
      { label: 'b', path: '/w/b' },
    ]);
    expect(m.metadata.nodeCount).toBe(4);
    expect(m.metadata.edgeCount).toBe(2);
    expect(m.metadata.projectPath).toBe('/w');
    // inputs not mutated
    expect(g1.nodes[0].id).toBe('main.ts');
  });

  test('nested roots cannot collide', () => {
    const m = mergeSerializedGraphs(
      [
        { root: '/w/pkg', graph: mk([{ id: 'api/x.ts', type: 'file', label: 'x.ts' }]) },
        { root: '/w/pkg/api', graph: mk([{ id: 'x.ts', type: 'file', label: 'x.ts' }]) },
      ],
      '/w'
    );
    expect(m.nodes.map(n => n.id)).toEqual(['pkg/api/x.ts', 'pkg-api/x.ts']);
  });
});
