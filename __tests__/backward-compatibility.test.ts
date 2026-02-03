import { Xray } from '../src/lib/xray';
import fs from 'fs';
import path from 'path';

describe('Backward Compatibility', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(__dirname, 'fixtures/compat-test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('onProgress callback', () => {
    it('should still support onProgress callback', async () => {
      const testFile = path.join(testDir, 'test.ts');
      fs.writeFileSync(testFile, `export function hello() { return 'world'; }`);

      const progressUpdates: Array<{ current: number; total: number; message: string }> = [];

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        onProgress: (current, total, message) => {
          progressUpdates.push({ current, total, message });
        }
      });

      await xray.run();

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some(p => p.message.includes('Scan'))).toBe(true);
    });

    it('should call onProgress with correct values', async () => {
      const testFile = path.join(testDir, 'progress.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      let lastProgress: any = null;

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        onProgress: (current, total, message) => {
          lastProgress = { current, total, message };
        }
      });

      await xray.run();

      expect(lastProgress).not.toBeNull();
      expect(lastProgress.current).toBeGreaterThanOrEqual(0);
      expect(lastProgress.total).toBeGreaterThanOrEqual(lastProgress.current);
      expect(typeof lastProgress.message).toBe('string');
    });

    it('should work with both onProgress and event listeners', async () => {
      const testFile = path.join(testDir, 'both.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      let progressCallbackCalls = 0;
      let progressEventCalls = 0;

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        onProgress: () => {
          progressCallbackCalls++;
        }
      });

      xray.on('progress', () => {
        progressEventCalls++;
      });

      await xray.run();

      // Both should be called
      expect(progressCallbackCalls).toBeGreaterThan(0);
      expect(progressEventCalls).toBeGreaterThan(0);
      // They should have the same count
      expect(progressCallbackCalls).toBe(progressEventCalls);
    });
  });

  describe('existing code runs unchanged', () => {
    it('should run analysis without plugins', async () => {
      const testFile = path.join(testDir, 'no-plugins.ts');
      fs.writeFileSync(testFile, `
        export function myFunction() {
          return 42;
        }
      `);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      const result = await xray.run();

      expect(typeof result).toBe('string');
      expect(result).toContain('myFunction');
    });

    it('should support all existing config options', async () => {
      const testFile = path.join(testDir, 'config.ts');
      fs.writeFileSync(testFile, `
        export const API_KEY = 'secret';
        export function helper() {}
        export class MyClass {}
      `);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        limit: 4096,
        features: {
          vars: true,
          incs: true,
          docs: true
        },
        match: ['*.ts'],
        depth: 5
      });

      const result = await xray.run();

      expect(typeof result).toBe('string');
      // Should contain at least one of the exported items
      if (typeof result === 'string') {
        const hasContent = result.includes('API_KEY') || result.includes('helper') || result.includes('MyClass');
        expect(hasContent).toBe(true);
      }
    });

    it('should handle small files correctly', async () => {
      const testFile = path.join(testDir, 'small.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        limit: 100  // Very small limit
      });

      const result = await xray.run();

      expect(typeof result).toBe('string');
      // Should work even with small limits
    });

    it('should work with caching disabled', async () => {
      const testFile = path.join(testDir, 'no-cache.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:', // In-memory is still caching, but isolated
        chunked: false
      });

      const result1 = await xray.run();
      const result2 = await xray.run();

      // Both should produce same output
      expect(result1).toBe(result2);
    });
  });

  describe('without plugins registered', () => {
    it('should not require any plugins', async () => {
      const testFile = path.join(testDir, 'vanilla.ts');
      fs.writeFileSync(testFile, `export function vanilla() {}`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      // Should have no plugins
      expect(xray.plugins()).toEqual([]);

      const result = await xray.run();
      expect(typeof result).toBe('string');
    });

    it('should emit events even without listeners', async () => {
      const testFile = path.join(testDir, 'no-listeners.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      // No event listeners registered
      // Should not throw
      const result = await xray.run();
      expect(typeof result).toBe('string');
    });

    it('should produce same output with or without plugins (if plugins do nothing)', async () => {
      const testFile = path.join(testDir, 'same-output.ts');
      fs.writeFileSync(testFile, `export function test() {}`);

      // Without plugins
      const xray1 = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });
      const result1 = await xray1.run();

      // With no-op plugin
      const xray2 = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      class NoOpPlugin {
        name = 'noop';
        apply(xray: Xray): void {
          // Listens but doesn't modify anything
          xray.on('scan:complete', () => {});
        }
      }

      await xray2.use(new NoOpPlugin());
      const result2 = await xray2.run();

      expect(result1).toBe(result2);
    });

    it('should work with features flags', async () => {
      const testFile = path.join(testDir, 'features.ts');
      fs.writeFileSync(testFile, `
        import fs from 'fs';

        /** This is a documented function */
        export function documented() {
          const local = 42;
          return local;
        }
      `);

      // Test with vars - variables should be included
      const xrayVars = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        features: { vars: true }
      });
      const resultVars = await xrayVars.run();
      // vars feature should include variables in output
      expect(typeof resultVars).toBe('string');

      // Test with incs - imports should be in dependency table
      const xrayIncs = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        features: { incs: true }
      });
      const resultIncs = await xrayIncs.run();
      expect(resultIncs).toContain('External Dependencies');

      // Test with docs - docstrings should be included
      const xrayDocs = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false,
        features: { docs: true }
      });
      const resultDocs = await xrayDocs.run();
      // docs feature should include docstrings
      expect(typeof resultDocs).toBe('string');
    });
  });

  describe('API compatibility', () => {
    it('should support method chaining', async () => {
      const testFile = path.join(testDir, 'chain.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      class TestPlugin {
        name = 'test';
        apply() {}
      }

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      // Should support chaining
      const result = await xray
        .use(new TestPlugin())
        .then(x => x.run());

      expect(typeof result).toBe('string');
    });

    it('should return correct type from run()', async () => {
      const testFile = path.join(testDir, 'types.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: false
      });

      const result = await xray.run();

      // Non-chunked should return string
      expect(typeof result).toBe('string');
    });

    it('should return correct type from run() with chunked', async () => {
      const testFile = path.join(testDir, 'chunked.ts');
      fs.writeFileSync(testFile, `export const x = 1;`);

      const xray = new Xray({
        path: testDir,
        cachePath: ':memory:',
        chunked: true
      });

      const result = await xray.run();

      // Chunked should return object with chunks
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('chunks');
      expect(result).toHaveProperty('rootChunk');
    });
  });
});
