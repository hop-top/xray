import { XrayGraph, RankedNode, RankedTagNode, isRankedTagNode } from '../../types/graph';
import * as path from 'path';
import * as fs from 'fs';

export interface ChunkMetadata {
  directory: string;
  filePath: string;
  tokenCount: number;
  fileCount: number;
  parent?: string;
  children: string[];
  depth: number;
}

export interface ChunkedOutput {
  chunks: Map<string, string>; // filePath -> content
  metadata: ChunkMetadata[];
  rootChunk: string;
}

export type TokenEstimator = (text: string) => number | Promise<number>;

export class ChunkedRenderer {
  private root: string;
  private ranked: RankedNode[];
  private graph: XrayGraph;
  private tokenLimit: number;
  private maxDepth?: number;
  private includeImports: boolean;
  private tokenEstimator?: TokenEstimator;

  constructor(
    root: string,
    ranked: RankedNode[],
    graph: XrayGraph,
    tokenLimit: number,
    maxDepth?: number,
    includeImports: boolean = false,
    tokenEstimator?: TokenEstimator
  ) {
    this.root = root;
    this.ranked = ranked;
    this.graph = graph;
    this.tokenLimit = tokenLimit;
    this.maxDepth = maxDepth;
    this.includeImports = includeImports;
    this.tokenEstimator = tokenEstimator;
  }

  /**
   * Estimate tokens for a line of text
   * Uses custom estimator if provided, otherwise falls back to simple heuristic: ~4 characters per token
   * This is much faster than async tokenization and accurate enough for chunking
   */
  private estimateTokens(text: string): number | Promise<number> {
    if (this.tokenEstimator) {
      return this.tokenEstimator(text);
    }
    return Math.ceil(text.length / 4);
  }

  /**
   * Safely get node attribute from graph
   * Returns undefined if node doesn't exist or attribute is missing
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
   * Returns undefined if node doesn't exist
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

  /**
   * Render the codebase into multiple chunks organized by directory
   */
  async renderChunked(outputBasePath: string): Promise<ChunkedOutput> {
    // Validate output path
    if (!outputBasePath || outputBasePath.trim() === '') {
      throw new Error('Output base path cannot be empty');
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputBasePath);
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    } catch (err: any) {
      throw new Error(`Failed to create output directory ${outputDir}: ${err.message}`);
    }

    // Group files by directory
    const directoryMap = this.organizeByDirectory();

    // Build chunks for each directory
    const chunks = new Map<string, string>();
    const metadata: ChunkMetadata[] = [];

    // Process directories in depth-first order to handle parent-child relationships
    const sortedDirs = Array.from(directoryMap.keys()).sort();

    for (const dir of sortedDirs) {
      const files = directoryMap.get(dir)!;
      const dirDepth = this.getDirectoryDepth(dir);

      // Skip if exceeds max depth
      if (this.maxDepth !== undefined && dirDepth > this.maxDepth) {
        continue;
      }

      // Render this directory's content
      const { content, tokenCount } = await this.renderDirectory(dir, files);

      // Determine output file path
      const chunkPath = this.getChunkPath(outputBasePath, dir);

      // Find parent and children
      const parent = this.findParentDirectory(dir, sortedDirs);
      const children = this.findChildDirectories(dir, sortedDirs);

      // Add navigation links
      const contentWithLinks = this.addNavigationLinks(content, dir, parent, children, chunkPath);

      chunks.set(chunkPath, contentWithLinks);

      metadata.push({
        directory: dir,
        filePath: chunkPath,
        tokenCount,
        fileCount: files.length,
        parent,
        children,
        depth: dirDepth,
      });
    }

    // Determine root chunk (usually the top-level directory)
    const rootChunk = this.getRootChunkPath(outputBasePath, sortedDirs);

