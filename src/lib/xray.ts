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
import { AsyncEventEmitter } from './events/async-emitter';
import { XrayEvents } from './events/types';
import { PluginManager, XrayPlugin } from './events/plugin';

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

export class Xray extends AsyncEventEmitter<XrayEvents> {
  private config: XrayConfig;
  private cache: SqliteCache;
  private pluginManager: PluginManager;
  private lastGraph?: any;
  private lastRankedNodes?: any[];

  constructor(config: XrayConfig) {
    super();
    this.config = config;
    // Set defaults
    this.config.limit = config.limit || 4096;
    this.config.features = config.features || {};
    this.config.chunked = config.chunked !== false; // default to true
    this.cache = new SqliteCache(config.cachePath || path.join(process.cwd(), '.xray_cache.db'));
    this.pluginManager = new PluginManager();

    // Backward compatibility: convert onProgress to event listener
    if (config.onProgress) {
      this.on('progress', ({ current, total, message }) => {
        config.onProgress!(current, total, message);
      });
    }
  }

  // Plugin methods
  async use(plugin: XrayPlugin): Promise<this> {
    await this.pluginManager.register(plugin, this);
    return this;
  }

  async unload(pluginName: string): Promise<this> {
    await this.pluginManager.unregister(pluginName);
    return this;
  }

  plugins(): XrayPlugin[] {
    return this.pluginManager.list();
  }

  getLastGraph(): { graph?: any; rankedNodes?: any[] } {
    return {
      graph: this.lastGraph,
      rankedNodes: this.lastRankedNodes
    };
  }

