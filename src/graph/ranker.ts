const Graph = require('graphology');
import * as pagerank from 'graphology-metrics/centrality';

export interface RankedNode {
  id: string;
  score: number;
  data: any;
}

export class Ranker {
  private graph: any;

  constructor(graph: any) {
    this.graph = graph;
  }

  rank(focusNode?: string): RankedNode[] {
    // 1. Compute PageRank (Standard)
    const scores = pagerank.pagerank(this.graph, {
      getEdgeWeight: null,
      alpha: 0.85,
      maxIterations: 50
    });

    // 2. Apply Heuristics (HSIR) & Focus Boosting
    const ranked: RankedNode[] = [];

    this.graph.forEachNode((node: string, attr: any) => {
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

      ranked.push({ id: node, score, data: attr });
    });

    // Sort descending
    const sorted = ranked.sort((a, b) => b.score - a.score);

    console.log('Top 5 ranked nodes:');
    sorted.slice(0, 5).forEach(n => console.log(`${n.id}: ${n.score.toFixed(4)}`));

    return sorted;
  }
}
