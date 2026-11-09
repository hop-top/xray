/**
 * Unit tests for the surprise analyzer.
 *
 * Covers:
 *  - per-heuristic behaviour on crafted minimal fixtures
 *  - reason-code enum stability (match by `code`, not substring)
 *  - integration fixture: 2 clusters + single bridge edge ⇒ bridge tops the list
 *  - graph-mutation guarantee: scoreEdges does NOT mutate the input graph
 *  - degenerate cases: all-zero raw scores, empty graph, score range check
 */

import Graph from 'graphology';
import {
  scoreEdges,
  buildRankIndex,
  crossCommunityHeuristic,
  confidenceGradientHeuristic,
  peripheralHubHeuristic,
  crossTypeKindHeuristic,
  DEFAULT_HEURISTICS,
  HeuristicContext,
} from '../../src/lib/graph/analyzer';
import { Confidence, XrayGraph, RankedNode, EdgeAttributes } from '../../src/types/graph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyGraph(): XrayGraph {
  return new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;
}

/**
 * Build a minimal two-tag graph with a single edge of the given attributes.
 * Both nodes are tag nodes; community is optional.
 */
function twoTagGraph(opts: {
  sCommunity?: number;
  tCommunity?: number;
  confidence?: Confidence;
  sKind?: string;
  tKind?: string;
}): { graph: XrayGraph; edgeId: string } {
  const g = emptyGraph();
  g.addNode('s', {
    type: 'tag',
    label: 's',
    kind: opts.sKind ?? 'function',
    file: 'a.ts',
    line: 1,
    ...(opts.sCommunity !== undefined ? { community: opts.sCommunity } : {}),
  });
  g.addNode('t', {
    type: 'tag',
    label: 't',
    kind: opts.tKind ?? 'function',
    file: 'b.ts',
    line: 1,
    ...(opts.tCommunity !== undefined ? { community: opts.tCommunity } : {}),
  });
  const attrs: { type: 'calls'; confidence?: Confidence } = { type: 'calls' };
  if (opts.confidence !== undefined) attrs.confidence = opts.confidence;
  const edgeId = g.addEdge('s', 't', attrs as EdgeAttributes);
  return { graph: g, edgeId };
}

/** Synthesize a RankedNode array for every node in `graph`. */
function rankingsFor(graph: XrayGraph, override: Record<string, number> = {}): RankedNode[] {
  const out: RankedNode[] = [];
  graph.forEachNode((id, attrs) => {
    out.push({
      id,
      rank: override[id] ?? 0.5,
      attributes: attrs,
    });
  });
  return out;
}

/**
 * Minimal HeuristicContext builder for calling heuristics directly.
 * Only the fields the heuristic reads need to be populated.
 */
function ctx(
  graph: XrayGraph,
  edgeId: string,
  rankings: RankedNode[] = [],
  opts = {}
): HeuristicContext {
  const [source, target] = graph.extremities(edgeId);
  return {
    graph,
    edgeId,
    source,
    target,
    attrs: graph.getEdgeAttributes(edgeId) as any,
    rankings,
    rankIndex: buildRankIndex(rankings),
    opts,
  };
}

// ---------------------------------------------------------------------------
// Per-heuristic fixtures
// ---------------------------------------------------------------------------

describe('crossCommunityHeuristic', () => {
  it('scores 1.0 with cross-community reason code', () => {
    const { graph, edgeId } = twoTagGraph({
      sCommunity: 1,
      tCommunity: 2,
      confidence: Confidence.EXTRACTED,
    });
    const r = crossCommunityHeuristic(ctx(graph, edgeId));
    expect(r).not.toBeNull();
    expect(r!.score).toBe(1.0);
    expect(r!.reason.code).toBe('cross-community');
    expect(r!.reason.detail).toBe('1→2');
  });

  it('returns null when endpoints share a community', () => {
    const { graph, edgeId } = twoTagGraph({
      sCommunity: 1,
      tCommunity: 1,
      confidence: Confidence.EXTRACTED,
    });
    expect(crossCommunityHeuristic(ctx(graph, edgeId))).toBeNull();
  });

  it('emits missing-input reason when community is absent', () => {
    const { graph, edgeId } = twoTagGraph({
      confidence: Confidence.EXTRACTED,
    });
    const r = crossCommunityHeuristic(ctx(graph, edgeId));
    expect(r).not.toBeNull();
    expect(r!.score).toBe(0);
    expect(r!.reason.code).toBe('missing-input');
    expect(r!.reason.detail).toBe('community');
  });
});

