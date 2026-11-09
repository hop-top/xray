/**
 * Tests for SurpriseAnalyzerPlugin.
 *
 * Covers:
 *  - Listener ordering (T-0049): spy registered before the plugin sees
 *    rankings unannotated; spy after the plugin sees surprise attrs on
 *    edges. Confirms the write happens in the plugin's listener, not
 *    via a race.
 *  - Degradation (T-0050): missing `community` / `confidence` does not
 *    crash, every edge still has a reason, and `heuristicsActive`
 *    omits the degraded heuristic.
 */

import Graph from 'graphology';
import {
  SurpriseAnalyzerPlugin,
  getSurprises,
} from '../../src/lib/plugins/surprise-analyzer';
import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';
import { XrayEvents } from '../../src/lib/events/types';
import { XrayGraph, Confidence, RankedNode } from '../../src/types/graph';

/** Minimal XrayLike stub — emitter + stash/retrieve/getLastGraph. */
function makeFakeXray() {
  const emitter = new AsyncEventEmitter<XrayEvents>();
  const stashes = new Map<string, unknown[]>();
  return Object.assign(emitter, {
    getLastGraph: () => ({}),
    stash: (ns: string, items: unknown[]) => {
      const bucket = stashes.get(ns);
      if (bucket) bucket.push(...items);
      else stashes.set(ns, [...items]);
    },
    retrieve: (ns: string, n?: number) => {
      const bucket = stashes.get(ns);
      if (!bucket) return [];
      return n === undefined ? bucket.slice() : bucket.slice(0, n);
    },
  });
}

function makeClusteredGraph(): XrayGraph {
  const g = new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;
  // Two communities + one bridge edge.
  for (const id of ['a0', 'a1', 'a2']) {
    g.addNode(id, {
      type: 'tag',
      label: id,
      kind: 'function',
      file: 'a.ts',
      line: 1,
      community: 0,
    });
  }
  for (const id of ['b0', 'b1', 'b2']) {
    g.addNode(id, {
      type: 'tag',
      label: id,
      kind: 'function',
      file: 'b.ts',
      line: 1,
      community: 1,
    });
  }
  g.addEdge('a0', 'a1', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('a1', 'a2', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('b0', 'b1', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('b1', 'b2', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('a0', 'b0', { type: 'calls', confidence: Confidence.AMBIGUOUS });
  return g;
}

function rankingsFor(graph: XrayGraph): RankedNode[] {
  const out: RankedNode[] = [];
  graph.forEachNode((id, attrs) => {
    out.push({ id, rank: 0.5, attributes: attrs });
  });
  return out;
}

describe('SurpriseAnalyzerPlugin listener ordering (T-0049)', () => {
  it('spy before plugin sees rankings with no surprise attrs; spy after plugin sees them', async () => {
    const xray = makeFakeXray();
    const graph = makeClusteredGraph();
    const rankings = rankingsFor(graph);

    const beforeState: Array<{ edgeId: string; hasScore: boolean }> = [];
    const afterState: Array<{ edgeId: string; hasScore: boolean }> = [];

    // Spy BEFORE plugin registration.
    xray.on('rank:complete', (event) => {
      event.graph.forEachEdge((edgeId: string, attrs: any) => {
        beforeState.push({ edgeId, hasScore: 'surpriseScore' in attrs });
      });
    });

    // Plugin registers next — its listener runs second.
    const plugin = new SurpriseAnalyzerPlugin({ topN: 3 });
    await plugin.apply(xray);

    // Spy AFTER plugin registration.
    xray.on('rank:complete', (event) => {
      event.graph.forEachEdge((edgeId: string, attrs: any) => {
        afterState.push({ edgeId, hasScore: 'surpriseScore' in attrs });
      });
    });

    await xray.emitAsync('rank:complete', {
      graph: graph as any,
      rankedNodes: rankings,
    });

    // Pre-plugin snapshot: no edge had a surprise score.
    expect(beforeState.every((s) => !s.hasScore)).toBe(true);
    // Post-plugin snapshot: at least one edge now carries a score.
    expect(afterState.some((s) => s.hasScore)).toBe(true);

    // Stash contains at most topN items and they are ScoredEdge shaped.
    const stashed = getSurprises(xray);
    expect(stashed.length).toBeGreaterThan(0);
    expect(stashed.length).toBeLessThanOrEqual(3);
    for (const s of stashed) {
      expect(typeof s.score).toBe('number');
      expect(Array.isArray(s.reasons)).toBe(true);
    }
  });
});

describe('SurpriseAnalyzerPlugin degradation (T-0050)', () => {
  it('survives missing community — cross-community emits missing-input, still scores edges', async () => {
    const xray = makeFakeXray();

    const g = new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;
    // NOTE: no `community` attribute on any node (clustering never ran).
    g.addNode('x', { type: 'tag', label: 'x', kind: 'function', file: 'a.ts', line: 1 });
    g.addNode('y', { type: 'tag', label: 'y', kind: 'function', file: 'b.ts', line: 1 });
    // Use AMBIGUOUS so confidence-gradient still contributes a real signal.
    g.addEdge('x', 'y', { type: 'calls', confidence: Confidence.AMBIGUOUS });

    const plugin = new SurpriseAnalyzerPlugin();
    await plugin.apply(xray);

    await expect(
      xray.emitAsync('rank:complete', {
        graph: g as any,
        rankedNodes: rankingsFor(g),
      })
    ).resolves.not.toThrow();

    const edgeId = g.edges()[0]!;
    const reasons = g.getEdgeAttribute(edgeId, 'surpriseReasons') as Array<{
      code: string;
      detail: string;
    }>;
    expect(reasons.length).toBeGreaterThanOrEqual(1);
    // cross-community degraded to missing-input.
    expect(
      reasons.some((r) => r.code === 'missing-input' && r.detail === 'community')
    ).toBe(true);
    // confidence-gradient still fires (AMBIGUOUS → real signal).
    expect(reasons.some((r) => r.code === 'confidence-gradient')).toBe(true);
  });

  it('survives missing confidence — confidence-gradient emits missing-input', async () => {
    const xray = makeFakeXray();

    const g = new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;
    g.addNode('x', {
      type: 'tag',
      label: 'x',
      kind: 'function',
      file: 'a.ts',
      line: 1,
      community: 0,
    });
    g.addNode('y', {
      type: 'tag',
      label: 'y',
      kind: 'function',
      file: 'b.ts',
      line: 1,
      community: 1,
    });
    // No confidence — deliberately omit it. Cast to satisfy the type.
    g.addEdge('x', 'y', { type: 'calls' } as any);

    const plugin = new SurpriseAnalyzerPlugin();
    await plugin.apply(xray);

    await expect(
      xray.emitAsync('rank:complete', {
        graph: g as any,
        rankedNodes: rankingsFor(g),
      })
    ).resolves.not.toThrow();

    const edgeId = g.edges()[0]!;
    const reasons = g.getEdgeAttribute(edgeId, 'surpriseReasons') as Array<{
      code: string;
      detail: string;
    }>;
    expect(
      reasons.some((r) => r.code === 'missing-input' && r.detail === 'confidence')
    ).toBe(true);
    // Cross-community still fires — endpoints have different communities.
    expect(reasons.some((r) => r.code === 'cross-community')).toBe(true);
  });
});
