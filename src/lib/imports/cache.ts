/**
 * Per-file cache for the imports extractor, outside the scanned tree.
 *
 * Location: `<xray cache dir>/imports/<root id>.db` (`xray paths` →
 * cache-dir; `$XDG_CACHE_HOME/xray` when set), one kit sqlstore per root
 * (root id = sha256 of the root's real path). Directory mode 700, file 600.
 * Never inside the scanned root: a cache dir there disables caching.
 *
 * Record: kv key `imports:<path>`; value { key, sum, value } where `key` is
 * `<content sha256>|<extractor version>|<language>|<grammar module>@<version>|<source>`,
 * `value` the file entry minus `path` before resolution (resolution depends
 * on the file set and runs every time), `sum` the sha256 of `value`'s JSON.
 * The path is part of the record identity because extraction reads it
 * (Python `__name__` anchors, PHP include targets). One record per path:
 * a changed file replaces its entry, so the store stays bounded by the tree.
 *
 * The store is untrusted on read: a key mismatch, checksum mismatch or any
 * value not of the exact file-entry shape is a miss, so a hit returns the
 * same entry a cold run computes. Writes are buffered and committed in one
 * SQLite transaction (atomic; concurrent runs serialise on the database
 * lock, a busy or failing write is dropped, never fatal).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { ensurePrivateDir, ensurePrivateFile } from '../storage';
import {
  CONFIDENCES, FILE_STATUSES, IMPORT_KINDS, LOCALITIES, PARSE_ERROR_KINDS, UNSUPPORTED_CONSTRUCTS,
  type FileImports, type GrammarInfo,
} from './types';

interface Store {
  put(key: string, value: unknown): void;
  get<T>(key: string): T | null;
  db(): { pragma(sql: string, opts?: { simple?: boolean }): unknown; transaction<T extends (...a: never[]) => unknown>(fn: T): T };
  close(): void;
}

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('@hop-top/kit/sqlstore') as { open: (p: string) => Store };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const xdg = require('@hop-top/kit/xdg') as { cacheDir: (tool: string) => string };

/** A cached file entry: the record without `path`. */
export type CachedFileImports = Omit<FileImports, 'path'>;

/** Everything besides path and content an entry depends on. */
export interface ImportsCacheKey {
  path: string;
  sha256: string;
  extractor: string;
  language: string;
  grammar: GrammarInfo;
}

export interface ImportsCacheStats {
  hits: number;
  misses: number;
  /** Entries present for the path but rejected (stale key, checksum, shape). */
  invalid: number;
  writes: number;
}

export interface ImportsCache {
  get(key: ImportsCacheKey): CachedFileImports | undefined;
  set(key: ImportsCacheKey, entry: CachedFileImports): void;
  readonly stats: ImportsCacheStats;
  /** Database file, for diagnostics. */
  readonly file: string;
  /** Commit buffered writes and close; safe to call twice. */
  close(): void;
}

const PREFIX = 'imports:';

