import { Xray } from '../../src/lib/xray';
import { XrayPlugin } from '../../src/lib/events/plugin';
import { Tag } from '../../src/lib/parser/types';
import { ParserManager } from '../../src/lib/parser/manager';
import fs from 'fs';
import path from 'path';

describe('Event Pipeline Integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(__dirname, '../fixtures/pipeline-test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('full analysis pipeline with events', () => {
    it('should emit events in correct order during analysis', async () => {
      // Create test file
      const testFile = path.join(testDir, 'test.ts');
      fs.writeFileSync(testFile, `
        export function hello() {
          return 'world';
        }
      `);

      const eventLog: string[] = [];
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      // Track event order
      xray.on('scan:start', () => { eventLog.push('scan:start'); });
      xray.on('scan:file', () => { eventLog.push('scan:file'); });
      xray.on('scan:complete', () => { eventLog.push('scan:complete'); });
      xray.on('cache:check', () => { eventLog.push('cache:check'); });
      xray.on('cache:miss', () => { eventLog.push('cache:miss'); });
      xray.on('parse:before', () => { eventLog.push('parse:before'); });
      xray.on('parse:after', () => { eventLog.push('parse:after'); });
      xray.on('cache:write', () => { eventLog.push('cache:write'); });
      xray.on('graph:add-file', () => { eventLog.push('graph:add-file'); });
      xray.on('graph:complete', () => { eventLog.push('graph:complete'); });
      xray.on('rank:start', () => { eventLog.push('rank:start'); });
      xray.on('rank:complete', () => { eventLog.push('rank:complete'); });
      xray.on('render:start', () => { eventLog.push('render:start'); });
      xray.on('render:complete', () => { eventLog.push('render:complete'); });

      await xray.run();

      // Verify event order follows lifecycle
      expect(eventLog).toEqual([
        'scan:start',
        'scan:complete',
        'scan:file',
        'cache:check',
        'cache:miss',
        'parse:before',
        'parse:after',
        'graph:add-file',
        'cache:write',
        'graph:complete',
        'rank:start',
        'rank:complete',
        'render:start',
        'render:complete'
      ]);
    });

    it('should pass data through pipeline events', async () => {
      const testFile = path.join(testDir, 'data-flow.ts');
      fs.writeFileSync(testFile, `
        export function testFunc() {
          return 42;
        }
      `);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      let scanFiles: string[] = [];
      let parsedTags: Tag[] = [];
      let graphNodeCount: number = 0;

      xray.on('scan:complete', (event) => {
        scanFiles = event.files;
      });

      xray.on('parse:after', (event) => {
        parsedTags = event.tags;
      });

      xray.on('graph:complete', (event) => {
        graphNodeCount = event.nodeCount;
      });

      await xray.run();

      expect(scanFiles.length).toBeGreaterThan(0);
      expect(scanFiles[0]).toContain('data-flow.ts');
      expect(parsedTags.length).toBeGreaterThan(0);
      expect(parsedTags[0].name).toBe('testFunc');
      expect(graphNodeCount).toBeGreaterThan(0);
    });

    it('should support cache hit events on second run', async () => {
      const testFile = path.join(testDir, 'cache-test.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const cachePath = path.join(testDir, 'test-cache.db');
      const xray = new Xray({
        path: testDir,
        cachePath,
        chunked: false
      });

      // First run - cache miss
      let cacheHits = 0;
      let cacheMisses = 0;

      xray.on('cache:hit', () => { cacheHits++; });
      xray.on('cache:miss', () => { cacheMisses++; });

      await xray.run();

      expect(cacheMisses).toBe(1);
      expect(cacheHits).toBe(0);

      // Second run - cache hit
      const xray2 = new Xray({
        path: testDir,
        cachePath,
        chunked: false
      });

      cacheHits = 0;
      cacheMisses = 0;

      xray2.on('cache:hit', () => { cacheHits++; });
      xray2.on('cache:miss', () => { cacheMisses++; });

      await xray2.run();

      expect(cacheHits).toBe(1);
      expect(cacheMisses).toBe(0);
    });
  });

  describe('multiple plugins working together', () => {
    it('should apply multiple plugins in registration order', async () => {
      const testFile = path.join(testDir, 'multi-plugin.ts');
      fs.writeFileSync(testFile, `
        export function publicFunc() {}
        export function _privateFunc() {}
      `);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      const executionLog: string[] = [];

      // Plugin 1: Logs and filters
      class Plugin1 implements XrayPlugin {
        name = 'plugin1';
        apply(xray: Xray): void {
          xray.on('parse:after', (event) => {
            executionLog.push('plugin1:before-filter');
            event.tags = event.tags.filter(tag => !tag.name.startsWith('_'));
            executionLog.push('plugin1:after-filter');
          });
        }
      }

      // Plugin 2: Sees filtered results
      class Plugin2 implements XrayPlugin {
        name = 'plugin2';
        apply(xray: Xray): void {
          xray.on('parse:after', (event) => {
            executionLog.push(`plugin2:saw-${event.tags.length}-tags`);
          });
        }
      }

      await xray.use(new Plugin1());
      await xray.use(new Plugin2());

      await xray.run();

      // Plugin 1 filters, then Plugin 2 sees filtered results
      expect(executionLog).toEqual([
        'plugin1:before-filter',
        'plugin1:after-filter',
        'plugin2:saw-1-tags' // Only publicFunc remains
      ]);
    });

    it('should allow plugins to modify data and later plugins see changes', async () => {
      const testFile = path.join(testDir, 'data-transform.ts');
      fs.writeFileSync(testFile, `
        export function func1() {}
        export function func2() {}
      `);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      let finalTagCount: number = 0;
      let processedTags: string[] = [];

      // Plugin 1: Marks tags by adding prefix to doc
      class MarkTagsPlugin implements XrayPlugin {
        name = 'mark-tags';
        apply(xray: Xray): void {
          xray.on('parse:after', (event) => {
            event.tags = event.tags.map(tag => ({
              ...tag,
              doc: `[PROCESSED] ${tag.doc || ''}`
            }));
          });
        }
      }

      // Plugin 2: Filters based on doc prefix
      class FilterMarkedPlugin implements XrayPlugin {
        name = 'filter-marked';
        apply(xray: Xray): void {
          xray.on('parse:after', (event) => {
            event.tags = event.tags.filter(tag => tag.doc?.startsWith('[PROCESSED]'));
            finalTagCount = event.tags.length;
            processedTags = event.tags.map(t => t.name);
          });
        }
      }

      await xray.use(new MarkTagsPlugin());
      await xray.use(new FilterMarkedPlugin());

      await xray.run();

      expect(finalTagCount).toBe(2); // Both tags are marked
      expect(processedTags).toEqual(['func1', 'func2']);
    });

    it('should handle plugins with async handlers', async () => {
      const testFile = path.join(testDir, 'async-test.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      // The requirement is that run() awaits an async handler, not how long the
      // timer takes: setTimeout may fire ~1ms early against Date.now() (observed
      // on linux), so assert completion rather than a wall-clock lower bound.
      let finished = 0;

      class AsyncPlugin implements XrayPlugin {
        name = 'async-plugin';
        apply(xray: Xray): void {
          xray.on('parse:after', async (event) => {
            await new Promise(resolve => setTimeout(resolve, 50));
            finished++;
          });
        }
      }

      await xray.use(new AsyncPlugin());
      await xray.run();

      // Handler fully completed (not merely started) by the time run() resolves.
      expect(finished).toBe(1);
    });
  });

  describe('event order and data flow', () => {
    it('should emit sequential events in order for same file', async () => {
      const testFile = path.join(testDir, 'sequential.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      const fileEvents: string[] = [];

      xray.on('cache:check', (event) => {
        fileEvents.push(`cache:check:${path.basename(event.file)}`);
      });

      xray.on('cache:miss', (event) => {
        fileEvents.push(`cache:miss:${path.basename(event.file)}`);
      });

      xray.on('parse:before', (event) => {
        fileEvents.push(`parse:before:${path.basename(event.file)}`);
      });

      xray.on('parse:after', (event) => {
        fileEvents.push(`parse:after:${path.basename(event.file)}`);
      });

      await xray.run();

      expect(fileEvents).toEqual([
        'cache:check:sequential.ts',
        'cache:miss:sequential.ts',
        'parse:before:sequential.ts',
        'parse:after:sequential.ts'
      ]);
    });

    it('should allow listeners to modify data in sequential events', async () => {
      const testFile = path.join(testDir, 'modify.ts');
      fs.writeFileSync(testFile, `
        export function original() {}
      `);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      let finalTagName: string = '';

      // First listener modifies
      xray.on('parse:after', (event) => {
        event.tags = event.tags.map(tag => ({
          ...tag,
          name: `modified_${tag.name}`
        }));
      });

      // Second listener sees modification
      xray.on('parse:after', (event) => {
        finalTagName = event.tags[0]?.name || '';
      });

      await xray.run();

      expect(finalTagName).toBe('modified_original');
    });

    it('should execute parallel events concurrently', async () => {
      const testFile = path.join(testDir, 'parallel.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      const timestamps: number[] = [];
      const endTimestamps: number[] = [];

      // Two listeners that both delay
      xray.on('scan:complete', async () => {
        timestamps.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 100));
        endTimestamps.push(Date.now());
      });

      xray.on('scan:complete', async () => {
        timestamps.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 100));
        endTimestamps.push(Date.now());
      });

      await xray.run();

      // Measure the listener window itself (not the whole run, which also
      // scans/parses/ranks and is load-sensitive). Sequential execution
      // would span >= 200ms; parallel spans ~100ms.
      expect(timestamps.length).toBe(2);
      expect(Math.abs(timestamps[0] - timestamps[1])).toBeLessThan(30); // Started at same time
      const span = Math.max(...endTimestamps) - Math.min(...timestamps);
      expect(span).toBeLessThan(190); // Ran in parallel
    });
  });

  describe('error scenarios', () => {
    it('should emit error event when listener throws', async () => {
      const testFile = path.join(testDir, 'error.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      let errorEvent: any = null;

      xray.on('parse:after', () => {
        throw new Error('Test error');
      });

      xray.on('error', (event) => {
        errorEvent = event;
      });

      // Listener failures are isolated and surfaced via the `error` event;
      // the run itself completes (4033c6f pipeline unification).
      await expect(xray.run()).resolves.toBeDefined();

      expect(errorEvent).not.toBeNull();
      expect(errorEvent.event).toBe('parse:after');
      expect(errorEvent.error.message).toBe('Test error');
    });

    it('should continue analysis when error event is handled', async () => {
      const testFile = path.join(testDir, 'handled-error.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      let completedEvents: string[] = [];

      xray.on('parse:after', () => {
        throw new Error('Recoverable error');
      });

      xray.on('error', (event) => {
        // Error handled, mark as recovered
        event.recovered = true;
      });

      xray.on('render:complete', () => {
        completedEvents.push('render:complete');
      });

      // Should not throw because error was recovered
      await xray.run();

      expect(completedEvents).toContain('render:complete');
    });

    it('should handle parse errors gracefully', async () => {
      const testFile = path.join(testDir, 'invalid.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      // tree-sitter is error-tolerant and never throws on bad syntax, so
      // force a parser failure to exercise the parse:error path.
      const parseSpy = jest
        .spyOn(ParserManager.prototype, 'parse')
        .mockRejectedValue(new Error('parser exploded'));

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      let parseErrors: any[] = [];

      xray.on('parse:error', (event) => {
        parseErrors.push(event);
      });

      try {
        await xray.run();
      } finally {
        parseSpy.mockRestore();
      }

      expect(parseErrors.length).toBeGreaterThan(0);
      expect(parseErrors[0].file).toContain('invalid.ts');
      expect(parseErrors[0].error.message).toBe('parser exploded');
    });

    it('should allow plugins to skip files with errors', async () => {
      const testFile = path.join(testDir, 'skip-on-error.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      let parsedFiles: string[] = [];

      // Skip file during scan
      xray.on('scan:file', (event) => {
        if (event.file.includes('skip-on-error')) {
          event.skip = true;
        }
      });

      xray.on('parse:after', (event) => {
        parsedFiles.push(event.file);
      });

      await xray.run();

      expect(parsedFiles).not.toContain('skip-on-error.ts');
    });

    it('should handle multiple errors from different plugins', async () => {
      const testFile = path.join(testDir, 'multi-error.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      const errors: string[] = [];

      class ErrorPlugin1 implements XrayPlugin {
        name = 'error-plugin-1';
        apply(xray: Xray): void {
          xray.on('parse:after', () => {
            throw new Error('Error from plugin 1');
          });
        }
      }

      class ErrorPlugin2 implements XrayPlugin {
        name = 'error-plugin-2';
        apply(xray: Xray): void {
          xray.on('parse:after', () => {
            throw new Error('Error from plugin 2');
          });
        }
      }

      xray.on('error', (event) => {
        errors.push(event.error.message);
      });

      await xray.use(new ErrorPlugin1());
      await xray.use(new ErrorPlugin2());

      // Listener failures are reported via `error`, not thrown from run().
      await expect(xray.run()).resolves.toBeDefined();

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]).toContain('Error from plugin');
    });
  });

  describe('plugin lifecycle', () => {
    it('should register and list plugins', async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:'
      });

      class TestPlugin implements XrayPlugin {
        name = 'test-plugin';
        apply() {}
      }

      const plugin = new TestPlugin();
      await xray.use(plugin);

      const plugins = xray.plugins();
      expect(plugins).toContainEqual(plugin);
      expect(plugins.length).toBe(1);
    });

    it('should unload plugins', async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:'
      });

      class TestPlugin implements XrayPlugin {
        name = 'removable-plugin';
        apply() {}
      }

      await xray.use(new TestPlugin());
      expect(xray.plugins().length).toBe(1);

      await xray.unload('removable-plugin');
      expect(xray.plugins().length).toBe(0);
    });

    it('should call dispose when plugin is unloaded', async () => {
      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:'
      });

      let disposed = false;

      class DisposablePlugin implements XrayPlugin {
        name = 'disposable';
        apply() {}
        async dispose() {
          disposed = true;
        }
      }

      await xray.use(new DisposablePlugin());
      await xray.unload('disposable');

      expect(disposed).toBe(true);
    });
  });
});
