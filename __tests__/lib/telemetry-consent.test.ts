import {
  hasConsentDecision,
  isTelemetryDisabledByFlag,
  handleFirstRunConsent,
  saveConsentDecision
} from '../../src/lib/telemetry-consent';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

// Mock readline to avoid interactive prompts in tests
const mockQuestion = jest.fn((q: string, cb: (answer: string) => void) => cb('n'));
const mockClose = jest.fn();

jest.mock('readline', () => ({
  createInterface: jest.fn(() => ({
    question: mockQuestion,
    close: mockClose
  }))
}));

// kit tui pulls ESM-only deps jest cannot load; output styling is irrelevant here
jest.mock('../../src/lib/tui', () => {
  const id = (t: string) => t;
  return {
    styles: () => ({ bold: id, accent: id, muted: id, warn: id }),
    statusLine: (t: string) => t,
  };
});

describe('TelemetryConsent', () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalStdin: any;
  let originalStdout: any;
  let xdgHome: string;
  let savedXdg: string | undefined;
  let savedHome: string | undefined;
  const globalFile = () => path.join(xdgHome, 'xray', 'config.json');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-consent-test-'));
    // Never touch the real user config: point global lookup at a temp dir.
    xdgHome = path.join(tmpDir, 'xdg');
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = xdgHome;
    process.env.HOME = path.join(tmpDir, 'home');
    fs.mkdirSync(process.env.HOME, { recursive: true });
    tmpDir = path.join(tmpDir, 'proj');
    fs.mkdirSync(tmpDir);
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Mock TTY for interactive tests
    originalStdin = process.stdin.isTTY;
    originalStdout = process.stdout.isTTY;
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;

    // Reset mocks (jest config resets implementations between tests)
    (readline.createInterface as jest.Mock).mockImplementation(() => ({
      question: mockQuestion,
      close: mockClose
    }));
    mockQuestion.mockClear();
    mockClose.mockClear();
    mockQuestion.mockImplementation((q: string, cb: (answer: string) => void) => cb('n'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(path.dirname(tmpDir), { recursive: true, force: true });
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;

    // Restore TTY
    process.stdin.isTTY = originalStdin;
    process.stdout.isTTY = originalStdout;

    // Clear any CI env vars set during tests
    delete process.env.CI;
  });

  describe('hasConsentDecision', () => {
    it('should return false when no config exists', () => {
      expect(hasConsentDecision()).toBe(false);
    });

    it('should return true when telemetry config exists (enabled)', () => {
      const configPath = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(configPath, JSON.stringify({
        telemetry: { enabled: true }
      }));

      expect(hasConsentDecision()).toBe(true);
    });

    it('should return true when telemetry config exists (disabled)', () => {
      const configPath = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(configPath, JSON.stringify({
        telemetry: { enabled: false }
      }));

      expect(hasConsentDecision()).toBe(true);
    });

    it('should return false when config exists without telemetry setting', () => {
      const configPath = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(configPath, JSON.stringify({
        paths: ['./src']
      }));

      expect(hasConsentDecision()).toBe(false);
    });
  });

  describe('isTelemetryDisabledByFlag', () => {
    it('should return true when --no-telemetry is present', () => {
      const argv = ['node', 'xray', 'map', '--no-telemetry'];
      expect(isTelemetryDisabledByFlag(argv)).toBe(true);
    });

    it('should return false when --no-telemetry is not present', () => {
      const argv = ['node', 'xray', 'map'];
      expect(isTelemetryDisabledByFlag(argv)).toBe(false);
    });

    it('should work with flag at different positions', () => {
      const argv1 = ['node', 'xray', '--no-telemetry', 'map'];
      const argv2 = ['node', 'xray', 'map', '--path', './src', '--no-telemetry'];

      expect(isTelemetryDisabledByFlag(argv1)).toBe(true);
      expect(isTelemetryDisabledByFlag(argv2)).toBe(true);
    });
  });

  describe('saveConsentDecision', () => {
    it('persists to the global user config, never the cwd', () => {
      saveConsentDecision(true);

      expect(JSON.parse(fs.readFileSync(globalFile(), 'utf-8')))
        .toEqual({ telemetry: { enabled: true } });
      expect(fs.existsSync(path.join(tmpDir, '.xrayrc.json'))).toBe(false);
      expect(fs.readdirSync(tmpDir)).toEqual([]);
    });

    it('preserves other keys of an existing global config', () => {
      fs.mkdirSync(path.dirname(globalFile()), { recursive: true });
      fs.writeFileSync(globalFile(), JSON.stringify({ limit: 4096 }));

      saveConsentDecision(false);

      expect(JSON.parse(fs.readFileSync(globalFile(), 'utf-8')))
        .toEqual({ limit: 4096, telemetry: { enabled: false } });
    });

    it('does not modify an existing project config', () => {
      const projectFile = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(projectFile, JSON.stringify({ paths: ['./src'] }));

      saveConsentDecision(true);

      expect(JSON.parse(fs.readFileSync(projectFile, 'utf-8'))).toEqual({ paths: ['./src'] });
    });

    it('does not seed paths', () => {
      saveConsentDecision(false);
      expect(JSON.parse(fs.readFileSync(globalFile(), 'utf-8')).paths).toBeUndefined();
    });

    it('is visible to hasConsentDecision from any project', () => {
      saveConsentDecision(false);
      expect(hasConsentDecision()).toBe(true);
    });

    it('skips a non-writable (JS) global config instead of shadowing it', () => {
      const js = path.join(xdgHome, 'xray', 'config.js');
      fs.mkdirSync(path.dirname(js), { recursive: true });
      fs.writeFileSync(js, 'module.exports = {};\n');

      saveConsentDecision(true);

      expect(fs.existsSync(globalFile())).toBe(false);
      expect(fs.readFileSync(js, 'utf-8')).toBe('module.exports = {};\n');
    });
  });

  describe('handleFirstRunConsent', () => {
    it('should return false when --no-telemetry flag is present', async () => {
      const argv = ['node', 'xray', 'map', '--no-telemetry'];
      const result = await handleFirstRunConsent(argv);
      expect(result).toBe(false);
    });

    it('should return existing decision when config exists', async () => {
      const configPath = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(configPath, JSON.stringify({
        telemetry: { enabled: true }
      }));

      const argv = ['node', 'xray', 'map'];
      const result = await handleFirstRunConsent(argv);
      expect(result).toBe(true);
    });

    it('should return false in non-interactive mode (no TTY)', async () => {
      process.stdin.isTTY = false;
      process.stdout.isTTY = false;

      const argv = ['node', 'xray', 'map'];
      const result = await handleFirstRunConsent(argv);

      expect(result).toBe(false);

      // Nothing persisted: a later interactive run must still ask
      expect(fs.existsSync(globalFile())).toBe(false);
      expect(fs.readdirSync(tmpDir)).toEqual([]);
    });

    it('should return false in CI environment', async () => {
      process.env.CI = 'true';

      const argv = ['node', 'xray', 'map'];
      const result = await handleFirstRunConsent(argv);

      expect(result).toBe(false);
      expect(fs.existsSync(globalFile())).toBe(false);
      expect(fs.readdirSync(tmpDir)).toEqual([]);
    });

    it('should detect various CI environment variables', async () => {
      const ciVars = ['GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'JENKINS_URL'];

      for (const envVar of ciVars) {
        // Clean up between iterations
        if (fs.existsSync(path.join(tmpDir, '.xrayrc.json'))) {
          fs.unlinkSync(path.join(tmpDir, '.xrayrc.json'));
        }

        process.env[envVar] = 'true';

        const argv = ['node', 'xray', 'map'];
        const result = await handleFirstRunConsent(argv);

        expect(result).toBe(false);

        delete process.env[envVar];
      }
    });

    it('prompts once, stores globally, then never asks again (any project)', async () => {
      const argv = ['node', 'xray', 'map'];
      mockQuestion.mockImplementation((q: string, cb: (a: string) => void) => cb('y'));

      expect(await handleFirstRunConsent(argv)).toBe(true);
      expect(mockQuestion).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fs.readFileSync(globalFile(), 'utf-8')).telemetry).toEqual({ enabled: true });
      expect(fs.readdirSync(tmpDir)).toEqual([]);

      // Same project again, and a different project: no prompt, same answer
      const other = fs.mkdtempSync(path.join(path.dirname(tmpDir), 'other-'));
      process.chdir(other);
      expect(await handleFirstRunConsent(argv)).toBe(true);
      expect(await handleFirstRunConsent(argv, path.join(other, 'missing.json'))).toBe(true);
      expect(mockQuestion).toHaveBeenCalledTimes(1);
      expect(fs.readdirSync(other)).toEqual([]);
    });

    it('stores a refusal globally and does not re-ask', async () => {
      const argv = ['node', 'xray', 'map'];
      expect(await handleFirstRunConsent(argv)).toBe(false);
      expect(await handleFirstRunConsent(argv)).toBe(false);
      expect(mockQuestion).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fs.readFileSync(globalFile(), 'utf-8')).telemetry).toEqual({ enabled: false });
    });

    it('re-asks after the global config is deleted', async () => {
      const argv = ['node', 'xray', 'map'];
      await handleFirstRunConsent(argv);
      fs.rmSync(globalFile());
      await handleFirstRunConsent(argv);
      expect(mockQuestion).toHaveBeenCalledTimes(2);
    });

    it('asks interactively after a non-interactive run stored nothing', async () => {
      const argv = ['node', 'xray', 'map'];
      process.stdin.isTTY = false;
      expect(await handleFirstRunConsent(argv)).toBe(false);
      process.stdin.isTTY = true;
      await handleFirstRunConsent(argv);
      expect(mockQuestion).toHaveBeenCalledTimes(1);
    });

    it('project telemetry setting wins over global and skips the prompt', async () => {
      fs.mkdirSync(path.dirname(globalFile()), { recursive: true });
      fs.writeFileSync(globalFile(), JSON.stringify({ telemetry: { enabled: false } }));
      fs.writeFileSync(path.join(tmpDir, '.xrayrc.json'), JSON.stringify({ telemetry: { enabled: true } }));

      expect(await handleFirstRunConsent(['node', 'xray', 'map'])).toBe(true);
      expect(mockQuestion).not.toHaveBeenCalled();
    });

    it('explicit --config telemetry wins over global; never written when absent', async () => {
      const explicit = path.join(tmpDir, 'explicit.json');
      fs.mkdirSync(path.dirname(globalFile()), { recursive: true });
      fs.writeFileSync(globalFile(), JSON.stringify({ telemetry: { enabled: false } }));
      fs.writeFileSync(explicit, JSON.stringify({ telemetry: { enabled: true } }));
      expect(await handleFirstRunConsent(['node', 'xray', 'map'], explicit)).toBe(true);

      // explicit without telemetry key: global decision applies, file untouched
      fs.writeFileSync(explicit, JSON.stringify({ limit: 1 }));
      expect(await handleFirstRunConsent(['node', 'xray', 'map'], explicit)).toBe(false);
      expect(JSON.parse(fs.readFileSync(explicit, 'utf-8'))).toEqual({ limit: 1 });
      expect(mockQuestion).not.toHaveBeenCalled();
    });

    it('prompt with explicit --config and no decision writes global only', async () => {
      const explicit = path.join(tmpDir, 'explicit.json');
      fs.writeFileSync(explicit, JSON.stringify({ limit: 1 }));
      await handleFirstRunConsent(['node', 'xray', 'map'], explicit);
      expect(JSON.parse(fs.readFileSync(explicit, 'utf-8'))).toEqual({ limit: 1 });
      expect(JSON.parse(fs.readFileSync(globalFile(), 'utf-8')).telemetry).toEqual({ enabled: false });
    });
  });

  describe('non-interactive detection', () => {
    it('should detect piped input', async () => {
      process.stdin.isTTY = false; // stdin is not a TTY (piped)
      process.stdout.isTTY = true;

      const argv = ['node', 'xray', 'map'];
      const result = await handleFirstRunConsent(argv);

      expect(result).toBe(false);
    });

    it('should detect piped output', async () => {
      process.stdin.isTTY = true;
      process.stdout.isTTY = false; // stdout is not a TTY (piped)

      const argv = ['node', 'xray', 'map'];
      const result = await handleFirstRunConsent(argv);

      expect(result).toBe(false);
    });
  });

  describe('flag precedence', () => {
    it('should respect --no-telemetry even if config says enabled', async () => {
      const configPath = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(configPath, JSON.stringify({
        telemetry: { enabled: true }
      }));

      const argv = ['node', 'xray', 'map', '--no-telemetry'];
      const result = await handleFirstRunConsent(argv);

      expect(result).toBe(false);
    });
  });
});
