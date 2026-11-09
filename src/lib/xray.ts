import * as fs from 'fs';
import * as path from 'path';
import { FileScanner } from './scanner';
import { compileMatchers, quotePattern } from './path-match';
import { ParserManager } from './parser/manager';
import { updateLanguageQuery } from './parser/language-registry';
import { flowCacheKey, flowTableFor, flowLanguages } from './flow';
import { beginLanguageRun, packForExtension, reportSkippedLanguages, type SkippedSummary } from './parser/grammars';
import { GraphBuilder } from './graph/builder';
import { Ranker } from './graph/ranker';
import { MapRenderer } from './renderer/map-renderer';
import { ChunkedRenderer } from './renderer/chunked-renderer';
import { detectGoModules } from './graph/go-resolver';
import { IMPORT_MANIFESTS } from './imports/collect';
import { contractLanguageOf } from './imports/tree';
import type { ResolveInput } from './imports/resolve';
import { SqliteCache } from './cache/sqlite-cache';
import { Logger } from './logger';
import { readTextSafe, UnsafeFileError } from './safe-read';
import { AsyncEventEmitter } from './events/async-emitter';
import { XrayEvents } from './events/types';
import { PluginManager, XrayPlugin } from './events/plugin';
import { TelemetryPlugin } from './plugins/telemetry-plugin';
import { loadConfig } from './config';
import { FileReadError, FileAccessError } from './error/types';
import { XrayGraph, RankedNode } from '../types/graph';
import { openCacheDbPath } from './storage';

// Export strategy module
export * as strategy from './strategy';

/** Files seen by the pipeline, files parsed (or served from cache), grammars skipped. */
export interface ParseCoverage {
  files: number;
  parsed: number;
  skipped: SkippedSummary[];
}

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
  chunked?: boolean;     // enable chunked output (default: true)

  // Advanced
  queries?: Record<string, string>;

  // Languages (names or bundles) to parse; each is required. Default: auto-detect.
  languages?: string[];

  // Config file to read (root `--config`). Unset: discover from `path`.
  configPath?: string;

  // Internal
  onProgress?: (current: number, total: number, file: string) => void;
}

export class Xray extends AsyncEventEmitter<XrayEvents> {
  private config: XrayConfig;
  private cache: SqliteCache;
  private useFileCache = true;
  private pluginManager: PluginManager;
  private lastGraph?: XrayGraph;
  private lastRankedNodes?: RankedNode[];
  private lastCoverage?: ParseCoverage;
  private stashes = new Map<string, unknown[]>();
  // Manifests (go.mod, package.json, ...) listed by the last scan: imports
  // resolution inputs, never parsed.
  private manifests: string[] = [];

