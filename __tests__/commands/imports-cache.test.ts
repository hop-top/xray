/**
 * `xray imports` and its per-file cache, end to end (built bin): the cache
 * lands only in `$XDG_CACHE_HOME/xray/imports`, never under the root or
 * the cwd; `--no-cache` writes nothing; warm, cold and parallel runs are
 * byte-identical; hit counts only on stderr at --verbose; describe lists
 * the flag.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const FIXTURES = path.join(ROOT, '__tests__', 'fixtures', 'imports');

interface Result { status: number | null; stdout: string; stderr: string }

let sandbox: string;
let env: NodeJS.ProcessEnv;

function run(args: string[], cwd: string, cacheHome: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...env, XDG_CACHE_HOME: cacheHome }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.setEncoding('utf-8').on('data', (d: string) => (stdout += d));
    p.stderr.setEncoding('utf-8').on('data', (d: string) => (stderr += d));
    p.on('error', reject);
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Every entry under `dir` with size and mtime: a write anywhere shows up. */
function snapshotTree(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    const st = fs.lstatSync(path.join(dir, p));
    out.push(`${p} ${st.isDirectory() ? 'd' : st.size} ${st.mtimeMs}`);
    if (e.isDirectory()) out.push(...snapshotTree(dir, p));
  }
  return out;
}

const listing = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : []);

beforeAll(() => {
  if (!fs.existsSync(DIST_ENTRY)) {
    const tsc = require.resolve('typescript/bin/tsc');
    const r = spawnSync(process.execPath, [tsc], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`);
  }
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-imports-cache-cli-')));
  env = { ...process.env, HOME: sandbox, XDG_CONFIG_HOME: path.join(sandbox, 'xdg'), NO_COLOR: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('XRAY_')) delete env[k];
  env.XRAY_NO_TELEMETRY = '1';
}, 120_000);

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

/** A root (copy of every fixture), a separate cwd and cache home. */
function setup() {
  const base = fs.mkdtempSync(path.join(sandbox, 'case-'));
  const root = path.join(base, 'repo');
  fs.cpSync(FIXTURES, root, { recursive: true });
  const cwd = path.join(base, 'cwd');
  fs.mkdirSync(cwd);
  return { root, cwd, cache: path.join(base, 'cache') };
}

describe('xray imports cache', () => {
  it('cold then warm: byte-identical stdout, writes only under the cache home', async () => {
    const { root, cwd, cache } = setup();
    const rootBefore = snapshotTree(root);
    const coldNoCache = await run(['imports', '-p', root, '--no-cache'], cwd, cache);
    expect(coldNoCache.status).toBe(0);
    expect(fs.existsSync(path.join(cache, 'xray', 'imports'))).toBe(false);
    const cold = await run(['imports', '-p', root], cwd, cache);
    const warm = await run(['imports', '-p', root], cwd, cache);
    expect(cold.status).toBe(0);
    expect(warm.status).toBe(0);
    expect(cold.stderr).not.toMatch(/imports cache/);
    expect(warm.stderr).not.toMatch(/imports cache/);
    expect(cold.stdout).toBe(coldNoCache.stdout);
    expect(warm.stdout).toBe(coldNoCache.stdout);
    // Same for yaml and the row formats.
    for (const fmt of ['yaml', 'csv', 'text']) {
      const a = await run(['imports', '-p', root, '--format', fmt, '--no-cache'], cwd, cache);
      const b = await run(['imports', '-p', root, '--format', fmt], cwd, cache);
      expect(b.stdout).toBe(a.stdout);
    }
    expect(snapshotTree(root)).toEqual(rootBefore);
    expect(fs.readdirSync(cwd)).toEqual([]);
    // (xray/strategies is the strategy registration cache every command writes.)
    expect(fs.readdirSync(cache)).toEqual(['xray']);
    expect(listing(path.join(cache, 'xray', 'imports')).some(f => /^[0-9a-f]{16}\.db$/.test(f))).toBe(true);
  }, 120_000);

  it('cwd = root: the run leaves the root untouched', async () => {
    const { root, cache } = setup();
    const before = snapshotTree(root);
    expect((await run(['imports'], root, cache)).status).toBe(0);
    expect((await run(['imports'], root, cache)).status).toBe(0);
    expect(snapshotTree(root)).toEqual(before);
    expect(listing(path.join(cache, 'xray', 'imports')).length).toBeGreaterThan(0);
  }, 60_000);

  it('--no-cache writes no imports cache, not even its directory', async () => {
    const { root, cwd, cache } = setup();
    const r = await run(['imports', '-p', root, '--no-cache', '--verbose'], cwd, cache);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/imports cache/);
    expect(fs.existsSync(path.join(cache, 'xray', 'imports'))).toBe(false);
  });

  it('a cache home inside the root: runs uncached, writes no imports cache there, same output', async () => {
    const { root, cwd } = setup();
    const inside = path.join(root, '.cache');
    const a = await run(['imports', '-p', root, '--verbose'], cwd, inside);
    const b = await run(['imports', '-p', root, '--no-cache'], cwd, inside);
    expect(a.status).toBe(0);
    expect(a.stderr).toMatch(/inside the scanned root, running uncached/);
    expect(a.stdout).toBe(b.stdout);
    expect(fs.existsSync(path.join(inside, 'xray', 'imports'))).toBe(false);
  });

  it('--verbose reports hits and misses on stderr only; stdout unchanged', async () => {
    const { root, cwd, cache } = setup();
    const cold = await run(['imports', '-p', root, '--verbose'], cwd, cache);
    const warm = await run(['imports', '-p', root, '--verbose'], cwd, cache);
    // unsupported-language / grammar-missing entries have no content to extract: never cached.
    const n = (JSON.parse(cold.stdout).files as Array<{ status: string }>)
      .filter(f => f.status !== 'unsupported-language' && f.status !== 'grammar-missing').length;
    expect(cold.stderr).toMatch(new RegExp(`imports cache: 0 hits, ${n} misses \\(0 invalid\\), ${n} written`));
    expect(warm.stderr).toMatch(new RegExp(`imports cache: ${n} hits, 0 misses \\(0 invalid\\), 0 written`));
    expect(warm.stdout).toBe(cold.stdout);
    expect(cold.stdout).not.toMatch(/imports cache/);
  }, 60_000);

  it('parallel runs on one cold cache: identical output, store intact (next run all hits)', async () => {
    const { root, cwd, cache } = setup();
    const expected = (await run(['imports', '-p', root, '--no-cache'], cwd, cache)).stdout;
    const rs = await Promise.all([1, 2, 3, 4].map(() => run(['imports', '-p', root, '--verbose'], cwd, cache)));
    for (const r of rs) {
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(expected);
    }
    const after = await run(['imports', '-p', root, '--verbose'], cwd, cache);
    expect(after.stdout).toBe(expected);
    expect(after.stderr).toMatch(/imports cache: \d+ hits, 0 misses \(0 invalid\)/);
  }, 120_000);

  it('describe lists --no-cache on imports', async () => {
    const r = await run(['describe', '--format', 'json'], sandbox, path.join(sandbox, 'd-cache'));
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    const imports = doc.commands.find((c: { name: string }) => c.name === 'imports');
    expect(imports.options.map((o: { name: string }) => o.name)).toContain('--no-cache');
  });
});
