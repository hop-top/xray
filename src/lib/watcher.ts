import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import { Xray, type ParseCoverage } from './xray';
import { GraphCache, computeRootManifest, diffFileManifest, optionsDigest } from './cache/graph-cache';
import { GraphSerializer } from './graph/serializer';
import { mergeSerializedGraphs } from './graph/merge';
import { resolveCrossRootReferences } from './graph/cross-root';
import { FileScanner } from './scanner';
import { isWithin, realpathLoose } from './confine';
import { FileWriteError, UsageError } from './error/types';
import { openCacheDbPath } from './storage';
import { Logger, LogLevel } from './logger';
import { compileMatchers } from './path-match';
import { QueryResolver } from './query-resolver';
import type { SerializedGraph } from './query/types';
import { readTextSafe } from './safe-read';

export interface WatchUpdateEvent {
  initial: boolean;
  changedFiles: string[];
  removedFiles: string[];
  graph: SerializedGraph;
  graphOutPath?: string;
  durationMs: number;
}

export interface WatcherOptions {
  roots?: string[];
  cwd?: string;
  debounceMs?: number;
  graphOut?: string;
  once?: boolean;
  mergedOptions?: any;
  configPath?: string;
  onUpdate?: (event: WatchUpdateEvent) => void;
  onError?: (err: Error) => void;
}

const DEFAULT_IGNORED_PREFIXES = ['.git', 'node_modules', '.xray', '.xray_cache.db'];

const featuresOf = (mergedOptions: any) => {
  const withFeatures = new Set(mergedOptions?.with || []);
  return {
    vars: withFeatures.has('vars'),
    incs: withFeatures.has('incs'),
    docs: withFeatures.has('docs'),
    cost: withFeatures.has('cost'),
    cf: withFeatures.has('cf'),
    df: withFeatures.has('df'),
  };
};

export const watchGraphOptionsOf = (mergedOptions: any) => ({
  features: featuresOf(mergedOptions),
  languages: mergedOptions?.languages ?? null,
  queries: mergedOptions?.query ?? null,
  ...(mergedOptions?.match?.length > 0 ? { pathMatch: mergedOptions.match } : {}),
  catch: mergedOptions?.catch ?? null,
  anchor: mergedOptions?.anchor ? path.resolve(mergedOptions.anchor) : null,
  presetDigest: 'none',
});

function buildIgnoreMatcher(root: string): Ignore {
  const ig = ignore();
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      ig.add(readTextSafe(root, '.gitignore'));
    } catch {
      // Unreadable .gitignore: fall back to standard ignores
    }
  }
  ig.add(['.git', 'node_modules', '.xray', 'dist', 'build', '*.min.js', '*.map', '.xray_cache.db']);
  return ig;
}

function collectNonIgnoredDirs(root: string, ig: Ignore): string[] {
  const dirs: string[] = [root];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (!rel) continue;
      const top = rel.split('/')[0];
      if (DEFAULT_IGNORED_PREFIXES.includes(top)) continue;
      if (ig.ignores(`${rel}/`) || ig.ignores(rel)) continue;
      dirs.push(full);
      walk(full);
    }
  };
  walk(root);
  return dirs;
}

export class WorkspaceWatcher {
  private readonly roots: string[];
  private readonly cwd: string;
  private readonly debounceMs: number;
  private readonly resolvedGraphOut?: string;
  private readonly mergedOptions: any;
  private readonly configPath?: string;
  private readonly once: boolean;
  private readonly onUpdate?: (event: WatchUpdateEvent) => void;
  private readonly onError?: (err: Error) => void;

  private graphCache: GraphCache | null = null;
  private watchers: fs.FSWatcher[] = [];
  private ignoreMatchers = new Map<string, Ignore>();
  private pendingPaths = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private flushInProgress = false;
  private rerunRequested = false;
  private stopped = false;

  constructor(options: WatcherOptions = {}) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    const rawRoots = options.roots && options.roots.length > 0 ? options.roots : [this.cwd];
    this.roots = Array.from(new Set(rawRoots.map(r => path.resolve(this.cwd, r))));
    this.debounceMs = options.debounceMs ?? 150;
    this.once = Boolean(options.once);
    this.mergedOptions = options.mergedOptions ?? {
      limit: '4096',
      with: [],
      query: [],
      match: [],
      catch: [],
    };
    this.configPath = options.configPath;
    this.onUpdate = options.onUpdate;
    this.onError = options.onError;