    return {
      chunks,
      metadata,
      rootChunk,
    };
  }

  /**
   * Organize ranked nodes by their directory
   */
  private organizeByDirectory(): Map<string, RankedNode[]> {
    const directoryMap = new Map<string, RankedNode[]>();

    for (const node of this.ranked) {
      if (node.attributes.type === 'file') {
        const dir = path.dirname(node.id);
        if (!directoryMap.has(dir)) {
          directoryMap.set(dir, []);
        }
      }
    }

    // Assign tags to their file's directory
    for (const node of this.ranked) {
      if (node.attributes.type === 'tag') {
        const dir = path.dirname(node.attributes.file);
        if (directoryMap.has(dir)) {
          directoryMap.get(dir)!.push(node);
        }
      }
    }

    return directoryMap;
  }

  /**
   * Render content for a specific directory
   */
  private async renderDirectory(dir: string, nodes: RankedNode[]): Promise<{ content: string; tokenCount: number }> {
    const outputLines: string[] = [];
    let currentTokens = 0;

    // Add directory header
    const header = `# Directory: ${dir}`;
    outputLines.push(header);
    outputLines.push('');
    currentTokens += await this.estimateTokens(header);

    // Group tags by file
    const fileMap = new Map<string, RankedTagNode[]>();

    for (const node of nodes) {
      if (isRankedTagNode(node)) {
        const file = node.attributes.file;
        if (!fileMap.has(file)) fileMap.set(file, []);
        fileMap.get(file)!.push(node);
      }
    }

    // Get file scores for sorting
    const fileScores = new Map<string, number>();
    for (const node of this.ranked) {
      if (node.attributes.type === 'file' && path.dirname(node.id) === dir) {
        fileScores.set(node.id, node.rank);
      }
    }

    // Sort files by rank score
    const sortedFiles = Array.from(fileMap.keys()).sort((a, b) => {
      const scoreA = fileScores.get(a) || 0;
      const scoreB = fileScores.get(b) || 0;
      return scoreB - scoreA;
    });

    // Render each file
    for (const file of sortedFiles) {
      const tags = fileMap.get(file)!;

      // Sort tags by line number
      tags.sort((a, b) => a.attributes.line - b.attributes.line);

      // Calculate file line range
      let fileStart = 1;
      let fileEnd = 1;
      if (tags.length > 0) {
        fileStart = tags[0].attributes.line + 1;
        const lastTag = tags[tags.length - 1];
        fileEnd = lastTag.attributes.endLine ? lastTag.attributes.endLine + 1 : lastTag.attributes.line + 1;
      }

      const fileRange = fileEnd > fileStart ? `(L${fileStart}-L${fileEnd})` : `(L${fileStart})`;

      const fileLine = `${file} ${fileRange}:`;
      outputLines.push(fileLine);
      currentTokens += await this.estimateTokens(fileLine);

      // Display imports if requested
      if (this.includeImports) {
        const imports = this.safeGetNodeAttribute<any[]>(file, 'imports');
        if (imports && Array.isArray(imports) && imports.length > 0) {
          for (const imp of imports) {
            const importText = imp.text || `import ${imp.source}`;
            const formattedImport = importText.replace(/\n/g, ' ').replace(/\s+/g, ' ');
            const importLine = `│ [L1] ${formattedImport}`;
            outputLines.push(importLine);
            currentTokens += await this.estimateTokens(importLine);
          }
        }
      }

      // Render tags
      for (const tag of tags) {
        const signature = tag.attributes.signature || '';
        const startLine = tag.attributes.line + 1;
        const endLine = tag.attributes.endLine ? tag.attributes.endLine + 1 : startLine;

        const lineRange = endLine > startLine ? `[L${startLine}-L${endLine}]` : `[L${startLine}]`;

        let line = `│ ${lineRange} ${tag.attributes.kind} ${tag.attributes.label}${signature}`;

        if (tag.attributes.doc) {
          const doc = tag.attributes.doc.length > 50 ? tag.attributes.doc.substring(0, 47) + '...' : tag.attributes.doc;
          line += `  # ${doc}`;
        }

        outputLines.push(line);
        currentTokens += await this.estimateTokens(line);

        // Display cross-file references
        const tagId = `${tag.attributes.file}::${tag.attributes.label}`;
        if (this.graph.hasNode(tagId)) {
          try {
            // Use inEdges for O(e) performance instead of O(n) forEachNode
            const inEdges = this.graph.inEdges(tagId);
            const crossFileCallers: { file: string; line: number }[] = [];

            for (const edge of inEdges) {
              const sourceId = this.graph.source(edge);
              const attrs = this.safeGetNodeAttributes(sourceId);

              if (attrs && attrs.type === 'tag' && attrs.file !== tag.attributes.file) {
                crossFileCallers.push({
                  file: attrs.file,
                  line: attrs.line + 1,
                });

                // Only collect top 3
                if (crossFileCallers.length >= 3) break;
              }
            }

            // Display cross-file callers
            for (const caller of crossFileCallers) {
              const refLine = `│       → used by: [${caller.file}:L${caller.line}]`;
              outputLines.push(refLine);
              currentTokens += await this.estimateTokens(refLine);
            }
          } catch (err) {
            // Skip malformed edges silently - don't fail entire render
            continue;
          }
        }

        // Stop if token limit reached
        if (currentTokens >= this.tokenLimit) break;
      }

      outputLines.push('');
      if (currentTokens >= this.tokenLimit) break;
    }

    return {
      content: outputLines.join('\n'),
      tokenCount: currentTokens,
    };
  }

  /**
   * Add navigation links to content
   */
  private addNavigationLinks(
    content: string,
    currentDir: string,
    parent: string | undefined,
    children: string[],
    currentPath: string
  ): string {
    const lines: string[] = [];

    // Add header with navigation
    lines.push('---');
    lines.push(`## Navigation`);
    lines.push('');

    if (parent) {
      const parentPath = this.getRelativePath(currentPath, this.getChunkPath(path.dirname(currentPath), parent));
      lines.push(`⬆️ **Parent:** [${parent}](${parentPath})`);
      lines.push('');
    }

    if (children.length > 0) {
      lines.push(`⬇️ **Children:**`);
      for (const child of children) {
        const childPath = this.getRelativePath(currentPath, this.getChunkPath(path.dirname(currentPath), child));
        lines.push(`  - [${child}](${childPath})`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push(content);

    return lines.join('\n');
  }

  /**
   * Get relative path between two file paths
   */
  private getRelativePath(from: string, to: string): string {
    return path.relative(path.dirname(from), to);
  }

  /**
   * Get the depth of a directory path
   */
  private getDirectoryDepth(dir: string): number {
    if (dir === '.' || dir === '') return 0;
    return dir.split(path.sep).length;
  }

  /**
   * Find parent directory from sorted list
   */
  private findParentDirectory(dir: string, sortedDirs: string[]): string | undefined {
    const parentDir = path.dirname(dir);
    if (parentDir === '.' || parentDir === dir) return undefined;
    return sortedDirs.includes(parentDir) ? parentDir : undefined;
  }

  /**
   * Find child directories from sorted list
   */
  private findChildDirectories(dir: string, sortedDirs: string[]): string[] {
    return sortedDirs.filter(d => {
      const parentOfD = path.dirname(d);
      return parentOfD === dir;
    });
  }

  /**
   * Get chunk file path for a directory
   */
  private getChunkPath(outputBasePath: string, dir: string): string {
    const sanitized = dir === '.' ? 'root' : dir.replace(/\//g, '_');
    const ext = path.extname(outputBasePath) || '.md';
    const base = outputBasePath.replace(ext, '');
    return `${base}_${sanitized}${ext}`;
  }

  /**
   * Get the root chunk path
   */
  private getRootChunkPath(outputBasePath: string, sortedDirs: string[]): string {
    const rootDir = sortedDirs.find(d => this.getDirectoryDepth(d) === 0) || sortedDirs[0] || '.';
    return this.getChunkPath(outputBasePath, rootDir);
  }
}
