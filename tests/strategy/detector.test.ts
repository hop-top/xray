// tests/strategy/detector.test.ts
import { StrategyDetector } from '../../src/strategy/detector';
import { StrategyLoader } from '../../src/strategy/loader';
import { StrategyContextImpl } from '../../src/strategy/context';
import * as path from 'path';
import * as fs from 'fs';

describe('StrategyDetector', () => {
  const testRoot = path.join(__dirname, 'fixtures/test-project');
  const detectionFile = path.join(testRoot, '.xray/detected-strategies.json');
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Change to test project directory for strategy discovery
    process.chdir(testRoot);
    // Point to fixtures strategies directory
    process.env.XRAY_STRATEGIES_PATH = path.join(__dirname, 'fixtures/strategies');
    // Clean up detection file before each test
    if (fs.existsSync(detectionFile)) {
      fs.unlinkSync(detectionFile);
    }
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Restore original environment
    process.env = { ...originalEnv };
    // Clean up detection file after each test
    if (fs.existsSync(detectionFile)) {
      fs.unlinkSync(detectionFile);
    }
  });

  it('should detect applicable strategies', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    const strategies = await loader.discoverStrategies();
    const detected = await detector.detect(strategies);

    expect(detected.length).toBeGreaterThan(0);
    expect(detected[0]).toHaveProperty('name');
    expect(detected[0]).toHaveProperty('version');
    expect(detected[0]).toHaveProperty('detectedAt');
  });

  it('should cache detection results', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    await detector.runDetection();
    const results = detector.getDetectedStrategies();

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  it('should write detection results to file', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    await detector.runDetection();

    expect(fs.existsSync(detectionFile)).toBe(true);
    const content = fs.readFileSync(detectionFile, 'utf-8');
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('should return null when no detection file exists', () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    const results = detector.getDetectedStrategies();
    expect(results).toBeNull();
  });

  it('should indicate refresh is needed when file does not exist', () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    expect(detector.needsRefresh()).toBe(true);
  });

  it('should indicate refresh is not needed when file is recent', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    await detector.runDetection();
    expect(detector.needsRefresh()).toBe(false);
  });

  it('should handle strategy detection errors gracefully', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    // Create a strategy that throws an error
    const faultyStrategy = {
      name: 'faulty',
      version: '1.0.0',
      detect: () => {
        throw new Error('Detection error');
      },
      analyze: async () => ({ tags: [] })
    };

    const detected = await detector.detect([faultyStrategy]);
    expect(detected).toEqual([]);
  });

  it('should detect React strategy in React project', async () => {
    const reactProjectRoot = path.join(__dirname, 'fixtures/react-project');
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(reactProjectRoot);
    const detector = new StrategyDetector(loader, context);

    const detected = await detector.runDetection();
    const reactDetection = detected.find(s => s.name === 'react');

    expect(reactDetection).toBeDefined();
    expect(reactDetection?.name).toBe('react');
    expect(reactDetection?.version).toBe('2.0.0');
  });
});
