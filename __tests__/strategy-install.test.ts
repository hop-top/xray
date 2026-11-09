import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

/**
 * `xray strategy install` end to end: the built CLI runs in a subprocess in
 * a throwaway project directory. npm only ever talks to a registry served
 * from 127.0.0.1 by this file, or to tarballs/directories made from
 * fixtures; its cache, config and home are redirected into a temp dir.
 */

const CLI_PATH = path.join(__dirname, '../bin/xray');
const OPT_IN = 'XRAY_ALLOW_PROJECT_STRATEGIES';

interface Result { code: number; out: string }

const strategyJs = (name: string, version: string) => `
if (process.env.MARK) require('fs').writeFileSync(process.env.MARK, 'loaded');
module.exports = { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)},
  detect() { return false; }, commands: {} };
`;

describe('strategy install E2E', () => {
  let base: string;
  let fx: string;
  let registry: http.Server;
  let registryUrl: string;
  const served = new Map<string, { version: string; file: string }>();
  let n = 0;

  const baseEnv = (extra: Record<string, string | undefined> = {}) => {
    const inherited: Record<string, string | undefined> = { ...process.env };
    delete inherited[OPT_IN];
    const env: Record<string, string | undefined> = {
      ...inherited,
      HOME: base,
      XRAY_LANG_DIR: path.join(base, 'lang'),
      XDG_DATA_HOME: path.join(base, 'xdg-data'),
      XDG_CONFIG_HOME: path.join(base, 'xdg-config'),
      XDG_CACHE_HOME: path.join(base, 'xdg-cache'),
      npm_config_cache: path.join(base, 'npm-cache'),
      npm_config_userconfig: path.join(base, 'npmrc'),
      npm_config_globalconfig: path.join(base, 'npmrc-global'),
      npm_config_registry: 'http://127.0.0.1:9/',
      npm_config_fetch_retries: '0',
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      npm_config_update_notifier: 'false',
      ...extra,
    };
    return env;
  };

  const run = (cmd: string, args: string[], cwd: string, extra: Record<string, string | undefined> = {}) =>
    new Promise<Result>((resolve) => {
      execFile(cmd, args, { cwd, env: baseEnv(extra) as NodeJS.ProcessEnv, timeout: 90000 }, (err, stdout, stderr) => {
        resolve({ code: err ? ((err as any).code as number) ?? 1 : 0, out: `${stdout}${stderr}` });
      });
    });

  const xray = (cwd: string, args: string[], extra: Record<string, string | undefined> = {}) =>
    run('node', [CLI_PATH, ...args], cwd, extra);

  /** A fresh empty project directory. */
  const project = () => {
    const dir = path.join(base, `proj-${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  /** Write a package directory under fx and return it. */
  const makePkg = (pkg: Record<string, unknown>, files: Record<string, string>) => {
    const dir = path.join(fx, `pkg-${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  };

  const strategyPkg = (
    name: string,
    version: string,
    files: Record<string, string> = { 'index.js': strategyJs('s-' + name.replace(/\W/g, '_'), version) },
    entry = 'index.js',
    sname = 's-' + name.replace(/\W/g, '_')
  ) => makePkg({ name, version, 'xray-strategy': { name: sname, entry } }, files);

  const yamlPkg = (name: string, version: string) =>
    strategyPkg(name, version, {
      's.yml': `name: y-strategy\nversion: 4.5.6\ndetect:\n  files: ["*.zz"]\n`,
    }, 's.yml', 'y-strategy');

  const pack = async (dir: string) => {
    const out = path.join(fx, `tgz-${n++}`);
    fs.mkdirSync(out);
    const r = await run('npm', ['pack', '--silent', '--pack-destination', out, dir], base);
    expect(r.code).toBe(0);
    return path.join(out, fs.readdirSync(out)[0]);
  };

  const installed = (proj: string, name: string) =>
    fs.existsSync(path.join(proj, 'node_modules', ...name.split('/'), 'package.json'));

  beforeAll(async () => {
    if (!fs.existsSync(path.join(__dirname, '../dist/index.js'))) {
      throw new Error('dist missing: run `npm run build` first');
    }
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-install-test-'));
    fx = path.join(base, 'fx');
    fs.mkdirSync(fx);
    registry = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
      if (url.startsWith('-/')) {
        const hit = [...served.values()].find((s) => path.basename(s.file) === url.slice(2));
        if (hit) return void res.end(fs.readFileSync(hit.file));
      } else if (served.has(url)) {
        const { version, file } = served.get(url)!;
        const buf = fs.readFileSync(file);
        const dist = {
          tarball: `${registryUrl}/-/${path.basename(file)}`,
          shasum: crypto.createHash('sha1').update(buf).digest('hex'),
          integrity: 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64'),
        };
        const manifest = { name: url, version, dist };
        res.setHeader('content-type', 'application/json');
        return void res.end(JSON.stringify({
          name: url, 'dist-tags': { latest: version }, versions: { [version]: manifest },
        }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((r) => registry.listen(0, '127.0.0.1', r));
    registryUrl = `http://127.0.0.1:${(registry.address() as any).port}`;
  });

  afterAll(async () => {
    registry.closeAllConnections();
    await new Promise((r) => registry.close(r));
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('code strategy package', () => {
    test('tarball without the opt-in: validated from package.json, not loaded', async () => {
      const mark = path.join(base, 'mark-tgz-1');
      const tgz = await pack(strategyPkg('xray-strategy-tgz', '1.2.3', { 'index.js': strategyJs('tgz-strat', '1.2.3') }, 'index.js', 'tgz-strat'));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz], { MARK: mark });
      expect(r.code).toBe(0);
      expect(r.out).toContain('tgz-strat');
      expect(r.out).toContain('1.2.3');
      expect(r.out).toContain(`${OPT_IN}=1`);
      expect(r.out).not.toContain('Failed');
      expect(installed(proj, 'xray-strategy-tgz')).toBe(true);
      expect(fs.existsSync(mark)).toBe(false);
    });

    test('tarball with the opt-in: loaded through the loader, warning shown', async () => {
      const mark = path.join(base, 'mark-tgz-2');
      const tgz = await pack(strategyPkg('xray-strategy-tgz2', '2.0.0', { 'index.js': strategyJs('tgz-strat-2', '2.0.1') }, 'index.js', 'tgz-strat-2'));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz], { MARK: mark, [OPT_IN]: '1' });
      expect(r.code).toBe(0);
      expect(r.out).toContain('tgz-strat-2');
      expect(r.out).toContain('2.0.1');
      expect(r.out).toContain('runs code');
      expect(fs.existsSync(mark)).toBe(true);
      expect(installed(proj, 'xray-strategy-tgz2')).toBe(true);
    });

    test('local directory source', async () => {
      const dir = strategyPkg('xray-strategy-dirsrc', '0.3.0');
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', dir]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('0.3.0');
      expect(r.out).toContain(`${OPT_IN}=1`);
      expect(installed(proj, 'xray-strategy-dirsrc')).toBe(true);
    });

    test('relative ./ directory source', async () => {
      const dir = strategyPkg('xray-strategy-relsrc', '0.4.0');
      const proj = project();
      fs.symlinkSync(dir, path.join(proj, 'local-copy'));
      const r = await xray(proj, ['strategy', 'install', './local-copy']);
      expect(r.code).toBe(0);
      expect(installed(proj, 'xray-strategy-relsrc')).toBe(true);
    });

    test('registry name, name@version and scoped name; source differs from directory name', async () => {
      const a = await pack(strategyPkg('xray-strategy-reg', '1.0.0'));
      const b = await pack(strategyPkg('@acme/xray-strategy-scoped', '3.1.0'));
      served.set('xray-strategy-reg', { version: '1.0.0', file: a });
      served.set('@acme/xray-strategy-scoped', { version: '3.1.0', file: b });
      const env = { npm_config_registry: registryUrl };

      const p1 = project();
      const r1 = await xray(p1, ['strategy', 'install', 'xray-strategy-reg'], env);
      expect(r1.code).toBe(0);
      expect(r1.out).toContain('1.0.0');
      expect(installed(p1, 'xray-strategy-reg')).toBe(true);

      const p2 = project();
      const r2 = await xray(p2, ['strategy', 'install', 'xray-strategy-reg@1.0.0'], env);
      expect(r2.code).toBe(0);
      expect(installed(p2, 'xray-strategy-reg')).toBe(true);

      const p3 = project();
      const r3 = await xray(p3, ['strategy', 'install', '@acme/xray-strategy-scoped'], env);
      expect(r3.code).toBe(0);
      expect(r3.out).toContain('3.1.0');
      expect(installed(p3, '@acme/xray-strategy-scoped')).toBe(true);
    }, 60000);

    test('with the opt-in, the installed package is then listed', async () => {
      const tgz = await pack(strategyPkg('xray-strategy-listed', '1.0.0', { 'index.js': strategyJs('listed-strat', '1.0.0') }, 'index.js', 'listed-strat'));
      const proj = project();
      expect((await xray(proj, ['strategy', 'install', tgz], { [OPT_IN]: '1' })).code).toBe(0);
      const r = await xray(proj, ['strategy', 'list'], { [OPT_IN]: '1' });
      expect(r.out).toContain('listed-strat');
    });
  });

  describe('YAML entry', () => {
    test('loads with no opt-in and prints name and version', async () => {
      const tgz = await pack(yamlPkg('xray-strategy-yml', '9.9.9'));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('y-strategy');
      expect(r.out).toContain('4.5.6');
      expect(r.out).not.toContain(`${OPT_IN}=1`);
    });
  });

  describe('rejects what is not a strategy', () => {
    test('entry escaping the package: non-zero, message, package removed', async () => {
      const mark = path.join(base, 'mark-escape');
      const dir = strategyPkg('xray-strategy-escape', '1.0.0', {
        'index.js': strategyJs('escape', '1.0.0'),
      }, '../outside.yml');
      fs.writeFileSync(path.join(dir, '..', 'outside.yml'), 'name: outside\nversion: 1.0.0\n');
      const tgz = await pack(dir);
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz], { MARK: mark, [OPT_IN]: '1' });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('outside the package');
      expect(installed(proj, 'xray-strategy-escape')).toBe(false);
      expect(fs.existsSync(mark)).toBe(false);
    });

    test('entry file missing from the package', async () => {
      const tgz = await pack(strategyPkg('xray-strategy-noentry', '1.0.0', { 'other.js': '' }, 'index.js'));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('does not exist');
      expect(installed(proj, 'xray-strategy-noentry')).toBe(false);
    });

    test('package without an xray-strategy field: non-zero, clear message, removed', async () => {
      const tgz = await pack(makePkg({ name: 'plain-lib', version: '1.0.0', main: 'i.js' }, { 'i.js': '' }));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('not a strategy package');
      expect(installed(proj, 'plain-lib')).toBe(false);
    });

    test('xray-strategy without a name', async () => {
      const tgz = await pack(makePkg({ name: 'noname-lib', version: '1.0.0', 'xray-strategy': { entry: 'i.js' } }, { 'i.js': '' }));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('"xray-strategy.name"');
      expect(installed(proj, 'noname-lib')).toBe(false);
    });

    test('a package already installed before the run stays', async () => {
      const tgz = await pack(makePkg({ name: 'plain-keep', version: '1.0.0' }, { 'i.js': '' }));
      const proj = project();
      expect((await run('npm', ['install', tgz], proj)).code).toBe(0);
      expect(installed(proj, 'plain-keep')).toBe(true);
      const r = await xray(proj, ['strategy', 'install', tgz]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('not a strategy package');
      expect(installed(proj, 'plain-keep')).toBe(true);
    });

    test('a rejected package changes nothing: manifest, lockfile, installed version', async () => {
      const v1 = await pack(makePkg({ name: 'dep-lib', version: '1.0.0' }, { 'i.js': '' }));
      const mark = path.join(base, 'mark-postinstall');
      const v2 = await pack(makePkg(
        { name: 'dep-lib', version: '2.0.0', scripts: { postinstall: `node -e "require('fs').writeFileSync(process.env.MARK,'ran')"` } },
        { 'i.js': '' }
      ));
      const proj = project();
      expect((await run('npm', ['install', v1], proj)).code).toBe(0);
      const snap = () => ({
        manifest: fs.readFileSync(path.join(proj, 'package.json')),
        lock: fs.readFileSync(path.join(proj, 'package-lock.json')),
        version: fs.readFileSync(path.join(proj, 'node_modules', 'dep-lib', 'package.json')),
      });
      const before = snap();
      const r = await xray(proj, ['strategy', 'install', v2], { MARK: mark });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('not a strategy package');
      expect(r.out).not.toContain('left in place');
      const after = snap();
      expect(after.manifest.equals(before.manifest)).toBe(true);
      expect(after.lock.equals(before.lock)).toBe(true);
      expect(after.version.equals(before.version)).toBe(true);
      expect(JSON.parse(after.version.toString()).version).toBe('1.0.0');
      expect(fs.existsSync(mark)).toBe(false);
    });

    test('a rejected package in an empty project leaves nothing behind', async () => {
      const mark = path.join(base, 'mark-postinstall-empty');
      const tgz = await pack(makePkg(
        { name: 'empty-lib', version: '1.0.0', scripts: { postinstall: `node -e "require('fs').writeFileSync(process.env.MARK,'ran')"` } },
        { 'i.js': '' }
      ));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', tgz], { MARK: mark });
      expect(r.code).not.toBe(0);
      expect(fs.readdirSync(proj)).toEqual([]);
      expect(fs.existsSync(mark)).toBe(false);
    });

    test('a valid package at a new version updates the installed one and says so', async () => {
      const v1 = await pack(strategyPkg('xray-strategy-upd', '1.0.0'));
      const v2 = await pack(strategyPkg('xray-strategy-upd', '2.0.0'));
      const proj = project();
      expect((await xray(proj, ['strategy', 'install', v1])).code).toBe(0);
      const r = await xray(proj, ['strategy', 'install', v2]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('1.0.0 is already installed');
      expect(r.out).toContain('2.0.0');
      expect(JSON.parse(fs.readFileSync(path.join(proj, 'node_modules/xray-strategy-upd/package.json'), 'utf-8')).version).toBe('2.0.0');
    });

    test('unresolvable registry name fails without installing anything', async () => {
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', 'xray-strategy-nonexistent'], { npm_config_registry: registryUrl });
      expect(r.code).not.toBe(0);
      expect(fs.existsSync(path.join(proj, 'node_modules'))).toBe(false);
    });
  });

  describe('source is never run by a shell or read as an npm flag', () => {
    test.each([
      ['command substitution', (m: string) => `$(touch ${m})`],
      ['command separator', (m: string) => `x; touch ${m}`],
      ['logical and', (m: string) => `x && touch ${m}`],
      ['backticks', (m: string) => `\`touch ${m}\``],
    ])('%s', async (_label, build) => {
      const mark = path.join(base, `mark-hostile-${n++}`);
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', build(mark)]);
      expect(r.code).not.toBe(0);
      expect(fs.existsSync(mark)).toBe(false);
    });

    test('a source starting with - is a package spec, not an npm option', async () => {
      // the project has its own package.json, so an option-reading npm would
      // pack and install the project itself and write a lockfile
      const proj = project();
      fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"host","version":"1.0.0"}');
      const r = await xray(proj, ['strategy', 'install', '--', '--package-lock-only']);
      expect(r.code).not.toBe(0);
      expect(fs.existsSync(path.join(proj, 'package-lock.json'))).toBe(false);
      expect(fs.existsSync(path.join(proj, 'node_modules'))).toBe(false);
    });
  });

  describe('scoped packages are discovered', () => {
    const scoped = (proj: string, name: string, sname: string, entry: string, files: Record<string, string>) => {
      const dir = path.join(proj, 'node_modules', ...name.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', 'xray-strategy': { name: sname, entry } }));
      for (const [rel, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), c);
    };

    test('code package: named in the skip notice without the opt-in, listed with it', async () => {
      const proj = project();
      const mark = path.join(base, `mark-scoped-${n++}`);
      scoped(proj, '@acme/xray-strategy-sc', 'scoped-code', 'index.js', { 'index.js': strategyJs('scoped-code', '1.0.0') });
      const off = await xray(proj, ['strategy', 'list'], { MARK: mark });
      expect(off.out).toContain('node_modules/@acme/xray-strategy-sc');
      expect(off.out).toContain(`${OPT_IN}=1`);
      expect(off.out).not.toContain('scoped-code v');
      expect(fs.existsSync(mark)).toBe(false);
      const on = await xray(proj, ['strategy', 'list'], { MARK: mark, [OPT_IN]: '1' });
      expect(on.out).toContain('scoped-code');
      expect(fs.existsSync(mark)).toBe(true);
    });

    test('YAML package loads with no opt-in', async () => {
      const proj = project();
      scoped(proj, '@acme/xray-strategy-sy', 'scoped-yaml', 's.yml', { 's.yml': 'name: scoped-yaml\nversion: 2.0.0\ndetect:\n  files: ["*.zz"]\n' });
      const r = await xray(proj, ['strategy', 'list']);
      expect(r.out).toContain('scoped-yaml');
    });

    test('only xray-strategy-* inside @scope directories counts', async () => {
      const proj = project();
      scoped(proj, '@acme/other-thing', 'other', 'index.js', { 'index.js': strategyJs('other', '1.0.0') });
      const r = await xray(proj, ['strategy', 'list'], { [OPT_IN]: '1' });
      expect(r.out).not.toContain('other v');
      expect(r.out).not.toContain('other-thing');
    });

    test('entry escaping the package is rejected, nothing loads', async () => {
      const proj = project();
      const mark = path.join(base, `mark-scoped-esc-${n++}`);
      fs.writeFileSync(path.join(proj, 'outside.js'), strategyJs('outside', '1.0.0'));
      scoped(proj, '@acme/xray-strategy-esc', 'scoped-esc', '../../../outside.js', {});
      const r = await xray(proj, ['strategy', 'list'], { MARK: mark, [OPT_IN]: '1' });
      expect(r.out).toContain('outside the package');
      expect(fs.existsSync(mark)).toBe(false);
    });

    test('install of a scoped name no longer warns that it will not be discovered', async () => {
      const b = await pack(strategyPkg('@acme/xray-strategy-nowarn', '1.0.0'));
      served.set('@acme/xray-strategy-nowarn', { version: '1.0.0', file: b });
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', '@acme/xray-strategy-nowarn'], { npm_config_registry: registryUrl });
      expect(r.code).toBe(0);
      expect(r.out).not.toContain('will not be discovered');
    });
  });

  describe('strategy install has no --global', () => {
    test('is a usage error and installs nothing', async () => {
      const tgz = await pack(yamlPkg('xray-strategy-glob', '1.0.0'));
      const proj = project();
      const r = await xray(proj, ['strategy', 'install', '--global', tgz]);
      expect(r.code).toBe(2);
      expect(r.out).toContain('--global');
      expect(installed(proj, 'xray-strategy-glob')).toBe(false);
      expect(fs.existsSync(path.join(base, 'xdg-data', 'xray'))).toBe(false);
    });
  });

  describe('strategy remove', () => {
    test('package by package name, scoped, no code run and no opt-in needed', async () => {
      const mark = path.join(base, `mark-rm-${n++}`);
      const tgz = await pack(strategyPkg('@acme/xray-strategy-rm', '1.0.0', { 'index.js': strategyJs('rm-strat', '1.0.0') }, 'index.js', 'rm-strat'));
      const proj = project();
      expect((await xray(proj, ['strategy', 'install', tgz])).code).toBe(0);
      expect(installed(proj, '@acme/xray-strategy-rm')).toBe(true);
      const r = await xray(proj, ['--confirm=yes', 'strategy', 'remove', '@acme/xray-strategy-rm'], { MARK: mark });
      expect(r.code).toBe(0);
      expect(r.out).toContain('rm-strat');
      expect(installed(proj, '@acme/xray-strategy-rm')).toBe(false);
      expect(fs.existsSync(mark)).toBe(false);
    });

    test('package by strategy name, via the uninstall alias', async () => {
      const tgz = await pack(strategyPkg('xray-strategy-byname', '1.0.0', { 'index.js': strategyJs('by-name', '1.0.0') }, 'index.js', 'by-name'));
      const proj = project();
      expect((await xray(proj, ['strategy', 'install', tgz])).code).toBe(0);
      const r = await xray(proj, ['--confirm=yes', 'strategy', 'uninstall', 'by-name']);
      expect(r.code).toBe(0);
      expect(installed(proj, 'xray-strategy-byname')).toBe(false);
    });

    test('a package that is not a strategy package is refused and left alone', async () => {
      const proj = project();
      const dir = path.join(proj, 'node_modules', 'lodash');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"lodash","version":"4.0.0"}');
      fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"host","dependencies":{"lodash":"4.0.0"}}');
      const r = await xray(proj, ['--confirm=yes', 'strategy', 'remove', 'lodash']);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('not a strategy package');
      expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(proj, 'package.json'), 'utf-8')).dependencies.lodash).toBe('4.0.0');
    });

    test('not found at all: non-zero with a clear message', async () => {
      const proj = project();
      const r = await xray(proj, ['--confirm=yes', 'strategy', 'remove', 'nothing-here']);
      expect(r.code).toBe(3);
      expect(r.out).toContain('"nothing-here" not found');
    });

    test('local file and package of the same name: file removed, package stays and is said so', async () => {
      const tgz = await pack(yamlPkg('xray-strategy-both', '1.0.0'));
      const proj = project();
      expect((await xray(proj, ['strategy', 'install', tgz])).code).toBe(0);
      const file = path.join(proj, '.xray/strategies/y-strategy.yml');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'name: y-strategy\nversion: 1.0.0\n');
      const r = await xray(proj, ['--confirm=yes', 'strategy', 'remove', 'y-strategy']);
      expect(r.code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
      expect(installed(proj, 'xray-strategy-both')).toBe(true);
      expect(r.out).toContain('xray-strategy-both was not removed');
    });

    test.each([
      ['command substitution', (m: string) => `$(touch ${m})`],
      ['command separator', (m: string) => `x; touch ${m}`],
      ['backticks', (m: string) => `\`touch ${m}\``],
      ['option-like', (m: string) => `--prefix=${m}`],
      ['traversal', (m: string) => `../../${path.basename(m)}`],
    ])('hostile name (%s) leaves no marker', async (_label, build) => {
      const mark = path.join(base, `mark-rmhostile-${n++}`);
      const proj = project();
      const r = await xray(proj, ['--confirm=yes', 'strategy', 'remove', '--', build(mark)]);
      expect(r.code).not.toBe(0);
      expect(fs.existsSync(mark)).toBe(false);
      expect(fs.existsSync(path.join(proj, 'node_modules'))).toBe(false);
    });
  });

  describe('local strategy file', () => {
    test('YAML file: reads it, says nothing was installed', async () => {
      const proj = project();
      const file = path.join(proj, 'mine.yml');
      fs.writeFileSync(file, 'name: mine\nversion: 1.0.0\n');
      const r = await xray(proj, ['strategy', 'install', file]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('mine');
      expect(r.out).toContain('1.0.0');
      expect(r.out).toMatch(/nothing was (installed|copied)/i);
      expect(r.out).not.toMatch(/Strategy installed/);
      expect(fs.existsSync(path.join(proj, '.xray'))).toBe(false);
      expect(fs.existsSync(path.join(proj, 'node_modules'))).toBe(false);
    });

    test('code file without the opt-in: not loaded, says nothing was installed', async () => {
      const proj = project();
      const mark = path.join(base, 'mark-file');
      const file = path.join(proj, 'mine.js');
      fs.writeFileSync(file, strategyJs('mine-js', '1.0.0'));
      const r = await xray(proj, ['strategy', 'install', file], { MARK: mark });
      expect(r.out).toContain(`${OPT_IN}=1`);
      expect(r.out).toMatch(/nothing was (installed|copied)/i);
      expect(r.out).not.toMatch(/Strategy installed/);
      expect(fs.existsSync(mark)).toBe(false);
    });
  });
});
