import Graph from 'graphology';
import { ClusteringPlugin } from '../../src/lib/plugins/clustering';
import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';
import { XrayEvents } from '../../src/lib/events/types';
import { XrayGraph } from '../../src/types/graph';
import { CLUSTER_SENTINEL } from '../../src/lib/graph/cluster';

// Deterministic Mulberry32 PRNG so Louvain ties break the same way every run.
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
 * Minimal XrayLike stub — the plugin only touches the event emitter and the
 * graph passed in the event payload, so a bare `AsyncEventEmitter` plus
 * empty `getLastGraph`/`stash`/`retrieve` methods is enough.
 */
function makeFakeXray() {
  const emitter = new AsyncEventEmitter<XrayEvents>();
  return Object.assign(emitter, {
    getLastGraph: () => ({}),
    stash: () => {},
    retrieve: () => [],
  });
}

function makeBuiltGraph(): XrayGraph {
  const g = new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;

  // Two dense call clusters with a single bridge.
  const groups = [
    ['auth::login', 'auth::logout', 'auth::verify'],
    ['db::read', 'db::write', 'db::flush'],
  ];
  for (const group of groups) {
    for (const node of group) {
      g.addNode(node, { type: 'tag', label: node, kind: 'function', file: 'x.ts', line: 0 });
    }
    for (const a of group) {
      for (const b of group) {
        if (a !== b) {
          g.addEdgeWithKey(`c-${a}-${b}`, a, b, { type: 'calls' });
        }
      }
    }
  }
  g.addEdgeWithKey('bridge', 'auth::login', 'db::read', { type: 'calls' });
  return g;
}

describe('ClusteringPlugin', () => {
  it('stamps community IDs on every node via graph:complete', async () => {
    const xray = makeFakeXray();
    const plugin = new ClusteringPlugin({ rng: mulberry32(7) });
    plugin.apply(xray);

    const graph = makeBuiltGraph();
    await xray.emitAsync('graph:complete', {
      graph: graph as any,
      nodeCount: graph.order,
      edgeCount: graph.size,
    });

    // Every node reachable via calls must have a numeric community attribute.
    graph.forEachNode((nodeId) => {
      const c = graph.getNodeAttribute(nodeId, 'community');
      expect(typeof c).toBe('number');
      expect(c).not.toBe(CLUSTER_SENTINEL);
    });

    // clusteringModularity graph attribute must be a finite number.
    const mod = graph.getAttribute('clusteringModularity');
    expect(typeof mod).toBe('number');
    expect(Number.isFinite(mod)).toBe(true);
  });

  it('uses the configured warn threshold without throwing', async () => {
    const xray = makeFakeXray();
    const plugin = new ClusteringPlugin({ rng: mulberry32(7), warnBelowModularity: 0.9 });
    plugin.apply(xray);

    const graph = makeBuiltGraph();
    // Should not throw even though modularity is likely below 0.9.
    await expect(
      xray.emitAsync('graph:complete', {
        graph: graph as any,
        nodeCount: graph.order,
        edgeCount: graph.size,
      })
    ).resolves.not.toThrow();
  });
});
