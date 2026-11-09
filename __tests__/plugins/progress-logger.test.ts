import { Xray } from '../../src/lib/xray';
import { ProgressLoggerPlugin } from '../../examples/plugins/progress-logger';

// Mock console methods
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockStdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation();

// Styling follows the color policy; keep it off so assertions see plain text.
const savedNoColor = process.env.NO_COLOR;
process.env.NO_COLOR = '1';
afterAll(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

describe('ProgressLoggerPlugin', () => {
  let xray: Xray;
  let plugin: ProgressLoggerPlugin;

  beforeEach(() => {
    xray = new Xray({
      path: '/tmp/test',
      cachePath: ':memory:'
    });
    plugin = new ProgressLoggerPlugin();
    mockConsoleLog.mockClear();
    mockStdoutWrite.mockClear();
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
    mockStdoutWrite.mockRestore();
  });

  describe('plugin metadata', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('progress-logger');
    });

    it('should have version', () => {
      expect(plugin.version).toBeDefined();
    });
  });

  describe('scan:start event', () => {
    it('should log scan start message', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test/path',
        config: xray['config']
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Scanning /test/path')
      );
    });

    it('should include scanning emoji', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test/path',
        config: xray['config']
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('🔍')
      );
    });

    it('should record start time', async () => {
      await xray.use(plugin);

      const before = Date.now();
      await xray.emitAsync('scan:start', {
        path: '/test/path',
        config: xray['config']
      });
      const after = Date.now();

      // Check that startTime was set (we can verify this indirectly through timing)
      expect(plugin['startTime']).toBeGreaterThanOrEqual(before);
      expect(plugin['startTime']).toBeLessThanOrEqual(after);
    });
  });

  describe('scan:complete event', () => {
    it('should log file count', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:complete', {
        files: ['file1.ts', 'file2.ts', 'file3.ts']
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Found 3 files')
      );
    });

    it('should include checkmark emoji', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:complete', {
        files: ['file1.ts']
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('✓')
      );
    });
  });

  describe('progress event', () => {
    it('should render progress bar', async () => {
      await xray.use(plugin);

      await xray.emitAsync('progress', {
        stage: 'parsing',
        current: 50,
        total: 100,
        message: 'Parsing files'
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringMatching(/█.*░.*50%.*Parsing files/)
      );
    });

    it('should calculate percentage correctly', async () => {
      await xray.use(plugin);

      await xray.emitAsync('progress', {
        stage: 'parsing',
        current: 75,
        total: 100,
        message: 'Processing'
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining('75%')
      );
    });

    it('should show full bar at 100%', async () => {
      await xray.use(plugin);

      await xray.emitAsync('progress', {
        stage: 'parsing',
        current: 100,
        total: 100,
        message: 'Complete'
      });

      const call = mockStdoutWrite.mock.calls[0][0] as string;
      const filledBlocks = (call.match(/█/g) || []).length;
      expect(filledBlocks).toBe(50);
    });

    it('should add newline when progress completes', async () => {
      await xray.use(plugin);

      await xray.emitAsync('progress', {
        stage: 'parsing',
        current: 100,
        total: 100,
        message: 'Done'
      });

      // Should call console.log() to add newline
      expect(mockConsoleLog).toHaveBeenCalledWith();
    });

    it('should not add newline for incomplete progress', async () => {
      await xray.use(plugin);

      await xray.emitAsync('progress', {
        stage: 'parsing',
        current: 50,
        total: 100,
        message: 'Working'
      });

      // Should not call console.log
      expect(mockConsoleLog).not.toHaveBeenCalled();
    });
  });

  describe('graph:complete event', () => {
    it('should log node and edge counts', async () => {
      await xray.use(plugin);

      // Set start time first
      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });

      const Graph = require('graphology');
      const graph = new Graph();

      await xray.emitAsync('graph:complete', {
        graph,
        nodeCount: 150,
        edgeCount: 200
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/150 nodes.*200 edges/)
      );
    });

    it('should calculate elapsed time', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });

      // Wait a bit to ensure time passes
      await new Promise(resolve => setTimeout(resolve, 10));

      const Graph = require('graphology');
      const graph = new Graph();

      await xray.emitAsync('graph:complete', {
        graph,
        nodeCount: 10,
        edgeCount: 5
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/\d+\.\d+s/)
      );
    });
  });

  describe('render:complete event', () => {
    it('should log output path', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });

      await xray.emitAsync('render:complete', {
        outputPath: '/output/xray.txt',
        filesWritten: 1
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('/output/xray.txt')
      );
    });

    it('should calculate total time', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await xray.emitAsync('render:complete', {
        outputPath: '/output/xray.txt',
        filesWritten: 1
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/\d+\.\d+s total/)
      );
    });
  });

  describe('plugin lifecycle', () => {
    it('should register successfully with xray', async () => {
      await xray.use(plugin);

      const plugins = xray.plugins();
      expect(plugins).toContainEqual(plugin);
    });

    it('should handle multiple events in sequence', async () => {
      await xray.use(plugin);

      await xray.emitAsync('scan:start', {
        path: '/test',
        config: xray['config']
      });

      await xray.emitAsync('scan:complete', {
        files: ['file1.ts', 'file2.ts']
      });

      await xray.emitAsync('progress', {
        stage: 'parsing',
        current: 100,
        total: 100,
        message: 'Done'
      });

      const Graph = require('graphology');
      const graph = new Graph();

      await xray.emitAsync('graph:complete', {
        graph,
        nodeCount: 10,
        edgeCount: 5
      });

      await xray.emitAsync('render:complete', {
        outputPath: '/output/xray.txt',
        filesWritten: 1
      });

      // All events should have logged something
      expect(mockConsoleLog.mock.calls.length).toBeGreaterThan(0);
      expect(mockStdoutWrite.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
