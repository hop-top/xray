import * as pagerank from 'graphology-metrics/centrality';
import { Logger } from '../logger';
import { XrayGraph, NodeAttributes, RankedNode } from '../../types/graph';
import { terminalSafe } from '../terminal-safe';

export class Ranker {
  private graph: XrayGraph;

  constructor(graph: XrayGraph) {
    this.graph = graph;
  }

  rank(focusNode?: string | string[], churnMap?: Map<string, number>): RankedNode[] {
    // PageRank throws "failed to converge" on an empty graph (e.g. every
    // file skipped or no parseable files); nothing to rank.
    if (this.graph.order === 0) {
      return [];
    }

    const focusNodes = new Set(
      Array.isArray(focusNode) ? focusNode : focusNode ? [focusNode] : []
    );

    // 1. Compute PageRank (Standard)
    const scores = pagerank.pagerank(this.graph, {
      getEdgeWeight: null,
      alpha: 0.85,
      maxIterations: 50
    });

    // 2. Apply Heuristics (HSIR), Focus Boosting & Churn Weighting
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

      // Focus Boosting (single anchor or multi-anchor diff files)
      if (focusNodes.size > 0) {
        if (focusNodes.has(node)) {
          score *= 100.0; // Super boost for the focus file(s)
        } else {
          for (const fn of focusNodes) {
            if (this.graph.hasEdge(fn, node) || this.graph.hasEdge(node, fn)) {
              score *= 10.0; // Boost direct neighbors (dependencies/dependents)
              break;
            }
          }
        }
      }

      // Churn Weighting
      if (churnMap) {
        const fileKey = attr.type === 'file' ? node : attr.file;
        const commits = fileKey ? (churnMap.get(fileKey) ?? 0) : 0;
        if (commits > 0) {
          score *= 1 + Math.log1p(commits) * 0.35;
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
