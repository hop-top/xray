import { XrayGraph, RankedNode, RankedTagNode, isRankedTagNode } from '../../types/graph';

export type TokenEstimator = (text: string) => number | Promise<number>;

export class MapRenderer {
  private root: string;
  private ranked: RankedNode[];
  private graph: XrayGraph;
  private tokenEstimator?: TokenEstimator;

  constructor(root: string, ranked: RankedNode[], graph: XrayGraph, tokenEstimator?: TokenEstimator) {
    this.root = root;
    this.ranked = ranked;
    this.graph = graph;
    this.tokenEstimator = tokenEstimator;
  }

  /**
   * Estimate tokens for a line of text
   * Uses custom estimator if provided, otherwise falls back to simple heuristic: ~4 characters per token
   */
  private estimateTokens(text: string): number | Promise<number> {
    if (this.tokenEstimator) {
      return this.tokenEstimator(text);
    }
    return Math.ceil(text.length / 4);
  }

  /**
   * Safely get node attribute from graph
   */
  private safeGetNodeAttribute<T>(nodeId: string, attr: string): T | undefined {
    if (!this.graph.hasNode(nodeId)) {
      return undefined;
    }
    try {
      return this.graph.getNodeAttribute(nodeId, attr) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Safely get node attributes from graph
   */
  private safeGetNodeAttributes(nodeId: string): any {
    if (!this.graph.hasNode(nodeId)) {
      return undefined;
    }
    try {
      return this.graph.getNodeAttributes(nodeId);
    } catch {
      return undefined;
    }
  }

  async render(tokenLimit: number, depth?: number, includeImports?: boolean): Promise<string> {
    // Group tags by file
    const fileMap = new Map<string, RankedTagNode[]>();

    // Build a map of node IDs to their data for efficient lookup
    const nodeInfoMap = new Map<string, any>();
    this.graph.forEachNode((nodeId: string, attrs: any) => {
      nodeInfoMap.set(nodeId, attrs);
    });

    // Filter only tags that are important enough
    // For MVP, we take top N nodes until we hit a "soft" limit
    // In production, we would count tokens strictly.

    const outputLines: string[] = [];
    let currentTokens = 0;

    // Organize data
    for (const node of this.ranked) {
      if (isRankedTagNode(node)) {
        const file = node.attributes.file;
        if (!fileMap.has(file)) fileMap.set(file, []);
        fileMap.get(file)?.push(node);
      } else if (node.attributes.type === 'file') {
        // Ensure file is in map if it has imports and we are including them
        if (includeImports) {
          const imports = this.graph.getNodeAttribute(node.id, 'imports');
          if (imports && imports.length > 0) {
            if (!fileMap.has(node.id)) fileMap.set(node.id, []);
          }
        }
      }
    }

    // Create a map of file scores for sorting
    const fileScores = new Map<string, number>();
    for (const node of this.ranked) {
      if (node.attributes.type === 'file') {
        fileScores.set(node.id, node.rank);
      }
    }

    // Sort files by their rank score (descending)
    const sortedFiles = Array.from(fileMap.keys()).sort((a, b) => {
      const scoreA = fileScores.get(a) || 0;
      const scoreB = fileScores.get(b) || 0;
      return scoreB - scoreA;
    });

    for (const file of sortedFiles) {
      if (depth !== undefined) {
        const fileDepth = file.split('/').length;
        if (fileDepth > depth) continue;
      }

      const tags = fileMap.get(file)!;

      // Sort tags in file by line number for readability
      tags.sort((a, b) => a.attributes.line - b.attributes.line);

      // Calculate file line range
      let fileStart = 1;
      let fileEnd = 1;
      if (tags.length > 0) {
        fileStart = tags[0].attributes.line + 1;
        const lastTag = tags[tags.length - 1];
        fileEnd = lastTag.attributes.endLine ? lastTag.attributes.endLine + 1 : lastTag.attributes.line + 1;
      }

      let fileRange = `(L${fileStart})`;
      if (fileEnd > fileStart) {
        fileRange = `(L${fileStart}-L${fileEnd})`;
      }

      const fileLine = `${file} ${fileRange}:`;
      outputLines.push(fileLine);
      currentTokens += await this.estimateTokens(fileLine);

      // Display imports if requested
      if (includeImports) {
        const imports = this.safeGetNodeAttribute<any[]>(file, 'imports');
        if (imports && Array.isArray(imports) && imports.length > 0) {
          for (const imp of imports) {
            // Use text if available, otherwise construct simple import
            const importText = imp.text || `import ${imp.source}`;
            // Clean up newlines in import text to keep it on one line if possible or indent properly
            const formattedImport = importText.replace(/\n/g, ' ').replace(/\s+/g, ' ');

            const importLine = `│ [L1] ${formattedImport}`;
            outputLines.push(importLine);
            currentTokens += await this.estimateTokens(importLine);
          }
        }
      }

      for (const tag of tags) {
        const signature = tag.attributes.signature ? tag.attributes.signature : '';
        // Line numbers are 0-indexed in tree-sitter, so add 1 for display
        const startLine = tag.attributes.line + 1;
        const endLine = tag.attributes.endLine ? tag.attributes.endLine + 1 : startLine;

        let lineRange = `[L${startLine}]`;
        if (endLine > startLine) {
          lineRange = `[L${startLine}-L${endLine}]`;
        }

        let line = `│ ${lineRange} ${tag.attributes.kind} ${tag.attributes.label}${signature}`;

        if (tag.attributes.doc) {
          const doc = tag.attributes.doc.length > 50 ? tag.attributes.doc.substring(0, 47) + '...' : tag.attributes.doc;
          line += `  # ${doc}`;
        }

        outputLines.push(line);
        currentTokens += await this.estimateTokens(line);

        // Display cross-file references (who calls this tag)
        const tagId = `${tag.attributes.file}::${tag.attributes.label}`;
        if (this.graph.hasNode(tagId)) {
          try {
            // Use inEdges for O(e) performance instead of O(n) forEachNode
            const inEdges = this.graph.inEdges(tagId);
            const crossFileCallers: { file: string, line: number, endLine: number, label: string }[] = [];

            for (const edge of inEdges) {
              const sourceId = this.graph.source(edge);
              const attrs = this.safeGetNodeAttributes(sourceId);

              if (attrs && attrs.type === 'tag' && attrs.file !== tag.attributes.file) {
                crossFileCallers.push({
                  file: attrs.file,
                  line: attrs.line + 1,  // Convert to 1-indexed
                  endLine: attrs.endLine ? attrs.endLine + 1 : attrs.line + 1,
                  label: attrs.label
                });

                // Only collect top 3
                if (crossFileCallers.length >= 3) break;
              }
            }

            // Display cross-file callers
            for (const caller of crossFileCallers) {
              const refLine = `│       → used by: [${caller.file}:L${caller.line}](L${caller.line}-L${caller.endLine})`;
              outputLines.push(refLine);
              currentTokens += await this.estimateTokens(refLine);
            }
          } catch (err) {
            // Skip malformed edges silently
            continue;
          }
        }

        if (currentTokens >= tokenLimit) break;
      }
      outputLines.push(''); // spacer
      if (currentTokens >= tokenLimit) break;
    }

    // Generate Dependency Table when imports are included
    if (includeImports) {
      outputLines.push('## External Dependencies');
      outputLines.push('| Library | Used By |');
      outputLines.push('|---------|---------|');

      const dependencies = new Map<string, Set<string>>();
      const allFiles = new Set<string>();

      // Collect all known files in the repo to filter internal imports
      this.ranked.forEach(node => {
        if (node.attributes.type === 'file') {
          allFiles.add(node.id);
        }
      });

      // Iterate over all files to find imports
      this.ranked.forEach(node => {
        if (node.attributes.type === 'file') {
          const imports = this.graph.getNodeAttribute(node.id, 'imports');
          if (imports) {
            for (const imp of imports) {
              const source = imp.source;
              // Simple heuristic to check if it's external
              // 1. Not starting with . or / (absolute paths shouldn't happen in imports usually)
              // 2. Not in the list of files (approximate matching needed?)
              // For now, assume if it starts with ., it's internal.

              let isExternal = true;
              if (source.startsWith('.')) isExternal = false;

              if (isExternal) {
                if (!dependencies.has(source)) {
                  dependencies.set(source, new Set());
                }
                dependencies.get(source)!.add(node.id);
              }
            }
          }
        }
      });

      // Sort dependencies
      const sortedDeps = Array.from(dependencies.keys()).sort();

      for (const dep of sortedDeps) {
        const users = Array.from(dependencies.get(dep)!).sort().join(', ');
        outputLines.push(`| ${dep} | ${users} |`);
      }
    }

    return outputLines.join('\n');
  }
}
