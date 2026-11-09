import Graph from 'graphology';
import { cluster, CLUSTER_SENTINEL } from '../../src/lib/graph/cluster';
import { XrayGraph } from '../../src/types/graph';

/**
 * Deterministic PRNG for Louvain so partitions are byte-identical across runs.
 * Mulberry32 — small, fast, seedable.
 */
function mulberry32(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a synthetic tag graph with three dense subgraphs ("clusters")
 * A0..A3, B0..B3, C0..C3 connected internally by `calls` edges, plus
 * a single bridge edge between A0 and B0, and between B0 and C0.
 * Also adds a `defines` edge per cluster to exercise the default
 * `calls`-only filter.
 */
function makeThreeClusterGraph(): XrayGraph {
  const g = new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;

  const clusters: Array<[string, string[]]> = [
    ['A', ['A0', 'A1', 'A2', 'A3']],
    ['B', ['B0', 'B1', 'B2', 'B3']],
    ['C', ['C0', 'C1', 'C2', 'C3']],
  ];

  // Add a "file" node per cluster and its tag members, plus `defines` edges
  // (which the default edgeFilter drops).
  for (const [name, members] of clusters) {
    const fileId = `${name}.ts`;
    g.addNode(fileId, { type: 'file', label: fileId });
    for (const m of members) {
      g.addNode(m, { type: 'tag', label: m, kind: 'function', file: fileId, line: 0 });
      g.addEdgeWithKey(`def-${fileId}-${m}`, fileId, m, { type: 'defines', confidence: 'EXTRACTED' });
    }
    // Dense intra-cluster `calls` edges.
    for (let i = 0; i < members.length; i++) {
      for (let j = 0; j < members.length; j++) {
        if (i === j) continue;
        g.addEdgeWithKey(`call-${members[i]}-${members[j]}`, members[i], members[j], {
          type: 'calls', confidence: 'EXTRACTED',
        });
      }
    }
  }

  // Weak bridge edges across clusters.
  g.addEdgeWithKey('bridge-A0-B0', 'A0', 'B0', { type: 'calls', confidence: 'EXTRACTED' });
  g.addEdgeWithKey('bridge-B0-C0', 'B0', 'C0', { type: 'calls', confidence: 'EXTRACTED' });

  return g;
}

describe('cluster()', () => {
  it('partitions a synthetic 3-cluster graph into 3 communities', () => {
    const graph = makeThreeClusterGraph();
    const rng = mulberry32(42);

    const result = cluster(graph, { rng });

    expect(result.count).toBe(3);
    expect(Number.isFinite(result.modularity)).toBe(true);
    expect(result.modularity).toBeGreaterThan(0.1);

    // Partition equivalence: members of the same expected cluster must share
    // the same community id; members of different clusters must not.
    const cid = (n: string) => graph.getNodeAttribute(n, 'community') as number;

    for (const group of [
      ['A0', 'A1', 'A2', 'A3'],
      ['B0', 'B1', 'B2', 'B3'],
      ['C0', 'C1', 'C2', 'C3'],
    ]) {
      const first = cid(group[0]);
      expect(first).not.toBe(CLUSTER_SENTINEL);
      for (const m of group.slice(1)) {
        expect(cid(m)).toBe(first);
      }
    }

    expect(cid('A0')).not.toBe(cid('B0'));
    expect(cid('B0')).not.toBe(cid('C0'));
    expect(cid('A0')).not.toBe(cid('C0'));
  });

  it('stamps the graph-level clusteringModularity attribute', () => {
    const graph = makeThreeClusterGraph();
    const rng = mulberry32(42);
    const result = cluster(graph, { rng });
    expect(graph.getAttribute('clusteringModularity')).toBe(result.modularity);
  });

  it('assigns CLUSTER_SENTINEL to nodes filtered out of the subgraph', () => {
    const graph = makeThreeClusterGraph();
    // File nodes only connect via `defines` (which the default filter drops),
    // so they must land in the sentinel community.
    const rng = mulberry32(42);
    cluster(graph, { rng });

    for (const fileId of ['A.ts', 'B.ts', 'C.ts']) {
      expect(graph.getNodeAttribute(fileId, 'community')).toBe(CLUSTER_SENTINEL);
    }
  });

  it('handles an edge-empty graph by stamping sentinel on every node', () => {
    const g = new Graph({ type: 'directed' }) as unknown as XrayGraph;
    g.addNode('lonely', { type: 'tag', label: 'lonely', kind: 'function', file: 'x.ts', line: 0 });
    const result = cluster(g);
    expect(result.count).toBe(0);
    expect(result.modularity).toBe(0);
    expect(g.getNodeAttribute('lonely', 'community')).toBe(CLUSTER_SENTINEL);
  });

  it('honours a custom edgeFilter', () => {
    const graph = makeThreeClusterGraph();
    // Only the bridges pass this filter, so everything collapses into one
    // weakly-connected subgraph spanning A0 <-> B0 <-> C0.
    const rng = mulberry32(42);
    const result = cluster(graph, {
      rng,
      edgeFilter: (key) => key.startsWith('bridge-'),
    });

    // With only two edges, Louvain will find at most one meaningful community;
    // the rest become sentinels. Core invariant: A0/B0/C0 get real community
    // ids (non-sentinel), everyone else is sentinel.
    expect(graph.getNodeAttribute('A0', 'community')).not.toBe(CLUSTER_SENTINEL);
    expect(graph.getNodeAttribute('B0', 'community')).not.toBe(CLUSTER_SENTINEL);
    expect(graph.getNodeAttribute('C0', 'community')).not.toBe(CLUSTER_SENTINEL);
    expect(graph.getNodeAttribute('A1', 'community')).toBe(CLUSTER_SENTINEL);
    expect(result.count).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Two sparse groups A0..A3 and B0..B3, each a chain of EXTRACTED `calls`
 * edges. Callers add noise edges on top to check what the default filter
 * keeps out of the clustering subgraph.
 */
function makeTwoChainGraph(): XrayGraph {
  const g = new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;
  for (const group of [['A0', 'A1', 'A2', 'A3'], ['B0', 'B1', 'B2', 'B3']]) {
    for (const m of group) {
      g.addNode(m, { type: 'tag', label: m, kind: 'function', file: `${m[0]}.ts`, line: 0 });
    }
    for (let i = 0; i < group.length - 1; i++) {
      g.addEdgeWithKey(`call-${group[i]}-${group[i + 1]}`, group[i], group[i + 1], {
        type: 'calls', confidence: 'EXTRACTED',
      });
    }
  }
  return g;
}

function expectSeparateGroups(graph: XrayGraph): void {
  const cid = (n: string) => graph.getNodeAttribute(n, 'community') as number;
  for (const group of [['A0', 'A1', 'A2', 'A3'], ['B0', 'B1', 'B2', 'B3']]) {
    expect(cid(group[0])).not.toBe(CLUSTER_SENTINEL);
    for (const m of group.slice(1)) expect(cid(m)).toBe(cid(group[0]));
  }
  expect(cid('A0')).not.toBe(cid('B0'));
}

describe('cluster() default filter — INFERRED calls edges', () => {
  it('ignores a bundle of INFERRED cross-group edges that would reshape communities', () => {
    const graph = makeTwoChainGraph();
    // Name-match noise: every A calls every B. Counted, these pull A2/A3
    // and B0/B1 into a shared community.
    for (const a of ['A0', 'A1', 'A2', 'A3']) {
      for (const b of ['B0', 'B1', 'B2', 'B3']) {
        graph.addEdgeWithKey(`inf-${a}-${b}`, a, b, { type: 'calls', confidence: 'INFERRED' });
      }
    }
    const result = cluster(graph, { rng: mulberry32(42) });
    expectSeparateGroups(graph);
    expect(result.count).toBe(2);
  });

  it('a node reached only by a single INFERRED edge is not merged into a community', () => {
    const graph = makeTwoChainGraph();
    graph.addNode('X', { type: 'tag', label: 'X', kind: 'function', file: 'x.ts', line: 0 });
    graph.addEdgeWithKey('inf-X-A0', 'X', 'A0', { type: 'calls', confidence: 'INFERRED' });
    const result = cluster(graph, { rng: mulberry32(42) });
    expect(graph.getNodeAttribute('X', 'community')).toBe(CLUSTER_SENTINEL);
    expect(result.communities).not.toHaveProperty('X');
    expectSeparateGroups(graph);
  });

  it('excludes INFERRED cross-root edges too', () => {
    const graph = makeTwoChainGraph();
    graph.addNode('r2::Y', { type: 'tag', label: 'Y', kind: 'function', file: 'r2/y.ts', line: 0 });
    graph.addEdgeWithKey('xr-Y-B3', 'r2::Y', 'B3', {
      type: 'calls', confidence: 'INFERRED', crossRoot: true,
    });
    cluster(graph, { rng: mulberry32(42) });
    expect(graph.getNodeAttribute('r2::Y', 'community')).toBe(CLUSTER_SENTINEL);
  });

  it('keeps confidence-less calls edges (treated as EXTRACTED)', () => {
    const graph = makeTwoChainGraph();
    graph.addNode('Z', { type: 'tag', label: 'Z', kind: 'function', file: 'z.ts', line: 0 });
    graph.addEdgeWithKey('legacy-Z-A3', 'Z', 'A3', { type: 'calls' } as never);
    cluster(graph, { rng: mulberry32(42) });
    expect(graph.getNodeAttribute('Z', 'community')).not.toBe(CLUSTER_SENTINEL);
  });
});
