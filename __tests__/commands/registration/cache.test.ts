// __tests__/commands/registration/cache.test.ts
import { StrategyCacheManager } from '../../../src/commands/registration/cache';
import { Strategy, StrategyContext } from '../../../src/lib/strategy/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('StrategyCacheManager', () => {
  const testCacheDir = path.join(__dirname, '.test-cache');
  let cacheManager: StrategyCacheManager;

  beforeEach(() => {
    // Keep the XDG cache out of the real user cache
    process.env.XDG_CACHE_HOME = testCacheDir;
    // Clean up test cache directory
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }
    fs.mkdirSync(testCacheDir, { recursive: true });

    cacheManager = new StrategyCacheManager(testCacheDir);
  });

  afterEach(() => {
    delete process.env.XDG_CACHE_HOME;
    // Clean up
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }
  });

  const createMockStrategy = (name: string, hasCommands = true): Strategy => ({
    name,
    version: '0.0.1-alpha.1',
    detect: async (ctx: StrategyContext) => true,
    analyze: async (file: string, ctx: StrategyContext) => ({
      tags: [],
      exports: [],
      imports: []
    }),
    commands: hasCommands
      ? {
          test: {
            description: 'Test command',
            handler: async () => []
          }
        }
      : undefined
  });

  it('should save strategies to cache', async () => {
    const strategies = [
      createMockStrategy('test-strategy-1'),
      createMockStrategy('test-strategy-2')
    ];

    await cacheManager.save(strategies);

    const cacheFile = cacheManager.cacheFile;
    expect(fs.existsSync(cacheFile)).toBe(true);

    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const { version } = require('../../../package.json');
    expect(cached.version).toBe(version);
    expect(cached.strategies).toHaveLength(2);
    expect(cached.strategies[0].name).toBe('test-strategy-1');
    expect(cached.strategies[1].name).toBe('test-strategy-2');
  });

  it('should retrieve cached strategies', async () => {
    const strategies = [createMockStrategy('cached-strategy')];

    await cacheManager.save(strategies);
    const cached = await cacheManager.getCached();

    expect(cached).not.toBeNull();
    expect(cached).toHaveLength(1);
    expect(cached![0].name).toBe('cached-strategy');
  });

  it('should return null for non-existent cache', async () => {
    const cached = await cacheManager.getCached();
    expect(cached).toBeNull();
  });

  it('should invalidate cache on version mismatch', async () => {
    const strategies = [createMockStrategy('versioned-strategy')];
    await cacheManager.save(strategies);

    // Manually modify cache version
    const cacheFile = cacheManager.cacheFile;
    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    cacheData.version = '0.0.0-old-version';
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData));

    const cached = await cacheManager.getCached();
    expect(cached).toBeNull();
  });

  it('should validate cache against loaded strategies', async () => {
    const strategies = [createMockStrategy('validate-test')];
    await cacheManager.save(strategies);

    const cached = await cacheManager.getCached();
    expect(cached).not.toBeNull();

    const isValid = cacheManager.validateCache(strategies, cached!);
    expect(isValid).toBe(true);
  });

  it('should detect cache invalidation when strategy changes', async () => {
    const strategy1 = createMockStrategy('changing-strategy');
    await cacheManager.save([strategy1]);

    const cached = await cacheManager.getCached();
    expect(cached).not.toBeNull();

    // Modify strategy
    const strategy2: Strategy = {
      ...strategy1,
      commands: {
        different: {
          description: 'Different command',
          handler: async () => []
        }
      }
    };

    const isValid = cacheManager.validateCache([strategy2], cached!);
    expect(isValid).toBe(false);
  });

  it('should clear cache', async () => {
    const strategies = [createMockStrategy('clear-test')];
    await cacheManager.save(strategies);

    const cacheFile = cacheManager.cacheFile;
    expect(fs.existsSync(cacheFile)).toBe(true);

    await cacheManager.clear();
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it('should handle strategies without commands', async () => {
    const strategies = [
      createMockStrategy('with-commands', true),
      createMockStrategy('without-commands', false)
    ];

    await cacheManager.save(strategies);
    const cached = await cacheManager.getCached();

    expect(cached).not.toBeNull();
    expect(cached).toHaveLength(2);
    expect(cached![0].commands).toBeDefined();
    expect(cached![1].commands).toBeUndefined();
  });

  describe('default location', () => {
    let cwd: string;
    let xdg: string;
    let prevCwd: string;
    let prevXdg: string | undefined;

    beforeEach(() => {
      prevCwd = process.cwd();
      prevXdg = process.env.XDG_CACHE_HOME;
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cache-cwd-'));
      xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cache-xdg-'));
      process.env.XDG_CACHE_HOME = xdg;
      process.chdir(cwd);
    });

    afterEach(() => {
      process.chdir(prevCwd);
      if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevXdg;
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(xdg, { recursive: true, force: true });
    });

    it('persists outside the project and round-trips', async () => {
      const mgr = new StrategyCacheManager();
      await mgr.save([createMockStrategy('s1')]);

      expect(fs.readdirSync(cwd)).toEqual([]);
      expect(fs.readdirSync(xdg).length).toBeGreaterThan(0);
      expect((await new StrategyCacheManager().getCached())?.map(s => s.name)).toEqual(['s1']);
    });

    it('keys the cache per project root', async () => {
      await new StrategyCacheManager().save([createMockStrategy('s1')]);
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cache-other-'));
      try {
        expect(await new StrategyCacheManager(other).getCached()).toBeNull();
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
    });
  });
});

// A shared XDG cache dir another user can write to: a planted `strategies`
// link must not be followed, for reads or writes.
(process.platform === 'win32' ? describe.skip : describe)('StrategyCacheManager in a hostile XDG cache dir', () => {
  let root: string;
  let outside: string;
  let prevXdg: string | undefined;
  const strategy = {
    name: 'planted-probe',
    version: '0.0.1',
    detect: async () => true,
    analyze: async () => ({ tags: [], exports: [], imports: [] }),
  } as unknown as Strategy;

  beforeEach(() => {
    prevXdg = process.env.XDG_CACHE_HOME;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hostile-xdg-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hostile-target-'));
    fs.mkdirSync(path.join(root, 'xray'), { mode: 0o700 });
    fs.symlinkSync(outside, path.join(root, 'xray', 'strategies'));
    process.env.XDG_CACHE_HOME = root;
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = prevXdg;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('does not write through a planted strategies link', async () => {
    const mgr = new StrategyCacheManager('/some/project');
    await mgr.save([strategy]);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('does not read a cache planted behind the link', async () => {
    const mgr = new StrategyCacheManager('/some/project');
    const rel = path.relative(path.join(root, 'xray', 'strategies'), mgr.cacheFile);
    fs.mkdirSync(path.dirname(path.join(outside, rel)), { recursive: true });
    const { version } = require('../../../package.json');
    fs.writeFileSync(path.join(outside, rel), JSON.stringify({
      version, timestamp: Date.now(),
      strategies: [{ name: 'planted', version: '9.9.9', hash: 'x' }],
    }));
    expect(await mgr.getCached()).toBeNull();
  });
});
