/**
 * Merged-graph cache for multi-root builds, stored in the existing SQLite
 * cache db (kv records, no extra table).
 *
 * - Per root: `graph:root:<options>:<abs root>` -> {fingerprint, graph,
 *   coverage}. `graph` is the root's serialized graph WITH unresolved
 *   references (input of the cross-root pass), so a changed root is rebuilt
 *   alone and re-linked against the cached others.
 * - Merged: `graph:merged:<options>:<sha of sorted real abs roots>` -> the merged
 *   graph, reused only when every root hit and the root order and cwd (which
 *   decide labels) match.
 *
 * A root's fingerprint covers what the per-file cache validates (scanned
 * files: root-relative path, mtime, size) plus the files the import
 * resolvers read (package.json, go.mod / go.work). `<options>` digests the
 * build options that change the graph and the cache layout version.
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

interface RootRecord {
  fingerprint: string;
  graph: SerializedGraph;
  coverage: ParseCoverage;
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

/** Fingerprint of one root's analysis inputs (see module doc); independent of how `root` is spelled. */
export function rootFingerprint(root: string): string {
  const prev = Logger.getLevel();
  // The scan repeats the one Xray runs; keep its warnings to that one.
  if (prev > LogLevel.ERROR) Logger.setLevel(LogLevel.ERROR);
  let files: string[];
  try {
    files = new FileScanner(root).scan();
  } finally {
    if (Logger.getLevel() !== prev) Logger.setLevel(prev);
  }
  const lines: string[] = [];
  for (const f of [...files].sort()) lines.push(statLine(path.join(root, f), f));
  lines.push(statLine(path.join(root, 'package.json'), '@package.json'));
  lines.push(statLine(path.join(root, '.gitignore'), '@.gitignore'));
  const go = files.some(f => f.endsWith('.go')) ? detectGoModules(root, files) : null;
  for (const dir of [...(go?.moduleDirs ?? [])].sort()) {
    lines.push(statLine(path.join(dir, 'go.mod'), `@go.mod:${path.relative(root, dir)}`));
  }
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'go.work'))) {
      lines.push(statLine(path.join(dir, 'go.work'), `@go.work:${path.relative(root, dir)}`));
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  return sha(lines.join(''));
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
  return sha(JSON.stringify({ layout: CACHE_SCHEMA_VERSION, version, ...opts })).slice(0, 16);
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
