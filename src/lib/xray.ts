import * as fs from 'fs';
import * as path from 'path';
import { FileScanner } from './scanner';
import { ParserManager } from './parser/manager';
import { updateLanguageQuery } from './parser/language-registry';
import { GraphBuilder } from './graph/builder';
import { Ranker } from './graph/ranker';
import { MapRenderer } from './renderer/map-renderer';
import { ChunkedRenderer } from './renderer/chunked-renderer';
import { SqliteCache } from './cache/sqlite-cache';
import { Logger } from './logger';

// Export strategy module
export * as strategy from './strategy';

export interface XrayConfig {
  // Core options
  path: string;
  limit?: number;
  cachePath?: string;

  // Focus and filtering
  anchor?: string;
  depth?: number;
  match?: string[];
  catch?: string[];

  // Features (grouped, matching --with flag)
  features?: {
    vars?: boolean;      // include variables
    incs?: boolean;      // include imports
    docs?: boolean;      // include docstrings
    cost?: boolean;      // estimate cost
    df?: boolean;        // data flow graph
    cf?: boolean;        // control flow graph
  };

  // Output options
  format?: 'txt' | 'csv' | 'xml' | 'json';
  diagram?: 'mermaid' | 'dot';
  chunked?: boolean;     // enable chunked output (default: true)

  // Advanced
  queries?: Record<string, string>;

  // Internal
  onProgress?: (current: number, total: number, file: string) => void;
}

export class Xray {
  private config: XrayConfig;
  private cache: SqliteCache;

  constructor(config: XrayConfig) {
    this.config = config;
    // Set defaults
    this.config.limit = config.limit || 4096;
    this.config.features = config.features || {};
    this.config.chunked = config.chunked !== false; // default to true
    this.cache = new SqliteCache(config.cachePath || path.join(process.cwd(), '.xray_cache.db'));
  }

  /**
   * Main entry point to generate the repository map.
   * Returns either a single string (non-chunked) or an object with chunk metadata.
   */
  async run(): Promise<string | { chunks: Map<string, string>; rootChunk: string }> {
    Logger.debug('Starting xray analysis', { config: this.config });

    // 1. Scan Files
    const scanner = new FileScanner(this.config.path);
    const files = scanner.scan();
    Logger.info(`Found ${files.length} files.`);
    Logger.debug(`File list:`, files.slice(0, 10));

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
    const parser = new ParserManager(this.config.path);
    const graphBuilder = new GraphBuilder();

    if (this.config.onProgress) {
      this.config.onProgress(0, files.length, '');
    }

    const includeVars = this.config.features?.vars || false;
    const includeDocs = this.config.features?.docs ? 'all' : 'none';
    const enableCfg = this.config.features?.cf || false;
    const enableDfg = this.config.features?.df || false;

    let processed = 0;
    for (const file of files) {
      if (this.config.onProgress) {
        this.config.onProgress(processed, files.length, file);
      }

      const absPath = path.join(this.config.path, file);
      const stats = fs.statSync(absPath);

      // Check cache
      const cached = this.cache.get(file, stats.mtimeMs, includeDocs, includeVars);

      if (cached) {
        graphBuilder.loadFromCache(file, cached.tags, cached.imports);
      } else {
        const content = fs.readFileSync(absPath, 'utf-8');
        const { tags, imports } = await parser.parse(file, content, includeVars, includeDocs, enableCfg, enableDfg);

        graphBuilder.addFile(file, tags, imports);
        this.cache.set(file, stats.mtimeMs, tags, imports, includeDocs, includeVars);
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
    const rankedNodes = ranker.rank(this.config.anchor);

    // 5. Render
    const includeIncs = this.config.features?.incs || false;

    // If chunked rendering is disabled, use the original single-file renderer
    if (!this.config.chunked) {
      const renderer = new MapRenderer(this.config.path, rankedNodes, graph);
      const output = await renderer.render(this.config.limit!, this.config.depth, includeIncs);

      if (this.config.features?.cost) {
        const { tokenizeAndEstimateCost } = await import('llm-cost');
        const { cost } = await tokenizeAndEstimateCost({
          model: 'gpt-4o',
          input: output
        });
        Logger.info(`Estimated cost: $${(cost || 0).toFixed(6)}`);
      }

      return output;
    }

    // Use chunked renderer (returns metadata for caller to handle)
    return { chunks: new Map(), rootChunk: '' }; // Placeholder - handled by generate command
  }

  /**
   * Get the graph builder for external access (used by chunked rendering)
   */
  async buildGraph(): Promise<{ rankedNodes: any[]; graph: any }> {
    // 1. Scan Files
    const scanner = new FileScanner(this.config.path);
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
    const parser = new ParserManager(this.config.path);
    const graphBuilder = new GraphBuilder();

    if (this.config.onProgress) {
      this.config.onProgress(0, files.length, '');
    }

    const includeVars = this.config.features?.vars || false;
    const includeDocs = this.config.features?.docs ? 'all' : 'none';
    const enableCfg = this.config.features?.cf || false;
    const enableDfg = this.config.features?.df || false;

    let processed = 0;
    for (const file of files) {
      if (this.config.onProgress) {
        this.config.onProgress(processed, files.length, file);
      }

      const absPath = path.join(this.config.path, file);
      const stats = fs.statSync(absPath);

      // Check cache
      const cached = this.cache.get(file, stats.mtimeMs, includeDocs, includeVars);

      if (cached) {
        graphBuilder.loadFromCache(file, cached.tags, cached.imports);
      } else {
        const content = fs.readFileSync(absPath, 'utf-8');
        const { tags, imports } = await parser.parse(file, content, includeVars, includeDocs, enableCfg, enableDfg);

        graphBuilder.addFile(file, tags, imports);
        this.cache.set(file, stats.mtimeMs, tags, imports, includeDocs, includeVars);
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
    const rankedNodes = ranker.rank(this.config.anchor);

    return { rankedNodes, graph };
  }
}
