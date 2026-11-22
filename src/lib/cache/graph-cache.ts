/**
 * Root and merged-graph cache for single- and multi-root builds, stored in
 * the existing SQLite cache db (kv records, no extra table).
 *
 * - Per root: `graph:root:<options>:<abs root>` -> {fingerprint, fileManifest,
 *   manifestHash, graph, coverage}. `graph` is the root's serialized graph WITH
 *   references (`{ references: true }`), so a changed root can be patched
 *   incrementally or re-linked against cached others.
 * - Merged: `graph:merged:<options>:<sha of sorted real abs roots>` -> the merged
 *   graph, reused only when every root hit and the root order and cwd (which
 *   decide labels) match.
 *
 * A root's fingerprint covers what the per-file cache validates (scanned
 * files: root-relative path, mtime, size) plus the manifest files the import
 * resolvers read (package.json, go.mod, go.work, .gitignore, tsconfig.json).
 * `<options>` digests the build options that change the graph and the cache
 * layout version.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { SerializedGraph } from '../query/types';
import type { ParseCoverage } from '../xray';
import { FileScanner } from '../scanner';
import { Logger, LogLevel } from '../logger';
import { detectGoModules } from '../graph/go-resolver';
import { SqliteCache, CACHE_SCHEMA_VERSION } from './sqlite-cache';

export interface RootRecord {
  fingerprint: string;
  fileManifest?: Record<string, string>;
  manifestHash?: string;
  graph: SerializedGraph;
  coverage: ParseCoverage;
}

export interface RootManifest {
  fileManifest: Record<string, string>;
  manifestHash: string;
  fingerprint: string;
}

export interface ManifestDiff {
  fallback: boolean;
  changedFiles: string[];
  removedFiles: string[];
}

interface MergedRecord {
  roots: string[];
  cwd: string;
  fingerprints: string[];
  graph: SerializedGraph;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Key form of a root: symlinks resolved, so `/var/x` and `/private/var/x` share entries. */
const canon = (root: string): string => {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
};

function statLine(abs: string, rel: string): string {
  try {
    const st = fs.statSync(abs);
    return `${rel}\0${st.mtimeMs}\0${st.size}\n`;
  } catch {
    return `${rel}\0-\n`;
  }
}

function statToken(abs: string): string {
  try {
    const st = fs.statSync(abs);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '-';
  }
}

/**
 * Compute per-file manifest (`relPath -> "${mtimeMs}:${size}"`), `manifestHash`
 * (covering `package.json`, `go.mod`, `go.work`, `.gitignore`, `tsconfig.json`),
 * and the combined `fingerprint` for one root.
 */
export function computeRootManifest(root: string): RootManifest {
  const prev = Logger.getLevel();
  // The scan repeats the one Xray runs; keep its warnings to that one.
  if (prev > LogLevel.ERROR) Logger.setLevel(LogLevel.ERROR);
  let files: string[];
  try {
    files = new FileScanner(root).scan();
  } finally {
    if (Logger.getLevel() !== prev) Logger.setLevel(prev);
  }
  const fileManifest: Record<string, string> = {};
  const lines: string[] = [];
  for (const f of [...files].sort()) {
    const rel = f.split(path.sep).join('/');
    const abs = path.join(root, f);
    fileManifest[rel] = statToken(abs);
    lines.push(statLine(abs, f));
  }

  const manifestLines: string[] = [];
  manifestLines.push(statLine(path.join(root, 'package.json'), '@package.json'));
  manifestLines.push(statLine(path.join(root, '.gitignore'), '@.gitignore'));
  manifestLines.push(statLine(path.join(root, 'tsconfig.json'), '@tsconfig.json'));
  const go = files.some(f => f.endsWith('.go')) ? detectGoModules(root, files) : null;
  for (const dir of [...(go?.moduleDirs ?? [])].sort()) {
    manifestLines.push(statLine(path.join(dir, 'go.mod'), `@go.mod:${path.relative(root, dir)}`));
  }
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'go.work'))) {
      manifestLines.push(statLine(path.join(dir, 'go.work'), `@go.work:${path.relative(root, dir)}`));
      break;
    }
    if (path.dirname(dir) === dir) break;
  }

  const manifestHash = sha(manifestLines.join(''));
  const fingerprint = sha(lines.join('') + manifestLines.join(''));
  return { fileManifest, manifestHash, fingerprint };
}

