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
    expect(reactStrategy?.version).toBe('2.0.0');
  });

  it('should discover and load built-in REST API strategy', async () => {
    const strategies = await loader.discoverStrategies();
    const restApiStrategy = strategies.find(s => s.name === 'rest-api');

    expect(restApiStrategy).toBeDefined();
    expect(restApiStrategy?.version).toBe('1.0.0');
  });

  it('should discover and load built-in Express strategy', async () => {
    const strategies = await loader.discoverStrategies();
    const expressStrategy = strategies.find(s => s.name === 'express');

    expect(expressStrategy).toBeDefined();
    expect(expressStrategy?.version).toBe('1.0.0');
  });
});
