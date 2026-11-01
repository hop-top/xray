import { Tag, Import } from '../parser/types';
import { CacheWriteError } from '../error/types';
import { Logger } from '../logger';

// Minimal structural view of the driver handle exposed by Store.db(); keeps
// xray free of a direct driver (and driver typings) dependency.
interface Statement {
  run(...params: unknown[]): unknown;
}
interface DatabaseHandle {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
  pragma(sql: string, opts?: { simple?: boolean }): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}
interface Store {
  put(key: string, value: unknown): void;
  get<T>(key: string): T | null;
  db(): DatabaseHandle;
  close(): void;
}

// require() because tsconfig moduleResolution is 'node' (legacy), which does
// not honor @hop-top/kit's `exports` map. Runtime resolution does.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('@hop-top/kit/sqlstore') as {
  open: (path: string, opts?: { ttl?: number; migrateSql?: string }) => Store;
};

/**
 * On-disk layout version, stored in PRAGMA user_version.
 *  0 (unset): relational layout (files_v2 / tags / file_analysis tables).
 *  3: kit sqlstore `kv` table; one JSON record per file.
 *  4: same layout; tag references gain member-call forms (`.name`).
 * Any other value is invalidated (wiped) on open.
 */
export const CACHE_SCHEMA_VERSION = 4;

const LEGACY_TABLES = ['tags', 'files_v2', 'file_analysis'];
const TAGS_PREFIX = 'tags:';
const ANALYSIS_PREFIX = 'analysis:';

interface TagsEntry {
  mtime: number;
  docConfig: string;
  includeVariables: boolean;
  tags: Tag[];
  imports: Import[];
}

interface AnalysisEntry {
  mtime: number;
  hash: string;
  analysis: any;
}

export class SqliteCache {
  private store: Store;

  constructor(dbPath: string) {
    this.store = SqliteCache.openStore(dbPath);
  }

  private static openStore(dbPath: string): Store {
    try {
      const store = open(dbPath);
      SqliteCache.ensureSchema(store.db());
      return store;
    } catch (err) {
      // Unreadable / foreign file at the cache path: run uncached for this
      // process instead of crashing. Never delete it implicitly.
      Logger.warn(
        `Cache at ${dbPath} unusable (${(err as Error).message}); running without persistent cache. ` +
        'Run `xray cache clear` to reset it.'
      );
      const store = open(':memory:');
      SqliteCache.ensureSchema(store.db());
      return store;
    }
  }

  private static ensureSchema(db: DatabaseHandle) {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version === CACHE_SCHEMA_VERSION) return;
    db.transaction(() => {
      for (const t of LEGACY_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
      db.exec('DELETE FROM kv');
      db.pragma(`user_version = ${CACHE_SCHEMA_VERSION}`);
    })();
  }

  private read<T>(key: string, file: string): T | null {
    try {
      return this.store.get<T>(key);
    } catch (err) {
      Logger.warn(`Failed to read from cache for ${file}: ${(err as Error).message}`);
      return null;
    }
  }

  get(file: string, mtime: number, docConfig: string, includeVariables: boolean): { tags: Tag[], imports: Import[] } | null {
    const entry = this.read<TagsEntry>(TAGS_PREFIX + file, file);
    if (
      !entry ||
      entry.mtime !== mtime ||
      entry.docConfig !== docConfig ||
      entry.includeVariables !== includeVariables
    ) {
      return null;
    }
    if (!Array.isArray(entry.tags) || !Array.isArray(entry.imports)) {
      Logger.warn(`Corrupted cache entry for ${file}, treating as cache miss`);
      return null;
    }
    return { tags: entry.tags, imports: entry.imports };
  }

  set(file: string, mtime: number, tags: Tag[], imports: Import[], docConfig: string, includeVariables: boolean) {
    const entry: TagsEntry = { mtime, docConfig, includeVariables, tags, imports: imports ?? [] };
    try {
      this.store.put(TAGS_PREFIX + file, entry);
    } catch (err) {
      throw new CacheWriteError('sqlite', err as Error);
    }
  }

  // File analysis cache methods
  setFileAnalysis(file: string, data: AnalysisEntry) {
    try {
      this.store.put(ANALYSIS_PREFIX + file, { mtime: data.mtime, hash: data.hash, analysis: data.analysis });
    } catch (err) {
      throw new CacheWriteError('sqlite', err as Error);
    }
  }

  getFileAnalysis(file: string): AnalysisEntry | null {
    return this.read<AnalysisEntry>(ANALYSIS_PREFIX + file, file);
  }

  isFileAnalysisValid(file: string, mtime: number, hash: string): boolean {
    const entry = this.getFileAnalysis(file);
    return entry !== null && entry.mtime === mtime && entry.hash === hash;
  }

  clearFileAnalysis(file: string) {
    try {
      this.store.db().prepare('DELETE FROM kv WHERE key = ?').run(ANALYSIS_PREFIX + file);
    } catch (err) {
      // Clearing cache is not critical
      Logger.warn(`Failed to clear analysis cache for ${file}: ${(err as Error).message}`);
    }
  }

  close() {
    this.store.close();
  }
}
