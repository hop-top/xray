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

    // Build a map of node IDs to their data for efficient lookup
    const nodeInfoMap = new Map<string, any>();
    (this.graph as any).forEachNode((nodeId: string, attrs: any) => {
      nodeInfoMap.set(nodeId, attrs);
    });

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

      // Calculate file line range
      let fileStart = 1;
      let fileEnd = 1;
      if (tags.length > 0) {
        fileStart = tags[0].data.line + 1;
        const lastTag = tags[tags.length - 1];
        fileEnd = lastTag.data.endLine ? lastTag.data.endLine + 1 : lastTag.data.line + 1;
      }

      let fileRange = `(L${fileStart})`;
      if (fileEnd > fileStart) {
        fileRange = `(L${fileStart}-L${fileEnd})`;
      }

      outputLines.push(`${file} ${fileRange}:`);
      currentTokens += 4; // rough estimate

      for (const tag of tags) {
        const signature = tag.data.signature ? tag.data.signature : '';
        // Line numbers are 0-indexed in tree-sitter, so add 1 for display
        const startLine = tag.data.line + 1;
        const endLine = tag.data.endLine ? tag.data.endLine + 1 : startLine;

        let lineRange = `[L${startLine}]`;
        if (endLine > startLine) {
          lineRange = `[L${startLine}-L${endLine}]`;
        }

        let line = `│ ${lineRange} ${tag.data.kind} ${tag.data.label}${signature}`;

        if (tag.data.doc) {
          const doc = tag.data.doc.length > 50 ? tag.data.doc.substring(0, 47) + '...' : tag.data.doc;
          line += `  # ${doc}`;
        }

        outputLines.push(line);

        // Display cross-file references (who calls this tag)
        const tagId = `${tag.data.file}::${tag.data.label}`;
        if ((this.graph as any).hasNode(tagId)) {
          const crossFileCallers: { file: string, line: number, endLine: number, label: string }[] = [];

          // Iterate through all nodes to find those that call this tag
          (this.graph as any).forEachNode((nodeId: string, attrs: any) => {
            if (attrs.type === 'tag' && attrs.file !== tag.data.file) {
              // Check if this node has a 'calls' edge to our tag
              if ((this.graph as any).hasEdge(nodeId, tagId)) {
                crossFileCallers.push({
                  file: attrs.file,
                  line: attrs.line + 1,  // Convert to 1-indexed
                  endLine: attrs.endLine ? attrs.endLine + 1 : attrs.line + 1,
                  label: attrs.label
                });
              }
            }
          });

          // Display top 3 cross-file callers
          const displayLimit = 3;
          for (let i = 0; i < Math.min(crossFileCallers.length, displayLimit); i++) {
            const caller = crossFileCallers[i];
            const refLine = `│       → used by: [${caller.file}:L${caller.line}](L${caller.line}-L${caller.endLine})`;
            outputLines.push(refLine);
            currentTokens += 4; // rough estimate for reference line
          }
        }

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
