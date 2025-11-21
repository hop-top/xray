import Graph from 'graphology';
import { RankedNode } from '../graph/ranker';
import { tokenizeAndEstimateCost } from 'llm-cost';

export class MapRenderer {
  private root: string;
  private ranked: RankedNode[];
  private graph: Graph;

  constructor(root: string, ranked: RankedNode[], graph: Graph) {
    this.root = root;
    this.ranked = ranked;
    this.graph = graph;
  }

  async render(tokenLimit: number, maxDepth?: number): Promise<string> {
    // Group tags by file
    const fileMap = new Map<string, RankedNode[]>();

    // Filter only tags that are important enough
    // For MVP, we take top N nodes until we hit a "soft" limit
    // In production, we would count tokens strictly.

    const outputLines: string[] = [];
    let currentTokens = 0;

    // Organize data
    for (const node of this.ranked) {
      if (node.data.type === 'tag') {
        const file = node.data.file;
        if (!fileMap.has(file)) fileMap.set(file, []);
        fileMap.get(file)?.push(node);
      }
    }

    // Create a map of file scores for sorting
    const fileScores = new Map<string, number>();
    for (const node of this.ranked) {
      if (node.data.type === 'file') {
        fileScores.set(node.id, node.score);
      }
    }

    // Sort files by their rank score (descending)
    const sortedFiles = Array.from(fileMap.keys()).sort((a, b) => {
      const scoreA = fileScores.get(a) || 0;
      const scoreB = fileScores.get(b) || 0;
      return scoreB - scoreA;
    });

    for (const file of sortedFiles) {
      if (maxDepth !== undefined) {
        const depth = file.split('/').length;
        if (depth > maxDepth) continue;
      }

      const tags = fileMap.get(file)!;

      // Sort tags in file by line number for readability
      tags.sort((a, b) => a.data.line - b.data.line);

      outputLines.push(`${file}:`);
      currentTokens += 2; // rough estimate

      for (const tag of tags) {
        const signature = tag.data.signature ? tag.data.signature : '';
        // Line numbers are 0-indexed in tree-sitter, so add 1 for display
        const lineNum = tag.data.line + 1;
        let line = `│ [L${lineNum}] ${tag.data.kind} ${tag.data.label}${signature}`;

        if (tag.data.doc) {
          const doc = tag.data.doc.length > 50 ? tag.data.doc.substring(0, 47) + '...' : tag.data.doc;
          line += `  # ${doc}`;
        }

        outputLines.push(line);

        const { inputTokens } = await tokenizeAndEstimateCost({
          model: 'gpt-4o',
          input: line
        });
        currentTokens += inputTokens;

        if (currentTokens >= tokenLimit) break;
      }
      outputLines.push(''); // spacer
      if (currentTokens >= tokenLimit) break;
    }

    return outputLines.join('\n');
  }
}
