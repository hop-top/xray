// Characterization of config discovery + layering precedence. Pins the
// current contract so loader internals can change without behavior drift.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findConfigPath, findGlobalConfigPath, loadConfig } from '../../src/lib/config';

const mockHomedir = jest.fn();
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => mockHomedir(),
}));

function write(file: string, content: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

describe('config precedence (characterization)', () => {
  let home: string;
  let cwd: string;
  const saved = { xdg: process.env.XDG_CONFIG_HOME };

  beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-prec-')));
    mockHomedir.mockReturnValue(home);
    delete process.env.XDG_CONFIG_HOME;
    cwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(home, { recursive: true, force: true });
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
  });

  describe('project discovery', () => {
    it('does not treat a home-dir rc file as a project config', () => {
      write(path.join(home, '.xrayrc.json'), { limit: 1 });
      const proj = path.join(home, 'a', 'b');
      fs.mkdirSync(proj, { recursive: true });
      expect(findConfigPath(proj)).toBeNull();
    });

    it('filename order: .xrayrc > .xrayrc.json > .xrayrc.js > xray.config.js > xray.config.json > package.json', () => {
      const proj = path.join(home, 'p');
      write(path.join(proj, 'package.json'), { xray: { limit: 1 } });
      expect(findConfigPath(proj)).toBe(path.join(proj, 'package.json'));
      const order = ['xray.config.json', 'xray.config.js', '.xrayrc.js', '.xrayrc.json', '.xrayrc'];
      for (const name of order) {
        write(path.join(proj, name), '{}');
        expect(findConfigPath(proj)).toBe(path.join(proj, name));
      }
    });

    it('ignores package.json without an xray key', () => {
      const proj = path.join(home, 'p');
      write(path.join(proj, 'package.json'), { name: 'x' });
      expect(findConfigPath(proj)).toBeNull();
    });
  });

  describe('global discovery', () => {
    it('order: <xdg>/xray/config.json > config.js > ~/.xrayrc.json > ~/.xrayrc', () => {
      const xdg = path.join(home, '.config', 'xray');
      write(path.join(home, '.xrayrc'), '{}');
      expect(findGlobalConfigPath()).toBe(path.join(home, '.xrayrc'));
      write(path.join(home, '.xrayrc.json'), '{}');
      expect(findGlobalConfigPath()).toBe(path.join(home, '.xrayrc.json'));
      write(path.join(xdg, 'config.js'), 'module.exports = {};');
      expect(findGlobalConfigPath()).toBe(path.join(xdg, 'config.js'));
      write(path.join(xdg, 'config.json'), '{}');
      expect(findGlobalConfigPath()).toBe(path.join(xdg, 'config.json'));
    });

    it('XDG_CONFIG_HOME replaces ~/.config', () => {
      write(path.join(home, '.config', 'xray', 'config.json'), '{}');
      const custom = path.join(home, 'custom');
      process.env.XDG_CONFIG_HOME = custom;
      expect(findGlobalConfigPath()).toBeNull();
      write(path.join(custom, 'xray', 'config.json'), '{}');
      expect(findGlobalConfigPath()).toBe(path.join(custom, 'xray', 'config.json'));
    });

    it('kit config dir wins over legacy ~/.config/xray; legacy still found', () => {
      const { configDir } = require('@hop-top/kit/xdg') as { configDir: (t: string) => string };
      const kitDir = configDir('xray');
      const legacy = path.join(home, '.config', 'xray', 'config.json');
      write(legacy, '{}');
      expect(findGlobalConfigPath()).toBe(legacy);
      write(path.join(kitDir, 'config.json'), '{}');
      expect(findGlobalConfigPath()).toBe(path.join(kitDir, 'config.json'));
    });

    it('returns null when nothing exists', () => {
      expect(findGlobalConfigPath()).toBeNull();
    });
  });

  describe('formats', () => {
    it('parses extensionless .xrayrc as JSON', () => {
      const proj = path.join(home, 'p');
      write(path.join(proj, '.xrayrc'), { limit: 77 });
      process.chdir(proj);
      expect(loadConfig()?.limit).toBe(77);
    });

    it('loads .js configs via require (module.exports and default export)', () => {
      const proj = path.join(home, 'p');
      write(path.join(proj, '.xrayrc.js'), 'module.exports = { limit: 11 };');
      process.chdir(proj);
      expect(loadConfig()?.limit).toBe(11);
      const proj2 = path.join(home, 'p2');
      write(path.join(proj2, '.xrayrc.js'), 'module.exports = { default: { limit: 12 } };');
      process.chdir(proj2);
      expect(loadConfig()?.limit).toBe(12);
    });

    it('package.json source yields the whole manifest, not just the xray key', () => {
      const proj = path.join(home, 'p');
      write(path.join(proj, 'package.json'), { name: 'n', xray: { limit: 5 } });
      process.chdir(proj);
      const cfg = loadConfig() as any;
      expect(cfg.name).toBe('n');
      expect(cfg.xray).toEqual({ limit: 5 });
    });

    it('throws on malformed JSON', () => {
      const proj = path.join(home, 'p');
      write(path.join(proj, '.xrayrc.json'), '{"a":1,}');
      process.chdir(proj);
      jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => loadConfig()).toThrow();
    });
  });

  describe('layering', () => {
    function layered(global: object, project: object) {
      write(path.join(home, '.xrayrc.json'), global);
      const proj = path.join(home, 'p');
      write(path.join(proj, '.xrayrc.json'), project);
      process.chdir(proj);
      return loadConfig() as any;
    }

    it('project null/undefined keeps global value', () => {
      expect(layered({ limit: 1, anchor: 'g' }, { limit: null }).limit).toBe(1);
    });

    it('arrays replace, not concat', () => {
      expect(layered({ match: ['a', 'b'] }, { match: ['c'] }).match).toEqual(['c']);
    });

    it('object merge is one level deep; nested objects replace', () => {
      const cfg = layered(
        { scopes: { s: { paths: ['g'], limit: 1 }, t: { paths: ['t'] } } },
        { scopes: { s: { paths: ['p'] } } }
      );
      expect(cfg.scopes).toEqual({ s: { paths: ['p'] }, t: { paths: ['t'] } });
    });

    it('extensions merge per-extension: hints union, surfaces + config merged', () => {
      const cfg = layered(
        { extensions: { e: { hints: ['a'], enabledSurfaces: { x: true }, config: { k: 1 }, mode: 'g' }, f: { hints: ['z'] } } },
        { extensions: { e: { hints: ['a', 'b'], enabledSurfaces: { y: false }, config: { j: 2 } } } }
      );
      expect(cfg.extensions).toEqual({
        e: { hints: ['a', 'b'], enabledSurfaces: { x: true, y: false }, config: { k: 1, j: 2 }, mode: 'g' },
        f: { hints: ['z'] },
      });
    });

    it('explicit path: no layering; missing explicit path -> null', () => {
      write(path.join(home, '.xrayrc.json'), { limit: 1, anchor: 'g' });
      const explicit = write(path.join(home, 'x.json'), { limit: 2 });
      expect(loadConfig(explicit)).toEqual({ limit: 2 });
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(loadConfig(path.join(home, 'nope.json'))).toBeNull();
    });
  });
});
