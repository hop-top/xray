import { flowLines } from '../../src/lib/flow/format';
import { graphToXml } from '../../src/lib/graph/export';
import { GraphSerializer } from '../../src/lib/graph/serializer';
import type { SerializedGraph } from '../../src/lib/query/types';
import { flowOf } from './helpers';

const SUM = `export function sum(xs: number[], limit: number): number {
  let total = 0;
  for (const x of xs) {
    if (x > limit) { break; }
    total += x;
  }
  return total;
}`;

describe('flow text format', () => {
  it('cfg then dfg, one line per node / definition, 1-based lines, → successors', () => {
    expect(flowLines(flowOf(SUM, 'sum'))).toEqual([
      '  cfg',
      '    n0 entry L1 → n2',
      '    n1 exit L8',
      '    n2 stmt L2 let total = 0 → n3',
      '    n3 loop L3 for (const x of xs) → n4:true n7:false',
      '    n4 cond L4 x > limit → n5:true n6:false',
      '    n5 break L4 break → n7',
      '    n6 stmt L5 total += x → n3',
      '    n7 return L7 return total → n1',
      '  dfg',
      '    d0 xs param L1 → n3',
      '    d1 limit param L1 → n4',
      '    d2 total decl L2 → n6 n7',
      '    d3 x loop L3 → n4 n6',
      '    d4 total update L5 → n6 n7',
    ]);
  });

  it('only df lists the reading nodes first so it stands alone', () => {
    const lines = flowLines(flowOf('function f(a) {\n  return a;\n}', 'f', { cfg: false, dfg: true }));
    expect(lines).toEqual([
      '  dfg',
      '    n2 L2 return a',
      '    d0 a param L1 → n2',
    ]);
  });

  it('closures follow their parent, indented; a captured variable is flagged', () => {
    const lines = flowLines(flowOf(`function f() {
  let n = 0;
  const inc = () => { n++; };
}`, 'f', { cfg: false, dfg: true }));
    expect(lines).toEqual([
      '  dfg',
      '    n3 L3 const inc = () => { n++; }',
      '    d0 n decl L2 captured → n3',
      '    d1 inc decl L3',
      '  closure inc L3',
      '    dfg',
    ]);
  });

  it('truncation is spelled out in the header', () => {
    const code = `function f() {\n${Array.from({ length: 600 }, (_, i) => `s${i}();`).join('\n')}\n}`;
    expect(flowLines(flowOf(code, 'f', { cfg: true, dfg: false }))[0]).toBe('  cfg (truncated: 500 of 602 nodes)');
  });

  it('empty input prints nothing', () => {
    expect(flowLines({})).toEqual([]);
  });
});

describe('flow in the serialized graph and XML', () => {
  const flow = flowOf('function f(a) {\n  if (a) { return "<&>"; }\n}', 'f');
  const graph: SerializedGraph = {
    metadata: { version: '1.0', timestamp: 't', projectPath: '/p', nodeCount: 2, edgeCount: 0 },
    nodes: [
      { id: 'a.ts', type: 'file', label: 'a.ts' },
      { id: 'a.ts::f', type: 'tag', label: 'f', kind: 'function', file: 'a.ts', line: 0, cfg: flow.cfg, dfg: flow.dfg },
    ],
    edges: [],
  };

  it('serializer round-trips cfg and dfg; graphs without them still load', () => {
    const s = new GraphSerializer();
    const back = s.serialize(s.deserialize(graph), '/p');
    expect(back.nodes[1].cfg).toEqual(flow.cfg);
    expect(back.nodes[1].dfg).toEqual(flow.dfg);
    const plain = s.serialize(s.deserialize({ ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], cfg: undefined, dfg: undefined }] }), '/p');
    expect('cfg' in plain.nodes[1]).toBe(false);
    expect('dfg' in plain.nodes[1]).toBe(false);
  });

  it('xml carries steps, edges, defs, uses and sites, escaped', () => {
    const xml = graphToXml(graph);
    expect(xml).toContain('<cfg>');
    expect(xml).toContain('<step id="n0" kind="entry" line="0" label="entry"/>');
    expect(xml).toContain('<step id="n3" kind="return" line="1" label="return &quot;&lt;&amp;&gt;&quot;"/>');
    expect(xml).toContain('<next from="n2" to="n3" label="true"/>');
    expect(xml).toContain('<dfg>');
    expect(xml).toContain('<def id="d0" name="a" kind="param" line="0" at="n0"/>');
    expect(xml).toContain('<use from="d0" to="n2"/>');
    expect(xml).toContain('<site id="n2" line="1" label="a"/>');
  });

  it('xml without flow is unchanged', () => {
    const plain = graphToXml({ ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], cfg: undefined, dfg: undefined }] });
    expect(plain).not.toContain('<cfg');
    expect(plain).toContain('<node id="a.ts::f" type="tag" label="f" kind="function" file="a.ts" line="0"/>');
  });
});

describe('flowLines terminal safety', () => {
  const ESC = String.fromCharCode(27);
  it('escapes control characters from source-derived labels and names', () => {
    const cfg = {
      nodes: [{ id: 'n2', kind: 'stmt', label: `log("${ESC}[2J")`, line: 0 }],
      edges: [],
      closures: [{ name: `f${ESC}]0;x`, line: 0, nodes: [], edges: [] }],
    };
    const dfg = {
      nodes: [{ id: 'd0', name: `v${ESC}[1m`, kind: 'decl', line: 0, at: 'n2' }],
      edges: [],
      sites: [{ id: 'n2', line: 0, label: `s${ESC}[2J` }],
    };
    const out = [...flowLines({ cfg } as never), ...flowLines({ dfg } as never)].join('\n');
    expect(out).not.toContain(ESC);
    expect(out).toContain('\\x1b[2J');
  });
});
