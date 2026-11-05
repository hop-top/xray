/**
 * xray never writes into the project it analyses: the SQLite analysis cache
 * lives in the user cache dir and the telemetry sink in the user state dir,
 * both keyed by project root. Every case spawns the built CLI
 * (`npm run build` first) in a throwaway project with its own XDG dirs,
 * `--offline`, no network.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { projectKey } from '../../src/lib/storage';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('@hop-top/kit/sqlstore') as {
  open: (p: string) => { db(): { prepare(sql: string): { all(): any[]; run(...a: unknown[]): unknown } }; close(): void };
};

const OFF_ENV = [
  'XRAY_NO_TELEMETRY', 'DO_NOT_TRACK', 'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS',
  'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'JENKINS_URL', 'BUILDKITE', 'TEAMCITY_VERSION',
];
const SRC = 'export function hello() { return 1 }\nexport class A { m() { return hello() } }\n';

let base: string;
let dirs: { cache: string; state: string; config: string; data: string; home: string; tmp: string; lang: string };
let preload: string;

function tree(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    out.push(e.isDirectory() ? `${r}/` : r);
    if (e.isDirectory()) out.push(...tree(dir, r));
  }
  return out.sort();
}

function mkProject(...parts: string[]): string {
  const dir = path.join(base, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.ts'), SRC);
  fs.writeFileSync(path.join(dir, 'b.py'), 'def f():\n  return 2\n');
  return dir;
}

function setConsent(enabled: boolean): void {
  fs.mkdirSync(path.join(dirs.config, 'xray'), { recursive: true });
  fs.writeFileSync(path.join(dirs.config, 'xray', 'config.json'), JSON.stringify({ telemetry: { enabled } }));
}

/** `tty`: preload making stdout/stdin look like a terminal, so saved consent applies. */
function xray(args: string[], cwd: string, opts: { tty?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: dirs.home,
    TMPDIR: dirs.tmp,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XRAY_LANG_DIR: dirs.lang,
    FORCE_COLOR: '0',
    ...opts.env,
  };
  for (const k of OFF_ENV) delete env[k];
  return spawnSync(process.execPath, [...(opts.tty ? ['-r', preload] : []), BIN, '--offline', ...args], {
    cwd, env, encoding: 'utf-8', timeout: 90_000,
  });
}

const cacheDbOf = (project: string) =>
  path.join(dirs.cache, 'xray', 'projects', projectKey(project), 'xray_cache.db');
const telemetryOf = (project: string) =>
  path.join(dirs.state, 'xray', 'telemetry', projectKey(project), 'telemetry.json');

