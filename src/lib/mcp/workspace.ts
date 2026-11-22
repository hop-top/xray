/**
 * Warm in-process workspace manager for the MCP server.
 *
 * Maintains an LRU cache (max 8 entries) of parsed graphs and trigram search
 * indexes keyed by `${canonRoot}:${optionsDigest}`, validates freshness via
 * `rootFingerprint`, and patches graphs incrementally via `Xray.patchGraph` on
 * small edits. Also enforces context-root confinement: repo-local `contexts`
 * must stay within `serverRoot`, while user global config contexts may
 * authorize additional roots.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  findGlobalConfigPath,
  loadConfig,
  loadConfigFile,
  loadGlobalConfig,
  resolveContextRoots,
} from '../config';
import { isWithin, realpathLoose } from '../confine';
import { Logger } from '../logger';
import {
  computeRootManifest,
  GraphCache,
  optionsDigest,
  rootFingerprint,
  type RootManifest,
} from '../cache/graph-cache';
import { GraphSerializer } from '../graph/serializer';
import { compileMatchers } from '../path-match';
import { QueryResolver } from '../query-resolver';
import { TrigramIndex } from '../search/trigram-index';
import { openCacheDbPath } from '../storage';
import { Xray, type ParseCoverage } from '../xray';
import type { RankedNode, XrayGraph } from '../../types/graph';
import type { SerializedGraph } from '../query/types';
import { getScopedRoots } from './scoped-token';
import { isUrlLike, ToolArgumentError } from './tools';

const DEFAULT_MAX_ENTRIES = 8;

/**
 * Up to this many changed/removed files an in-memory patch beats a rebuild,
 * even when that is a large share of a small root (where
 * `diffFileManifest`'s 25% guard would otherwise force a full rebuild).
 */
const MAX_INCREMENTAL_EDITS = 64;

/** Changed and removed root-relative files between two file manifests. */
function manifestEdits(
  prev: Record<string, string>,
  next: Record<string, string>
): { changed: string[]; removed: string[] } {
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [rel, token] of Object.entries(next)) {
    if (prev[rel] !== token) changed.push(rel);
  }
  for (const rel of Object.keys(prev)) {
    if (!(rel in next)) removed.push(rel);
  }
  return { changed, removed };
}

export interface WarmGraphOptions {
  configPath?: string;
  lens?: string;
  scope?: string;
  lang?: string[];
  match?: string[];
  catch?: string[];
  queries?: string[];
  limit?: number;
  depth?: number;
  anchor?: string;
  features?: Record<string, boolean>;
  useCache?: boolean;
}

export interface WarmWorkspaceEntry {
  key: string;
  root: string;
  optionsDigest: string;
  fingerprint: string;
  manifest: RootManifest;
  graph: XrayGraph;
  serialized: SerializedGraph;
  rankedNodes: RankedNode[];
  coverage: ParseCoverage;
  trigramIndex: TrigramIndex | null;
  lastUsedAt: number;
}

export interface WarmGraphResult extends WarmWorkspaceEntry {
  hit: boolean;
  incremental: boolean;
}

export interface WarmWorkspaceManagerOptions {
  maxEntries?: number;
}

function normalizeGraphOptions(opts: WarmGraphOptions): Record<string, unknown> {
  return {
    configPath: opts.configPath ?? null,
    lens: opts.lens ?? null,
    scope: opts.scope ?? null,
    lang: opts.lang ?? [],
    match: opts.match ?? [],
    catch: opts.catch ?? [],
    queries: opts.queries ?? [],
    limit: opts.limit ?? 0,
    depth: opts.depth ?? null,
    anchor: opts.anchor ?? null,
    features: opts.features ?? {},
  };
}

export class WarmWorkspaceManager {
  readonly serverRoot: string;
  readonly serverConfig: string | null;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, WarmWorkspaceEntry>();
  private readonly trigramByRoot = new Map<string, TrigramIndex>();
  private readonly allowedRoots: Set<string>;
  private readonly rejectedContextRoots: string[] = [];

  constructor(
    serverRoot: string,
    serverConfig: string | null = null,
    options: WarmWorkspaceManagerOptions = {}
  ) {
    this.serverRoot = fs.realpathSync(serverRoot);
    this.serverConfig = serverConfig;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.allowedRoots = new Set<string>([this.serverRoot]);
    this.loadAllowedContextRoots();
  }

