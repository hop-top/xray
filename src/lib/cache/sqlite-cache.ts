import Database from 'better-sqlite3';
import { Tag, Import } from '../parser/types';
import { CacheReadError, CacheWriteError } from '../error/types';
import { Logger } from '../logger';

interface FileRow {
  mtime: number;
  doc_config: string;
  include_variables: number;
}

interface TagRow {
  data: string;
}

interface FileAnalysisRow {
  mtime: number;
  hash: string;
  analysis: string;
}

export class SqliteCache {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files_v2 (
        path TEXT PRIMARY KEY,
        mtime REAL,
        doc_config TEXT,
        include_variables INTEGER
      );
      CREATE TABLE IF NOT EXISTS tags (
        file TEXT,
        data JSON,
        FOREIGN KEY(file) REFERENCES files_v2(path) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS file_analysis (
        path TEXT PRIMARY KEY,
        mtime REAL,
        hash TEXT,
        analysis JSON
      );
    `);
  }

  get(file: string, mtime: number, docConfig: string, includeVariables: boolean): { tags: Tag[], imports: Import[] } | null {
    try {
      const row = this.db.prepare('SELECT mtime, doc_config, include_variables FROM files_v2 WHERE path = ?').get(file) as FileRow | undefined;

      if (!row || row.mtime !== mtime || row.doc_config !== docConfig || Boolean(row.include_variables) !== includeVariables) {
        return null;
      }

      const tagRows = this.db.prepare('SELECT data FROM tags WHERE file = ?').all(file) as TagRow[];

      // Parse tags with error handling for corrupted entries
      const tags: Tag[] = [];
      for (const row of tagRows) {
        try {
          tags.push(JSON.parse(row.data));
        } catch (err) {
          // Skip corrupted cache entry but continue processing
          Logger.warn(`Corrupted cache entry for ${file}, skipping tag`);
        }
      }

      return { tags, imports: [] }; // Imports caching omitted for brevity
    } catch (err) {
      // Cache read failure shouldn't crash the application
      Logger.warn(`Failed to read from cache for ${file}: ${(err as Error).message}`);
      return null; // Treat as cache miss
    }
  }

  set(file: string, mtime: number, tags: Tag[], imports: Import[], docConfig: string, includeVariables: boolean) {
    try {
      const insertFile = this.db.prepare('INSERT OR REPLACE INTO files_v2 (path, mtime, doc_config, include_variables) VALUES (?, ?, ?, ?)');
      const insertTag = this.db.prepare('INSERT INTO tags (file, data) VALUES (?, ?)');
      const deleteTags = this.db.prepare('DELETE FROM tags WHERE file = ?');

      const transaction = this.db.transaction(() => {
        insertFile.run(file, mtime, docConfig, includeVariables ? 1 : 0);
        deleteTags.run(file);
        for (const tag of tags) {
          insertTag.run(file, JSON.stringify(tag));
        }
      });

      transaction();
    } catch (err) {
      // Cache write failure shouldn't crash the application
      throw new CacheWriteError('sqlite', err as Error);
    }
  }

  // File analysis cache methods
  setFileAnalysis(file: string, data: { mtime: number; hash: string; analysis: any }) {
    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO file_analysis (path, mtime, hash, analysis) VALUES (?, ?, ?, ?)'
      );
      stmt.run(file, data.mtime, data.hash, JSON.stringify(data.analysis));
    } catch (err) {
      throw new CacheWriteError('sqlite', err as Error);
    }
  }

  getFileAnalysis(file: string): { mtime: number; hash: string; analysis: any } | null {
    try {
      const row = this.db.prepare(
        'SELECT mtime, hash, analysis FROM file_analysis WHERE path = ?'
      ).get(file) as FileAnalysisRow | undefined;

      if (!row) {
        return null;
      }

      try {
        return {
          mtime: row.mtime,
          hash: row.hash,
          analysis: JSON.parse(row.analysis)
        };
      } catch (jsonErr) {
        // Corrupted JSON in cache
        Logger.warn(`Corrupted analysis cache for ${file}, treating as cache miss`);
        return null;
      }
    } catch (err) {
      Logger.warn(`Failed to read analysis cache for ${file}: ${(err as Error).message}`);
      return null;
    }
  }

  isFileAnalysisValid(file: string, mtime: number, hash: string): boolean {
    try {
      const row = this.db.prepare(
        'SELECT mtime, hash FROM file_analysis WHERE path = ?'
      ).get(file) as Pick<FileAnalysisRow, 'mtime' | 'hash'> | undefined;

      if (!row) {
        return false;
      }

      return row.mtime === mtime && row.hash === hash;
    } catch (err) {
      Logger.warn(`Failed to validate analysis cache for ${file}: ${(err as Error).message}`);
      return false;
    }
  }

  clearFileAnalysis(file: string) {
    try {
      this.db.prepare('DELETE FROM file_analysis WHERE path = ?').run(file);
    } catch (err) {
      // Silently fail - clearing cache is not critical
      Logger.warn(`Failed to clear analysis cache for ${file}: ${(err as Error).message}`);
    }
  }
}