beforeAll(() => {
  if (!fs.existsSync(DIST_ENTRY)) {
    const tsc = require.resolve('typescript/bin/tsc');
    const r = spawnSync(process.execPath, [tsc], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`);
  }
}, 120_000);

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-storage-xdg-')));
  dirs = {
    cache: path.join(base, 'x', 'cache'), state: path.join(base, 'x', 'state'),
    config: path.join(base, 'x', 'config'), data: path.join(base, 'x', 'data'),
    home: path.join(base, 'x', 'home'), tmp: path.join(base, 'x', 'tmp'), lang: path.join(base, 'x', 'lang'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  preload = path.join(base, 'tty.js');
  fs.writeFileSync(preload,
    "for (const s of [process.stdout, process.stdin]) Object.defineProperty(s, 'isTTY', { value: true, configurable: true });\n");
});

afterEach(() => {
  fs.chmodSync(base, 0o755);
  for (const e of fs.readdirSync(base)) {
    try { fs.chmodSync(path.join(base, e), 0o755); } catch { /* gone */ }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

describe.each([['on'], ['off']])('consent %s: the project is left as found', (consent) => {
  const cases: Array<[string, (out: string) => string[]]> = [
    ['map', (o) => ['map', '-p', '.', '-o', path.join(o, 'm')]],
    ['map --format json', (o) => ['map', '-p', '.', '--format', 'json', '-o', path.join(o, 'm.json')]],
    ['graph', (o) => ['graph', '-p', '.', '-o', path.join(o, 'g')]],
    ['paths', () => ['paths']],
    ['describe', () => ['describe']],
    ['imports', (o) => ['imports', '-p', '.', '-o', path.join(o, 'i.json')]],
  ];

  it.each(cases)('%s creates nothing in the project', (_name, argsFor) => {
    setConsent(consent === 'on');
    const proj = mkProject('proj');
    const out = path.join(base, 'out');
    fs.mkdirSync(out);
    const before = tree(proj);
    const r = xray(argsFor(out), proj, { tty: true });
    expect(r.status).toBe(0);
    expect(tree(proj)).toEqual(before);
    expect(fs.existsSync(path.join(proj, '.xray'))).toBe(false);
    expect(fs.existsSync(path.join(proj, '.xray_cache.db'))).toBe(false);
  });

  it('consent on records into the state dir (control); off records nothing', () => {
    setConsent(consent === 'on');
    const proj = mkProject('proj');
    const r = xray(['paths'], proj, { tty: true });
    expect(r.status).toBe(0);
    expect(fs.existsSync(telemetryOf(proj))).toBe(consent === 'on');
    expect(fs.existsSync(path.join(proj, '.xray'))).toBe(false);
  });
});

describe('cache location', () => {
  it('map writes its db under XDG_CACHE_HOME keyed by the project, and `paths` reports it', () => {
    const proj = mkProject('proj');
    expect(xray(['map', '-p', '.', '-o', path.join(base, 'o')], proj).status).toBe(0);
    expect(fs.existsSync(cacheDbOf(proj))).toBe(true);
    const p = JSON.parse(xray(['paths', '--format', 'json'], proj).stdout);
    expect(p.cacheDb).toBe(cacheDbOf(proj));
    expect(p.cacheDbExists).toBe(true);
    expect(p.telemetry).toBe(telemetryOf(proj));
  });

  it('a second run reuses the cache (hit): a cached record is served, not re-parsed', () => {
    const proj = mkProject('proj');
    const out1 = path.join(base, 'o1');
    const out2 = path.join(base, 'o2');
    expect(xray(['map', '-p', '.', '--txt', '-o', out1], proj).status).toBe(0);
    expect(fs.readFileSync(`${out1}_root.txt`, 'utf-8')).toContain('hello');
    // Rewrite the cached tags of every file: a hit surfaces the marker.
    const store = open(cacheDbOf(proj));
    const db = store.db();
    const rows = db.prepare("SELECT key, value FROM kv WHERE key LIKE 'tags:%'").all();
    expect(rows.length).toBeGreaterThan(0);
    const upd = db.prepare('UPDATE kv SET value = ? WHERE key = ?');
    for (const row of rows) upd.run(String(row.value).split('hello').join('zzcachedname'), row.key);
    store.close();
    expect(xray(['map', '-p', '.', '--txt', '-o', out2], proj).status).toBe(0);
    expect(fs.readFileSync(`${out2}_root.txt`, 'utf-8')).toContain('zzcachedname');
  });

  it('two projects with the same basename keep separate entries', () => {
    const one = mkProject('one', 'app');
    const two = mkProject('two', 'app');
    for (const p of [one, two]) expect(xray(['map', '-p', '.', '-o', path.join(base, 'o')], p).status).toBe(0);
    expect(cacheDbOf(one)).not.toBe(cacheDbOf(two));
    expect(fs.existsSync(cacheDbOf(one))).toBe(true);
    expect(fs.existsSync(cacheDbOf(two))).toBe(true);
    // Poison one; the other is unaffected.
    const store = open(cacheDbOf(one));
    store.db().prepare("UPDATE kv SET value = REPLACE(value, 'hello', 'zzcachedname') WHERE key LIKE 'tags:%'").run();
    store.close();
    const outOne = path.join(base, 'p1');
    const outTwo = path.join(base, 'p2');
    xray(['map', '-p', '.', '--txt', '-o', outOne], one);
    xray(['map', '-p', '.', '--txt', '-o', outTwo], two);
    expect(fs.readFileSync(`${outOne}_root.txt`, 'utf-8')).toContain('zzcachedname');
    expect(fs.readFileSync(`${outTwo}_root.txt`, 'utf-8')).not.toContain('zzcachedname');
  });

  it('cache clear removes this project only', () => {
    const one = mkProject('one', 'app');
    const two = mkProject('two', 'app');
    for (const p of [one, two]) xray(['map', '-p', '.', '-o', path.join(base, 'o')], p);
    const r = xray(['--confirm=yes', 'cache', 'clear'], one);
    expect(r.status).toBe(0);
    expect(fs.existsSync(cacheDbOf(one))).toBe(false);
    expect(fs.existsSync(cacheDbOf(two))).toBe(true);
  });

  it('cache clear with no cache: exit 0, "No cache found.", nothing created', () => {
    const proj = mkProject('proj');
    const r = xray(['--confirm=yes', 'cache', 'clear'], proj);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain('No cache found.');
    expect(tree(proj)).toEqual(['a.ts', 'b.py']);
    expect(fs.existsSync(path.join(dirs.cache, 'xray', 'projects'))).toBe(false);
  });

  it('an old ./.xray_cache.db is neither read, migrated nor deleted', () => {
    const proj = mkProject('proj');
    fs.writeFileSync(path.join(proj, '.xray_cache.db'), 'legacy bytes');
    expect(xray(['map', '-p', '.', '-o', path.join(base, 'o')], proj).status).toBe(0);
    expect(xray(['--confirm=yes', 'cache', 'clear'], proj).status).toBe(0);
    expect(fs.readFileSync(path.join(proj, '.xray_cache.db'), 'utf-8')).toBe('legacy bytes');
  });

  it('an unusable cache dir does not fail the command', () => {
    const proj = mkProject('proj');
    const blocker = path.join(base, 'blocker');
    fs.writeFileSync(blocker, 'a file where the cache dir should be');
    const r = xray(['map', '-p', '.', '--txt', '-o', path.join(base, 'o')], proj, { env: { XDG_CACHE_HOME: blocker } });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(base, 'o_root.txt'), 'utf-8')).toContain('hello');
    expect(tree(proj)).toEqual(['a.ts', 'b.py']);
  });

  it('a read-only project works when -o points elsewhere', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root ignores modes
    const proj = mkProject('ro');
    fs.chmodSync(proj, 0o555);
    for (const args of [['map', '-p', '.', '-o', path.join(base, 'o')],
      ['graph', '-p', '.', '-o', path.join(base, 'g')], ['imports', '-p', '.', '-o', path.join(base, 'i.json')], ['paths'], ['describe']]) {
      const r = xray(args, proj);
      expect({ args, status: r.status, err: r.stderr }).toEqual({ args, status: 0, err: r.stderr });
    }
    fs.chmodSync(proj, 0o755);
  });
});

const mode = (p: string) => fs.statSync(p).mode & 0o777;

(process.platform === 'win32' ? describe.skip : describe)('private to the user', () => {
  it('a fresh cache db is 0600 in a 0700 dir (sidecars too, when present)', () => {
    const proj = mkProject('proj');
    expect(xray(['map', '-p', '.', '-o', path.join(base, 'o')], proj).status).toBe(0);
    const db = cacheDbOf(proj);
    expect(mode(path.dirname(db))).toBe(0o700);
    expect(mode(db)).toBe(0o600);
    for (const side of [`${db}-wal`, `${db}-shm`]) {
      if (fs.existsSync(side)) expect(mode(side)).toBe(0o600);
    }
  });

  it('a pre-existing loose cache dir and db are tightened', () => {
    const proj = mkProject('proj');
    const db = cacheDbOf(proj);
    fs.mkdirSync(path.dirname(db), { recursive: true, mode: 0o755 });
    fs.chmodSync(path.dirname(db), 0o755);
    fs.writeFileSync(db, '');
    fs.chmodSync(db, 0o644);
    expect(xray(['map', '-p', '.', '-o', path.join(base, 'o')], proj).status).toBe(0);
    expect(mode(path.dirname(db))).toBe(0o700);
    expect(mode(db)).toBe(0o600);
  });

  it('the telemetry file is 0600 in a 0700 dir; a loose dir is tightened', () => {
    setConsent(true);
    const proj = mkProject('proj');
    const sink = telemetryOf(proj);
    fs.mkdirSync(path.dirname(sink), { recursive: true });
    fs.chmodSync(path.dirname(sink), 0o755);
    expect(xray(['paths'], proj, { tty: true }).status).toBe(0);
    expect(fs.existsSync(sink)).toBe(true);
    expect(mode(path.dirname(sink))).toBe(0o700);
    expect(mode(sink)).toBe(0o600);
  });
});

