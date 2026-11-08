/**
 * `strategy create|remove|install` turn a name into a path. A name must
 * never reach outside the strategies directory, and a bad one is a usage
 * error (exit 2), not a silent rewrite. Drives the built CLI in throwaway
 * projects with their own config/cache/state dirs.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../bin/cli.js');

describe('strategy names and paths', () => {
  let base: string;
  let env: NodeJS.ProcessEnv;
  let n = 0;

  const project = () => {
    const dir = path.join(base, `proj-${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
  const files = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(p);
      }
    };
    walk(dir);
    // The throwaway cache/state dirs fill up on any run.
    return out.filter((f) => !f.startsWith(path.join(base, '.env') + path.sep));
  };

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-name-')));
    const sub = (d: string) => {
      const p = path.join(base, '.env', d);
      fs.mkdirSync(p, { recursive: true });
      return p;
    };
    env = {
      ...process.env,
      HOME: sub('home'),
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

  describe('create', () => {
    const bad = [
      'a/../../x',
      '../../../esc',
      '..',
      'a/b',
      'a\\b',
      '/abs/path',
      'Upper',
      'has space',
      '-leading-dash',
      'under_score',
      'dot.name',
      'a'.repeat(65),
      '',
    ];

    it.each(bad)('refuses %j with exit 2, naming the rule, writing nothing', (name) => {
      const dir = project();
      const before = files(base);
      const r = run(dir, 'strategy', 'create', '--', name);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('[a-z0-9][a-z0-9-]*');
      expect(files(base)).toEqual(before);
    });

    it('refuses under --dry-run too', () => {
      const r = run(project(), 'strategy', 'create', '../../../esc', '--dry-run');
      expect(r.status).toBe(2);
    });

    it('refuses with the JSON error envelope under --format json', () => {
      const r = run(project(), 'strategy', 'create', '../esc', '--format', 'json');
      expect(r.status).toBe(2);
      const err = JSON.parse(r.stderr);
      expect(err).toMatchObject({ code: 'USAGE', exit_code: 2 });
      expect(err.message).toContain('[a-z0-9][a-z0-9-]*');
    });

    it('refuses with --dir too: the name alone must not leave the directory', () => {
      const dir = project();
      const out = path.join(dir, 'out');
      const r = run(dir, 'strategy', 'create', '../esc', '--dir', out, '--ts');
      expect(r.status).toBe(2);
      expect(fs.existsSync(path.join(dir, 'esc.ts'))).toBe(false);
    });

    it.each(['a', 'my-rules', 'rules2', '9lives', 'a'.repeat(64)])('accepts %j', (name) => {
      const dir = project();
      const r = run(dir, 'strategy', 'create', name, '--yaml');
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(dir, '.xray/strategies', `${name}.yml`))).toBe(true);
    });

    it('writes a TypeScript scaffold with a valid identifier for a digit-leading name', () => {
      const dir = project();
      expect(run(dir, 'strategy', 'create', '9lives', '--ts').status).toBe(0);
      const src = fs.readFileSync(path.join(dir, '.xray/strategies/9lives.ts'), 'utf8');
      expect(src).toMatch(/export const [A-Za-z_$][\w$]*Strategy: Strategy/);
    });

    it('refuses when .xray/strategies is a symlink leaving the project', () => {
      const dir = project();
      const outside = path.join(base, `outside-${n++}`);
      fs.mkdirSync(outside);
      fs.mkdirSync(path.join(dir, '.xray'));
      fs.symlinkSync(outside, path.join(dir, '.xray/strategies'));
      const r = run(dir, 'strategy', 'create', 'ok', '--yaml');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(outside);
      expect(fs.readdirSync(outside)).toEqual([]);
    });

    it('refuses when .xray is a symlink leaving the project', () => {
      const dir = project();
      const outside = path.join(base, `outside-${n++}`);
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(dir, '.xray'));
      const r = run(dir, 'strategy', 'create', 'ok', '--yaml');
      expect(r.status).toBe(2);
      expect(fs.readdirSync(outside)).toEqual([]);
    });

    it('allows a symlinked .xray that stays inside the project', () => {
      const dir = project();
      fs.mkdirSync(path.join(dir, 'real-xray'));
      fs.symlinkSync(path.join(dir, 'real-xray'), path.join(dir, '.xray'));
      expect(run(dir, 'strategy', 'create', 'ok', '--yaml').status).toBe(0);
      expect(fs.existsSync(path.join(dir, 'real-xray/strategies/ok.yml'))).toBe(true);
    });

    it('refuses a pre-planted symlink at the target file name', () => {
      const dir = project();
      const outside = path.join(base, `victim-${n++}.yml`);
      fs.mkdirSync(path.join(dir, '.xray/strategies'), { recursive: true });
      fs.symlinkSync(outside, path.join(dir, '.xray/strategies/ok.yml'));
      const r = run(dir, 'strategy', 'create', 'ok', '--yaml');
      expect(r.status).not.toBe(0);
      expect(fs.existsSync(outside)).toBe(false);
    });
  });

  describe('remove', () => {
    it('a traversal name removes nothing outside the strategies directory', () => {
      const dir = project();
      fs.mkdirSync(path.join(dir, '.xray/strategies'), { recursive: true });
      const victim = path.join(dir, '.xray/x.yml');
      fs.writeFileSync(victim, 'name: x\nversion: 0.1.0\n');
      const r = run(dir, 'strategy', 'remove', 'a/../../x', '--confirm=yes');
      expect(r.status).not.toBe(0);
      expect(fs.existsSync(victim)).toBe(true);
    });

    it('still removes a strategy whose name predates the create rule', () => {
      const dir = project();
      fs.mkdirSync(path.join(dir, '.xray/strategies'), { recursive: true });
      const old = path.join(dir, '.xray/strategies/Old_Name.yml');
      fs.writeFileSync(old, 'name: Old_Name\nversion: 0.1.0\n');
      const r = run(dir, 'strategy', 'remove', 'Old_Name', '--confirm=yes');
      expect(r.status).toBe(0);
      expect(fs.existsSync(old)).toBe(false);
    });
  });

  describe('install', () => {
    it('a local strategy file is read, never copied anywhere', () => {
      const dir = project();
      const src = path.join(dir, '..', `elsewhere-${n++}.yml`);
      fs.writeFileSync(src, 'name: ../../esc\nversion: 0.1.0\ndetect:\n  files: []\nfileTypes: []\ncommands: {}\n');
      const before = files(base);
      run(dir, 'strategy', 'install', src);
      expect(files(base)).toEqual(before);
      expect(fs.existsSync(path.join(dir, '.xray'))).toBe(false);
    });
  });
});
