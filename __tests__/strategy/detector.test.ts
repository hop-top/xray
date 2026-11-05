// tests/strategy/detector.test.ts
import { StrategyDetector } from '../../src/lib/strategy/detector';
import { StrategyLoader } from '../../src/lib/strategy/loader';
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import { Extension } from '../../src/lib/strategy/types';
import { projectKey } from '../../src/lib/storage';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('StrategyDetector', () => {
  const testRoot = path.join(__dirname, 'fixtures/test-project');
  let cacheHome: string;
  let detectionFile: string;
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-detect-cache-'));
    process.env.XDG_CACHE_HOME = cacheHome;
    detectionFile = path.join(
      cacheHome, 'xray', 'strategies', projectKey(testRoot), 'detected-strategies.json'
    );
    // Change to test project directory for strategy discovery
    process.chdir(testRoot);
    // Point to fixtures strategies directory
    process.env.XRAY_STRATEGIES_PATH = path.join(__dirname, 'fixtures/strategies');
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Restore original environment
    process.env = { ...originalEnv };
    fs.rmSync(cacheHome, { recursive: true, force: true });
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

  it('keeps the detection file private and out of the project tree', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);

    await detector.runDetection();

    expect(fs.existsSync(path.join(testRoot, '.xray', 'detected-strategies.json'))).toBe(false);
    if (process.platform !== 'win32') {
      expect(fs.statSync(detectionFile).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(detectionFile)).mode & 0o777).toBe(0o700);
    }
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

  it('detects command-only extensions through the extension seam', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);
    const glossaryExtension: Extension = {
      id: 'glossary',
      name: 'glossary',
      version: '0.1.0',
      surface: 'glossary',
      detect: () => ({
        matched: true,
        score: 0.92,
        surface: 'glossary',
      }),
      commands: {
        scan: {
          description: 'Scan glossary terms',
          handler: async () => [],
        },
      },
    };

    const detected = await detector.detectExtensions([glossaryExtension]);

    expect(detected).toEqual([
      expect.objectContaining({
        name: 'glossary',
        version: '0.1.0',
        score: 0.92,
        surface: 'glossary',
      }),
    ]);
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
    expect(reactDetection?.version).toBe('0.1.0');
  });

  it('uses passed extensions in runDetection (regression PR #18)', async () => {
    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(testRoot);
    const detector = new StrategyDetector(loader, context);
    const mockExtensions: Extension[] = [
      {
        id: 'mock',
        name: 'mock',
        version: '1.0.0',
        surface: 'strategy',
        detect: () => true,
      },
    ];

    const spy = jest.spyOn(loader, 'discoverExtensions');
    const detected = await detector.runDetection(mockExtensions);

    expect(spy).not.toHaveBeenCalled();
    expect(detected).toHaveLength(1);
    expect(detected[0].name).toBe('mock');
    spy.mockRestore();
  });
});
