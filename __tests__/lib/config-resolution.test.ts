import { loadConfig, findConfigPath } from '../../src/lib/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock os.homedir before importing config module
const mockHomedir = jest.fn();
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => mockHomedir()
}));

describe('Config Resolution', () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalXdgConfigHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-config-test-'));
    originalCwd = process.cwd();

    // Set mock homedir to tmpDir
    mockHomedir.mockReturnValue(tmpDir);

    // Clear XDG_CONFIG_HOME so tests use tmpDir/.config
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Restore XDG_CONFIG_HOME
    if (originalXdgConfigHome) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
  });

  describe('findConfigPath', () => {
    it('should find config in current directory', () => {
      // Create a project directory (not in home dir)
      const projectDir = path.join(tmpDir, 'my-project');
      fs.mkdirSync(projectDir);

      const configPath = path.join(projectDir, '.xrayrc.json');
      fs.writeFileSync(configPath, JSON.stringify({ paths: ['./src'] }));

      process.chdir(projectDir);
      const found = findConfigPath();

      expect(found).toBe(fs.realpathSync(configPath));
    });

    it('should walk up directory tree to find config', () => {
      // Create nested structure: tmpDir/project/src/nested
      const projectRoot = path.join(tmpDir, 'project');
      const srcDir = path.join(projectRoot, 'src');
      const nestedDir = path.join(srcDir, 'nested');

      fs.mkdirSync(projectRoot);
      fs.mkdirSync(srcDir);
      fs.mkdirSync(nestedDir);

      // Put config at project root
      const configPath = path.join(projectRoot, '.xrayrc.json');
      fs.writeFileSync(configPath, JSON.stringify({ paths: ['./src'] }));

      // Run from nested directory
      process.chdir(nestedDir);
      const found = findConfigPath();

      expect(found).toBe(fs.realpathSync(configPath));
    });

    it('should stop at filesystem root', () => {
      // Run from temp dir with no config
      process.chdir(tmpDir);
      const found = findConfigPath();

      expect(found).toBeNull();
    });

    it('should prefer closer config files', () => {
      // Create nested structure with configs at multiple levels
      const projectRoot = path.join(tmpDir, 'project');
      const subDir = path.join(projectRoot, 'subproject');

      fs.mkdirSync(projectRoot);
      fs.mkdirSync(subDir);

      // Config at project root
      const rootConfig = path.join(projectRoot, '.xrayrc.json');
      fs.writeFileSync(rootConfig, JSON.stringify({ limit: 4096 }));

      // Config at subdirectory
      const subConfig = path.join(subDir, '.xrayrc.json');
      fs.writeFileSync(subConfig, JSON.stringify({ limit: 8192 }));

      // Run from subdirectory - should find closer config
      process.chdir(subDir);
      const found = findConfigPath();

      expect(found).toBe(fs.realpathSync(subConfig));
    });

    it('should check all config filenames in order', () => {
      const projectDir = path.join(tmpDir, 'test-project');
      fs.mkdirSync(projectDir);

      const configPath = path.join(projectDir, 'xray.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ paths: ['./src'] }));

      process.chdir(projectDir);
      const found = findConfigPath();

      expect(found).toBe(fs.realpathSync(configPath));
    });

    it('should find config in package.json', () => {
      const projectDir = path.join(tmpDir, 'npm-project');
      fs.mkdirSync(projectDir);

      const packageJsonPath = path.join(projectDir, 'package.json');
      fs.writeFileSync(packageJsonPath, JSON.stringify({
        name: 'test',
        xray: { paths: ['./src'] }
      }));

      process.chdir(projectDir);
      const found = findConfigPath();

      expect(found).toBe(fs.realpathSync(packageJsonPath));
    });
  });

  describe('global config', () => {
    it('should verify mock homedir is working', () => {
      expect(os.homedir()).toBe(tmpDir);
    });

    it('should load global config from home directory', () => {
      const globalConfig = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(globalConfig, JSON.stringify({
        limit: 2048,
        telemetry: { enabled: false }
      }));

      const projectDir = path.join(tmpDir, 'some-project');
      fs.mkdirSync(projectDir);
      process.chdir(projectDir);

      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config?.limit).toBe(2048);
      expect(config?.telemetry?.enabled).toBe(false);
    });

    it('should load global config from .config/xray directory', () => {
      const configDir = path.join(tmpDir, '.config', 'xray');
      fs.mkdirSync(configDir, { recursive: true });

      const globalConfig = path.join(configDir, 'config.json');
      fs.writeFileSync(globalConfig, JSON.stringify({
        limit: 3096
      }));

      const projectDir = path.join(tmpDir, 'some-project');
      fs.mkdirSync(projectDir);
      process.chdir(projectDir);

      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config?.limit).toBe(3096);
    });

    it('should prefer ~/.config/xray/config.json over ~/.xrayrc.json (XDG)', () => {
      // Create both global configs
      const xrayrc = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(xrayrc, JSON.stringify({ limit: 1000 }));

      const configDir = path.join(tmpDir, '.config', 'xray');
      fs.mkdirSync(configDir, { recursive: true });
      const configJson = path.join(configDir, 'config.json');
      fs.writeFileSync(configJson, JSON.stringify({ limit: 2000 }));

      const projectDir = path.join(tmpDir, 'some-project');
      fs.mkdirSync(projectDir);
      process.chdir(projectDir);

      const config = loadConfig();

      expect(config?.limit).toBe(2000); // Should prefer XDG config
    });

    it('should respect XDG_CONFIG_HOME environment variable', () => {
      const customConfigHome = path.join(tmpDir, 'custom-config');
      fs.mkdirSync(customConfigHome, { recursive: true });

      const xrayConfigDir = path.join(customConfigHome, 'xray');
      fs.mkdirSync(xrayConfigDir);

      const configPath = path.join(xrayConfigDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ limit: 5555 }));

      // Set XDG_CONFIG_HOME
      const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = customConfigHome;

      const projectDir = path.join(tmpDir, 'some-project');
      fs.mkdirSync(projectDir);
      process.chdir(projectDir);

      const config = loadConfig();

      // Restore original env
      if (originalXdgConfigHome) {
        process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      } else {
        delete process.env.XDG_CONFIG_HOME;
      }

      expect(config).toBeDefined();
      expect(config?.limit).toBe(5555);
    });
  });

  describe('config merging', () => {
    it('should merge project config with global config', () => {
      // Global config
      const globalConfig = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(globalConfig, JSON.stringify({
        limit: 2048,
        telemetry: { enabled: false },
        match: ['*.ts']
      }));

      // Project config
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);
      const projectConfig = path.join(projectDir, '.xrayrc.json');
      fs.writeFileSync(projectConfig, JSON.stringify({
        limit: 8192,
        paths: ['./src']
      }));

      process.chdir(projectDir);
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config?.limit).toBe(8192); // Project overrides
      expect(config?.paths).toEqual(['./src']); // From project
      expect(config?.telemetry?.enabled).toBe(false); // From global
      expect(config?.match).toEqual(['*.ts']); // From global
    });

    it('should allow project config to override global telemetry', () => {
      // Global: telemetry enabled
      const globalConfig = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(globalConfig, JSON.stringify({
        telemetry: { enabled: true }
      }));

      // Project: telemetry disabled
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);
      const projectConfig = path.join(projectDir, '.xrayrc.json');
      fs.writeFileSync(projectConfig, JSON.stringify({
        telemetry: { enabled: false }
      }));

      process.chdir(projectDir);
      const config = loadConfig();

      expect(config?.telemetry?.enabled).toBe(false); // Project overrides
    });

    it('should deep merge nested objects', () => {
      // Global config
      const globalConfig = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(globalConfig, JSON.stringify({
        features: {
          vars: true,
          incs: false,
          docs: true
        }
      }));

      // Project config - only override some features
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);
      const projectConfig = path.join(projectDir, '.xrayrc.json');
      fs.writeFileSync(projectConfig, JSON.stringify({
        features: {
          incs: true
        }
      }));

      process.chdir(projectDir);
      const config = loadConfig();

      expect(config?.features).toEqual({
        vars: true,  // From global
        incs: true,  // Overridden by project
        docs: true   // From global
      });
    });

    it('should handle missing global config gracefully', () => {
      // No global config
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);
      const projectConfig = path.join(projectDir, '.xrayrc.json');
      fs.writeFileSync(projectConfig, JSON.stringify({
        limit: 5000
      }));

      process.chdir(projectDir);
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config?.limit).toBe(5000);
    });

    it('should handle missing project config gracefully', () => {
      // Only global config
      const globalConfig = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(globalConfig, JSON.stringify({
        limit: 3000
      }));

      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);

      process.chdir(projectDir);
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config?.limit).toBe(3000);
    });
  });

  describe('explicit config path', () => {
    it('should use explicit path and ignore global/project configs', () => {
      // Global config
      const globalConfig = path.join(tmpDir, '.xrayrc.json');
      fs.writeFileSync(globalConfig, JSON.stringify({ limit: 1000 }));

      // Explicit config
      const explicitConfig = path.join(tmpDir, 'custom-config.json');
      fs.writeFileSync(explicitConfig, JSON.stringify({ limit: 9999 }));

      const config = loadConfig(explicitConfig);

      expect(config).toBeDefined();
      expect(config?.limit).toBe(9999); // Only explicit config, no merging
    });
  });
});

