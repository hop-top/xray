import * as pagerank from 'graphology-metrics/centrality';
import { Logger } from '../logger';
import { XrayGraph, NodeAttributes, RankedNode } from '../../types/graph';
import { terminalSafe } from '../terminal-safe';

export class Ranker {
  private graph: XrayGraph;

  constructor(graph: XrayGraph) {
    this.graph = graph;
  }

  rank(focusNode?: string): RankedNode[] {
    // PageRank throws "failed to converge" on an empty graph (e.g. every
    // file skipped or no parseable files); nothing to rank.
    if (this.graph.order === 0) {
      return [];
    }

    // 1. Compute PageRank (Standard)
    const scores = pagerank.pagerank(this.graph, {
      getEdgeWeight: null,
      alpha: 0.85,
      maxIterations: 50
    });

    // 2. Apply Heuristics (HSIR) & Focus Boosting
    const ranked: RankedNode[] = [];

    this.graph.forEachNode((node: string, attr: NodeAttributes) => {
      let score = scores[node];

      // Heuristic: Boost short, clear names?
      // Heuristic: Boost files over tags slightly for structure?
      if (attr.type === 'file') {
        score *= 1.2; // Boost files to ensure they appear as containers
      }

      // Heuristic: Penalize private members (underscore prefix)
      if (attr.label && attr.label.startsWith('_')) {
        score *= 0.5;
      }

      // Focus Boosting
      if (focusNode) {
        if (node === focusNode) {
          score *= 100.0; // Super boost for the focus file
        } else if (this.graph.hasEdge(focusNode, node) || this.graph.hasEdge(node, focusNode)) {
          score *= 10.0; // Boost direct neighbors (dependencies/dependents)
        }
      }

      ranked.push({ id: node, rank: score, attributes: attr });
    });

    // Sort descending
    const sorted = ranked.sort((a, b) => b.rank - a.rank);

    Logger.info('Top 5 ranked nodes:');
    sorted.slice(0, 5).forEach(n => Logger.log(`  ${terminalSafe(n.id)}: ${n.rank.toFixed(4)}`));

    return sorted;
  }
}
