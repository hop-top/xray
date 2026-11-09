/**
 * A repo's config must not reach outside the project: `output`, `share`,
 * `paths` and `queries` that resolve (symlinks included) outside the
 * directory of the config file supplying them are a usage error, unless
 * the command line gives the value. The user's global config is exempt.
 * Drives the built CLI in throwaway projects with their own
 * config/cache/state dirs.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertConfigConfined, loadConfig } from '../src/lib/config';

const CLI = path.join(__dirname, '../bin/cli.js');

describe('config paths stay inside their project', () => {
  let base: string;
  let home: string;
  let env: NodeJS.ProcessEnv;
  let n = 0;

  /** A project with one source file, a sibling `outside` tree and an empty `cfgout`. */
  const layout = () => {
    const root = path.join(base, `case-${n++}`);
    const proj = path.join(root, 'proj');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'cfgout'));
    fs.writeFileSync(path.join(proj, 'src/a.ts'), 'export const insideMarker = 1;\n');
    fs.writeFileSync(path.join(outside, 'src/s.ts'), 'export const outsideSecret = 2;\n');
    return { root, proj, outside, cfgout: path.join(root, 'cfgout') };
  };
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
  const rc = (proj: string, config: unknown, name = '.xrayrc.json') =>
    fs.writeFileSync(path.join(proj, name), JSON.stringify(config));
  const entries = (dir: string) => fs.readdirSync(dir);

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'config-confine-')));
    const sub = (d: string) => {
      const p = path.join(base, '.env', d);
      fs.mkdirSync(p, { recursive: true });
      return p;
    };
    home = sub('home');
    env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: sub('config'),
      XDG_CACHE_HOME: sub('cache'),
      XDG_STATE_HOME: sub('state'),
      XDG_DATA_HOME: sub('data'),
      XRAY_LANG_DIR: sub('lang'),
      NO_COLOR: '1',
      XRAY_NO_TELEMETRY: '1',
    };
    delete env.XRAY_ALLOW_PROJECT_STRATEGIES;
  });

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
  afterEach(() => {
    for (const f of ['.xrayrc.json', '.xrayrc']) fs.rmSync(path.join(home, f), { force: true });
  });

  describe('output', () => {
    it.each(['.xrayrc', '.xrayrc.json', 'xray.config.json'])('%s: refused, exit 2, names file, key and resolved path', (name) => {
      const { proj, cfgout } = layout();
      rc(proj, { output: '../cfgout/evil.sh' }, name);
      const r = run(proj, 'map');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(path.join(proj, name));
      expect(r.stderr).toContain('output');
      expect(r.stderr).toContain(path.join(cfgout, 'evil.sh'));
      expect(r.stderr).toContain('-o/--output');
      expect(entries(cfgout)).toEqual([]);
    });

    it('package.json with an xray key: refused too', () => {
      const { proj, cfgout } = layout();
      fs.writeFileSync(
        path.join(proj, 'package.json'),
        JSON.stringify({ name: 'p', xray: { output: '../cfgout/evil.sh' } })
      );
      const r = run(proj, 'map');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(path.join(proj, 'package.json'));
      expect(r.stderr).toContain('output');
      expect(entries(cfgout)).toEqual([]);
    });

    it('package.json: a top-level output of the manifest is not config', () => {
      const { proj, cfgout } = layout();
      fs.writeFileSync(
        path.join(proj, 'package.json'),
        JSON.stringify({ name: 'p', xray: {}, output: '../cfgout/evil.sh' })
      );
      const r = run(proj, 'map');
      expect(r.status).toBe(0);
      expect(entries(cfgout)).toEqual([]);
    });

    it('an absolute output elsewhere is refused', () => {
      const { proj, cfgout } = layout();
      rc(proj, { output: path.join(cfgout, 'abs.txt') });
      expect(run(proj, 'map').status).toBe(2);
      expect(entries(cfgout)).toEqual([]);
    });

    it('an output through a symlink leaving the project is refused', () => {
      const { proj, cfgout } = layout();
      fs.symlinkSync(cfgout, path.join(proj, 'link'));
      rc(proj, { output: 'link/evil.txt' });
      expect(run(proj, 'map').status).toBe(2);
      expect(entries(cfgout)).toEqual([]);
    });

    it('--format json: the existing error envelope, exit 2', () => {
      const { proj } = layout();
      rc(proj, { output: '../cfgout/evil.sh' });
      const r = run(proj, 'map', '--format', 'json');
      expect(r.status).toBe(2);
      const err = JSON.parse(r.stderr);
      expect(err).toMatchObject({ code: 'USAGE', exit_code: 2 });
      expect(err.message).toContain('output');
    });

    it('--dry-run refuses too', () => {
      const { proj } = layout();
      rc(proj, { output: '../cfgout/evil.sh' });
      expect(run(proj, 'map', '--dry-run').status).toBe(2);
    });

    it('an output inside the project is fine, also from a subdirectory', () => {
      const { proj } = layout();
      fs.mkdirSync(path.join(proj, 'sub'));
      rc(proj, { output: 'build/out.txt' });
      const r = run(path.join(proj, 'sub'), 'map', '--format', 'json');
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(proj, 'build/out.txt'))).toBe(true);
    });

    it('-o on the command line is unrestricted', () => {
      const { proj, cfgout } = layout();
      rc(proj, { output: '../cfgout/evil.sh' });
      const r = run(proj, 'map', '--format', 'json', '-o', '../cfgout/mine.json');
      expect(r.status).toBe(0);
      expect(entries(cfgout)).toEqual(['mine.json']);
    });

    it('--output on the command line is unrestricted for a lens and a scope too', () => {
      const { proj, cfgout } = layout();
      rc(proj, {
        lenses: { l: { output: '../cfgout/evil.sh' } },
        scopes: { s: { output: '../cfgout/evil2.sh' } },
      });
      expect(run(proj, 'map', '--lens', 'l', '--format', 'json', '--output', '../cfgout/a.json').status).toBe(0);
      expect(run(proj, 'map', '--scope', 's', '--format', 'json', '--output', '../cfgout/b.json').status).toBe(0);
      expect(entries(cfgout).sort()).toEqual(['a.json', 'b.json']);
    });

    it('lens: only the selected lens is checked', () => {
      const { proj, cfgout } = layout();
      rc(proj, { lenses: { bad: { output: '../cfgout/evil.sh' }, good: { output: 'good.json' } } });
      const refused = run(proj, 'map', '--lens', 'bad', '--format', 'json');
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain('lenses.bad.output');
      expect(run(proj, 'map', '--lens', 'good', '--format', 'json').status).toBe(0);
      expect(run(proj, 'map', '--format', 'json').status).toBe(0);
      expect(entries(cfgout)).toEqual([]);
    });

    it('scope: only the selected scope is checked', () => {
      const { proj, cfgout } = layout();
      rc(proj, { scopes: { bad: { output: '../cfgout/evil.sh' }, good: { output: 'good.json' } } });
      const refused = run(proj, 'map', '--scope', 'bad', '--format', 'json');
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain('scopes.bad.output');
      expect(run(proj, 'map', '--scope', 'good', '--format', 'json').status).toBe(0);
      expect(entries(cfgout)).toEqual([]);
    });

    it('--all-scopes checks every scope', () => {
      const { proj, cfgout } = layout();
      rc(proj, { scopes: { good: { output: 'good.json' }, bad: { output: '../cfgout/evil.sh' } } });
      const r = run(proj, 'map', '--all-scopes', '--format', 'json');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('scopes.bad.output');
      expect(entries(cfgout)).toEqual([]);
    });

    it('--all-scopes with -o or --path is a usage error, text and json', () => {
      const { proj, cfgout } = layout();
      rc(proj, { scopes: { good: { output: 'good.json' } } });
      for (const [flag, value] of [['-o', '../cfgout/mine.json'], ['--output', 'x.json'], ['--path', 'src']]) {
        const text = run(proj, 'map', '--all-scopes', flag, value);
        expect(text.status).toBe(2);
        expect(text.stderr).toContain('--all-scopes');
        const json = run(proj, 'map', '--all-scopes', '--format', 'json', flag, value);
        expect(json.status).toBe(2);
        expect(JSON.parse(json.stderr)).toMatchObject({ code: 'USAGE', exit_code: 2 });
      }
      expect(entries(cfgout)).toEqual([]);
      expect(fs.existsSync(path.join(proj, 'good.json'))).toBe(false);
    });

    it('--all-scopes with every scope inside the project runs', () => {
      const { proj } = layout();
      rc(proj, { scopes: { one: { output: 'one.json' }, two: { output: 'two.json' } } });
      const r = run(proj, 'map', '--all-scopes', '--format', 'json');
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(proj, 'one.json'))).toBe(true);
      expect(fs.existsSync(path.join(proj, 'two.json'))).toBe(true);
    });

    it('the message is terminal-safe: a control sequence in a key never reaches the terminal raw', () => {
      const { proj } = layout();
      rc(proj, { scopes: { 'x\u001b[31mred': { output: '../cfgout/e.sh' } } });
      const r = run(proj, 'map', '--all-scopes');
      expect(r.status).toBe(2);
      expect(r.stderr).not.toContain('\u001b');
      expect(r.stderr).toContain('\\x1b');
    });
  });

  describe('share', () => {
    it('a string share path outside is refused; --share on the command line wins', () => {
      const { proj, cfgout } = layout();
      rc(proj, { share: '../cfgout/share.md' });
      const r = run(proj, 'map');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('share');
      expect(entries(cfgout)).toEqual([]);
      expect(run(proj, 'map', '--share', 'ok-share.md').status).toBe(0);
      expect(fs.existsSync(path.join(proj, 'ok-share.md'))).toBe(true);
    });
  });

  describe('paths', () => {
    it('an absolute path elsewhere is refused and not analyzed', () => {
      const { proj, outside } = layout();
      rc(proj, { paths: [outside] });
      const r = run(proj, 'map', '--format', 'json', '-o', 'o.json');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(path.join(proj, '.xrayrc.json'));
      expect(r.stderr).toContain('paths[0]');
      expect(r.stderr).toContain(outside);
      expect(r.stderr).toContain('--path');
      expect(fs.existsSync(path.join(proj, 'o.json'))).toBe(false);
    });

    it('a relative ../ path is refused', () => {
      const { proj } = layout();
      rc(proj, { paths: ['src', '../outside'] });
      const r = run(proj, 'map', '--format', 'json', '-o', 'o.json');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('paths[1]');
    });

    it('a symlink inside the project pointing outside is refused', () => {
      const { proj, outside } = layout();
      fs.symlinkSync(outside, path.join(proj, 'linked'));
      rc(proj, { paths: ['linked'] });
      const r = run(proj, 'map', '--format', 'json', '-o', 'o.json');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(outside);
    });

    it('paths inside the project are fine', () => {
      const { proj } = layout();
      rc(proj, { paths: ['src', '.'] });
      expect(run(proj, 'map', '--format', 'json', '-o', 'o.json').status).toBe(0);
    });

    it('--path and positional roots on the command line are unrestricted', () => {
      const { proj, outside } = layout();
      rc(proj, { paths: [outside] });
      const a = run(proj, 'map', '--format', 'json', '-o', 'a.json', '--path', outside);
      expect(a.status).toBe(0);
      expect(fs.readFileSync(path.join(proj, 'a.json'), 'utf8')).toContain('outsideSecret');
      const b = run(proj, 'map', outside, '--format', 'json', '-o', 'b.json');
      expect(b.status).toBe(0);
      // The config is found from the root given (walk up) and its paths are replaced.
      const c = run(proj, 'map', 'src', '--format', 'json', '-o', 'c.json');
      expect(c.status).toBe(0);
      expect(fs.readFileSync(path.join(proj, 'c.json'), 'utf8')).not.toContain('outsideSecret');
      expect(run(proj, 'map', '--format', 'json', '-o', 'd.json', '--path', 'src').status).toBe(0);
    });

    it('lens and scope paths are checked when selected', () => {
      const { proj, outside } = layout();
      rc(proj, {
        lenses: { l: { paths: [outside] } },
        scopes: { s: { paths: [outside] }, ok: { paths: ['src'], output: 'ok.json' } },
      });
      const lens = run(proj, 'map', '--lens', 'l', '--format', 'json', '-o', 'o.json');
      expect(lens.status).toBe(2);
      expect(lens.stderr).toContain('lenses.l.paths[0]');
      const scope = run(proj, 'map', '--scope', 's', '--format', 'json');
      expect(scope.status).toBe(2);
      expect(scope.stderr).toContain('scopes.s.paths[0]');
      expect(run(proj, 'map', '--scope', 'ok', '--format', 'json').status).toBe(0);
      const all = run(proj, 'map', '--all-scopes', '--format', 'json');
      expect(all.status).toBe(2);
      expect(all.stderr).toContain('scopes.s.paths[0]');
    });

    it('--config: the project is the directory of that file', () => {
      const { proj, outside, root } = layout();
      const cfgDir = path.join(root, 'cfgdir');
      fs.mkdirSync(path.join(cfgDir, 'inner'), { recursive: true });
      fs.writeFileSync(path.join(cfgDir, 'inner/i.ts'), 'export const i = 1;\n');
      const cfg = path.join(cfgDir, 'elsewhere.json');
      fs.writeFileSync(cfg, JSON.stringify({ paths: [outside] }));
      const r = run(proj, '--config', cfg, 'map', '--format', 'json', '-o', 'o.json');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(cfg);
      fs.writeFileSync(cfg, JSON.stringify({ paths: ['inner'] }));
      expect(run(proj, '--config', cfg, 'map', '--format', 'json', '-o', 'o.json').status).toBe(0);
    });

    it('--config reached through a symlinked directory: the project is its real location', () => {
      const { root, proj } = layout();
      const link = path.join(root, 'link');
      fs.symlinkSync(proj, link);
      rc(proj, { paths: ['src'], output: 'via-link.json' });
      const r = run(proj, '--config', path.join(link, '.xrayrc.json'), 'map', '--format', 'json');
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(proj, 'via-link.json'))).toBe(true);
    });

    it('impact: refused too, but its unused output key is not checked', () => {
      const { proj, outside } = layout();
      rc(proj, { output: '../cfgout/evil.sh' });
      const fine = run(proj, 'impact', 'insideMarker');
      expect(fine.stderr).not.toContain('outside the project');
      rc(proj, { paths: [outside] });
      const r = run(proj, 'impact', 'outsideSecret');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('paths[0]');
    });
  });

  describe('queries', () => {
    it.each([['../outside/q.scm'], ['.ts:../outside/q.scm'], ['src/ok.scm,../outside/q.scm']])(
      'a query file outside (%s) is refused; --query on the command line wins',
      (entry) => {
        const { proj, outside } = layout();
        fs.writeFileSync(path.join(outside, 'q.scm'), '(identifier) @x\n');
        rc(proj, { queries: [entry] });
        const r = run(proj, 'map', '--format', 'json', '-o', 'o.json');
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('queries[0]');
        expect(r.stderr).toContain(path.join(outside, 'q.scm'));
        expect(r.stderr).toContain('--query');
        expect(run(proj, 'map', '--format', 'json', '-o', 'o.json', '--query', path.join(outside, 'q.scm')).status).toBe(0);
      }
    );
  });

  describe('the user global config is their own choice', () => {
    it('~/.xrayrc.json may set output and paths anywhere', () => {
      const { proj, cfgout, outside } = layout();
      fs.writeFileSync(
        path.join(home, '.xrayrc.json'),
        JSON.stringify({ output: path.join(cfgout, 'home.json'), paths: [outside] })
      );
      const r = run(proj, 'map', '--format', 'json');
      expect(r.status).toBe(0);
      expect(entries(cfgout)).toEqual(['home.json']);
      expect(fs.readFileSync(path.join(cfgout, 'home.json'), 'utf8')).toContain('outsideSecret');
    });

    it('a project config still cannot do it while a global config exists', () => {
      const { proj, cfgout } = layout();
      fs.writeFileSync(path.join(home, '.xrayrc.json'), JSON.stringify({ limit: 2048 }));
      rc(proj, { output: '../cfgout/evil.sh' });
      expect(run(proj, 'map').status).toBe(2);
      expect(entries(cfgout)).toEqual([]);
    });
  });

  describe('assertConfigConfined / loadConfig', () => {
    const all = { paths: true, output: true, queries: true, share: true };

    it('judges a still-relative output against the config file directory, not the working directory', () => {
      const { proj } = layout();
      const file = path.join(proj, '.xrayrc.json');
      const cwd = process.cwd();
      try {
        process.chdir(path.join(proj, 'src'));
        expect(() => assertConfigConfined({ output: 'build/x.txt' }, file, all)).not.toThrow();
        expect(() => assertConfigConfined({ output: '../x.txt' }, file, all)).toThrow(/outside the project/);
      } finally {
        process.chdir(cwd);
      }
    });

    it('does not check a key the caller marks as given on the command line', () => {
      const { proj } = layout();
      const file = path.join(proj, '.xrayrc.json');
      const cfg = { output: '/elsewhere/x', paths: ['/elsewhere'], queries: ['/elsewhere/q.scm'], share: '/elsewhere/s.md' };
      expect(() => assertConfigConfined(cfg, file, { paths: false, output: false, queries: false, share: false })).not.toThrow();
      expect(() => assertConfigConfined(cfg, file, { ...all, output: false, queries: false, share: false })).toThrow(/paths\[0\]/);
    });

    it('loadConfig leaves the config alone without confine', () => {
      const { proj } = layout();
      rc(proj, { output: '../cfgout/evil.sh' });
      expect(loadConfig(path.join(proj, '.xrayrc.json'), undefined, { resolvePaths: true })).not.toBeNull();
      expect(() =>
        loadConfig(path.join(proj, '.xrayrc.json'), undefined, { resolvePaths: true, confine: all })
      ).toThrow(/outside the project/);
    });
  });
});