/** Fingerprint of one root's analysis inputs (see module doc); independent of how `root` is spelled. */
export function rootFingerprint(root: string): string {
  return computeRootManifest(root).fingerprint;
}

/**
 * Diff two file manifests. Falls back to a full rebuild when `manifestHash`
 * changed or >25% of files changed/removed.
 */
export function diffFileManifest(
  prevManifest: Record<string, string>,
  nextManifest: Record<string, string>,
  prevManifestHash: string,
  nextManifestHash: string
): ManifestDiff {
  if (prevManifestHash !== nextManifestHash) {
    return { fallback: true, changedFiles: [], removedFiles: [] };
  }
  const changedFiles: string[] = [];
  const removedFiles: string[] = [];
  for (const [rel, token] of Object.entries(nextManifest)) {
    if (prevManifest[rel] !== token) {
      changedFiles.push(rel);
    }
  }
  for (const rel of Object.keys(prevManifest)) {
    if (!(rel in nextManifest)) {
      removedFiles.push(rel);
    }
  }
  const total = Math.max(Object.keys(prevManifest).length, Object.keys(nextManifest).length, 1);
  if ((changedFiles.length + removedFiles.length) / total > 0.25) {
    return { fallback: true, changedFiles: [], removedFiles: [] };
  }
  return { fallback: false, changedFiles, removedFiles };
}

/** Digest of the build options that change a root's graph. */
export function optionsDigest(opts: Record<string, unknown>): string {
  let version = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    version = require('../../../package.json').version ?? '';
  } catch {
    /* version unknown: layout version alone */
  }
  return sha(JSON.stringify({ layout: CACHE_SCHEMA_VERSION, version, presetDigest: 'none', ...opts })).slice(0, 16);
}

export class GraphCache {
  private cache: SqliteCache;

  constructor(dbPath: string, private readonly options: string) {
    this.cache = new SqliteCache(dbPath);
  }

  getRoot(root: string, fingerprint: string): RootRecord | null {
    const rec = this.cache.getRecord<RootRecord>(`graph:root:${this.options}:${canon(root)}`);
    return rec && rec.fingerprint === fingerprint && rec.graph && Array.isArray(rec.graph.nodes) ? rec : null;
  }

  /** Return the cached root record even if its fingerprint is stale, for incremental patching. */
  getStaleRoot(root: string): RootRecord | null {
    const rec = this.cache.getRecord<RootRecord>(`graph:root:${this.options}:${canon(root)}`);
    return rec && rec.graph && Array.isArray(rec.graph.nodes) ? rec : null;
  }

  putRoot(root: string, rec: RootRecord): void {
    this.cache.putRecord(`graph:root:${this.options}:${canon(root)}`, rec);
  }

  private mergedKey(roots: string[]): string {
    return `graph:merged:${this.options}:${sha(roots.map(canon).sort().join('\0'))}`;
  }

  getMerged(roots: string[], cwd: string, fingerprints: string[]): SerializedGraph | null {
    const rec = this.cache.getRecord<MergedRecord>(this.mergedKey(roots));
    if (!rec || rec.cwd !== cwd || rec.roots.join('\0') !== roots.join('\0') ||
        rec.fingerprints.join('\0') !== fingerprints.join('\0')) return null;
    return rec.graph;
  }

  putMerged(roots: string[], cwd: string, fingerprints: string[], graph: SerializedGraph): void {
    this.cache.putRecord(this.mergedKey(roots), { roots, cwd, fingerprints, graph });
  }

  close(): void {
    this.cache.close();
  }
}
