import * as fs from 'fs';
import * as path from 'path';
import { FileScanner } from './scanner';
import { ParserManager } from './parser/manager';
import { GraphBuilder } from './graph/builder';
import { Ranker } from './graph/ranker';
import { MapRenderer } from './renderer/map-renderer';
import { SqliteCache } from './cache/sqlite-cache';

export interface RepoMapConfig {
  root: string;
  tokenLimit?: number;
  cachePath?: string;
  includeVariables?: boolean;
  doc?: string;
  focus?: string;
}

export class RepoMap {
  private config: RepoMapConfig;
  private cache: SqliteCache;

  constructor(config: RepoMapConfig) {
    this.config = config;
    this.config.tokenLimit = config.tokenLimit || 4096;
    this.cache = new SqliteCache(config.cachePath || path.join(config.root, '.repomap_cache.db'));
  }

  /**
   * Main entry point to generate the repository map.
   */
  async run(): Promise<string> {
    // 1. Scan Files
    const scanner = new FileScanner(this.config.root);
    const files = scanner.scan();
    console.log(`Found ${files.length} files.`);

    // 2. Parse & Extract (with Cache)
    const parser = new ParserManager(this.config.root);
    const graphBuilder = new GraphBuilder();

    for (const file of files) {
      const absPath = path.join(this.config.root, file);
      const stats = fs.statSync(absPath);

      // Check cache
      const cached = this.cache.get(file, stats.mtimeMs, this.config.doc || 'none', this.config.includeVariables || false);

      if (cached) {
        graphBuilder.loadFromCache(file, cached.tags, cached.imports);
      } else {
        const content = fs.readFileSync(absPath, 'utf-8');
        // console.log(`Parsing ${file} with docstrings config: ${this.config.doc}`);
        const { tags, imports } = await parser.parse(file, content, this.config.includeVariables, this.config.doc);

        graphBuilder.addFile(file, tags, imports);
        this.cache.set(file, stats.mtimeMs, tags, imports, this.config.doc || 'none', this.config.includeVariables || false);
      }
    }

    // 3. Build Graph
    const graph = graphBuilder.getGraph();

    // 4. Rank (PageRank + Heuristics)
    const ranker = new Ranker(graph);
    const rankedNodes = ranker.rank(this.config.focus);

    // 5. Render
    const renderer = new MapRenderer(this.config.root, rankedNodes, graph);
    return renderer.render(this.config.tokenLimit!);
  }
}
