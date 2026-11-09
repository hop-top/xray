import { Xray } from '../../src/lib/xray';
import { FilterPrivatePlugin } from '../../examples/plugins/filter-private';
import { Tag } from '../../src/lib/parser/types';
import type { MapRenderer } from '../../src/lib/renderer/map-renderer';

// The plugin does not touch the renderer; render:start requires one by type.
const mockRenderer = {} as unknown as MapRenderer;

// Mock console.log to capture output
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

describe('FilterPrivatePlugin', () => {
  let xray: Xray;
  let plugin: FilterPrivatePlugin;

  beforeEach(() => {
    xray = new Xray({
      path: '/tmp/test',
      cachePath: ':memory:'
    });
    plugin = new FilterPrivatePlugin();
    mockConsoleLog.mockClear();
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
  });

  describe('plugin metadata', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('filter-private');
    });

    it('should have version', () => {
      expect(plugin.version).toBeDefined();
    });
  });

  describe('filtering private tags', () => {
    it('should filter tags starting with underscore', async () => {
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: 'publicFunc',
          kind: 'function',
          line: 1,
          col: 0
        },
        {
          file: 'test.ts',
          name: '_privateFunc',
          kind: 'function',
          line: 10,
          col: 0
        },
        {
          file: 'test.ts',
          name: 'anotherPublic',
          kind: 'function',
          line: 20,
          col: 0
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags).toHaveLength(2);
      expect(event.tags.map(t => t.name)).toEqual(['publicFunc', 'anotherPublic']);
    });

    it('should filter multiple private tags', async () => {
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: '_private1',
          kind: 'function',
          line: 1,
          col: 0
        },
        {
          file: 'test.ts',
          name: '_private2',
          kind: 'function',
          line: 10,
          col: 0
        },
        {
          file: 'test.ts',
          name: '_private3',
          kind: 'function',
          line: 20,
          col: 0
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags).toHaveLength(0);
    });

    it('should keep all tags if none are private', async () => {
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: 'func1',
          kind: 'function',
          line: 1,
          col: 0
        },
        {
          file: 'test.ts',
          name: 'func2',
          kind: 'function',
          line: 10,
          col: 0
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags).toHaveLength(2);
    });

    it('should handle empty tag arrays', async () => {
      await xray.use(plugin);

      const event = { file: 'test.ts', tags: [], imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags).toHaveLength(0);
    });

    it('should work with different tag kinds', async () => {
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: '_privateClass',
          kind: 'class',
          line: 1,
          col: 0
        },
        {
          file: 'test.ts',
          name: '_privateVar',
          kind: 'variable',
          line: 10,
          col: 0
        },
        {
          file: 'test.ts',
          name: 'publicMethod',
          kind: 'method',
          line: 20,
          col: 0
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags).toHaveLength(1);
      expect(event.tags[0].name).toBe('publicMethod');
    });
  });

  describe('filtered count tracking', () => {
    it('should track number of filtered tags', async () => {
      await xray.use(plugin);

      const tags: Tag[] = [
        { file: 'test.ts', name: 'public', kind: 'function', line: 1, col: 0 },
        { file: 'test.ts', name: '_private1', kind: 'function', line: 2, col: 0 },
        { file: 'test.ts', name: '_private2', kind: 'function', line: 3, col: 0 }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      // Access private field to verify count
      expect(plugin['filtered']).toBe(2);
    });

    it('should accumulate filtered count across multiple files', async () => {
      await xray.use(plugin);

      const tags1: Tag[] = [
        { file: 'file1.ts', name: '_private1', kind: 'function', line: 1, col: 0 },
        { file: 'file1.ts', name: '_private2', kind: 'function', line: 2, col: 0 }
      ];

      const tags2: Tag[] = [
        { file: 'file2.ts', name: '_private3', kind: 'function', line: 1, col: 0 }
      ];

      await xray.emitAsync('parse:after', { file: 'file1.ts', tags: tags1, imports: [] });
      await xray.emitAsync('parse:after', { file: 'file2.ts', tags: tags2, imports: [] });

      expect(plugin['filtered']).toBe(3);
    });

    it('should not increment count when no tags are filtered', async () => {
      await xray.use(plugin);

      const tags: Tag[] = [
        { file: 'test.ts', name: 'public1', kind: 'function', line: 1, col: 0 },
        { file: 'test.ts', name: 'public2', kind: 'function', line: 2, col: 0 }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(plugin['filtered']).toBe(0);
    });
  });

  describe('reporting filtered count', () => {
    it('should log filtered count on render:start', async () => {
      await xray.use(plugin);

      // Filter some tags first
      const tags: Tag[] = [
        { file: 'test.ts', name: '_private1', kind: 'function', line: 1, col: 0 },
        { file: 'test.ts', name: '_private2', kind: 'function', line: 2, col: 0 }
      ];

      await xray.emitAsync('parse:after', { file: 'test.ts', tags, imports: [] });
      await xray.emitAsync('render:start', {
        format: 'txt',
        chunked: false,
        outputPath: '/output/xray.txt',
        renderer: mockRenderer
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Filtered 2 private functions')
      );
    });

    it('should not log anything when no tags filtered', async () => {
      await xray.use(plugin);

      await xray.emitAsync('render:start', {
        format: 'txt',
        chunked: false,
        outputPath: '/output/xray.txt',
        renderer: mockRenderer
      });

      expect(mockConsoleLog).not.toHaveBeenCalled();
    });

    it('should use singular form for single filtered tag', async () => {
      await xray.use(plugin);

      const tags: Tag[] = [
        { file: 'test.ts', name: '_private', kind: 'function', line: 1, col: 0 }
      ];

      await xray.emitAsync('parse:after', { file: 'test.ts', tags, imports: [] });
      await xray.emitAsync('render:start', {
        format: 'txt',
        chunked: false,
        outputPath: '/output/xray.txt',
        renderer: mockRenderer
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/Filtered 1 private function/)
      );
    });
  });

  describe('plugin lifecycle', () => {
    it('should register successfully with xray', async () => {
      await xray.use(plugin);

      const plugins = xray.plugins();
      expect(plugins).toContainEqual(plugin);
    });

    it('should work with multiple parse:after events', async () => {
      await xray.use(plugin);

      const files = [
        {
          tags: [
            { file: 'file1.ts', name: 'public', kind: 'function', line: 1, col: 0 },
            { file: 'file1.ts', name: '_private', kind: 'function', line: 2, col: 0 }
          ]
        },
        {
          tags: [
            { file: 'file2.ts', name: '_hidden', kind: 'function', line: 1, col: 0 }
          ]
        },
        {
          tags: [
            { file: 'file3.ts', name: 'visible', kind: 'function', line: 1, col: 0 }
          ]
        }
      ];

      for (const file of files) {
        await xray.emitAsync('parse:after', { file: file.tags[0].file, tags: file.tags, imports: [] });
      }

      expect(plugin['filtered']).toBe(2);
    });
  });
});