interface StoredEntry {
  key: string;
  sum: string;
  value: unknown;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function identity(k: ImportsCacheKey): string {
  return [k.sha256, k.extractor, k.language, `${k.grammar.module}@${k.grammar.version}`, k.grammar.source].join('|');
}

/** `<xray cache dir>/imports`; undefined when the platform dir is unusable or relative. */
export function importsCacheDir(): string | undefined {
  let base: string;
  try {
    base = xdg.cacheDir('xray');
  } catch {
    return undefined;
  }
  // XDG: a relative path in XDG_CACHE_HOME is invalid (and would land under cwd).
  return path.isAbsolute(base) ? path.join(base, 'imports') : undefined;
}

function realOrResolved(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Nearest existing ancestor, real path, plus the remainder: compares a not-yet-created dir. */
function realDir(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(realOrResolved(cur), ...rest);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface OpenImportsCacheOptions {
  /** Cache directory (default importsCacheDir()). */
  dir?: string;
  /** Owner the cache dir must have (default: the current user). */
  uid?: number;
}

/**
 * Open the cache for `root`; undefined (run uncached) when no usable
 * location exists, the location is inside the root, or the store fails to
 * open. A location that cannot be made private (symlink, foreign owner,
 * loose parent) logs one warning; other reasons go to the debug log.
 */
export function openImportsCache(root: string, opts: OpenImportsCacheOptions = {}): ImportsCache | undefined {
  const dir = opts.dir ?? importsCacheDir();
  if (!dir) {
    Logger.debug('imports cache: no usable cache directory, running uncached');
    return undefined;
  }
  const realRoot = realOrResolved(root);
  const realCache = realDir(dir);
  if (isInside(realCache, realRoot)) {
    Logger.debug(`imports cache: ${realCache} is inside the scanned root, running uncached`);
    return undefined;
  }
  // The location is checked unresolved (a planted symlink must not be
  // followed into): every component below the XDG base is a real directory
  // of ours, the db a regular file of ours (O_NOFOLLOW, fchmod on the fd).
  const privateDir = path.resolve(dir);
  const file = path.join(privateDir, `${sha256(realRoot).slice(0, 16)}.db`);
  if (!ensurePrivateDir(privateDir, opts.uid) || !ensurePrivateFile(file)) {
    Logger.warn(
      `Imports cache directory ${privateDir} is unusable (cannot be made private to this user); ` +
      'running without persistent cache.'
    );
    return undefined;
  }
  let store: Store | undefined;
  try {
    store = open(file);
    store.db().pragma('journal_mode = WAL');
    // WAL / SHM sidecars exist now: same mode as the db.
    if (!ensurePrivateFile(file)) throw new Error('db or sidecar is not a private regular file');
  } catch (err) {
    try { store?.close(); } catch { /* already unusable */ }
    Logger.debug(`imports cache: ${file} unusable (${(err as Error).message}), running uncached`);
    return undefined;
  }
  return new SqliteImportsCache(store, file);
}

class SqliteImportsCache implements ImportsCache {
  readonly stats: ImportsCacheStats = { hits: 0, misses: 0, invalid: 0, writes: 0 };
  private pending = new Map<string, StoredEntry>();
  private closed = false;

  constructor(private store: Store, readonly file: string) {}

  get(key: ImportsCacheKey): CachedFileImports | undefined {
    let stored: unknown;
    try {
      stored = this.store.get<unknown>(PREFIX + key.path);
    } catch {
      stored = undefined; // unreadable row / malformed JSON
      this.stats.invalid++;
    }
    const value = stored == null ? undefined : accept(stored, key);
    if (value) {
      this.stats.hits++;
      return value;
    }
    if (stored != null) this.stats.invalid++;
    this.stats.misses++;
    return undefined;
  }

  set(key: ImportsCacheKey, entry: CachedFileImports): void {
    // Serialised now: later passes (resolution) must not leak into the record.
    const json = JSON.stringify(entry);
    this.pending.set(PREFIX + key.path, { key: identity(key), sum: sha256(json), value: JSON.parse(json) });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.pending.size > 0) {
        this.store.db().transaction(() => {
          for (const [k, v] of this.pending) this.store.put(k, v);
        })();
        this.stats.writes += this.pending.size;
      }
    } catch (err) {
      Logger.debug(`imports cache: write to ${this.file} dropped (${(err as Error).message})`);
    } finally {
      this.pending.clear();
      try {
        this.store.close();
      } catch {
        // nothing left to do
      }
    }
  }
}

/** The cached entry when `stored` is exactly what a cold run for `key` produces; else undefined. */
function accept(stored: unknown, key: ImportsCacheKey): CachedFileImports | undefined {
  if (!isObject(stored) || !hasExactly(stored, ['key', 'sum', 'value'])) return undefined;
  const { key: id, sum, value } = stored as unknown as StoredEntry;
  if (id !== identity(key) || typeof sum !== 'string' || sum !== sha256(JSON.stringify(value))) return undefined;
  if (!isFileEntry(value) || value.sha256 !== key.sha256 || value.language !== key.language) return undefined;
  return value;
}

// ---- shape (mirrors types.ts / schemas/xray.imports.v1.json) ----

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isPosInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 1;
const oneOf = (list: readonly string[]) => (v: unknown) => isStr(v) && list.includes(v);
const isKind = oneOf(IMPORT_KINDS);
const isLocality = oneOf(LOCALITIES);
const isConfidence = oneOf(CONFIDENCES);
const isStatus = oneOf(FILE_STATUSES);
const isConstruct = oneOf(UNSUPPORTED_CONSTRUCTS);
const isParseKind = oneOf(PARSE_ERROR_KINDS);

function hasExactly(o: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && own.every((k, i) => k === keys[i]);
}

/** Only keys from `allowed`, in that order, all `required` present. */
function hasOrdered(o: Obj, allowed: readonly string[], required: readonly string[]): boolean {
  let i = 0;
  for (const k of Object.keys(o)) {
    while (i < allowed.length && allowed[i] !== k) i++;
    if (i === allowed.length) return false;
    i++;
  }
  return required.every(k => k in o);
}

const arrayOf = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item);

