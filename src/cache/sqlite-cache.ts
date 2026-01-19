import Database from 'better-sqlite3';
import { Tag, Import } from '../parser/types';

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
    const row = this.db.prepare('SELECT mtime, doc_config, include_variables FROM files_v2 WHERE path = ?').get(file) as any;

    if (!row || row.mtime !== mtime || row.doc_config !== docConfig || Boolean(row.include_variables) !== includeVariables) {
      return null; // Cache miss or stale or config mismatch
    }

    const tagRows = this.db.prepare('SELECT data FROM tags WHERE file = ?').all(file) as any[];
    const tags = tagRows.map(r => JSON.parse(r.data));

    return { tags, imports: [] }; // Imports caching omitted for brevity
  }

  set(file: string, mtime: number, tags: Tag[], imports: Import[], docConfig: string, includeVariables: boolean) {
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
  }

  // File analysis cache methods
  setFileAnalysis(file: string, data: { mtime: number; hash: string; analysis: any }) {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO file_analysis (path, mtime, hash, analysis) VALUES (?, ?, ?, ?)'
    );
    stmt.run(file, data.mtime, data.hash, JSON.stringify(data.analysis));
  }

  getFileAnalysis(file: string): { mtime: number; hash: string; analysis: any } | null {
    const row = this.db.prepare(
      'SELECT mtime, hash, analysis FROM file_analysis WHERE path = ?'
    ).get(file) as any;

    if (!row) {
      return null;
    }

    return {
      mtime: row.mtime,
      hash: row.hash,
      analysis: JSON.parse(row.analysis)
    };
  }

  isFileAnalysisValid(file: string, mtime: number, hash: string): boolean {
    const row = this.db.prepare(
      'SELECT mtime, hash FROM file_analysis WHERE path = ?'
    ).get(file) as any;

    if (!row) {
      return false;
    }

    return row.mtime === mtime && row.hash === hash;
  }

  clearFileAnalysis(file: string) {
    this.db.prepare('DELETE FROM file_analysis WHERE path = ?').run(file);
  }
}
