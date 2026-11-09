import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * `xray strategy remove` only deletes files from user-managed strategy
 * directories. The CLI under test is a throwaway copy of the build, so a
 * regression deletes from the copy, never from the real `dist`.
 */

const ROOT = path.join(__dirname, '..');

describe('strategy remove never deletes built-in strategies', () => {
  let base: string;
  let cli: string;
  let builtin: string;
  let n = 0;

  const run = (cwd: string, args: string[], extra: Record<string, string> = {}) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      execFile('node', [cli, ...args], {
        cwd,
        env: {
          ...process.env,
          HOME: base,
          XRAY_LANG_DIR: path.join(base, 'lang'),
          XDG_DATA_HOME: path.join(base, 'xdg-data'),
          XDG_CONFIG_HOME: path.join(base, 'xdg-config'),
          XDG_CACHE_HOME: path.join(base, 'xdg-cache'),
          XRAY_ALLOW_PROJECT_STRATEGIES: undefined,
          ...extra,
        } as NodeJS.ProcessEnv,
        timeout: 60000,
      }, (err, stdout, stderr) => {
        resolve({ code: err ? ((err as any).code as number) ?? 1 : 0, out: `${stdout}${stderr}` });
      });
    });

  const project = () => {
    const dir = path.join(base, `proj-${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  beforeAll(() => {
    if (!fs.existsSync(path.join(ROOT, 'dist/index.js'))) {
      throw new Error('dist missing: run `npm run build` first');
    }
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-remove-builtin-'));
    const copy = path.join(base, 'copy');
    fs.mkdirSync(path.join(copy, 'bin'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'dist'), path.join(copy, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'bin/xray'), path.join(copy, 'bin/xray'));
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(copy, 'package.json'));
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(copy, 'node_modules'));
    cli = path.join(copy, 'bin/xray');
    builtin = path.join(copy, 'dist/strategies/react.js');
    if (!fs.existsSync(builtin)) throw new Error('built-in react.js missing from the build copy');
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('remove of a built-in name fails, says so, leaves the file', async () => {
    const r = await run(project(), ['--confirm=yes', 'strategy', 'remove', 'react']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('built-in');
    expect(r.out).toContain('cannot be removed');
    expect(fs.existsSync(builtin)).toBe(true);
  });

  test('a user file of the same name is removed; the built-in stays', async () => {
    const proj = project();
    const file = path.join(proj, '.xray/strategies/react.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'name: react\nversion: 1.0.0\n');
    const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'react']);
    expect(r.code).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(builtin)).toBe(true);
  });

  test('a bare node_modules/<name>.js file is untouched', async () => {
    const proj = project();
    const file = path.join(proj, 'node_modules/barefile.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'module.exports = {};\n');
    const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'barefile']);
    expect(r.code).not.toBe(0);
    expect(fs.existsSync(file)).toBe(true);
  });

  describe('symlinked directories', () => {
    test('.xray/strategies -> built-in dir: built-in intact, reported as built-in', async () => {
      const proj = project();
      fs.mkdirSync(path.join(proj, '.xray'));
      fs.symlinkSync(path.dirname(builtin), path.join(proj, '.xray/strategies'));
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'react']);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('built-in');
      expect(fs.existsSync(builtin)).toBe(true);
    });

    test('.xray/strategies -> outside dir: file kept, not found', async () => {
      const proj = project();
      const outside = path.join(base, `outside-${n++}`);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'foo.yml'), 'name: foo\nversion: 1.0.0\n');
      fs.mkdirSync(path.join(proj, '.xray'));
      fs.symlinkSync(outside, path.join(proj, '.xray/strategies'));
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'foo']);
      expect(r.code).toBe(3);
      expect(r.out).toContain('not found');
      expect(fs.existsSync(path.join(outside, 'foo.yml'))).toBe(true);
    });

    test('.xray itself -> outside dir: file kept, not found', async () => {
      const proj = project();
      const outside = path.join(base, `outside-${n++}`);
      fs.mkdirSync(path.join(outside, 'strategies'), { recursive: true });
      fs.writeFileSync(path.join(outside, 'strategies/foo.yml'), 'name: foo\nversion: 1.0.0\n');
      fs.symlinkSync(outside, path.join(proj, '.xray'));
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'foo']);
      expect(r.code).toBe(3);
      expect(fs.existsSync(path.join(outside, 'strategies/foo.yml'))).toBe(true);
    });

    test('a symlinked file in a normal .xray/strategies: only the link goes', async () => {
      const proj = project();
      const target = path.join(base, `target-${n++}.yml`);
      fs.writeFileSync(target, 'name: foo\nversion: 1.0.0\n');
      fs.mkdirSync(path.join(proj, '.xray/strategies'), { recursive: true });
      const link = path.join(proj, '.xray/strategies/foo.yml');
      fs.symlinkSync(target, link);
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'foo']);
      expect(r.code).toBe(0);
      expect(() => fs.lstatSync(link)).toThrow();
      expect(fs.existsSync(target)).toBe(true);
    });

    const outsideWithFoo = () => {
      const outside = path.join(base, `outside-${n++}`);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'foo.yml'), 'name: foo\nversion: 1.0.0\n');
      return outside;
    };

    test.each([
      ['relative entry', '.xray/strategies'],
      ['trailing slash', '.xray/strategies/'],
      ['dot-relative', './.xray/../.xray/strategies'],
    ])('XRAY_STRATEGIES_PATH, %s, symlinked outside: file kept', async (_l, spelling) => {
      const proj = project();
      const outside = outsideWithFoo();
      fs.mkdirSync(path.join(proj, '.xray'));
      fs.symlinkSync(outside, path.join(proj, '.xray/strategies'));
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'foo'], { XRAY_STRATEGIES_PATH: spelling });
      expect(r.code).toBe(3);
      expect(fs.existsSync(path.join(outside, 'foo.yml'))).toBe(true);
    });

    test('absolute XRAY_STRATEGIES_PATH under cwd, symlinked outside: file kept', async () => {
      const proj = project();
      const outside = outsideWithFoo();
      fs.mkdirSync(path.join(proj, '.xray'));
      fs.symlinkSync(outside, path.join(proj, '.xray/strategies'));
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'foo'], { XRAY_STRATEGIES_PATH: path.join(proj, '.xray/strategies') });
      expect(r.code).toBe(3);
      expect(fs.existsSync(path.join(outside, 'foo.yml'))).toBe(true);
    });

    test('absolute user entry outside cwd may be a symlink elsewhere', async () => {
      const proj = project();
      const outside = outsideWithFoo();
      const link = path.join(base, `userlink-${n++}`);
      fs.symlinkSync(outside, link);
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'foo'], { XRAY_STRATEGIES_PATH: link });
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(outside, 'foo.yml'))).toBe(false);
    });

    const caseInsensitive = (() => {
      const probe = path.join(os.tmpdir(), `CaseProbe-${process.pid}`);
      fs.writeFileSync(probe, '');
      const ci = fs.existsSync(probe.toLowerCase());
      fs.rmSync(probe);
      return ci;
    })();
    const ci = caseInsensitive ? test : test.skip;

    ci('built-in dir reached through a differently cased symlink target: built-in intact', async () => {
      // a user-set entry outside the project, so only the built-in check can stop it
      const link = path.join(base, `builtinlink-${n++}`);
      fs.symlinkSync(path.dirname(builtin).toUpperCase(), link);
      const r = await run(project(), ['--confirm=yes', 'strategy', 'remove', 'react'], { XRAY_STRATEGIES_PATH: link });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('built-in');
      expect(fs.existsSync(builtin)).toBe(true);
    });

    ci('differently cased node_modules through a symlink: file kept', async () => {
      const proj = project();
      const nm = path.join(base, `nm-${n++}`, 'node_modules', 'strategies');
      fs.mkdirSync(nm, { recursive: true });
      fs.writeFileSync(path.join(nm, 'foo.yml'), 'name: foo\nversion: 1.0.0\n');
      const link = path.join(base, `nmlink-${n++}`);
      fs.symlinkSync(nm.replace('node_modules', 'NODE_MODULES'), link);
      const r = await run(proj, ['--confirm=yes', 'strategy', 'remove', 'foo'], { XRAY_STRATEGIES_PATH: link });
      expect(r.code).toBe(3);
      expect(fs.existsSync(path.join(nm, 'foo.yml'))).toBe(true);
    });
  });
});