const FILE_KEYS = ['language', 'sha256', 'status', 'complete', 'parseErrors', 'imports', 'unsupported'];

function isFileEntry(v: unknown): v is CachedFileImports {
  return isObject(v) && hasExactly(v, FILE_KEYS)
    && isStr(v.language) && isStr(v.sha256) && /^[0-9a-f]{64}$/.test(v.sha256)
    && isStatus(v.status) && typeof v.complete === 'boolean'
    && arrayOf(v.parseErrors, isParseError)
    && arrayOf(v.imports, isImportRecord)
    && arrayOf(v.unsupported, isUnsupported);
}

const isPosition = (v: unknown) => isObject(v) && hasExactly(v, ['line', 'column']) && isPosInt(v.line) && isPosInt(v.column);

function isParseError(v: unknown): boolean {
  return isObject(v) && hasExactly(v, ['kind', 'start', 'end']) && isParseKind(v.kind) && isPosition(v.start) && isPosition(v.end);
}

const RECORD_KEYS = [
  'line', 'column', 'endLine', 'endColumn', 'kind', 'form', 'module', 'normalized', 'package', 'locality',
  'relative', 'alias', 'names', 'wildcard', 'typeOnly', 'resolved', 'confidence', 'occurrences', 'evidence',
];
const RECORD_REQUIRED = ['line', 'column', 'endLine', 'endColumn', 'kind', 'form', 'module', 'normalized', 'locality', 'confidence', 'evidence'];

function isImportRecord(v: unknown): boolean {
  if (!isObject(v) || !hasOrdered(v, RECORD_KEYS, RECORD_REQUIRED)) return false;
  return isPosInt(v.line) && isPosInt(v.column) && isPosInt(v.endLine) && isPosInt(v.endColumn)
    && isKind(v.kind) && isStr(v.form) && isStr(v.module)
    && (v.normalized === null || isStr(v.normalized))
    && (v.package === undefined || isStr(v.package))
    && isLocality(v.locality)
    && (v.relative === undefined || isRelative(v.relative))
    && (v.alias === undefined || isStr(v.alias))
    && (v.names === undefined || arrayOf(v.names, isName))
    && (v.wildcard === undefined || v.wildcard === true)
    && (v.typeOnly === undefined || v.typeOnly === true)
    && (v.resolved === undefined || isResolved(v.resolved))
    && isConfidence(v.confidence)
    && (v.occurrences === undefined || isPosInt(v.occurrences))
    && isStr(v.evidence);
}

function isRelative(v: unknown): boolean {
  return isObject(v) && hasOrdered(v, ['level', 'module'], ['level'])
    && Number.isInteger(v.level) && (v.level as number) >= 0 && (v.module === undefined || isStr(v.module));
}

function isName(v: unknown): boolean {
  return isObject(v) && hasOrdered(v, ['name', 'alias'], ['name']) && isStr(v.name) && (v.alias === undefined || isStr(v.alias));
}

function isResolved(v: unknown): boolean {
  return isObject(v) && ((hasExactly(v, ['file']) && isStr(v.file)) || (hasExactly(v, ['dir']) && isStr(v.dir)));
}

function isUnsupported(v: unknown): boolean {
  return isObject(v) && hasOrdered(v, ['line', 'column', 'construct', 'detail', 'evidence'], ['line', 'column', 'construct', 'evidence'])
    && isPosInt(v.line) && isPosInt(v.column) && isConstruct(v.construct)
    && (v.detail === undefined || isStr(v.detail)) && isStr(v.evidence);
}
