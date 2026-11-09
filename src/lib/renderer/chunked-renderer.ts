import { XrayGraph, RankedNode, RankedTagNode, isRankedTagNode } from '../../types/graph';
import { terminalSafe, terminalSafeBlock } from '../terminal-safe';
import { CLUSTER_SENTINEL } from '../graph/cluster';
import { Logger } from '../logger';
import type { Insight } from './insight';
import { flowLines } from '../flow/format';
import { collectCrossFileCallers, formatCallerLines } from './callers';
export type { Insight } from './insight';
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

/**
 * Grouping strategy for chunk organisation.
 *
 * - `'directory'` (default): group nodes by filesystem parent directory.
 * - `'community'`: group nodes by the `community` attribute stamped on
 *   the graph by `ClusteringPlugin` / `cluster()` in
 *   `src/lib/graph/cluster.ts`. Each community becomes one chunk file;
 *   chunks are ordered by size desc; intra-chunk order stays PageRank.
 */
export type ChunkGrouping = 'directory' | 'community';

// Insight type lives in `./insight` so both renderers (and the
// `applyStashedInsights` drain helper used by `src/commands/generate.ts`)
// reference a single shape.

/**
 * Options bag for `ChunkedRenderer`. Replaces the previous positional
 * constructor parameter list — see spec T-0034. New grouping modes land as
 * additional fields on this interface rather than new positional params.
 */
export interface ChunkedRendererOptions {
  root: string;
  ranked: RankedNode[];
  graph: XrayGraph;
  tokenLimit: number;
  maxDepth?: number;
  includeImports?: boolean;
  tokenEstimator?: TokenEstimator;
  /** Chunk grouping mode. Defaults to `'directory'` for back-compat. */
  grouping?: ChunkGrouping;
}

export class ChunkedRenderer {
  private root: string;
  private ranked: RankedNode[];
  private graph: XrayGraph;
  private tokenLimit: number;
  private maxDepth?: number;
  private includeImports: boolean;
  private tokenEstimator?: TokenEstimator;
  private grouping: ChunkGrouping;
  private insights: Insight[] = [];

  constructor(opts: ChunkedRendererOptions) {
    this.root = opts.root;
    this.ranked = opts.ranked;
    this.graph = opts.graph;
    this.tokenLimit = opts.tokenLimit;
    this.maxDepth = opts.maxDepth;
    this.includeImports = opts.includeImports ?? false;
    this.tokenEstimator = opts.tokenEstimator;
    this.grouping = opts.grouping ?? 'directory';
  }

  /**
   * Push a pre-render insight block onto the renderer. Called by plugins
   * from the `render:start` event (sequential emission). Insights are
   * rendered in attach order, each as `## <title>` + body, prepended to
   * the root chunk in both `'directory'` and `'community'` modes.
   */
  addInsight(insight: Insight): void {
    this.insights.push(insight);
  }

  /** Read-only accessor used by integration tests. */
  getInsights(): readonly Insight[] {
    return this.insights;
  }