describe('loadConfig never runs project code', () => {
  let home: string;
  let project: string;
  let marker: string;
  let originalXdgConfigHome: string | undefined;

  beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-config-safe-')));
    mockHomedir.mockReturnValue(home);
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    project = path.join(home, 'project');
    fs.mkdirSync(project);
    marker = path.join(home, 'marker');
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    if (originalXdgConfigHome) process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    else delete process.env.XDG_CONFIG_HOME;
  });

  function writeJsConfig(name: string): void {
    fs.writeFileSync(
      path.join(project, name),
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n` +
      `module.exports = { aliases: { rc: 'react components' } };\n`
    );
  }

  it.each(['.xrayrc.js', 'xray.config.js'])('does not execute project %s', (name) => {
    writeJsConfig(name);
    fs.mkdirSync(path.join(home, '.config', 'xray'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.config', 'xray', 'config.json'),
      JSON.stringify({ aliases: { g: 'react hooks' } })
    );

    const config = loadConfig(undefined, project);
    expect(fs.existsSync(marker)).toBe(false);
    expect(config?.aliases).toEqual({ g: 'react hooks' });
  });

  it('still reads data-only project config', () => {
    fs.writeFileSync(
      path.join(project, '.xrayrc.json'),
      JSON.stringify({ aliases: { rc: 'react components' } })
    );
    const config = loadConfig(undefined, project);
    expect(config?.aliases).toEqual({ rc: 'react components' });
  });

  it('refuses an explicit JS config without running it', () => {
    writeJsConfig('.xrayrc.js');
    expect(() => loadConfig(path.join(project, '.xrayrc.js'))).toThrow(/JavaScript.*\.xrayrc\.json/);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