    if (options.graphOut !== undefined) {
      this.resolvedGraphOut = path.resolve(this.cwd, options.graphOut);
    }
  }

  /** Validate `--graph-out` stays confined within at least one watched root. */
  private assertGraphOutConfined(): void {
    if (!this.resolvedGraphOut) return;
    const realOut = realpathLoose(this.resolvedGraphOut);
    const confined = this.roots.some(root => isWithin(realpathLoose(root), realOut));
    if (!confined) {
      throw new UsageError(`--graph-out path escapes project root: ${this.resolvedGraphOut}`);
    }
  }

  /** Write serialized graph JSON atomically via `<path>.tmp.<pid>` + `renameSync`. */
  private writeGraphAtomic(graph: SerializedGraph): void {
    if (!this.resolvedGraphOut) return;
    const tmpPath = `${this.resolvedGraphOut}.tmp.${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(this.resolvedGraphOut), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
      fs.renameSync(tmpPath, this.resolvedGraphOut);
    } catch (err: any) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup of temp file
      }
      throw new FileWriteError(this.resolvedGraphOut, err);
    }
  }

  /** Warm `GraphCache` once on startup and optionally start watching for edits. */
  async start(): Promise<void> {
    this.stopped = false;
    this.assertGraphOutConfined();

    const dbPath = openCacheDbPath(this.cwd);
    const digest = optionsDigest(watchGraphOptionsOf(this.mergedOptions));
    this.graphCache = new GraphCache(dbPath, digest);

    try {
      await this.syncAllRoots(true);
    } catch (err) {
      this.closeResources();
      throw err;
    }

    if (this.once) {
      this.closeResources();
      return;
    }

    this.attachWatchers();
  }

  /** Stop all `FSWatcher` handles, clear pending timers, and close SQLite DBs. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingPaths.clear();
    this.closeResources();
  }

  private closeResources(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore already-closed watcher
      }
    }
    this.watchers = [];
    if (this.graphCache) {
      try {
        this.graphCache.close();
      } catch {
        // Ignore already-closed DB
      }
      this.graphCache = null;
    }
  }

  private isIgnoredEvent(root: string, absPath: string): boolean {
    if (this.resolvedGraphOut) {
      if (absPath === this.resolvedGraphOut || absPath.startsWith(`${this.resolvedGraphOut}.tmp.`)) {
        return true;
      }
    }
    const rel = path.relative(root, absPath).split(path.sep).join('/');
    if (!rel || rel === '.') return false;
    if (rel.startsWith('..')) return true;

    const top = rel.split('/')[0];
    if (DEFAULT_IGNORED_PREFIXES.includes(top)) return true;

    // Never ignore manifest/config files tracked by computeRootManifest
    const base = path.basename(rel);
    if (base === '.gitignore' || base === 'package.json' || base === 'tsconfig.json' || base === 'go.mod' || base === 'go.work') {
      return false;
    }

    let ig = this.ignoreMatchers.get(root);
    if (!ig) {
      ig = buildIgnoreMatcher(root);
      this.ignoreMatchers.set(root, ig);
    }
    return ig.ignores(rel);
  }

  private attachWatchers(): void {
    for (const root of this.roots) {
      const ig = buildIgnoreMatcher(root);
      this.ignoreMatchers.set(root, ig);

      const handleEvent = (watchedDir: string, filename: string | Buffer | null) => {
        if (this.stopped) return;
        const name = filename ? filename.toString() : '';
        const absPath = name ? path.resolve(watchedDir, name) : root;
        if (name && this.isIgnoredEvent(root, absPath)) return;
        this.pendingPaths.add(absPath);
        this.scheduleFlush();
      };

      try {
        const w = fs.watch(root, { recursive: true }, (_eventType, filename) => {
          handleEvent(root, filename);
        });
        w.on('error', err => this.onError?.(err));
        this.watchers.push(w);
      } catch (err: any) {
        if (err?.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
          throw err;
        }
        // Linux fallback when recursive fs.watch is unavailable: watch every non-ignored dir
        const dirs = collectNonIgnoredDirs(root, ig);
        for (const dir of dirs) {
          const w = fs.watch(dir, { recursive: false }, (_eventType, filename) => {
            handleEvent(dir, filename);
          });
          w.on('error', e => this.onError?.(e));
          this.watchers.push(w);
        }
      }
    }
  }

  private scheduleFlush(): void {
    if (this.stopped) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushPending();
    }, this.debounceMs);
  }

  private async flushPending(): Promise<void> {
    if (this.stopped) return;
    if (this.flushInProgress) {
      this.rerunRequested = true;
      return;
    }
    this.flushInProgress = true;
    try {
      this.pendingPaths.clear();
      await this.syncAllRoots(false);
    } catch (err) {
      this.onError?.(err as Error);
    } finally {
      this.flushInProgress = false;
      if (this.rerunRequested && !this.stopped) {
        this.rerunRequested = false;
        this.scheduleFlush();
      }
    }
  }

  private async syncAllRoots(initial: boolean): Promise<void> {
    if (!this.graphCache) return;
    const startMs = Date.now();
    const prevLevel = Logger.getLevel();
    if (prevLevel > LogLevel.WARN) Logger.setLevel(LogLevel.WARN);

    const serializer = new GraphSerializer();
    const matchPatterns: string[] = this.mergedOptions.match || [];
    const matchesPattern = matchPatterns.length > 0 ? compileMatchers(matchPatterns) : null;
    const parts: Array<{ root: string; graph: SerializedGraph }> = [];
    const fingerprints: string[] = [];
    const allChanged: string[] = [];
    const allRemoved: string[] = [];

    try {
      for (const root of this.roots) {
        const manifest = computeRootManifest(root);
        fingerprints.push(manifest.fingerprint);

        const cached = this.graphCache.getRoot(root, manifest.fingerprint);
        if (cached) {
          parts.push({ root, graph: cached.graph });
          continue;
        }

        const stale = this.graphCache.getStaleRoot(root);
        if (stale?.fileManifest && stale?.manifestHash) {
          const diff = diffFileManifest(
            stale.fileManifest,
            manifest.fileManifest,
            stale.manifestHash,
            manifest.manifestHash
          );
          if (!diff.fallback) {
            const changedFiles = matchesPattern ? diff.changedFiles.filter(f => matchesPattern(f)) : diff.changedFiles;
            const removedFiles = matchesPattern ? diff.removedFiles.filter(f => matchesPattern(f)) : diff.removedFiles;
            allChanged.push(...changedFiles);
            allRemoved.push(...removedFiles);

            const xray = this.createXray(root, matchPatterns);
            try {
              const existingGraph = serializer.deserialize(stale.graph);
              const { graph } = await xray.patchGraph(
                existingGraph,
                changedFiles,
                removedFiles,
                Object.keys(manifest.fileManifest).length
              );
              const rootGraph = serializer.serialize(graph, root, { references: true });
              const c: ParseCoverage = xray.getLastCoverage() ?? { files: 0, parsed: 0, skipped: [] };
              this.graphCache.putRoot(root, {
                fingerprint: manifest.fingerprint,
                fileManifest: manifest.fileManifest,
                manifestHash: manifest.manifestHash,
                graph: rootGraph,
                coverage: c,
              });
              parts.push({ root, graph: rootGraph });
              continue;
            } finally {
              xray.close();
            }
          }
        }

        // Cold build or fallback rebuild
        const xray = this.createXray(root, matchPatterns);
        try {
          const { graph } = await xray.buildGraph();
          const rootGraph = serializer.serialize(graph, root, { references: true });
          const c: ParseCoverage = xray.getLastCoverage() ?? { files: 0, parsed: 0, skipped: [] };
          this.graphCache.putRoot(root, {
            fingerprint: manifest.fingerprint,
            fileManifest: manifest.fileManifest,
            manifestHash: manifest.manifestHash,
            graph: rootGraph,
            coverage: c,
          });
          parts.push({ root, graph: rootGraph });
        } finally {
          xray.close();
        }

        // Refresh ignore matcher in case .gitignore changed
        this.ignoreMatchers.set(root, buildIgnoreMatcher(root));
      }

      const merged = resolveCrossRootReferences(mergeSerializedGraphs(parts, this.cwd));
      this.graphCache.putMerged(this.roots, this.cwd, fingerprints, merged);

      if (this.resolvedGraphOut) {
        this.writeGraphAtomic(merged);
      }

      this.onUpdate?.({
        initial,
        changedFiles: allChanged,
        removedFiles: allRemoved,
        graph: merged,
        graphOutPath: this.resolvedGraphOut,
        durationMs: Date.now() - startMs,
      });
    } finally {
      if (Logger.getLevel() !== prevLevel) Logger.setLevel(prevLevel);
    }
  }

  private createXray(root: string, matchPatterns: string[]): Xray {
    return new Xray({
      path: root,
      limit: parseInt(this.mergedOptions.limit || '4096', 10),
      anchor: this.mergedOptions.anchor ? path.resolve(this.mergedOptions.anchor) : undefined,
      depth: this.mergedOptions.depth ? parseInt(this.mergedOptions.depth, 10) : undefined,
      features: featuresOf(this.mergedOptions),
      queries: QueryResolver.resolve(this.mergedOptions.query || []),
      match: matchPatterns,
      catch: this.mergedOptions.catch || [],
      languages: this.mergedOptions.languages,
      configPath: this.configPath,
      presetDigest: 'none',
      format: 'json',
      chunked: false,
    });
  }
}
