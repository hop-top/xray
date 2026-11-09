// tests/strategy/loader.test.ts
import { StrategyLoader } from '../../src/lib/strategy/loader';
import { Strategy } from '../../src/lib/strategy/types';
import * as path from 'path';

describe('StrategyLoader', () => {
  let loader: StrategyLoader;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    loader = new StrategyLoader();
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it('should discover strategies from XDG_DATA_HOME', () => {
    // Set test XDG path
    const testXdg = path.join(__dirname, 'fixtures/xdg-data');
    process.env.XDG_DATA_HOME = testXdg;

    const paths = loader.getStrategyPaths();
    expect(paths).toContain(path.join(testXdg, 'xray/strategies'));
  });

  it('should prioritize XRAY_STRATEGIES_PATH', () => {
    const customPath = '/custom/strategies';
    process.env.XRAY_STRATEGIES_PATH = customPath;

    const paths = loader.getStrategyPaths();
    expect(paths[0]).toBe(customPath);
  });

  describe('projectCode: false', () => {
    const cwdPaths = () => [
      path.join(process.cwd(), '.xray/strategies'),
      path.join(process.cwd(), 'node_modules'),
    ];

    it('includes cwd strategy dirs by default', () => {
      expect(loader.getStrategyPaths()).toEqual(expect.arrayContaining(cwdPaths()));
    });

    it('excludes cwd strategy dirs and cwd-relative env entries', () => {
      process.env.XRAY_STRATEGIES_PATH = '/abs/strategies:rel/strategies';
      process.env.XDG_DATA_HOME = 'rel-data';
      const paths = new StrategyLoader({ projectCode: false }).getStrategyPaths();

      for (const p of cwdPaths()) expect(paths).not.toContain(p);
      expect(paths).toContain('/abs/strategies');
      expect(paths).not.toContain('rel/strategies');
      expect(paths).not.toContain(path.join('rel-data', 'xray/strategies'));
      expect(paths.every(p => path.isAbsolute(p))).toBe(true);
    });

    it('keeps absolute XDG_DATA_HOME and built-in strategies', async () => {
      process.env.XDG_DATA_HOME = '/abs/data';
      const safe = new StrategyLoader({ projectCode: false });
      expect(safe.getStrategyPaths()).toContain(path.join('/abs/data', 'xray/strategies'));
      const names = (await safe.discoverStrategies()).map(s => s.name);
      expect(names).toEqual(expect.arrayContaining(['react', 'express', 'rest-api']));
    });
  });

  it('should load YAML strategy', async () => {
    const strategyPath = path.join(__dirname, 'fixtures/strategies/simple.yml');
    const strategy = await loader.loadStrategy(strategyPath);

    expect(strategy.name).toBe('simple');
    expect(strategy.version).toBe('1.0.0');
  });

  it('should discover and load built-in React strategy', async () => {
    const strategies = await loader.discoverStrategies();
    const reactStrategy = strategies.find(s => s.name === 'react');

    expect(reactStrategy).toBeDefined();
    expect(reactStrategy?.version).toBe('0.1.0');
  });

  it('should discover and load built-in REST API strategy', async () => {
    const strategies = await loader.discoverStrategies();
    const restApiStrategy = strategies.find(s => s.name === 'rest-api');

    expect(restApiStrategy).toBeDefined();
    expect(restApiStrategy?.version).toBe('0.1.0');
  });

  it('should discover and load built-in Express strategy', async () => {
    const strategies = await loader.discoverStrategies();
    const expressStrategy = strategies.find(s => s.name === 'express');

    expect(expressStrategy).toBeDefined();
    expect(expressStrategy?.version).toBe('0.1.0');
  });

  it('discovers extension facades for discovered strategies', async () => {
    const strategies = await loader.discoverStrategies();
    const reactStrategy = strategies.find(s => s.name === 'react');
    const extensions = await loader.discoverExtensions(strategies);
    const reactExtension = extensions.find(extension => extension.name === 'react');

    expect(reactStrategy).toBeDefined();
    expect(reactExtension).toMatchObject({
      id: 'react',
      name: 'react',
      version: '0.1.0',
      surface: 'strategy',
    });
    expect(reactExtension?.strategy).toBe(reactStrategy);
  });
});
