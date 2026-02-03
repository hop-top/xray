// __tests__/commands/registration/cache.test.ts
import { StrategyCacheManager } from '../../../src/commands/registration/cache';
import { Strategy, StrategyContext } from '../../../src/lib/strategy/types';
import * as fs from 'fs';
import * as path from 'path';

describe('StrategyCacheManager', () => {
  const testCacheDir = path.join(__dirname, '.test-cache');
  let cacheManager: StrategyCacheManager;

  beforeEach(() => {
    // Clean up test cache directory
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }
    fs.mkdirSync(testCacheDir, { recursive: true });

    cacheManager = new StrategyCacheManager(testCacheDir);
  });

  afterEach(() => {
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

    const cacheFile = path.join(testCacheDir, '.xray', '.strategy-cache.json');
    expect(fs.existsSync(cacheFile)).toBe(true);

    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    expect(cached.version).toBe('0.0.1-alpha.1');
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
    const cacheFile = path.join(testCacheDir, '.xray', '.strategy-cache.json');
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

    const cacheFile = path.join(testCacheDir, '.xray', '.strategy-cache.json');
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
});