describe('confidenceGradientHeuristic', () => {
  it('scores AMBIGUOUS at 1.0', () => {
    const { graph, edgeId } = twoTagGraph({ confidence: Confidence.AMBIGUOUS });
    const r = confidenceGradientHeuristic(ctx(graph, edgeId));
    expect(r!.score).toBe(1.0);
    expect(r!.reason.code).toBe('confidence-gradient');
  });

  it('returns null for INFERRED (global name-match fallback, not a surprise signal)', () => {
    const { graph, edgeId } = twoTagGraph({ confidence: Confidence.INFERRED });
    expect(confidenceGradientHeuristic(ctx(graph, edgeId))).toBeNull();
  });

  it('returns null for EXTRACTED (ground truth, not surprising)', () => {
    const { graph, edgeId } = twoTagGraph({ confidence: Confidence.EXTRACTED });
    expect(confidenceGradientHeuristic(ctx(graph, edgeId))).toBeNull();
  });

  it('emits missing-input when confidence is absent', () => {
    const { graph, edgeId } = twoTagGraph({});
    const r = confidenceGradientHeuristic(ctx(graph, edgeId));
    expect(r!.reason.code).toBe('missing-input');
    expect(r!.reason.detail).toBe('confidence');
  });
});

describe('peripheralHubHeuristic', () => {
  it('fires on bottom-quartile → top-decile edges', () => {
    const { graph, edgeId } = twoTagGraph({
      sCommunity: 0,
      tCommunity: 0,
      confidence: Confidence.EXTRACTED,
    });
    // Spread 10 nodes of synthetic rank, assign 's' to the bottom, 't' to top.
    const rankings: RankedNode[] = [];
    for (let i = 0; i < 10; i++) {
      rankings.push({ id: `n${i}`, rank: i * 0.1, attributes: { type: 'tag', label: `n${i}`, kind: 'function', file: 'x', line: 1 } });
    }
    rankings.push({ id: 's', rank: 0.01, attributes: graph.getNodeAttributes('s') });
    rankings.push({ id: 't', rank: 1.0, attributes: graph.getNodeAttributes('t') });

    const r = peripheralHubHeuristic(ctx(graph, edgeId, rankings));
    expect(r).not.toBeNull();
    expect(r!.reason.code).toBe('peripheral-hub');
  });

  it('returns null when both endpoints are in the mid band', () => {
    const { graph, edgeId } = twoTagGraph({});
    const rankings: RankedNode[] = [];
    for (let i = 0; i < 10; i++) {
      rankings.push({ id: `n${i}`, rank: i * 0.1, attributes: { type: 'tag', label: `n${i}`, kind: 'function', file: 'x', line: 1 } });
    }
    rankings.push({ id: 's', rank: 0.5, attributes: graph.getNodeAttributes('s') });
    rankings.push({ id: 't', rank: 0.5, attributes: graph.getNodeAttributes('t') });
    expect(peripheralHubHeuristic(ctx(graph, edgeId, rankings))).toBeNull();
  });

  it('appends (anchor-relative) when focusNode is set', () => {
    const { graph, edgeId } = twoTagGraph({});
    const rankings: RankedNode[] = [];
    for (let i = 0; i < 10; i++) {
      rankings.push({ id: `n${i}`, rank: i * 0.1, attributes: { type: 'tag', label: `n${i}`, kind: 'function', file: 'x', line: 1 } });
    }
    rankings.push({ id: 's', rank: 0.01, attributes: graph.getNodeAttributes('s') });
    rankings.push({ id: 't', rank: 1.0, attributes: graph.getNodeAttributes('t') });
    const r = peripheralHubHeuristic(ctx(graph, edgeId, rankings, { focusNode: 't' }));
    expect(r!.reason.detail).toMatch(/\(anchor-relative\)$/);
  });
});