  /**
   * Main entry point to generate the repository map.
   * Returns either a single string (non-chunked) or an object with chunk metadata.
   */
  async run(): Promise<string | { chunks: Map<string, string>; rootChunk: string }> {
    try {
      Logger.debug('Starting xray analysis', { config: this.config });

      // 1. Scan Files - use parallel for independent observers
      await this.emitAsyncParallel('scan:start', {
        path: this.config.path,
        config: this.config
      });

      const scanner = new FileScanner(this.config.path);
      const files = scanner.scan();
      Logger.info(`Found ${files.length} files.`);
      Logger.debug(`File list:`, files.slice(0, 10));

      await this.emitAsyncParallel('scan:complete', { files });
      await this.emitProgress('scan', files.length, files.length, 'Scan complete');

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

      // 2. Parse & Build Graph
      const { rankedNodes, graph } = await this.buildGraphWithEvents(files);

      // 3. Render
      const includeIncs = this.config.features?.incs || false;

      // 3. Render
      await this.emitAsyncParallel('render:start', {
        format: this.config.format || 'txt',
        chunked: this.config.chunked !== false,
        outputPath: ''
      });

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

        await this.emitAsyncParallel('render:complete', {
          outputPath: '',
          filesWritten: 1
        });

        return output;
      }

      // Use chunked renderer (returns metadata for caller to handle)
      await this.emitAsyncParallel('render:complete', {
        outputPath: '',
        filesWritten: 0
      });

      return { chunks: new Map(), rootChunk: '' }; // Placeholder - handled by generate command

    } catch (error) {
      await this.emitAsync('error', {
        event: 'run',
        error: error as Error,
        payload: { config: this.config }
      });
      throw error;
    }
  }

  private async emitProgress(stage: string, current: number, total: number, message: string) {
    // Use parallel emission for progress events - listeners are independent observers
    await this.emitAsyncParallel('progress', { stage, current, total, message });
  }

  private async buildGraphWithEvents(files: string[]): Promise<{ rankedNodes: any[]; graph: any }> {
    const parser = new ParserManager(this.config.path);
    const graphBuilder = new GraphBuilder();

    // Forward GraphBuilder events to Xray listeners
    graphBuilder.on('node:add', async (event) => {
      await this.emitAsync('graph:add-node', event);
    });

    graphBuilder.on('edge:add', async (event) => {
      await this.emitAsync('graph:add-edge', event);
    });

    graphBuilder.on('error', async (event) => {
      await this.emitAsync('error', event);
    });

    const includeVars = this.config.features?.vars || false;
    const includeDocs = this.config.features?.docs ? 'all' : 'none';
    const enableCfg = this.config.features?.cf || false;
    const enableDfg = this.config.features?.df || false;

    let processed = 0;
    for (const file of files) {
      // Event: Check if file should be skipped
      const scanEvent = { file, skip: false };
      await this.emitAsync('scan:file', scanEvent);
      if (scanEvent.skip) continue;

      await this.emitProgress('parsing', processed, files.length, file);

      const absPath = path.join(this.config.path, file);
      const stats = fs.statSync(absPath);

      // Event: Cache check - use parallel for observers
      await this.emitAsyncParallel('cache:check', { file, mtime: stats.mtimeMs });

      const cached = this.cache.get(file, stats.mtimeMs, includeDocs, includeVars);

      if (cached) {
        // Event: Cache hit - use sequential since listeners can modify cached data
        const cacheHitEvent = { file, tags: cached.tags, imports: cached.imports };
        await this.emitAsync('cache:hit', cacheHitEvent);
        graphBuilder.loadFromCache(file, cacheHitEvent.tags, cacheHitEvent.imports);
      } else {
        // Event: Cache miss - use parallel for observers
        await this.emitAsyncParallel('cache:miss', { file });

        const content = fs.readFileSync(absPath, 'utf-8');

        // Event: Before parse (listeners can modify content or skip)
        const parseBeforeEvent = { file, content, skip: false };
        await this.emitAsync('parse:before', parseBeforeEvent);
        if (parseBeforeEvent.skip) continue;

        try {
          const { tags, imports } = await parser.parse(
            file,
            parseBeforeEvent.content,
            includeVars,
            includeDocs,
            enableCfg,
            enableDfg
          );

          // Event: After parse (listeners can modify results)
          const parseAfterEvent = { file, tags, imports };
          await this.emitAsync('parse:after', parseAfterEvent);

          // Event: Before adding to graph
          const addFileEvent = { file, tags: parseAfterEvent.tags, imports: parseAfterEvent.imports, skip: false };
          await this.emitAsync('graph:add-file', addFileEvent);

          if (!addFileEvent.skip) {
            graphBuilder.addFile(file, addFileEvent.tags, addFileEvent.imports);
          }

          // Event: Cache write
          const cacheWriteEvent = { file, tags: parseAfterEvent.tags, imports: parseAfterEvent.imports };
          await this.emitAsync('cache:write', cacheWriteEvent);
          this.cache.set(file, stats.mtimeMs, cacheWriteEvent.tags, cacheWriteEvent.imports, includeDocs, includeVars);
        } catch (error) {
          // Event: Parse error
          await this.emitAsync('parse:error', {
            file,
            error: error as Error,
            recovered: false
          });
          // Continue processing other files
        }
      }
      processed++;
    }

    await this.emitProgress('parsing', files.length, files.length, 'Parsing complete');

    const graph = await graphBuilder.getGraph();

    // Graph complete - use parallel for observers (metrics, logging)
    await this.emitAsyncParallel('graph:complete', {
      graph,
      nodeCount: graph.order,
      edgeCount: graph.size
    });

    // Ranking - use parallel for observers
    await this.emitAsyncParallel('rank:start', { graph, anchor: this.config.anchor });
    const ranker = new Ranker(graph);
    const rankedNodes = ranker.rank(this.config.anchor);

    // Rank complete - use sequential since listeners can modify rankings
    const rankCompleteEvent = { rankedNodes };
    await this.emitAsync('rank:complete', rankCompleteEvent);

    this.lastGraph = graph;
    this.lastRankedNodes = rankCompleteEvent.rankedNodes;

    return { rankedNodes: rankCompleteEvent.rankedNodes, graph };
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

    // Forward GraphBuilder events to Xray listeners
    graphBuilder.on('node:add', async (event) => {
      await this.emitAsync('graph:add-node', event);
    });

    graphBuilder.on('edge:add', async (event) => {
      await this.emitAsync('graph:add-edge', event);
    });

    graphBuilder.on('error', async (event) => {
      await this.emitAsync('error', event);
    });

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
    const graph = await graphBuilder.getGraph();

    // 4. Rank (PageRank + Heuristics)
    const ranker = new Ranker(graph);
    const rankedNodes = ranker.rank(this.config.anchor);

    this.lastGraph = graph;
    this.lastRankedNodes = rankedNodes;

    return { rankedNodes, graph };
  }
}
