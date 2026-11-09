import { TelemetryPlugin, TelemetryConfig } from '../../src/lib/plugins/telemetry-plugin';
import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';
import { XrayEvents } from '../../src/lib/events/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { projectTelemetryPath } from '../../src/lib/storage';

// Recording needs an interactive run (see telemetry-policy): simulate a
// TTY stdout and clear the env that forces telemetry off.
const OFF_ENV = [
  'XRAY_NO_TELEMETRY', 'DO_NOT_TRACK', 'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS',
  'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'JENKINS_URL', 'BUILDKITE', 'TEAMCITY_VERSION',
];
let savedTTY: boolean | undefined;
let savedEnv: Record<string, string | undefined> = {};
let savedState: string | undefined;
let stateHome: string;
beforeEach(() => {
  // The sink lives in the state dir: keep it out of the real one.
  savedState = process.env.XDG_STATE_HOME;
  stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-telemetry-state-'));
  process.env.XDG_STATE_HOME = stateHome;
  savedTTY = process.stdout.isTTY;
  (process.stdout as { isTTY?: boolean }).isTTY = true;
  savedEnv = {};
  for (const k of OFF_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  if (savedState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedState;
  fs.rmSync(stateHome, { recursive: true, force: true });
  (process.stdout as { isTTY?: boolean }).isTTY = savedTTY;
  for (const k of OFF_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('TelemetryPlugin', () => {
  let tmpDir: string;
  let plugin: TelemetryPlugin;
  let emitter: AsyncEventEmitter<XrayEvents>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-telemetry-plugin-test-'));
    emitter = new AsyncEventEmitter<XrayEvents>();
  });

  afterEach(() => {
    if (plugin) {
      plugin.shutdown();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('plugin metadata', () => {
    it('should have correct name', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      plugin = new TelemetryPlugin(config);
      expect(plugin.name).toBe('telemetry');
    });

    it('should have version', () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      plugin = new TelemetryPlugin(config);
      expect(plugin.version).toBe('1.0.0');
    });
  });

  describe('event-based tracking', () => {
    beforeEach(() => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };
      plugin = new TelemetryPlugin(config);
      plugin.apply(emitter);
    });

    it('should track command:start events', async () => {
      await emitter.emit('command:start', {
        command: 'generate',
        options: { format: 'json' },
        timestamp: Date.now(),
        traceId: 'test-trace-123'
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      expect(fs.existsSync(telemetryFile)).toBe(true);

      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const commandEvent = events.find(e => e.name === 'command.execute');
      expect(commandEvent).toBeDefined();
      expect(commandEvent.attributes['command.name']).toBe('generate');
      expect(commandEvent.attributes['command.options.format']).toBe('json');
    });

    it('should track command:complete events', async () => {
      await emitter.emit('command:start', {
        command: 'generate',
        options: {},
        timestamp: Date.now(),
        traceId: 'test-trace-123'
      });

      await emitter.emit('command:complete', {
        command: 'generate',
        duration: 1000,
        success: true,
        timestamp: Date.now(),
        traceId: 'test-trace-123'
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const spanEvent = events.find(e => e.kind === 'span' && e.name === 'generate');
      expect(spanEvent).toBeDefined();
      expect(spanEvent.duration).toBeDefined();
      expect(spanEvent.attributes.success).toBe(true);
    });

    it('should track command:error events', async () => {
      const error = new Error('Test error');
      await emitter.emit('command:error', {
        command: 'generate',
        error,
        errorType: 'TestError',
        timestamp: Date.now(),
        traceId: 'test-trace-123',
        context: { file: '/test/file.ts' }
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const errorEvent = events.find(e => e.name === 'error.occurred');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.attributes['error.type']).toBe('TestError');
      expect(errorEvent.attributes['error.message']).toBe('Test error');
      expect(errorEvent.attributes['error.context.file']).toBe('/test/file.ts');
    });

    it('should track stat:recorded events', async () => {
      await emitter.emit('stat:recorded', {
        name: 'execution.time',
        value: 1234,
        unit: 'ms',
        timestamp: Date.now()
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const statEvent = events.find(e => e.name === 'stat.recorded');
      expect(statEvent).toBeDefined();
      expect(statEvent.attributes['stat.name']).toBe('execution.time');
      expect(statEvent.attributes['stat.value']).toBe(1234);
      expect(statEvent.attributes['stat.unit']).toBe('ms');
    });

    it('should track cache:hit events', async () => {
      await emitter.emit('cache:hit', {
        file: '/test/file.ts',
        tags: [],
        imports: []
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const cacheEvent = events.find(e => e.name === 'cache.hit');
      expect(cacheEvent).toBeDefined();
    });

    it('should track cache:miss events', async () => {
      await emitter.emit('cache:miss', {
        file: '/test/file.ts'
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const cacheEvent = events.find(e => e.name === 'cache.miss');
      expect(cacheEvent).toBeDefined();
    });

    it('should track parse:error events', async () => {
      const error = new Error('Parse error');
      await emitter.emit('parse:error', {
        file: '/test/file.ts',
        error,
        recovered: false
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const errorEvent = events.find(e => e.name === 'error.occurred' && e.attributes['error.type'] === 'ParseError');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.attributes['error.context.file']).toBe('/test/file.ts');
    });

    it('should track generic error events', async () => {
      const error = new Error('Generic error');
      await emitter.emit('error', {
        event: 'test-event',
        error,
        payload: { foo: 'bar' },
        recovered: true
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const errorEvent = events.find(e => e.name === 'error.occurred' && e.attributes['error.type'] === 'test-event');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.attributes['error.context.recovered']).toBe(true);
    });
  });

  describe('opt-in mechanism', () => {
    it('should not track when telemetry is disabled', async () => {
      const config: TelemetryConfig = {
        enabled: false,
        projectRoot: tmpDir
      };

      plugin = new TelemetryPlugin(config);
      plugin.apply(emitter);

      await emitter.emit('command:start', {
        command: 'generate',
        options: {},
        timestamp: Date.now(),
        traceId: 'test-trace-123'
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      expect(fs.existsSync(telemetryFile)).toBe(false);
    });

    it('should respect environment variable XRAY_TELEMETRY_ENABLED', async () => {
      process.env.XRAY_TELEMETRY_ENABLED = 'true';

      const config: TelemetryConfig = {
        projectRoot: tmpDir
      };

      plugin = new TelemetryPlugin(config);
      plugin.apply(emitter);

      await emitter.emit('command:start', {
        command: 'generate',
        options: {},
        timestamp: Date.now(),
        traceId: 'test-trace-123'
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      expect(fs.existsSync(telemetryFile)).toBe(true);

      delete process.env.XRAY_TELEMETRY_ENABLED;
    });
  });

  describe('resource attributes', () => {
    it('should include service information', async () => {
      const config: TelemetryConfig = {
        enabled: true,
        projectRoot: tmpDir
      };

      plugin = new TelemetryPlugin(config);
      plugin.apply(emitter);

      await emitter.emit('command:start', {
        command: 'generate',
        options: {},
        timestamp: Date.now(),
        traceId: 'test-trace-123'
      });

      plugin.shutdown();

      const telemetryFile = projectTelemetryPath(tmpDir)!;
      const content = fs.readFileSync(telemetryFile, 'utf-8');
      const events = content.trim().split('\n').map(line => JSON.parse(line));

      const event = events[0];
      expect(event.resource).toMatchObject({
        'service.name': 'xray-cli',
        'service.version': expect.any(String)
      });
    });
  });

  describe('forced off beats enabled: true', () => {
    const record = async () => {
      plugin = new TelemetryPlugin({ enabled: true, projectRoot: tmpDir });
      plugin.apply(emitter);
      await emitter.emit('command:start', {
        command: 'map', options: {}, timestamp: Date.now(), traceId: 't',
      });
      plugin.trackStat('files', 1);
      plugin.shutdown();
      return fs.existsSync(projectTelemetryPath(tmpDir)!);
    };

    it('records on an interactive run (control)', async () => {
      expect(await record()).toBe(true);
    });

    it('stdout not a TTY', async () => {
      (process.stdout as { isTTY?: boolean }).isTTY = false;
      expect(await record()).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.xray'))).toBe(false);
      expect(fs.existsSync(path.dirname(projectTelemetryPath(tmpDir)!))).toBe(false);
    });

    it.each([['XRAY_NO_TELEMETRY'], ['DO_NOT_TRACK'], ['CI']])('%s=1', async (k) => {
      process.env[k] = '1';
      expect(await record()).toBe(false);
    });
  });
});