  /**
   * Populate `allowedRoots` from repo-local and user global `contexts`.
   * Security rule: repo-local contexts MUST stay within `serverRoot` and
   * never widen the allowed roots (the server root already covers them);
   * only user global config contexts may authorize roots outside `serverRoot`.
   */
  private loadAllowedContextRoots(): void {
    if (this.serverConfig) {
      try {
        const localCfg = loadConfigFile(this.serverConfig);
        if (localCfg?.contexts) {
          const cfgDir = path.dirname(this.serverConfig);
          for (const name of Object.keys(localCfg.contexts)) {
            try {
              const dirs = resolveContextRoots(localCfg, name, cfgDir);
              for (const dir of dirs) {
                const real = fs.realpathSync(dir);
                if (!isWithin(this.serverRoot, real)) {
                  this.rejectedContextRoots.push(real);
                  Logger.debug(
                    `mcp: repo-local context "${name}" resolves outside the server root (${real}); ignored`
                  );
                }
              }
            } catch {
              // Context may match no directories or have invalid pattern; skip.
            }
          }
        }
      } catch {
        // Ignore unreadable/invalid config at startup; per-call config loading enforces it.
      }
    }

    const globalPath = findGlobalConfigPath();
    const globalCfg = loadGlobalConfig();
    if (globalPath && globalCfg?.contexts) {
      const globalDir = path.dirname(globalPath);
      for (const name of Object.keys(globalCfg.contexts)) {
        try {
          const dirs = resolveContextRoots(globalCfg, name, globalDir);
          for (const dir of dirs) {
            this.allowedRoots.add(fs.realpathSync(dir));
          }
        } catch {
          // Skip unresolvable global context.
        }
      }
    }
  }

  getAllowedRoots(): ReadonlySet<string> {
    return getScopedRoots() ?? this.allowedRoots;
  }

  getRejectedContextRoots(): readonly string[] {
    return this.rejectedContextRoots;
  }

  /**
   * Contain `targetPath` across all authorized `allowedRoots`.
   * Returns `{ root, absPath }` for the matching root, or throws `ToolArgumentError`.
   */
  containAcrossAllowedRoots(targetPath: string): { root: string; absPath: string } {
    if (isUrlLike(targetPath)) {
      throw new ToolArgumentError(
        `path "${targetPath}" must be a filesystem path, not a URL`
      );
    }
    const absPath = path.resolve(this.serverRoot, targetPath);
    const real = realpathLoose(absPath);

    let matchedRoot: string | undefined;
    for (const root of this.getAllowedRoots()) {
      if (isWithin(root, real)) {
        if (!matchedRoot || root.length > matchedRoot.length) {
          matchedRoot = root;
        }
      }
    }

    if (!matchedRoot) {
      throw new ToolArgumentError(
        `path "${targetPath}" is outside allowed roots (${this.serverRoot})`
      );
    }
    return { root: matchedRoot, absPath };
  }

