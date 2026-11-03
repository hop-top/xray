import { SqliteCache, CACHE_SCHEMA_VERSION } from '../../src/lib/cache/sqlite-cache';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const rawVersion = (c: SqliteCache): number =>
  (c as any).store.db().pragma('user_version', { simple: true });

describe('SqliteCache', () => {
  let cache: SqliteCache;
  let tempDbPath: string;

  beforeEach(() => {
    // Create a temporary database file for each test
    tempDbPath = path.join(os.tmpdir(), `test-cache-${Date.now()}.db`);
    cache = new SqliteCache(tempDbPath);
  });

  afterEach(() => {
    cache.close();
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
    const rawDb = (c: SqliteCache) => (c as any).store.db();

    it('should treat a corrupted tags entry as a miss', () => {
      rawDb(cache).prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('tags:/test/file.ts', 'INVALID_JSON{{{');
      expect(cache.get('/test/file.ts', 123456, 'all', false)).toBeNull();
    });

    it('should treat an entry with malformed tags/imports as a miss', () => {
      rawDb(cache).prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(
        'tags:/test/file.ts',
        JSON.stringify({ mtime: 1, docConfig: 'all', includeVariables: false, tags: [] })
      );
      expect(cache.get('/test/file.ts', 1, 'all', false)).toBeNull();
    });

    it('should round-trip imports', () => {
      const imports = [{ file: 'a.go', source: 'example.com/m/cmd', alias: 'c' }];
      cache.set('a.go', 5, [], imports as any, 'none', false);
      expect(cache.get('a.go', 5, 'none', false)?.imports).toEqual(imports);
    });

    it('should round-trip imports contract records', () => {
      const records = [{ line: 1, column: 1, endLine: 1, endColumn: 9, kind: 'include', form: 'mod', module: 'foo',
        normalized: null, locality: 'local', confidence: 'syntactic', evidence: 'mod foo;' }];
      cache.set('m.rs', 5, [], [], 'none', false, records as any);
      expect(cache.get('m.rs', 5, 'none', false)?.records).toEqual(records);
    });

    it('should treat an entry from another imports extractor version as a miss', () => {
      cache.set('m.rs', 5, [], [], 'none', false, []);
      const key = 'tags:m.rs';
      const entry = JSON.parse((rawDb(cache).prepare('SELECT value FROM kv WHERE key = ?') as any).get(key).value);
      rawDb(cache).prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify({ ...entry, extractor: '0.0.1' }));
      expect(cache.get('m.rs', 5, 'none', false)).toBeNull();
    });

    it('should handle corrupted analysis JSON gracefully', () => {
      rawDb(cache).prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('analysis:/test/file.ts', 'INVALID_JSON{{{');
      expect(cache.getFileAnalysis('/test/file.ts')).toBeNull();
      expect(cache.isFileAnalysisValid('/test/file.ts', 123456, 'abc123')).toBe(false);
    });

    it('should keep tags and analysis entries for the same file independent', () => {
      cache.set('/f.ts', 1, [], [], 'all', false);
      cache.setFileAnalysis('/f.ts', { mtime: 1, hash: 'h', analysis: {} });
      cache.clearFileAnalysis('/f.ts');
      expect(cache.getFileAnalysis('/f.ts')).toBeNull();
      expect(cache.get('/f.ts', 1, 'all', false)).not.toBeNull();
    });

    it('should run uncached instead of crashing when the cache file is not a database', () => {
      const p = path.join(os.tmpdir(), `xray-garbage-${process.pid}-${Date.now()}.db`);
      fs.writeFileSync(p, 'this is not a sqlite database, just some bytes'.repeat(100));
      const c = new SqliteCache(p);
      c.set('x.ts', 1, [], [], 'none', false);
      expect(c.get('x.ts', 1, 'none', false)).not.toBeNull();
      c.close();
      // file left untouched
      expect(fs.readFileSync(p, 'utf8').startsWith('this is not')).toBe(true);
      fs.rmSync(p, { force: true });
    });
  });

  describe('schema versioning', () => {
    const fixtures = path.join(__dirname, '..', 'fixtures', 'cache');
    let copies: string[] = [];

    const copyFixture = (name: string): string => {
      const p = path.join(os.tmpdir(), `xray-${name}-${process.pid}-${Date.now()}.db`);
      fs.copyFileSync(path.join(fixtures, name), p);
      copies.push(p);
      return p;
    };

    afterEach(() => {
      for (const p of copies) fs.rmSync(p, { force: true });
      copies = [];
    });

    it('should stamp a fresh database with the current schema version', () => {
      expect(rawVersion(cache)).toBe(CACHE_SCHEMA_VERSION);
    });

    it.each(['legacy-v1.db', 'legacy-v2.db'])(
      'should invalidate old-format cache %s without crashing',
      (name) => {
        const p = copyFixture(name);
        const c = new SqliteCache(p);
        // old entries are gone: miss, not a stale hit or a throw
        expect(c.get('/proj/a.ts', 123456, 'all', false)).toBeNull();
        expect(c.getFileAnalysis('/proj/a.ts')).toBeNull();
        const db = (c as any).store.db();
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
        expect(tables).toEqual(['kv']);
        expect(rawVersion(c)).toBe(CACHE_SCHEMA_VERSION);
        // usable afterwards
        c.set('/proj/a.ts', 123456, [{ file: '/proj/a.ts', name: 'foo', kind: 'function', line: 1, col: 0 } as any], [], 'all', false);
        expect(c.get('/proj/a.ts', 123456, 'all', false)?.tags).toHaveLength(1);
        c.close();
      }
    );

    it('should invalidate a cache written under an unknown schema version', () => {
      const p = path.join(os.tmpdir(), `xray-future-${process.pid}-${Date.now()}.db`);
      copies.push(p);
      const c1 = new SqliteCache(p);
      c1.set('a.ts', 1, [], [], 'all', false);
      (c1 as any).store.db().pragma(`user_version = ${CACHE_SCHEMA_VERSION + 1}`);
      c1.close();
      const c2 = new SqliteCache(p);
      expect(c2.get('a.ts', 1, 'all', false)).toBeNull();
      expect(rawVersion(c2)).toBe(CACHE_SCHEMA_VERSION);
      c2.close();
    });

    it('should keep entries across reopen at the current version', () => {
      const p = path.join(os.tmpdir(), `xray-reopen-${process.pid}-${Date.now()}.db`);
      copies.push(p);
      const c1 = new SqliteCache(p);
      c1.set('a.ts', 1, [], [], 'all', false);
      c1.close();
      const c2 = new SqliteCache(p);
      expect(c2.get('a.ts', 1, 'all', false)).not.toBeNull();
      c2.close();
    });
  });
});
