import { TelemetryTracker, TelemetryConfig } from '../../src/lib/telemetry';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TelemetryTracker', () => {
  let tmpDir: string;
  let tracker: TelemetryTracker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-telemetry-test-'));
  });

  afterEach(() => {
    if (tracker) {
      tracker.shutdown();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('opt-in mechanism', () => {
    it('should not track when telemetry is disabled', () => {
      const config: TelemetryConfig = {
        enabled: false,
        projectRoot: tmpDir
      };

      tracker = new TelemetryTracker(config);

      tracker.trackCommand('generate', { path: '/test' });

      // No telemetry file should be created
      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      expect(fs.existsSync(telemetryFile)).toBe(false);
    });

    it('should track when telemetry is enabled', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };

      tracker = new TelemetryTracker(config);

      tracker.trackCommand('generate', { path: '/test' });
      tracker.shutdown();

      // Telemetry file should exist
      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      expect(fs.existsSync(telemetryFile)).toBe(true);
    });

    it('should respect environment variable XRAY_TELEMETRY_ENABLED', () => {
      process.env.XRAY_TELEMETRY_ENABLED = 'true';

      const config: TelemetryConfig = {
        projectRoot: tmpDir
      };

      tracker = new TelemetryTracker(config);

      tracker.trackCommand('generate', { path: '/test' });
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      expect(fs.existsSync(telemetryFile)).toBe(true);

      delete process.env.XRAY_TELEMETRY_ENABLED;
    });
  });

  describe('command tracking', () => {
    beforeEach(() => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      tracker = new TelemetryTracker(config);
    });

    it('should track command execution', () => {
      tracker.trackCommand('generate', { format: 'json', chunked: true });
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const commandEvent = events.find(e => e.name === 'command.execute');
      expect(commandEvent).toBeDefined();
      expect(commandEvent.attributes).toMatchObject({
        'command.name': 'generate',
        'command.options.format': 'json',
        'command.options.chunked': true
      });
    });

    it('should track command duration', () => {
      const span = tracker.startCommandSpan('generate');

      // Simulate work
      const start = Date.now();
      while (Date.now() - start < 50) {
        // wait
      }

      span.end();
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const spanEvent = events.find(e => e.name === 'generate' && e.kind === 'span');
      expect(spanEvent).toBeDefined();
      expect(spanEvent.duration).toBeGreaterThanOrEqual(50);
    });
  });

  describe('error tracking', () => {
    beforeEach(() => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      tracker = new TelemetryTracker(config);
    });

    it('should track error events', () => {
      const error = new Error('Test error');
      tracker.trackError('ParserError', error, {
        file: '/test/file.ts',
        line: 42
      });
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const errorEvent = events.find(e => e.name === 'error.occurred');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.attributes).toMatchObject({
        'error.type': 'ParserError',
        'error.message': 'Test error',
        'error.context.file': '/test/file.ts',
        'error.context.line': 42
      });
    });

    it('should track error with stack trace', () => {
      const error = new Error('Test error');
      tracker.trackError('ConfigError', error);
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const errorEvent = events.find(e => e.name === 'error.occurred');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.attributes['error.stack']).toBeDefined();
    });
  });

  describe('stats tracking', () => {
    beforeEach(() => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      tracker = new TelemetryTracker(config);
    });

    it('should track execution time', () => {
      tracker.trackStat('execution.time', 1234, { command: 'generate' });
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const statEvent = events.find(e => e.name === 'stat.recorded');
      expect(statEvent).toBeDefined();
      expect(statEvent.attributes).toMatchObject({
        'stat.name': 'execution.time',
        'stat.value': 1234,
        'stat.unit': 'ms',
        'stat.context.command': 'generate'
      });
    });

    it('should track memory usage', () => {
      const memoryUsage = process.memoryUsage();
      tracker.trackStat('memory.heap_used', memoryUsage.heapUsed, { unit: 'bytes' });
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const statEvent = events.find(e => e.name === 'stat.recorded' && e.attributes['stat.name'] === 'memory.heap_used');
      expect(statEvent).toBeDefined();
      expect(statEvent.attributes['stat.value']).toBeGreaterThan(0);
    });

    it('should track codebase size', () => {
      tracker.trackStat('codebase.files', 150, { unit: 'count' });
      tracker.trackStat('codebase.lines', 45000, { unit: 'count' });
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const filesEvent = events.find(e => e.attributes && e.attributes['stat.name'] === 'codebase.files');
      const linesEvent = events.find(e => e.attributes && e.attributes['stat.name'] === 'codebase.lines');

      expect(filesEvent).toBeDefined();
      expect(linesEvent).toBeDefined();
      expect(filesEvent.attributes['stat.value']).toBe(150);
      expect(linesEvent.attributes['stat.value']).toBe(45000);
    });
  });

  describe('resource attributes', () => {
    it('should include service information', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      tracker = new TelemetryTracker(config);

      tracker.trackCommand('generate', {});
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const event = events[0];
      expect(event.resource).toMatchObject({
        'service.name': 'xray-cli',
        'service.version': expect.any(String)
      });
    });

    it('should include host information', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      tracker = new TelemetryTracker(config);

      tracker.trackCommand('generate', {});
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const event = events[0];
      expect(event.resource['host.arch']).toBeDefined();
      expect(event.resource['os.type']).toBeDefined();
    });
  });

  describe('file export', () => {
    it('should export to JSONL format', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir,
        exportFormat: 'jsonl'
      };
      tracker = new TelemetryTracker(config);

      tracker.trackCommand('generate', { path: '/test1' });
      tracker.trackCommand('explore', { path: '/test2' });
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBeGreaterThanOrEqual(2);
      lines.forEach(line => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('should create telemetry directory if it does not exist', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };

      // Ensure .xray doesn't exist
      const xrayDir = path.join(tmpDir, '.xray');
      if (fs.existsSync(xrayDir)) {
        fs.rmSync(xrayDir, { recursive: true });
      }

      tracker = new TelemetryTracker(config);
      tracker.trackCommand('generate', {});
      tracker.shutdown();

      expect(fs.existsSync(xrayDir)).toBe(true);
      expect(fs.existsSync(path.join(xrayDir, 'telemetry.json'))).toBe(true);
    });
  });

  describe('context propagation', () => {
    beforeEach(() => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      tracker = new TelemetryTracker(config);
    });

    it('should support nested spans', () => {
      const parentSpan = tracker.startCommandSpan('generate');
      const childSpan = tracker.startSpan('parse.file', { parent: parentSpan });

      childSpan.end();
      parentSpan.end();
      tracker.shutdown();

      const telemetryFile = path.join(tmpDir, '.xray', 'telemetry.json');
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const parentEvent = events.find(e => e.name === 'generate');
      const childEvent = events.find(e => e.name === 'parse.file');

      expect(parentEvent).toBeDefined();
      expect(childEvent).toBeDefined();
      expect(childEvent.parentSpanId).toBe(parentEvent.spanId);
    });
  });

  describe('graceful degradation', () => {
    it('should not throw when tracking fails', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: '/invalid/path/that/does/not/exist'
      };

      // Should not throw
      expect(() => {
        tracker = new TelemetryTracker(config);
        tracker.trackCommand('generate', {});
        tracker.shutdown();
      }).not.toThrow();
    });

    it('should handle shutdown without tracking', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };

      tracker = new TelemetryTracker(config);

      // Should not throw
      expect(() => {
        tracker.shutdown();
      }).not.toThrow();
    });
  });
});