  constructor(config: XrayConfig) {
    super();
    this.config = config;
    // Set defaults
    this.config.limit = config.limit || 4096;
    this.config.features = config.features || {};
    this.config.chunked = config.chunked !== false; // default to true
    this.cache = new SqliteCache(config.cachePath || openCacheDbPath(process.cwd()));
    this.pluginManager = new PluginManager();

    // Auto-register telemetry plugin if enabled
    const fileConfig = loadConfig(config.configPath, config.path);
    const telemetryConfig = fileConfig?.telemetry;
    if (telemetryConfig?.enabled) {
      const telemetryPlugin = new TelemetryPlugin({
        enabled: true,
        projectRoot: config.path,
        ...telemetryConfig
      });
      this.pluginManager.register(telemetryPlugin, this);
    }

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

  async useIfAbsent(plugin: XrayPlugin): Promise<this> {
    await this.pluginManager.applyIfAbsent(plugin, this);
    return this;
  }

  async unload(pluginName: string): Promise<this> {
    await this.pluginManager.unregister(pluginName);
    return this;
  }

  plugins(): XrayPlugin[] {
    return this.pluginManager.list();
  }

  /**
   * Stop reading and writing the persistent per-file cache for this run.
   * Plugins may edit tags, and the cache is shared by every later run.
   */
  disableFileCache(): void {
    this.useFileCache = false;
  }

  /** Parse coverage of the last pipeline run (files parsed, grammars skipped). */
  getLastCoverage(): ParseCoverage | undefined {
    return this.lastCoverage;
  }

  getLastGraph(): { graph?: XrayGraph; rankedNodes?: RankedNode[] } {
    return {
      graph: this.lastGraph,
      rankedNodes: this.lastRankedNodes
    };
  }

  /**
   * Generic per-run side-channel storage. Both core and plugins use it:
   * each caller claims a string namespace and reads/writes its own slot.
   * Cleared at the top of every pipeline run so long-lived `Xray`
   * instances do not leak items across runs.
   *
   * Storage only — no domain logic. Plugins typically wrap with typed
   * sugar in their own package:
   *
   *     const stashSurprises = (xray, items: Surprise[]) =>
   *       xray.stash('surprise', items);
   */
  stash(namespace: string, items: unknown[]): void {
    const bucket = this.stashes.get(namespace);
    if (bucket) {
      bucket.push(...items);
    } else {
      this.stashes.set(namespace, [...items]);
    }
  }

  retrieve(namespace: string, n?: number): unknown[] {
    const bucket = this.stashes.get(namespace);
    if (!bucket) return [];
    return n === undefined ? bucket.slice() : bucket.slice(0, n);
  }

  /**
   * Main entry point to generate the repository map.
   * Returns either a single string (non-chunked) or an object with chunk metadata.
   */
  async run(): Promise<string | { chunks: Map<string, string>; rootChunk: string }> {
    try {
      Logger.debug('Starting xray analysis', { config: this.config });

      // 1. Scan Files + apply custom queries
      const files = await this.scanFiles();

      // 2. Parse & Build Graph (emits all pipeline lifecycle events)
      const { rankedNodes, graph } = await this.buildPipeline(files);

      // 3. Render
      const includeIncs = this.config.features?.incs || false;
      const chunked = this.config.chunked !== false;

      // Pre-construct the renderer so listeners can interact with it
      // (e.g. inject pre-render hooks) via the render:start event payload.
      //
      // CAVEAT for chunked mode: `run()` does not actually drive the
      // ChunkedRenderer — `src/commands/generate.ts` calls `buildGraph()`
      // and constructs its own renderer to write chunks. The instance
      // emitted here on the chunked branch is observability-only;
      // listeners that mutate it will NOT affect generate.ts's renderer.
      // The non-chunked branch is the only path where `run()` itself
      // drives rendering, so listener configuration takes effect there.
      const renderer: MapRenderer | ChunkedRenderer = chunked
        ? new ChunkedRenderer({
            root: this.config.path,
            ranked: rankedNodes,
            graph,
            tokenLimit: this.config.limit!,
            maxDepth: this.config.depth,
            includeImports: includeIncs,
          })
        : new MapRenderer(this.config.path, rankedNodes, graph);

      // Sequential: listeners may configure or wrap the renderer.
      await this.emitAsync('render:start', {
        format: this.config.format || 'txt',
        chunked,
        outputPath: '',
        renderer
      });

      // If chunked rendering is disabled, use the original single-file renderer
      if (!this.config.chunked) {
        const output = await (renderer as MapRenderer).render(this.config.limit!, this.config.depth, includeIncs);

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

  /**
   * Scan filesystem and apply custom tree-sitter query overrides.
   * Emits `scan:start` and `scan:complete`. Shared by `run()` and `buildGraph()`.
   */
  private async scanFiles(): Promise<string[]> {
    await this.emitAsyncParallel('scan:start', {
      path: this.config.path,
      config: this.config
    });

    // One listing for sources and the manifests imports resolution reads.
    const scanner = new FileScanner(this.config.path);
    const sourceExts = new Set(FileScanner.supportedExtensions());
    const manifestNames = new Set(IMPORT_MANIFESTS);
    const listed = scanner.scan([...sourceExts, ...IMPORT_MANIFESTS.map(m => path.extname(m))]);
    this.manifests = listed.filter(f => manifestNames.has(path.basename(f)));
    let files = listed.filter(f => sourceExts.has(path.extname(f)) && !manifestNames.has(path.basename(f)));
    // `match` narrows the source files to analyze (same semantics as
    // `explore --match`); manifests stay: import resolution reads them.
    const patterns = this.config.match ?? [];
    if (patterns.length > 0) {
      const matches = compileMatchers(patterns);
      files = files.filter(f => matches(f.split(path.sep).join('/')));
      if (files.length === 0) Logger.warn(`No files match --match ${patterns.map((p) => quotePattern(p)).join(', ')}`);
    }
    Logger.info(`Found ${files.length} files.`);
    Logger.debug(`File list:`, files.slice(0, 10));

    await this.emitAsyncParallel('scan:complete', { files });
    await this.emitProgress('scan', files.length, files.length, 'Scan complete');

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
            try {
              queryContent = fs.readFileSync(source, 'utf-8');
            } catch (err: any) {
              throw new FileReadError(source, err);
            }
          }
          updateLanguageQuery(ext, queryContent);
        } catch (e) {
          Logger.error(`Failed to load custom query for ${ext}:`, e);
        }
      }
    }

    return files;
  }

