import { Xray } from '../../src/lib/xray';
import { SkipTestsPlugin } from '../../examples/plugins/skip-tests';

describe('SkipTestsPlugin', () => {
  let xray: Xray;

  beforeEach(() => {
    xray = new Xray({
      path: '/tmp/test',
      cachePath: ':memory:'
    });
  });

  describe('plugin metadata', () => {
    it('should have correct name', () => {
      const plugin = new SkipTestsPlugin();
      expect(plugin.name).toBe('skip-tests');
    });

    it('should have version', () => {
      const plugin = new SkipTestsPlugin();
      expect(plugin.version).toBeDefined();
    });
  });

  describe('default patterns', () => {
    it('should use default patterns when none provided', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const event1 = { file: 'app.test.ts', skip: false };
      await xray.emitAsync('scan:file', event1);
      expect(event1.skip).toBe(true);

      const event2 = { file: 'component.spec.ts', skip: false };
      await xray.emitAsync('scan:file', event2);
      expect(event2.skip).toBe(true);

      const event3 = { file: '__tests__/unit.ts', skip: false };
      await xray.emitAsync('scan:file', event3);
      expect(event3.skip).toBe(true);
    });

    it('should not skip non-test files with default patterns', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const event = { file: 'src/app.ts', skip: false };
      await xray.emitAsync('scan:file', event);
      expect(event.skip).toBe(false);
    });
  });

  describe('custom patterns', () => {
    it('should accept custom patterns in constructor', async () => {
      const plugin = new SkipTestsPlugin(['*.mock.*']);
      await xray.use(plugin);

      const event = { file: 'api.mock.ts', skip: false };
      await xray.emitAsync('scan:file', event);
      expect(event.skip).toBe(true);
    });

    it('should match multiple custom patterns', async () => {
      const plugin = new SkipTestsPlugin(['*.test.*', '*.fixture.*']);
      await xray.use(plugin);

      const event1 = { file: 'app.test.ts', skip: false };
      await xray.emitAsync('scan:file', event1);
      expect(event1.skip).toBe(true);

      const event2 = { file: 'data.fixture.json', skip: false };
      await xray.emitAsync('scan:file', event2);
      expect(event2.skip).toBe(true);
    });

    it('should support directory patterns', async () => {
      const plugin = new SkipTestsPlugin(['test/**', 'fixtures/**']);
      await xray.use(plugin);

      const event1 = { file: 'test/unit/app.ts', skip: false };
      await xray.emitAsync('scan:file', event1);
      expect(event1.skip).toBe(true);

      const event2 = { file: 'fixtures/data.json', skip: false };
      await xray.emitAsync('scan:file', event2);
      expect(event2.skip).toBe(true);
    });
  });

  describe('pattern matching', () => {
    it('should match .test. pattern', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const testCases = [
        { file: 'app.test.ts', expected: true },
        { file: 'utils.test.js', expected: true },
        { file: 'component.test.tsx', expected: true },
        { file: 'src/app.test.ts', expected: true }
      ];

      for (const tc of testCases) {
        const event = { file: tc.file, skip: false };
        await xray.emitAsync('scan:file', event);
        expect(event.skip).toBe(tc.expected);
      }
    });

    it('should match .spec. pattern', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const testCases = [
        { file: 'app.spec.ts', expected: true },
        { file: 'utils.spec.js', expected: true },
        { file: 'component.spec.tsx', expected: true }
      ];

      for (const tc of testCases) {
        const event = { file: tc.file, skip: false };
        await xray.emitAsync('scan:file', event);
        expect(event.skip).toBe(tc.expected);
      }
    });

    it('should match __tests__/** pattern', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const testCases = [
        { file: '__tests__/app.ts', expected: true },
        { file: '__tests__/unit/utils.ts', expected: true },
        { file: '__tests__/integration/api.ts', expected: true }
      ];

      for (const tc of testCases) {
        const event = { file: tc.file, skip: false };
        await xray.emitAsync('scan:file', event);
        expect(event.skip).toBe(tc.expected);
      }
    });

    it('should not match files that do not fit patterns', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const testCases = [
        'src/app.ts',
        'lib/utils.ts',
        'components/Button.tsx',
        'testing.ts', // word "test" but not pattern
        'specs/manual.md' // word "spec" but not pattern
      ];

      for (const file of testCases) {
        const event = { file, skip: false };
        await xray.emitAsync('scan:file', event);
        expect(event.skip).toBe(false);
      }
    });

    it('should support ? wildcard for single character', async () => {
      const plugin = new SkipTestsPlugin(['test?.ts']);
      await xray.use(plugin);

      const event1 = { file: 'test1.ts', skip: false };
      await xray.emitAsync('scan:file', event1);
      expect(event1.skip).toBe(true);

      const event2 = { file: 'testAB.ts', skip: false };
      await xray.emitAsync('scan:file', event2);
      expect(event2.skip).toBe(false);
    });

    it('should support * wildcard for multiple characters', async () => {
      const plugin = new SkipTestsPlugin(['*.generated.*']);
      await xray.use(plugin);

      const event1 = { file: 'api.generated.ts', skip: false };
      await xray.emitAsync('scan:file', event1);
      expect(event1.skip).toBe(true);

      const event2 = { file: 'schema.generated.graphql', skip: false };
      await xray.emitAsync('scan:file', event2);
      expect(event2.skip).toBe(true);
    });
  });

  describe('skip flag behavior', () => {
    it('should set skip flag to true for matching files', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const event = { file: 'app.test.ts', skip: false };
      await xray.emitAsync('scan:file', event);
      expect(event.skip).toBe(true);
    });

    it('should not modify skip flag for non-matching files', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const event = { file: 'src/app.ts', skip: false };
      await xray.emitAsync('scan:file', event);
      expect(event.skip).toBe(false);
    });

    it('should stop checking after first pattern match', async () => {
      const plugin = new SkipTestsPlugin(['*.test.*', '*.spec.*']);
      await xray.use(plugin);

      const event = { file: 'app.test.spec.ts', skip: false };
      await xray.emitAsync('scan:file', event);
      expect(event.skip).toBe(true);
    });
  });

  describe('plugin lifecycle', () => {
    it('should register successfully with xray', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const plugins = xray.plugins();
      expect(plugins).toContainEqual(plugin);
    });

    it('should handle multiple scan:file events', async () => {
      const plugin = new SkipTestsPlugin();
      await xray.use(plugin);

      const files = [
        { file: 'app.test.ts', expected: true },
        { file: 'src/app.ts', expected: false },
        { file: 'utils.spec.ts', expected: true },
        { file: 'lib/utils.ts', expected: false },
        { file: '__tests__/unit.ts', expected: true }
      ];

      for (const { file, expected } of files) {
        const event = { file, skip: false };
        await xray.emitAsync('scan:file', event);
        expect(event.skip).toBe(expected);
      }
    });
  });
});
