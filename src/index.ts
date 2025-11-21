import * as fs from 'fs';
import * as path from 'path';
import { FileScanner } from './scanner';
import { ParserManager } from './parser/manager';
import { updateLanguageQuery } from './parser/language-registry';
import { GraphBuilder } from './graph/builder';
import { Ranker } from './graph/ranker';
import { MapRenderer } from './renderer/map-renderer';
import { SqliteCache } from './cache/sqlite-cache';
import { Logger } from './logger';

export interface XrayConfig {
  root: string;
  tokenLimit?: number;
  cachePath?: string;
  includeVariables?: boolean;
  doc?: string;
  focus?: string;
  maxDepth?: number;
  enableCfg?: boolean;
  enableDfg?: boolean;
  queries?: Record<string, string>;
  onProgress?: (current: number, total: number, file: string) => void;
}

export class Xray {
  private config: XrayConfig;
  private cache: SqliteCache;

  constructor(config: XrayConfig) {
    this.config = config;
    this.config.tokenLimit = config.tokenLimit || 4096;
    this.cache = new SqliteCache(config.cachePath || path.join(process.cwd(), '.xray_cache.db'));
  }

  /**
   * Main entry point to generate the repository map.
   */
  async run(): Promise<string> {
    // 1. Scan Files
    const scanner = new FileScanner(this.config.root);
    const files = scanner.scan();
    Logger.info(`Found ${files.length} files.`);

    // 1.5 Apply Custom Queries
    if (this.config.queries) {
      for (const [ext, source] of Object.entries(this.config.queries)) {
        try {
          let queryContent: string;
          if (source.startsWith('http://') || source.startsWith('https://')) {
            Logger.info(`Fetching custom query for ${ext} from ${source}...`);
            const response = await fetch(source);
            if (!response.ok) {
              throw new Error(`Failed to fetch query: ${response.statusText}`);
            }
            queryContent = await response.text();
          } else {
            Logger.info(`Loading custom query for ${ext} from ${source}...`);
            queryContent = fs.readFileSync(source, 'utf-8');
          }
          updateLanguageQuery(ext, queryContent);
        } catch (e) {
          Logger.error(`Failed to load custom query for ${ext}:`, e);
        }
      }
    }

    // 2. Parse & Extract (with Cache)
    const parser = new ParserManager(this.config.root);
    const graphBuilder = new GraphBuilder();

    if (this.config.onProgress) {
      this.config.onProgress(0, files.length, '');
    }

    let processed = 0;
    for (const file of files) {
      if (this.config.onProgress) {
        this.config.onProgress(processed, files.length, file);
      }

      const absPath = path.join(this.config.root, file);
      const stats = fs.statSync(absPath);

      // Check cache
      const cached = this.cache.get(file, stats.mtimeMs, this.config.doc || 'none', this.config.includeVariables || false);

      if (cached) {
        graphBuilder.loadFromCache(file, cached.tags, cached.imports);
      } else {
        const content = fs.readFileSync(absPath, 'utf-8');
        // console.log(`Parsing ${file} with docstrings config: ${this.config.doc}`);
        const { tags, imports } = await parser.parse(file, content, this.config.includeVariables, this.config.doc, this.config.enableCfg, this.config.enableDfg);

        graphBuilder.addFile(file, tags, imports);
        this.cache.set(file, stats.mtimeMs, tags, imports, this.config.doc || 'none', this.config.includeVariables || false);
      }
      processed++;
    }

    if (this.config.onProgress) {
      this.config.onProgress(files.length, files.length, 'Done');
    }

    // 3. Build Graph
    const graph = graphBuilder.getGraph();

    // 4. Rank (PageRank + Heuristics)
    const ranker = new Ranker(graph);
    const rankedNodes = ranker.rank(this.config.focus);

    // 5. Render
    const renderer = new MapRenderer(this.config.root, rankedNodes, graph);
    return renderer.render(this.config.tokenLimit!, this.config.maxDepth);
  }
}