  /** Manifests of the last scan as resolution inputs (posix paths); unreadable ones are left out. */
  private readManifests(): ResolveInput[] {
    const out: ResolveInput[] = [];
    for (const f of this.manifests) {
      try {
        out.push({ path: f.split(path.sep).join('/'), content: readTextSafe(this.config.path, f) });
      } catch {
        // Tracked but deleted in the working tree, or a directory: nothing to read.
      }
    }
    return out;
  }

  /**
   * Shared pipeline core for `run()` and `buildGraph()`. Owns every lifecycle
   * event from per-file parsing through ranking:
   *   scan:file, cache:*, parse:*, graph:add-*, graph:complete, rank:start, rank:complete.
   *
   * Both public entry points must call this so plugins register and fire on
   * every code path (including the default chunked CLI path).
   */
  private async buildPipeline(files: string[]): Promise<{ rankedNodes: RankedNode[]; graph: XrayGraph }> {
    // Reset per-run side-channel storage so long-lived `Xray` instances do
    // not leak stash entries across runs.
    this.stashes.clear();

    // Language selection: explicit (programmatic or .xrayrc `languages`) means
    // required; otherwise auto - parse whatever has an installed grammar.
    beginLanguageRun(this.config.languages ?? loadConfig(this.config.configPath, this.config.path)?.languages);

    const parser = new ParserManager(this.config.path);
    const graphBuilder = new GraphBuilder();
    if (files.some(f => f.endsWith('.go'))) {
      graphBuilder.setGoModule(detectGoModules(this.config.path, files));
    }
    if (files.some(f => contractLanguageOf(f.split(path.sep).join('/')) !== undefined)) {
      graphBuilder.setResolutionInputs(this.readManifests());
    }

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
    const flowKey = flowCacheKey(enableCfg, enableDfg);
    // Languages seen that have no flow table: reported once, after the run.
    const noFlow = new Map<string, number>();
    const flowOn = enableCfg || enableDfg;
    const noteNoFlow = (file: string): void => {
      if (!flowOn || flowTableFor(file)) return;
      const lang = packForExtension(path.extname(file))?.name;
      if (lang) noFlow.set(lang, (noFlow.get(lang) ?? 0) + 1);
    };

    let processed = 0;
    let parsed = 0;
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

      // Key by absolute path: the cache db lives in the cwd and is shared by every
      // root scanned from it, so a root-relative key lets `a/main.ts` and
      // `b/main.ts` (same relative path, equal mtime) serve each other's tags.
      const cacheKey = absPath;
      const cached = this.useFileCache ? this.cache.get(cacheKey, stats.mtimeMs, includeDocs, includeVars, flowKey) : null;

      if (cached) {
        // Event: Cache hit - use sequential since listeners can modify cached data
        const cacheHitEvent = { file, tags: cached.tags, imports: cached.imports };
        await this.emitAsync('cache:hit', cacheHitEvent);
        await graphBuilder.loadFromCache(file, cacheHitEvent.tags, cacheHitEvent.imports, cached.records);
        parsed++;
        noteNoFlow(file);
      } else {
        // Event: Cache miss - use parallel for observers
        await this.emitAsyncParallel('cache:miss', { file });

        let content: string;
        try {
          content = readTextSafe(this.config.path, file);
        } catch (err: any) {
          // Refused (not a regular file, outside the root, too large): tallied
          // and reported once at exit, not as one error per file.
          if (err instanceof UnsafeFileError) continue;
          await this.emitAsync('error', {
            event: 'file:read',
            error: new FileReadError(file, err),
            payload: { file }
          });
          continue; // Skip this file and continue with others
        }

        // Event: Before parse (listeners can modify content or skip)
        const parseBeforeEvent = { file, content, skip: false };
        await this.emitAsync('parse:before', parseBeforeEvent);
        if (parseBeforeEvent.skip) continue;

        try {
          const { tags, imports, records, skipped } = await parser.parse(
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
            await graphBuilder.addFile(file, addFileEvent.tags, addFileEvent.imports, records);
          }

          // Event: Cache write
          const cacheWriteEvent = { file, tags: parseAfterEvent.tags, imports: parseAfterEvent.imports };
          await this.emitAsync('cache:write', cacheWriteEvent);
          // Never cache a file we could not parse for lack of a grammar:
          // installing it later must take effect without touching the file.
          if (!skipped) {
            parsed++;
            noteNoFlow(file);
            if (this.useFileCache) this.cache.set(cacheKey, stats.mtimeMs, cacheWriteEvent.tags, cacheWriteEvent.imports, includeDocs, includeVars, records, flowKey);
          }
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
    if (noFlow.size > 0) {
      const langs = [...noFlow].map(([l, n]) => `${l} (${n} ${n === 1 ? 'file' : 'files'})`).join(', ');
      Logger.warn(
        `cf/df: no flow graphs for ${langs} yet; its functions carry none. Supported: ${flowLanguages().join(', ')}`
      );
    }
    const skippedFlow = Object.entries(parser.flowSkipped);
    if (skippedFlow.length > 0) {
      const why: Record<string, string> = { depth: 'nested too deeply', budget: 'file too large for flow', size: 'source too large for flow', error: 'flow failed' };
      Logger.warn(`cf/df: skipped ${skippedFlow.map(([k, n]) => `${n} ${n === 1 ? 'function' : 'functions'} (${why[k] ?? k})`).join(', ')}; no graphs for them`);
    }
    const skippedGrammars = reportSkippedLanguages({ format: this.config.format });
    this.lastCoverage = { files: files.length, parsed, skipped: skippedGrammars };

    const graph = await graphBuilder.getGraph();

    // Graph complete - sequential: mutation plugins rely on attach-order
    // semantics to write edge/node attributes deterministically.
    await this.emitAsync('graph:complete', {
      graph,
      nodeCount: graph.order,
      edgeCount: graph.size
    });

    // Ranking - use parallel for observers
    await this.emitAsyncParallel('rank:start', { graph, anchor: this.config.anchor });
    const ranker = new Ranker(graph);
    const rankedNodes = ranker.rank(this.config.anchor);

    // Rank complete - sequential: listeners can modify rankings or stamp
    // edge attrs through the graph reference.
    const rankCompleteEvent = { graph, rankedNodes };
    await this.emitAsync('rank:complete', rankCompleteEvent);

    this.lastGraph = graph;
    this.lastRankedNodes = rankCompleteEvent.rankedNodes;

    return { rankedNodes: rankCompleteEvent.rankedNodes, graph };
  }

  /**
   * Public entry point used by the chunked CLI path (`xray map`).
   *
   * Runs the same shared pipeline as `run()` so every lifecycle event fires
   * (previously silent — plugins registered before `buildGraph()` used to
   * no-op on the default CLI path). Also emits `render:start` so plugins
   * can observe render-time state before the caller renders chunks with
   * its own renderer instance.
   */
  async buildGraph(): Promise<{ rankedNodes: RankedNode[]; graph: XrayGraph }> {
    const files = await this.scanFiles();
    const { rankedNodes, graph } = await this.buildPipeline(files);

    // The renderer instance emitted here is observability-only — the actual
    // chunk writing is performed by `src/commands/generate.ts`, which
    // constructs its own renderer. We still pick the right type so the
    // payload stays internally consistent with `chunked`.
    const includeIncs = this.config.features?.incs || false;
    const chunked = this.config.chunked !== false;
    const renderer: MapRenderer | ChunkedRenderer = chunked
      ? new ChunkedRenderer({
          root: this.config.path,
          ranked: rankedNodes,
          graph,
          tokenLimit: this.config.limit!,
          maxDepth: this.config.depth,
          includeImports: includeIncs,
        })
      : new MapRenderer(this.config.path, rankedNodes, graph);

    await this.emitAsync('render:start', {
      format: this.config.format || 'txt',
      chunked,
      outputPath: '',
      renderer
    });

    return { rankedNodes, graph };
  }
}