describe('crossTypeKindHeuristic (gated)', () => {
  it('returns null when crossKind is not enabled', () => {
    const { graph, edgeId } = twoTagGraph({
      sCommunity: 1,
      tCommunity: 2,
      sKind: 'class',
      tKind: 'function',
    });
    expect(crossTypeKindHeuristic(ctx(graph, edgeId))).toBeNull();
  });

  it('fires on different-kind + cross-community when enabled', () => {
    const { graph, edgeId } = twoTagGraph({
      sCommunity: 1,
      tCommunity: 2,
      sKind: 'class',
      tKind: 'function',
    });
    const r = crossTypeKindHeuristic(
      ctx(graph, edgeId, [], { experimental: { crossKind: true } })
    );
    expect(r).not.toBeNull();
    expect(r!.reason.code).toBe('cross-type-kind');
    expect(r!.reason.detail).toBe('class→function');
  });

  it('returns null when either endpoint is a file node', () => {
    const g = emptyGraph();
    g.addNode('f', { type: 'file', label: 'f' });
    g.addNode('t', { type: 'tag', label: 't', kind: 'function', file: 'f', line: 1, community: 2 });
    const edgeId = g.addEdge('f', 't', { type: 'defines', confidence: Confidence.EXTRACTED });
    expect(
      crossTypeKindHeuristic(ctx(g, edgeId, [], { experimental: { crossKind: true } }))
    ).toBeNull();
  });

  it('returns null when communities match', () => {
    const { graph, edgeId } = twoTagGraph({
      sCommunity: 1,
      tCommunity: 1,
      sKind: 'class',
      tKind: 'function',
    });
    expect(
      crossTypeKindHeuristic(ctx(graph, edgeId, [], { experimental: { crossKind: true } }))
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_HEURISTICS membership
// ---------------------------------------------------------------------------

describe('DEFAULT_HEURISTICS', () => {
  it('contains all four heuristics by name', () => {
    const names = DEFAULT_HEURISTICS.map((h) => h.name).sort();
    expect(names).toEqual([
      'confidence-gradient',
      'cross-community',
      'cross-type-kind',
      'peripheral-hub',
    ]);
  });
});

// ---------------------------------------------------------------------------
// scoreEdges: integration on 2-cluster + bridge fixture
// ---------------------------------------------------------------------------

function twoClusterBridgeGraph(): XrayGraph {
  const g = emptyGraph();
  // Cluster A: A0 ↔ A1, A1 ↔ A2
  // Cluster B: B0 ↔ B1, B1 ↔ B2
  // Bridge: A0 → B0 (the only cross-community edge)
  for (const id of ['A0', 'A1', 'A2']) {
    g.addNode(id, { type: 'tag', label: id, kind: 'function', file: 'a.ts', line: 1, community: 0 });
  }
  for (const id of ['B0', 'B1', 'B2']) {
    g.addNode(id, { type: 'tag', label: id, kind: 'function', file: 'b.ts', line: 1, community: 1 });
  }
  g.addEdge('A0', 'A1', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('A1', 'A2', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('B0', 'B1', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('B1', 'B2', { type: 'calls', confidence: Confidence.EXTRACTED });
  g.addEdge('A0', 'B0', { type: 'calls', confidence: Confidence.EXTRACTED });
  return g;
}

describe('scoreEdges integration', () => {
  it('places the bridge edge at the top with a cross-community reason', () => {
    const g = twoClusterBridgeGraph();
    const rankings = rankingsFor(g);
    const { scored, heuristicsActive } = scoreEdges(g, rankings);
    expect(scored.length).toBeGreaterThan(0);
    const top = scored[0]!;
    expect(top.source).toBe('A0');
    expect(top.target).toBe('B0');
    expect(top.reasons.some((r) => r.code === 'cross-community')).toBe(true);
    expect(heuristicsActive).toContain('cross-community');
  });

  it('does not mutate the input graph', () => {
    const g = twoClusterBridgeGraph();
    const rankings = rankingsFor(g);
    const snapshotNodes = g.nodes().map((n) => [n, { ...g.getNodeAttributes(n) }]);
    const snapshotEdges = g.edges().map((e) => [e, { ...g.getEdgeAttributes(e) }]);
    scoreEdges(g, rankings);
    const afterNodes = g.nodes().map((n) => [n, { ...g.getNodeAttributes(n) }]);
    const afterEdges = g.edges().map((e) => [e, { ...g.getEdgeAttributes(e) }]);
    expect(afterNodes).toEqual(snapshotNodes);
    expect(afterEdges).toEqual(snapshotEdges);
  });

  it('every returned edge has at least one reason', () => {
    const g = twoClusterBridgeGraph();
    const { scored } = scoreEdges(g, rankingsFor(g));
    for (const s of scored) {
      expect(s.reasons.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every returned score is within [0, 1]', () => {
    const g = twoClusterBridgeGraph();
    const { scored } = scoreEdges(g, rankingsFor(g));
    for (const s of scored) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.score)).toBe(true);
    }
  });
});

describe('scoreEdges ignores INFERRED edges', () => {
  it('drops an INFERRED cross-community edge that would otherwise top the list', () => {
    const g = twoClusterBridgeGraph();
    g.addNode('C0', { type: 'tag', label: 'C0', kind: 'function', file: 'c.ts', line: 1, community: 2 });
    const inferredId = g.addEdge('A1', 'C0', { type: 'calls', confidence: Confidence.INFERRED });
    const { scored } = scoreEdges(g, rankingsFor(g));
    expect(scored.map((s) => s.edgeId)).not.toContain(inferredId);
    // EXTRACTED bridge still scored.
    expect(scored[0]!.source).toBe('A0');
    expect(scored[0]!.target).toBe('B0');
  });

  it('INFERRED-only graph yields no surprises and no active heuristics', () => {
    const { graph } = twoTagGraph({ sCommunity: 0, tCommunity: 1, confidence: Confidence.INFERRED });
    const { scored, heuristicsActive } = scoreEdges(graph, rankingsFor(graph));
    expect(scored).toEqual([]);
    expect(heuristicsActive).toEqual([]);
  });

  it('custom heuristic sets never see INFERRED edges', () => {
    const { graph } = twoTagGraph({ confidence: Confidence.INFERRED });
    const seen: string[] = [];
    const spy = Object.assign(
      (c: HeuristicContext) => {
        seen.push(c.edgeId);
        return { score: 1, reason: { code: 'cross-community' as const, detail: 'spy' } };
      },
      {}
    );
    Object.defineProperty(spy, 'name', { value: 'spy', configurable: true });
    scoreEdges(graph, rankingsFor(graph), {}, [spy as any]);
    expect(seen).toEqual([]);
  });

  it('AMBIGUOUS edges are still scored', () => {
    const { graph, edgeId } = twoTagGraph({ confidence: Confidence.AMBIGUOUS });
    const { scored } = scoreEdges(graph, rankingsFor(graph));
    expect(scored.map((s) => s.edgeId)).toContain(edgeId);
  });
});

// ---------------------------------------------------------------------------
// Degenerate cases
// ---------------------------------------------------------------------------

describe('scoreEdges degenerate cases', () => {
  it('returns empty scored + empty heuristicsActive on an empty graph', () => {
    const g = emptyGraph();
    const { scored, heuristicsActive } = scoreEdges(g, []);
    expect(scored).toEqual([]);
    expect(heuristicsActive).toEqual([]);
  });

  it('all-zero raw scores normalise to 0 with no NaN / Infinity', () => {
    // Build a graph where NO heuristic produces a non-missing-input score.
    // Every edge has confidence EXTRACTED (null), same community, and
    // no peripheral/hub spread in rankings. To still get reasons so the
    // edge is retained in output, we omit community entirely so the
    // cross-community heuristic emits `missing-input` (score 0).
    const g = emptyGraph();
    g.addNode('s', { type: 'tag', label: 's', kind: 'function', file: 'a.ts', line: 1 });
    g.addNode('t', { type: 'tag', label: 't', kind: 'function', file: 'b.ts', line: 1 });
    g.addEdge('s', 't', { type: 'calls', confidence: Confidence.EXTRACTED });

    const { scored, heuristicsActive } = scoreEdges(g, rankingsFor(g));
    expect(scored.length).toBe(1);
    expect(scored[0]!.score).toBe(0);
    expect(Number.isNaN(scored[0]!.score)).toBe(false);
    expect(Number.isFinite(scored[0]!.score)).toBe(true);
    // No heuristic produced a non-missing-input signal.
    expect(heuristicsActive).toEqual([]);
    // But the edge still has a reason (the missing-input one).
    expect(scored[0]!.reasons.length).toBeGreaterThanOrEqual(1);
    expect(scored[0]!.reasons[0]!.code).toBe('missing-input');
  });

  it('drops edges where every heuristic returns null', () => {
    const g = emptyGraph();
    g.addNode('s', { type: 'tag', label: 's', kind: 'function', file: 'a.ts', line: 1, community: 0 });
    g.addNode('t', { type: 'tag', label: 't', kind: 'function', file: 'b.ts', line: 1, community: 0 });
    g.addEdge('s', 't', { type: 'calls', confidence: Confidence.EXTRACTED });
    // cross-community: null (same community)
    // confidence-gradient: null (EXTRACTED)
    // peripheral-hub: null (no rankings spread)
    // cross-type-kind: null (gated off)
    const { scored } = scoreEdges(g, rankingsFor(g));
    expect(scored).toEqual([]);
  });
});
