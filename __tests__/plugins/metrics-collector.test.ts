import { Xray } from '../../src/lib/xray';
import { MetricsCollectorPlugin } from '../../examples/plugins/metrics-collector';

// Mock console.log to capture output
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

describe('MetricsCollectorPlugin', () => {
  let xray: Xray;
  let plugin: MetricsCollectorPlugin;

  beforeEach(() => {
    xray = new Xray({
      path: '/tmp/test',
      cachePath: ':memory:'
    });
    plugin = new MetricsCollectorPlugin();
    mockConsoleLog.mockClear();
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
  });

  describe('plugin metadata', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('metrics-collector');
    });

    it('should have version', () => {
      expect(plugin.version).toBeDefined();
    });
  });

  describe('initial metrics', () => {
    it('should initialize all metrics to zero', () => {
      const metrics = plugin.getMetrics();
      expect(metrics.totalFiles).toBe(0);
      expect(metrics.filesScanned).toBe(0);
      expect(metrics.filesSkipped).toBe(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.cacheMisses).toBe(0);
      expect(metrics.parseErrors).toBe(0);
      expect(metrics.totalTags).toBe(0);
      expect(metrics.totalEdges).toBe(0);
      expect(metrics.duration).toBe(0);
    });
  });

  describe('scan:start event', () => {
    it('should record start time', async () => {
      await xray.use(plugin);

      const before = Date.now();
      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });
      const after = Date.now();

      // Verify start time was set (we check this indirectly through duration)
      expect(plugin['startTime']).toBeGreaterThanOrEqual(before);
      expect(plugin['startTime']).toBeLessThanOrEqual(after);
    });
  });

  describe('scan:complete event', () => {
    it('should track total files', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:complete', {
        files: ['file1.ts', 'file2.ts', 'file3.ts']
      });

      const metrics = plugin.getMetrics();
      expect(metrics.totalFiles).toBe(3);
    });

    it('should update total files count', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:complete', {
        files: ['file1.ts', 'file2.ts']
      });

      let metrics = plugin.getMetrics();
      expect(metrics.totalFiles).toBe(2);

      // Simulate re-scan
      await xray.emitAsync('scan:complete', {
        files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts']
      });

      metrics = plugin.getMetrics();
      expect(metrics.totalFiles).toBe(4);
    });
  });

  describe('scan:file event', () => {
    it('should track scanned files when not skipped', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:file', { file: 'file1.ts', skip: false });
      await xray.emitAsync('scan:file', { file: 'file2.ts', skip: false });

      const metrics = plugin.getMetrics();
      expect(metrics.filesScanned).toBe(2);
      expect(metrics.filesSkipped).toBe(0);
    });

    it('should track skipped files', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:file', { file: 'test1.test.ts', skip: true });
      await xray.emitAsync('scan:file', { file: 'test2.spec.ts', skip: true });

      const metrics = plugin.getMetrics();
      expect(metrics.filesScanned).toBe(0);
      expect(metrics.filesSkipped).toBe(2);
    });

    it('should track both scanned and skipped files', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:file', { file: 'app.ts', skip: false });
      await xray.emitAsync('scan:file', { file: 'app.test.ts', skip: true });
      await xray.emitAsync('scan:file', { file: 'utils.ts', skip: false });

      const metrics = plugin.getMetrics();
      expect(metrics.filesScanned).toBe(2);
      expect(metrics.filesSkipped).toBe(1);
    });
  });

  describe('cache events', () => {
    it('should track cache hits', async () => {
      await xray.use(plugin);

      await xray.emitAsync('cache:hit', {
        file: 'file1.ts',
        tags: [],
        imports: []
      });
      await xray.emitAsync('cache:hit', {
        file: 'file2.ts',
        tags: [],
        imports: []
      });

      const metrics = plugin.getMetrics();
      expect(metrics.cacheHits).toBe(2);
    });

    it('should track cache misses', async () => {
      await xray.use(plugin);

      await xray.emitAsync('cache:miss', { file: 'file1.ts' });
      await xray.emitAsync('cache:miss', { file: 'file2.ts' });
      await xray.emitAsync('cache:miss', { file: 'file3.ts' });

      const metrics = plugin.getMetrics();
      expect(metrics.cacheMisses).toBe(3);
    });

    it('should track both cache hits and misses', async () => {
      await xray.use(plugin);

      await xray.emitAsync('cache:hit', {
        file: 'cached.ts',
        tags: [],
        imports: []
      });
      await xray.emitAsync('cache:miss', { file: 'new.ts' });
      await xray.emitAsync('cache:hit', {
        file: 'cached2.ts',
        tags: [],
        imports: []
      });

      const metrics = plugin.getMetrics();
      expect(metrics.cacheHits).toBe(2);
      expect(metrics.cacheMisses).toBe(1);
    });
  });

  describe('parse:error event', () => {
    it('should track parse errors', async () => {
      await xray.use(plugin);

      await xray.emitAsync('parse:error', {
        file: 'broken.ts',
        error: new Error('Parse failed'),
        recovered: false
      });
      await xray.emitAsync('parse:error', {
        file: 'invalid.ts',
        error: new Error('Syntax error'),
        recovered: false
      });

      const metrics = plugin.getMetrics();
      expect(metrics.parseErrors).toBe(2);
    });
  });

  describe('parse:after event', () => {
    it('should accumulate total tags', async () => {
      await xray.use(plugin);

      await xray.emitAsync('parse:after', {
        file: 'file1.ts',
        tags: [
          { file: 'file1.ts', name: 'func1', kind: 'function', line: 1, col: 0 },
          { file: 'file1.ts', name: 'func2', kind: 'function', line: 10, col: 0 }
        ],
        imports: []
      });

      await xray.emitAsync('parse:after', {
        file: 'file2.ts',
        tags: [
          { file: 'file2.ts', name: 'class1', kind: 'class', line: 1, col: 0 }
        ],
        imports: []
      });

      const metrics = plugin.getMetrics();
      expect(metrics.totalTags).toBe(3);
    });

    it('should handle files with no tags', async () => {
      await xray.use(plugin);

      await xray.emitAsync('parse:after', {
        file: 'empty.ts',
        tags: [],
        imports: []
      });

      const metrics = plugin.getMetrics();
      expect(metrics.totalTags).toBe(0);
    });
  });

  describe('graph:complete event', () => {
    it('should track total edges', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });

      const Graph = require('graphology');
      const graph = new Graph();

      await xray.emitAsync('graph:complete', {
        graph,
        nodeCount: 100,
        edgeCount: 150
      });

      const metrics = plugin.getMetrics();
      expect(metrics.totalEdges).toBe(150);
    });

    it('should calculate duration from start time', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const Graph = require('graphology');
      const graph = new Graph();

      await xray.emitAsync('graph:complete', {
        graph,
        nodeCount: 10,
        edgeCount: 5
      });

      const metrics = plugin.getMetrics();
      expect(metrics.duration).toBeGreaterThan(0);
    });
  });

  describe('cache hit rate calculation', () => {
    it('should calculate cache hit rate correctly', async () => {
      await xray.use(plugin);

      // 3 hits, 1 miss = 75% hit rate
      await xray.emitAsync('cache:hit', { file: 'f1.ts', tags: [], imports: [] });
      await xray.emitAsync('cache:hit', { file: 'f2.ts', tags: [], imports: [] });
      await xray.emitAsync('cache:hit', { file: 'f3.ts', tags: [], imports: [] });
      await xray.emitAsync('cache:miss', { file: 'f4.ts' });

      const hitRate = plugin['cacheHitRate']();
      expect(hitRate).toBe(75);
    });

    it('should return 0% when no cache operations', async () => {
      await xray.use(plugin);

      const hitRate = plugin['cacheHitRate']();
      expect(hitRate).toBe(0);
    });

    it('should return 100% when all hits', async () => {
      await xray.use(plugin);

      await xray.emitAsync('cache:hit', { file: 'f1.ts', tags: [], imports: [] });
      await xray.emitAsync('cache:hit', { file: 'f2.ts', tags: [], imports: [] });

      const hitRate = plugin['cacheHitRate']();
      expect(hitRate).toBe(100);
    });

    it('should return 0% when all misses', async () => {
      await xray.use(plugin);

      await xray.emitAsync('cache:miss', { file: 'f1.ts' });
      await xray.emitAsync('cache:miss', { file: 'f2.ts' });

      const hitRate = plugin['cacheHitRate']();
      expect(hitRate).toBe(0);
    });
  });

  describe('render:complete summary', () => {
    it('should log metrics summary', async () => {
      await xray.use(plugin);

      // Set up some metrics
      await xray.emitAsync('scan:start', { path: '/test', config: xray['config'] });
      await xray.emitAsync('scan:complete', { files: ['f1.ts', 'f2.ts'] });
      await xray.emitAsync('scan:file', { file: 'f1.ts', skip: false });
      await xray.emitAsync('scan:file', { file: 'f2.ts', skip: false });
      await xray.emitAsync('cache:hit', { file: 'f1.ts', tags: [], imports: [] });
      await xray.emitAsync('cache:miss', { file: 'f2.ts' });
      await xray.emitAsync('parse:after', {
        file: 'f2.ts',
        tags: [{ file: 'f2.ts', name: 'func', kind: 'function', line: 1, col: 0 }],
        imports: []
      });

      const Graph = require('graphology');
      const graph = new Graph();
      await xray.emitAsync('graph:complete', { graph, nodeCount: 10, edgeCount: 5 });

      await xray.emitAsync('render:complete', {
        outputPath: '/output/xray.txt',
        filesWritten: 1
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('📊 Metrics Summary')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Files: 2 scanned, 0 skipped')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Cache: 1 hits, 1 misses (50% hit rate)')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Parse: 1 tags extracted, 0 errors')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Graph: 5 edges')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/Duration: \d+\.\d+s/)
      );
    });
  });

  describe('getMetrics method', () => {
    it('should return a copy of metrics', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:complete', { files: ['f1.ts'] });

      const metrics1 = plugin.getMetrics();
      const metrics2 = plugin.getMetrics();

      expect(metrics1).toEqual(metrics2);
      expect(metrics1).not.toBe(metrics2); // Different objects
    });

    it('should not allow external mutation of internal metrics', () => {
      const metrics = plugin.getMetrics();
      metrics.totalFiles = 999;

      const actual = plugin.getMetrics();
      expect(actual.totalFiles).toBe(0); // Still 0, not mutated
    });
  });

  describe('plugin lifecycle', () => {
    it('should register successfully with xray', async () => {
      await xray.use(plugin);

      const plugins = xray.plugins();
      expect(plugins).toContainEqual(plugin);
    });

    it('should handle complete event pipeline', async () => {
      await xray.use(plugin);

      // Simulate full pipeline
      await xray.emitAsync('scan:start', { path: '/test', config: xray['config'] });
      await xray.emitAsync('scan:complete', { files: ['app.ts', 'test.ts'] });
      await xray.emitAsync('scan:file', { file: 'app.ts', skip: false });
      await xray.emitAsync('scan:file', { file: 'test.ts', skip: true });
      await xray.emitAsync('cache:miss', { file: 'app.ts' });
      await xray.emitAsync('parse:after', {
        file: 'app.ts',
        tags: [
          { file: 'app.ts', name: 'func1', kind: 'function', line: 1, col: 0 },
          { file: 'app.ts', name: 'func2', kind: 'function', line: 10, col: 0 }
        ],
        imports: []
      });

      const Graph = require('graphology');
      const graph = new Graph();
      await xray.emitAsync('graph:complete', { graph, nodeCount: 3, edgeCount: 2 });
      await xray.emitAsync('render:complete', { outputPath: '/out.txt', filesWritten: 1 });

      const metrics = plugin.getMetrics();
      expect(metrics.totalFiles).toBe(2);
      expect(metrics.filesScanned).toBe(1);
      expect(metrics.filesSkipped).toBe(1);
      expect(metrics.cacheMisses).toBe(1);
      expect(metrics.totalTags).toBe(2);
      expect(metrics.totalEdges).toBe(2);
    });
  });
});
