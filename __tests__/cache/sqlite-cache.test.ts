import { SqliteCache } from '../../src/lib/cache/sqlite-cache';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('SqliteCache', () => {
  let cache: SqliteCache;
  let tempDbPath: string;

  beforeEach(() => {
    // Create a temporary database file for each test
    tempDbPath = path.join(os.tmpdir(), `test-cache-${Date.now()}.db`);
    cache = new SqliteCache(tempDbPath);
  });

  afterEach(() => {
    // Clean up the temporary database file
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('file_analysis table', () => {
    it('should create file_analysis table on init', () => {
      // The table should be created in the constructor
      // We can verify by trying to insert data
      expect(() => {
        cache.setFileAnalysis('/test/file.ts', {
          mtime: 123456,
          hash: 'abc123',
          analysis: { tags: [], imports: [] }
        });
      }).not.toThrow();
    });

    it('should store and retrieve file analysis', () => {
      const filePath = '/test/file.ts';
      const analysisData = {
        mtime: 123456,
        hash: 'abc123',
        analysis: {
          tags: [{ name: 'test', kind: 'function', line: 1 }],
          imports: [{ path: './helper', line: 1 }]
        }
      };

      cache.setFileAnalysis(filePath, analysisData);
      const result = cache.getFileAnalysis(filePath);

      expect(result).not.toBeNull();
      expect(result?.mtime).toBe(123456);
      expect(result?.hash).toBe('abc123');
      expect(result?.analysis).toEqual(analysisData.analysis);
    });

    it('should return null for non-existent file', () => {
      const result = cache.getFileAnalysis('/nonexistent/file.ts');
      expect(result).toBeNull();
    });

    it('should overwrite existing file analysis', () => {
      const filePath = '/test/file.ts';
      const firstAnalysis = {
        mtime: 123456,
        hash: 'abc123',
        analysis: { tags: [], imports: [] }
      };
      const secondAnalysis = {
        mtime: 789012,
        hash: 'def456',
        analysis: {
          tags: [{ name: 'newTest', kind: 'class', line: 1 }],
          imports: []
        }
      };

      cache.setFileAnalysis(filePath, firstAnalysis);
      cache.setFileAnalysis(filePath, secondAnalysis);

      const result = cache.getFileAnalysis(filePath);
      expect(result?.mtime).toBe(789012);
      expect(result?.hash).toBe('def456');
      expect(result?.analysis.tags).toHaveLength(1);
      expect(result?.analysis.tags[0].name).toBe('newTest');
    });

    it('should validate file analysis with matching mtime and hash', () => {
      const filePath = '/test/file.ts';
      const analysisData = {
        mtime: 123456,
        hash: 'abc123',
        analysis: { tags: [], imports: [] }
      };

      cache.setFileAnalysis(filePath, analysisData);

      expect(cache.isFileAnalysisValid(filePath, 123456, 'abc123')).toBe(true);
    });

    it('should invalidate file analysis with different mtime', () => {
      const filePath = '/test/file.ts';
      const analysisData = {
        mtime: 123456,
        hash: 'abc123',
        analysis: { tags: [], imports: [] }
      };

      cache.setFileAnalysis(filePath, analysisData);

      expect(cache.isFileAnalysisValid(filePath, 999999, 'abc123')).toBe(false);
    });

    it('should invalidate file analysis with different hash', () => {
      const filePath = '/test/file.ts';
      const analysisData = {
        mtime: 123456,
        hash: 'abc123',
        analysis: { tags: [], imports: [] }
      };

      cache.setFileAnalysis(filePath, analysisData);

      expect(cache.isFileAnalysisValid(filePath, 123456, 'different')).toBe(false);
    });

    it('should return false for non-existent file validation', () => {
      expect(cache.isFileAnalysisValid('/nonexistent/file.ts', 123456, 'abc123')).toBe(false);
    });

    it('should clear file analysis for specific file', () => {
      const filePath1 = '/test/file1.ts';
      const filePath2 = '/test/file2.ts';

      cache.setFileAnalysis(filePath1, {
        mtime: 123456,
        hash: 'abc123',
        analysis: { tags: [], imports: [] }
      });
      cache.setFileAnalysis(filePath2, {
        mtime: 789012,
        hash: 'def456',
        analysis: { tags: [], imports: [] }
      });

      cache.clearFileAnalysis(filePath1);

      expect(cache.getFileAnalysis(filePath1)).toBeNull();
      expect(cache.getFileAnalysis(filePath2)).not.toBeNull();
    });

    it('should handle clearing non-existent file', () => {
      expect(() => {
        cache.clearFileAnalysis('/nonexistent/file.ts');
      }).not.toThrow();
    });

    it('should store complex analysis data', () => {
      const filePath = '/test/complex.ts';
      const complexAnalysis = {
        mtime: 123456,
        hash: 'abc123',
        analysis: {
          tags: [
            { name: 'MyClass', kind: 'class', line: 1, signature: 'class MyClass', doc: 'A test class' },
            { name: 'method', kind: 'method', line: 2, signature: 'method(): void', parentClass: 'MyClass' },
            { name: 'helper', kind: 'function', line: 10, signature: 'helper(x: number): string' }
          ],
          imports: [
            { path: './types', line: 1, isDefault: false },
            { path: 'lodash', line: 2, isDefault: true }
          ]
        }
      };

      cache.setFileAnalysis(filePath, complexAnalysis);
      const result = cache.getFileAnalysis(filePath);

      expect(result?.analysis.tags).toHaveLength(3);
      expect(result?.analysis.imports).toHaveLength(2);
      expect(result?.analysis.tags[0].doc).toBe('A test class');
      expect(result?.analysis.imports[1].isDefault).toBe(true);
    });
  });

  describe('backward compatibility', () => {
    it('should maintain existing get/set functionality for tags', () => {
      const filePath = '/test/file.ts';
      const tags = [
        { file: filePath, name: 'test', kind: 'function', line: 1, col: 0 }
      ];

      cache.set(filePath, 123456, tags, [], 'all', false);
      const result = cache.get(filePath, 123456, 'all', false);

      expect(result).not.toBeNull();
      expect(result?.tags).toHaveLength(1);
      expect(result?.tags[0].name).toBe('test');
    });

    it('should return null when get with wrong mtime', () => {
      const filePath = '/test/file.ts';
      const tags = [
        { file: filePath, name: 'test', kind: 'function', line: 1, col: 0 }
      ];

      cache.set(filePath, 123456, tags, [], 'all', false);
      const result = cache.get(filePath, 999999, 'all', false);

      expect(result).toBeNull();
    });

    it('should return null when get with wrong doc config', () => {
      const filePath = '/test/file.ts';
      const tags = [
        { file: filePath, name: 'test', kind: 'function', line: 1, col: 0 }
      ];

      cache.set(filePath, 123456, tags, [], 'all', false);
      const result = cache.get(filePath, 123456, 'function', false);

      expect(result).toBeNull();
    });

    it('should return null when get with wrong includeVariables', () => {
      const filePath = '/test/file.ts';
      const tags = [
        { file: filePath, name: 'test', kind: 'function', line: 1, col: 0 }
      ];

      cache.set(filePath, 123456, tags, [], 'all', false);
      const result = cache.get(filePath, 123456, 'all', true);

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle corrupted JSON in cache gracefully', () => {
      const filePath = '/test/file.ts';

      // Manually insert corrupted JSON into cache
      const db = (cache as any).db;
      db.prepare('INSERT OR REPLACE INTO files_v2 (path, mtime, doc_config, include_variables, imports) VALUES (?, ?, ?, ?, ?)').run(filePath, 123456, 'all', 0, '[]');
      db.prepare('INSERT INTO tags (file, data) VALUES (?, ?)').run(filePath, 'INVALID_JSON{{{');

      // Should skip corrupted entries and return empty array instead of throwing
      const result = cache.get(filePath, 123456, 'all', false);
      expect(result).not.toBeNull();
      expect(result?.tags).toEqual([]);
    });

    it('should round-trip imports', () => {
      const imports = [{ file: 'a.go', source: 'example.com/m/cmd', alias: 'c' }];
      cache.set('a.go', 5, [], imports as any, 'none', false);
      expect(cache.get('a.go', 5, 'none', false)?.imports).toEqual(imports);
    });

    it('should treat an entry without stored imports (pre-upgrade cache) as a miss', () => {
      const db = (cache as any).db;
      db.prepare('INSERT OR REPLACE INTO files_v2 (path, mtime, doc_config, include_variables) VALUES (?, ?, ?, ?)').run('/old.ts', 1, 'none', 0);
      expect(cache.get('/old.ts', 1, 'none', false)).toBeNull();
    });

    it('should add the imports column to a pre-upgrade database', () => {
      const Database = require('better-sqlite3');
      const p = path.join(os.tmpdir(), `xray-legacy-${process.pid}-${Date.now()}.db`);
      const legacy = new Database(p);
      legacy.exec('CREATE TABLE files_v2 (path TEXT PRIMARY KEY, mtime REAL, doc_config TEXT, include_variables INTEGER);');
      legacy.close();
      const c = new SqliteCache(p);
      c.set('x.ts', 1, [], [{ file: 'x.ts', source: './y' }], 'none', false);
      expect(c.get('x.ts', 1, 'none', false)?.imports).toHaveLength(1);
      fs.rmSync(p, { force: true });
    });

    it('should handle corrupted analysis JSON gracefully', () => {
      const filePath = '/test/file.ts';

      // Manually insert corrupted JSON into file_analysis
      const db = (cache as any).db;
      db.prepare('INSERT OR REPLACE INTO file_analysis (path, mtime, hash, analysis) VALUES (?, ?, ?, ?)').run(filePath, 123456, 'abc123', 'INVALID_JSON{{{');

      // Should return null instead of throwing
      const result = cache.getFileAnalysis(filePath);
      expect(result).toBeNull();
    });

    it('should continue operation when some tags are corrupted', () => {
      const filePath = '/test/file.ts';
      const db = (cache as any).db;

      // Insert mix of valid and invalid tags
      db.prepare('INSERT OR REPLACE INTO files_v2 (path, mtime, doc_config, include_variables, imports) VALUES (?, ?, ?, ?, ?)').run(filePath, 123456, 'all', 0, '[]');
      db.prepare('INSERT INTO tags (file, data) VALUES (?, ?)').run(filePath, JSON.stringify({ name: 'valid1', kind: 'function', line: 1, col: 0, file: filePath }));
      db.prepare('INSERT INTO tags (file, data) VALUES (?, ?)').run(filePath, 'INVALID_JSON');
      db.prepare('INSERT INTO tags (file, data) VALUES (?, ?)').run(filePath, JSON.stringify({ name: 'valid2', kind: 'class', line: 10, col: 0, file: filePath }));

      const result = cache.get(filePath, 123456, 'all', false);

      // Should return partial results, skipping corrupted entries
      expect(result).not.toBeNull();
      expect(result?.tags).toHaveLength(2);
      expect(result?.tags[0].name).toBe('valid1');
      expect(result?.tags[1].name).toBe('valid2');
    });
  });
});