  private touch(key: string, entry: WarmWorkspaceEntry): void {
    entry.lastUsedAt = Date.now();
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (evicted?.trigramIndex && this.trigramByRoot.get(evicted.root) !== evicted.trigramIndex) {
        evicted.trigramIndex.close();
      }
    }
  }

  /**
   * Return a warm `TrigramIndex` for `root`, opening and caching it on first use.
   */
  getTrigramIndex(root: string): TrigramIndex {
    const canonRoot = fs.realpathSync(root);
    let idx = this.trigramByRoot.get(canonRoot);
    if (!idx) {
      idx = new TrigramIndex(canonRoot);
      this.trigramByRoot.set(canonRoot, idx);
    }
    return idx;
  }

  /**
   * Validate that any config `paths` resolved for `root` remain confined to `allowedRoots`.
   */
  private resolveEffectiveConfig(root: string, opts: WarmGraphOptions) {
    const cfgPath = opts.configPath ?? this.serverConfig ?? undefined;
    // The graph is built over `root` itself, so config `paths` never widen a
    // scan; `confine` still refuses a project config whose paths/queries
    // resolve outside their own project (a user global config is exempt).
    const config = loadConfig(cfgPath, root, {
      resolvePaths: true,
      confine: { paths: true, output: false, queries: true, share: false },
    });
    return { cfgPath, config };
  }

  /**
   * Get or incrementally refresh the parsed graph for `root` and `opts`.
   * Checks `rootFingerprint(root)` / `computeRootManifest(root)` for O(1) warm hits,
   * and falls back to `Xray.patchGraph` on small edits or `Xray.buildGraph` on cold miss.
   */
  async getGraph(root: string, opts: WarmGraphOptions = {}): Promise<WarmGraphResult> {
    const canonRoot = fs.realpathSync(root);
    const { cfgPath, config } = this.resolveEffectiveConfig(canonRoot, opts);

    const effectiveMatch = opts.match ?? config?.match ?? [];
    const effectiveCatch = opts.catch ?? config?.catch ?? [];
    const effectiveQueries = opts.queries ?? config?.queries ?? [];
    const effectiveLanguages = opts.lang?.length ? opts.lang : config?.languages;
    const effectiveLimit = opts.limit ?? config?.limit ?? 0;
    const effectiveDepth = opts.depth ?? config?.depth;
    const effectiveAnchor = opts.anchor ?? config?.anchor;
    const effectiveFeatures = opts.features ?? (config?.features as Record<string, boolean> | undefined);

    const digest = optionsDigest(
      normalizeGraphOptions({
        ...opts,
        configPath: cfgPath,
        match: effectiveMatch,
        catch: effectiveCatch,
        queries: effectiveQueries,
        lang: effectiveLanguages,
        limit: effectiveLimit,
        depth: effectiveDepth,
        anchor: effectiveAnchor,
        features: effectiveFeatures,
      })
    );
    const key = `${canonRoot}:${digest}`;

    const fp = rootFingerprint(canonRoot);
    const existing = this.entries.get(key);
    if (existing && existing.fingerprint === fp) {
      this.touch(key, existing);
      return { ...existing, hit: true, incremental: false };
    }

    const manifest = computeRootManifest(canonRoot);
    const serializer = new GraphSerializer();
    const matchesPattern = effectiveMatch.length > 0 ? compileMatchers(effectiveMatch) : null;

    const xrayConfig = {
      path: canonRoot,
      limit: effectiveLimit,
      anchor: effectiveAnchor ? path.resolve(canonRoot, effectiveAnchor) : undefined,
      depth: effectiveDepth,
      features: effectiveFeatures,
      queries: QueryResolver.resolve(effectiveQueries),
      match: effectiveMatch,
      catch: effectiveCatch,
      languages: effectiveLanguages,
      configPath: cfgPath,
      format: 'json' as const,
      chunked: false,
    };

    // Incremental patch when a stale in-memory entry exists
    if (existing) {
      const sameInputs = existing.manifest.manifestHash === manifest.manifestHash;
      const edits = manifestEdits(existing.manifest.fileManifest, manifest.fileManifest);
      if (sameInputs && edits.changed.length + edits.removed.length <= MAX_INCREMENTAL_EDITS) {
        const changedFiles = matchesPattern ? edits.changed.filter((f) => matchesPattern(f)) : edits.changed;
        const removedFiles = matchesPattern ? edits.removed.filter((f) => matchesPattern(f)) : edits.removed;
        const xray = new Xray(xrayConfig);
        try {
          const { rankedNodes, graph } = await xray.patchGraph(
            existing.graph,
            changedFiles,
            removedFiles,
            Object.keys(manifest.fileManifest).length
          );
          const serialized = serializer.serialize(graph, canonRoot, { references: true });
          const coverage = xray.getLastCoverage() ?? { files: 0, parsed: 0, skipped: [] };
          const updated: WarmWorkspaceEntry = {
            ...existing,
            fingerprint: manifest.fingerprint,
            manifest,
            graph,
            serialized,
            rankedNodes,
            coverage,
            lastUsedAt: Date.now(),
          };
          this.touch(key, updated);
          return { ...updated, hit: false, incremental: true };
        } finally {
          xray.close();
        }
      }
    }

    // Cold miss: check L2 GraphCache, else full build
    const useDiskCache = opts.useCache !== false;
    const graphCache = useDiskCache ? new GraphCache(openCacheDbPath(this.serverRoot), digest) : null;
    try {
      const cached = graphCache?.getRoot(canonRoot, manifest.fingerprint) ?? null;
      if (cached) {
        const graph = serializer.deserialize(cached.graph);
        this.evictIfNeeded();
        const entry: WarmWorkspaceEntry = {
          key,
          root: canonRoot,
          optionsDigest: digest,
          fingerprint: manifest.fingerprint,
          manifest,
          graph,
          serialized: cached.graph,
          rankedNodes: [],
          coverage: cached.coverage,
          trigramIndex: this.trigramByRoot.get(canonRoot) ?? null,
          lastUsedAt: Date.now(),
        };
        this.entries.set(key, entry);
        return { ...entry, hit: false, incremental: false };
      }

      const stale = graphCache?.getStaleRoot(canonRoot) ?? null;
      if (graphCache && stale?.fileManifest && stale?.manifestHash) {
        const sameInputs = stale.manifestHash === manifest.manifestHash;
        const edits = manifestEdits(stale.fileManifest, manifest.fileManifest);
        if (sameInputs && edits.changed.length + edits.removed.length <= MAX_INCREMENTAL_EDITS) {
          const changedFiles = matchesPattern ? edits.changed.filter((f) => matchesPattern(f)) : edits.changed;
          const removedFiles = matchesPattern ? edits.removed.filter((f) => matchesPattern(f)) : edits.removed;
          const xray = new Xray(xrayConfig);
          try {
            const existingGraph = serializer.deserialize(stale.graph);
            const { rankedNodes, graph } = await xray.patchGraph(
              existingGraph,
              changedFiles,
              removedFiles,
              Object.keys(manifest.fileManifest).length
            );
            const serialized = serializer.serialize(graph, canonRoot, { references: true });
            const coverage = xray.getLastCoverage() ?? { files: 0, parsed: 0, skipped: [] };
            graphCache.putRoot(canonRoot, {
              fingerprint: manifest.fingerprint,
              fileManifest: manifest.fileManifest,
              manifestHash: manifest.manifestHash,
              graph: serialized,
              coverage,
            });
            this.evictIfNeeded();
            const entry: WarmWorkspaceEntry = {
              key,
              root: canonRoot,
              optionsDigest: digest,
              fingerprint: manifest.fingerprint,
              manifest,
              graph,
              serialized,
              rankedNodes,
              coverage,
              trigramIndex: this.trigramByRoot.get(canonRoot) ?? null,
              lastUsedAt: Date.now(),
            };
            this.entries.set(key, entry);
            return { ...entry, hit: false, incremental: true };
          } finally {
            xray.close();
          }
        }
      }

      const xray = new Xray(xrayConfig);
      try {
        const { rankedNodes, graph } = await xray.buildGraph();
        const serialized = serializer.serialize(graph, canonRoot, { references: true });
        const coverage = xray.getLastCoverage() ?? { files: 0, parsed: 0, skipped: [] };
        graphCache?.putRoot(canonRoot, {
          fingerprint: manifest.fingerprint,
          fileManifest: manifest.fileManifest,
          manifestHash: manifest.manifestHash,
          graph: serialized,
          coverage,
        });
        this.evictIfNeeded();
        const entry: WarmWorkspaceEntry = {
          key,
          root: canonRoot,
          optionsDigest: digest,
          fingerprint: manifest.fingerprint,
          manifest,
          graph,
          serialized,
          rankedNodes,
          coverage,
          trigramIndex: this.trigramByRoot.get(canonRoot) ?? null,
          lastUsedAt: Date.now(),
        };
        this.entries.set(key, entry);
        return { ...entry, hit: false, incremental: false };
      } finally {
        xray.close();
      }
    } finally {
      graphCache?.close();
    }
  }

  close(): void {
    for (const idx of this.trigramByRoot.values()) {
      idx.close();
    }
    this.trigramByRoot.clear();
    for (const entry of this.entries.values()) {
      if (entry.trigramIndex) {
        try {
          entry.trigramIndex.close();
        } catch {
          // already closed via trigramByRoot
        }
      }
    }
    this.entries.clear();
  }
}