  /**
   * Read-only accessor for the scan root. Used by plugins that need to
   * build repo-root-relative links (e.g. QuestionGeneratorPlugin).
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * Build the insight header block to prepend on the root chunk. Empty
   * string when no insights were pushed.
   */
  private renderInsights(): string {
    if (this.insights.length === 0) return '';
    const lines: string[] = [];
    for (const ins of this.insights) {
      lines.push(`## ${terminalSafe(ins.title)}`);
      lines.push('');
      lines.push(terminalSafeBlock(ins.body));
      lines.push('');
    }
    return lines.join('\n');
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
   * (default) or by graph community (`grouping: 'community'`).
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

    // Community grouping branches into a separate code path so the
    // directory path stays byte-identical when `grouping !== 'community'`.
    if (this.grouping === 'community') {
      return this.renderChunkedByCommunity(outputBasePath);
    }

    // Group files by directory
    const directoryMap = this.organizeByDirectory();

    // Build chunks for each directory
    const chunks = new Map<string, string>();
    const metadata: ChunkMetadata[] = [];

    // Files per directory: the chunk's own file nodes. `directoryMap` holds
    // tags, whose count says nothing about files (none for a file without
    // symbols).
    const fileCounts = new Map<string, number>();
    for (const node of this.ranked) {
      if (node.attributes.type === 'file') {
        const dir = path.dirname(node.id);
        fileCounts.set(dir, (fileCounts.get(dir) ?? 0) + 1);
      }
    }

    // Process directories in depth-first order to handle parent-child relationships
    const sortedDirs = Array.from(directoryMap.keys()).sort();

    // Only directories that get a chunk can be linked to.
    const renderedDirs = sortedDirs.filter(
      d => this.maxDepth === undefined || this.getDirectoryDepth(d) <= this.maxDepth
    );
    const entryDir = this.getRootDir(renderedDirs);

    for (const dir of renderedDirs) {
      const files = directoryMap.get(dir)!;
      const dirDepth = this.getDirectoryDepth(dir);

      // Render this directory's content
      const { content, tokenCount } = await this.renderDirectory(dir, files);

      // Determine output file path
      const chunkPath = this.getChunkPath(outputBasePath, dir);

      // Find parent and children
      const parent = this.findParentDirectory(dir, renderedDirs, entryDir);
      const children = this.findChildDirectories(dir, renderedDirs, entryDir);

      // Add navigation links
      const contentWithLinks = this.addNavigationLinks(parent, children, outputBasePath, content);

      chunks.set(chunkPath, contentWithLinks);

      metadata.push({
        directory: dir,
        filePath: chunkPath,
        tokenCount,
        fileCount: fileCounts.get(dir) ?? 0,
        parent,
        children,
        depth: dirDepth,
      });
    }

    // Determine root chunk (usually the top-level directory)
    const rootChunk = this.getChunkPath(outputBasePath, entryDir);

    // Prepend insight blocks (if any) onto the root chunk content.
    // Insights are pushed by plugins from the `render:start` event.
    const insightBlock = this.renderInsights();
    if (insightBlock) {
      const rootContent = chunks.get(rootChunk);
      if (rootContent !== undefined) {
        chunks.set(rootChunk, `${insightBlock}\n${rootContent}`);
      }
    }

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
        // `--with cf|df`: the function's flow graphs, indented under it.
        for (const flowLine of flowLines(tag.attributes)) {
          const text = `│ ${flowLine}`;
          outputLines.push(text);
          currentTokens += await this.estimateTokens(text);
        }

        // Display cross-file references
        const tagId = `${tag.attributes.file}::${tag.attributes.label}`;
        if (this.graph.hasNode(tagId)) {
          try {
            const refLines = formatCallerLines(
              collectCrossFileCallers(this.graph, tagId, tag.attributes.file, (id) => this.safeGetNodeAttributes(id)),
              (c) => `[${c.file}:L${c.line}]`
            );
            for (const refLine of refLines) {
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
      content: outputLines.map(terminalSafe).join('\n'),
      tokenCount: currentTokens,
    };
  }

  /**
   * Add navigation links to content. All chunks of one run sit side by
   * side, so each link is the target chunk's file name.
   */
  private addNavigationLinks(
    parent: string | undefined,
    children: string[],
    outputBasePath: string,
    content: string
  ): string {
    const lines: string[] = [];

    // Add header with navigation
    lines.push('---');
    lines.push(`## Navigation`);
    lines.push('');

    if (parent) {
      const parentPath = path.basename(this.getChunkPath(outputBasePath, parent));
      lines.push(`⬆️ **Parent:** [${terminalSafe(parent)}](${terminalSafe(parentPath)})`);
      lines.push('');
    }

    if (children.length > 0) {
      lines.push(`⬇️ **Children:**`);
      for (const child of children) {
        const childPath = path.basename(this.getChunkPath(outputBasePath, child));
        lines.push(`  - [${terminalSafe(child)}](${terminalSafe(childPath)})`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push(content);

    return lines.join('\n');
  }

  /**
   * Get the depth of a directory path
   */
  private getDirectoryDepth(dir: string): number {
    if (dir === '.' || dir === '') return 0;
    return dir.split(path.sep).length;
  }

  /**
   * Parent chunk: the nearest ancestor directory that has a chunk. With no
   * top-level chunk, the entry chunk adopts the other top-most ones so every
   * chunk stays reachable from it.
   */
  private findParentDirectory(dir: string, renderedDirs: string[], entryDir: string): string | undefined {
    if (dir === entryDir) return undefined;
    let ancestor = path.dirname(dir);
    while (ancestor !== dir) {
      if (renderedDirs.includes(ancestor)) return ancestor;
      dir = ancestor;
      ancestor = path.dirname(dir);
    }
    return entryDir;
  }

  /**
   * Child chunks: directories whose parent chunk is `dir`.
   */
  private findChildDirectories(dir: string, renderedDirs: string[], entryDir: string): string[] {
    return renderedDirs.filter(d => this.findParentDirectory(d, renderedDirs, entryDir) === dir);
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
   * The entry directory: the top-level one, else the first chunked directory.
   */
  private getRootDir(renderedDirs: string[]): string {
    return renderedDirs.find(d => this.getDirectoryDepth(d) === 0) || renderedDirs[0] || '.';
  }

  // ---------------------------------------------------------------------
  // Community grouping (T-0035)
  // ---------------------------------------------------------------------

  /**
   * Group ranked nodes by their `community` attribute. Nodes without a
   * community attribute (plugin not registered) or with the sentinel value
   * are bucketed under community id `-1` ("unclustered").
   */
  private organizeByCommunity(): Map<number, RankedNode[]> {
    const byCommunity = new Map<number, RankedNode[]>();

    const communityOf = (nodeId: string): number => {
      const raw = this.safeGetNodeAttribute<number>(nodeId, 'community');
      return typeof raw === 'number' ? raw : CLUSTER_SENTINEL;
    };

    for (const node of this.ranked) {
      const cid = communityOf(node.id);
      if (!byCommunity.has(cid)) byCommunity.set(cid, []);
      byCommunity.get(cid)!.push(node);
    }

    return byCommunity;
  }

  /**
   * Render a community chunk. Mirrors `renderDirectory` but labels the
   * chunk "Community N" and groups tags by their file so the layout is
   * still legible. Emits a warn log when the community's rendered token
   * count exceeds `tokenLimit` (spec R4, T-0036). Does not sub-chunk —
   * truncation falls through to the same break-out-of-loop path as the
   * directory renderer.
   */
  private async renderCommunity(
    communityId: number,
    nodes: RankedNode[]
  ): Promise<{ content: string; tokenCount: number }> {
    const outputLines: string[] = [];
    let currentTokens = 0;

    const label = communityId === CLUSTER_SENTINEL ? 'Unclustered' : `Community ${communityId}`;
    const header = `# ${label}`;
    outputLines.push(header);
    outputLines.push('');
    currentTokens += await this.estimateTokens(header);

    // Group tags by their file to keep the output layout file-scoped.
    const fileMap = new Map<string, RankedTagNode[]>();
    for (const node of nodes) {
      if (isRankedTagNode(node)) {
        const file = node.attributes.file;
        if (!fileMap.has(file)) fileMap.set(file, []);
        fileMap.get(file)!.push(node);
      }
    }

    // Sort files by the max rank of any tag in that file so higher-signal
    // files appear first. This preserves "intra-chunk order is PageRank".
    const sortedFiles = Array.from(fileMap.keys()).sort((a, b) => {
      const ma = Math.max(...fileMap.get(a)!.map(n => n.rank));
      const mb = Math.max(...fileMap.get(b)!.map(n => n.rank));
      return mb - ma;
    });

    let truncated = false;
    for (const file of sortedFiles) {
      const tags = fileMap.get(file)!;
      tags.sort((a, b) => a.attributes.line - b.attributes.line);

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

      // Mirror directory mode: emit imports under the file header when
      // `--with incs` / `includeImports` is enabled. Without this branch
      // the option silently no-ops in community mode.
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

      for (const tag of tags) {
        const signature = tag.attributes.signature || '';
        const startLine = tag.attributes.line + 1;
        const endLine = tag.attributes.endLine ? tag.attributes.endLine + 1 : startLine;
        const lineRange = endLine > startLine ? `[L${startLine}-L${endLine}]` : `[L${startLine}]`;
        let line = `│ ${lineRange} ${tag.attributes.kind} ${tag.attributes.label}${signature}`;
        if (tag.attributes.doc) {
          const doc = tag.attributes.doc.length > 50
            ? tag.attributes.doc.substring(0, 47) + '...'
            : tag.attributes.doc;
          line += `  # ${doc}`;
        }
        outputLines.push(line);
        currentTokens += await this.estimateTokens(line);
        // `--with cf|df`: the function's flow graphs, indented under it.
        for (const flowLine of flowLines(tag.attributes)) {
          const text = `│ ${flowLine}`;
          outputLines.push(text);
          currentTokens += await this.estimateTokens(text);
        }

        if (currentTokens >= this.tokenLimit) {
          truncated = true;
          break;
        }
      }

      outputLines.push('');
      if (currentTokens >= this.tokenLimit) {
        truncated = true;
        break;
      }
    }

    if (truncated) {
      // T-0036: warn when a community overflows the token budget. We
      // fall through to the same silent truncation path the directory
      // renderer uses — sub-chunking is deferred per spec R4.
      Logger.warn(
        `Community ${communityId} exceeded tokenLimit ` +
          `(${currentTokens}/${this.tokenLimit}) — output truncated. ` +
          `Sub-chunking is not implemented yet (spec R4).`
      );
    }

    return { content: outputLines.map(terminalSafe).join('\n'), tokenCount: currentTokens };
  }

  /**
   * Build a root index listing every community chunk (size + top nodes),
   * sorted by size desc.
   */
  private buildCommunityRootContent(
    communityOrder: number[],
    byCommunity: Map<number, RankedNode[]>
  ): string {
    const lines: string[] = [];
    lines.push('# Communities');
    lines.push('');
    lines.push('Chunks below are grouped by graph community (Louvain).');
    lines.push('');
    for (const cid of communityOrder) {
      const members = byCommunity.get(cid) ?? [];
      const label = cid === CLUSTER_SENTINEL ? 'Unclustered' : `Community ${cid}`;
      lines.push(`## ${terminalSafe(String(label))} — ${members.length} nodes`);
      const topNodes = members
        .slice()
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 5);
      for (const n of topNodes) {
        lines.push(`- ${terminalSafe(n.id)}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * Compute a community-keyed chunk file path. Mirrors `getChunkPath`.
   */
  private getCommunityChunkPath(outputBasePath: string, communityId: number): string {
    const key = communityId === CLUSTER_SENTINEL ? 'unclustered' : `community_${communityId}`;
    const ext = path.extname(outputBasePath) || '.md';
    const base = outputBasePath.replace(ext, '');
    return `${base}_${key}${ext}`;
  }

  /**
   * Community-grouping entry point. Emits one chunk per community, ordered
   * by size desc, plus a `root` chunk that lists communities with their
   * top nodes.
   */
  private async renderChunkedByCommunity(
    outputBasePath: string
  ): Promise<ChunkedOutput> {
    const byCommunity = this.organizeByCommunity();

    // Order communities by size desc, sentinel last.
    const communityOrder = Array.from(byCommunity.keys()).sort((a, b) => {
      if (a === CLUSTER_SENTINEL) return 1;
      if (b === CLUSTER_SENTINEL) return -1;
      const sizeA = byCommunity.get(a)!.length;
      const sizeB = byCommunity.get(b)!.length;
      return sizeB - sizeA;
    });

    const chunks = new Map<string, string>();
    const metadata: ChunkMetadata[] = [];

    for (const cid of communityOrder) {
      const nodes = byCommunity.get(cid)!;
      const { content, tokenCount } = await this.renderCommunity(cid, nodes);
      const chunkPath = this.getCommunityChunkPath(outputBasePath, cid);
      chunks.set(chunkPath, content);

      // True file count: unique `attributes.file` values across the
      // ranked tag nodes in this community. `nodes.length` would mix
      // file and tag nodes and be misleading downstream (generate.ts
      // prints "(X files, Y tokens)" from this field).
      const communityFiles = new Set<string>();
      for (const node of nodes) {
        if (isRankedTagNode(node) && node.attributes.file) {
          communityFiles.add(node.attributes.file);
        }
      }

      const label = cid === CLUSTER_SENTINEL ? 'unclustered' : `community_${cid}`;
      metadata.push({
        directory: label,
        filePath: chunkPath,
        tokenCount,
        fileCount: communityFiles.size,
        parent: undefined,
        children: [],
        depth: 0,
      });
    }

    // Root index chunk
    const rootBody = this.buildCommunityRootContent(communityOrder, byCommunity);
    const insightBlock = this.renderInsights();
    const rootContent = insightBlock ? `${insightBlock}\n${rootBody}` : rootBody;
    const ext = path.extname(outputBasePath) || '.md';
    const base = outputBasePath.replace(ext, '');
    const rootChunk = `${base}_root${ext}`;
    chunks.set(rootChunk, rootContent);

    // Add a metadata entry for the root chunk so `chunks.size === metadata.length`
    // and callers (generate.ts "Total chunks" / share summary) count it.
    metadata.push({
      directory: 'root',
      filePath: rootChunk,
      tokenCount: rootContent.trim() ? rootContent.trim().split(/\s+/).length : 0,
      fileCount: communityOrder.length,
      parent: undefined,
      children: metadata.map((entry) => entry.filePath),
      depth: 0,
    });

    return { chunks, metadata, rootChunk };
  }
}
