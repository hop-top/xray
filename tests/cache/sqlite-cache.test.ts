import { SqliteCache } from '../../src/cache/sqlite-cache';
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
});
