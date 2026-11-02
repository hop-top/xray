/**
 * Community detection over the xray graph.
 *
 * Thin wrapper around `graphology-communities-louvain`. Defaults to filtering
 * the graph to non-INFERRED `calls` edges before running Louvain — see spec R3 in
 * `.tlc/tracks/logical-clustering-init/spec.md` for why mixing `defines`,
 * `calls`, and `imports` edges produces a structural tautology instead of
 * a functional signal.
 *
 * Determinism: Louvain breaks modularity ties and orders its traversal with
 * a PRNG. Without an `rng` option each call gets a fresh mulberry32 seeded
 * with {@link DEFAULT_CLUSTER_SEED}, so identical graphs yield identical
 * community ids across runs.
 */
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { XrayGraph, EdgeAttributes, NodeAttributes, Confidence } from '../../types/graph';

/**
 * Sentinel community id assigned to nodes that are outside the clustering
 * subgraph (e.g. no `calls` edges when the default edge filter runs).
 */
export const CLUSTER_SENTINEL = -1;

/**
 * Edges that carry clustering signal: `calls` edges that are not
 * INFERRED. INFERRED edges are the builder's unscoped name-match
 * fallback (including cross-root name matches); counted, they merge
 * unrelated communities. Edges without a `confidence` are treated as
 * EXTRACTED, matching the serializer's backfill for older graphs.
 *
 * Shared by the default `cluster()` filter and the low-cohesion question
 * so both measure cohesion over the same edge subset.
 */
export function isClusteringEdge(attrs: Pick<EdgeAttributes, 'type'> & { confidence?: unknown }): boolean {
  return attrs.type === 'calls' && attrs.confidence !== Confidence.INFERRED;
}

/** Seed for the default per-call PRNG when no `rng` option is given. */
export const DEFAULT_CLUSTER_SEED = 42;

/** Mulberry32 — small, fast, seedable PRNG returning floats in `[0, 1)`. */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClusterOptions {
  /** Louvain resolution parameter. Higher = more, smaller communities. */
  resolution?: number;
  /**
   * PRNG override. Default: fresh `mulberry32(DEFAULT_CLUSTER_SEED)` per
   * call (deterministic). A supplied function is used as-is; its state
   * carries over between calls.
   */
  rng?: () => number;
  /**
   * Predicate deciding which edges enter the clustering subgraph.
   * Default: {@link isClusteringEdge} (non-INFERRED `calls` edges).
   */
  edgeFilter?: (edgeKey: string, attrs: EdgeAttributes) => boolean;
}

export interface ClusterResult {
  /** Library-native mapping: `{ [nodeId]: communityId }`. No inversion. */
  communities: Record<string, number>;
  /** Modularity score of the partition, in `[-0.5, 1.0]`. */
  modularity: number;
  /** Number of distinct communities in the partition. */
  count: number;
}

/**
 * Run Louvain community detection on `graph`.
 *
 * Side effects on the input graph:
 * - Every node is stamped with a `community` attribute (number). Nodes that
 *   fall outside the filtered subgraph receive `CLUSTER_SENTINEL` (`-1`).
 * - The graph-level attribute `clusteringModularity` is set to the
 *   partition's modularity, so downstream tracks can gate without
 *   re-running the algorithm.
 */
export function cluster(
  graph: XrayGraph,
  opts: ClusterOptions = {}
): ClusterResult {
  const edgeFilter =
    opts.edgeFilter ?? ((_edge: string, attrs: EdgeAttributes) => isClusteringEdge(attrs));

  // Build a filtered copy: keep all nodes, keep only edges that pass the
  // filter. We copy the graph so clustering is non-destructive on edges.
  const subgraph: XrayGraph = graph.copy() as XrayGraph;
  const edgesToDrop: string[] = [];
  subgraph.forEachEdge((edgeKey, attrs) => {
    if (!edgeFilter(edgeKey, attrs as EdgeAttributes)) {
      edgesToDrop.push(edgeKey);
    }
  });
  for (const edgeKey of edgesToDrop) {
    subgraph.dropEdge(edgeKey);
  }

  // Handle empty-subgraph edge case: no edges means no communities to find.
  // Stamp every node with the sentinel and record modularity = 0.
  if (subgraph.size === 0) {
    graph.forEachNode((nodeId) => {
      graph.setNodeAttribute(nodeId, 'community', CLUSTER_SENTINEL);
    });
    graph.setAttribute('clusteringModularity', 0);
    return { communities: {}, modularity: 0, count: 0 };
  }

  // Run Louvain in `detailed` mode so we get the modularity scalar alongside
  // the mapping. `assign()` would be one call cheaper but returns `void`.
  const detailed = louvain.detailed(subgraph as unknown as Graph, {
    resolution: opts.resolution,
    rng: opts.rng ?? mulberry32(DEFAULT_CLUSTER_SEED),
  });

  // Louvain assigns every node of the copy a community, including nodes with
  // no surviving edges (singleton noise). Report only nodes that actually
  // participate in the filtered subgraph so `communities` / `count` agree
  // with the `community` attributes written back below.
  const communities: Record<string, number> = {};
  for (const [nodeId, cid] of Object.entries(detailed.communities as Record<string, number>)) {
    if (subgraph.degree(nodeId) > 0) {
      communities[nodeId] = cid;
    }
  }
  const modularity = detailed.modularity;
  const count = new Set(Object.values(communities)).size;

  // Write the community attribute back onto the original graph. Nodes that
  // were filtered out of the subgraph (e.g. no calls edges) still exist in
  // the copy — `louvain` will have assigned them a singleton community,
  // which is noise from our POV. Distinguish those explicitly.
  graph.forEachNode((nodeId) => {
    if (subgraph.hasNode(nodeId) && subgraph.degree(nodeId) > 0) {
      const cid = communities[nodeId];
      graph.setNodeAttribute(
        nodeId,
        'community',
        typeof cid === 'number' ? cid : CLUSTER_SENTINEL
      );
    } else {
      graph.setNodeAttribute(nodeId, 'community', CLUSTER_SENTINEL);
    }
  });

  graph.setAttribute('clusteringModularity', modularity);

  return { communities, modularity, count };
}

/**
 * Convenience: read the last-computed modularity from a graph attribute.
 * Returns `undefined` if `cluster()` has not been run on this graph.
 */
export function getClusteringModularity(graph: XrayGraph): number | undefined {
  const val = graph.getAttribute('clusteringModularity');
  return typeof val === 'number' ? val : undefined;
}

// Re-export NodeAttributes for convenience in downstream consumers that only
// import from this module.
export type { NodeAttributes };
