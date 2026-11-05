/**
 * Merged-graph cache for multi-root `impact`: keyed by the sorted absolute
 * roots (plus build options), each root fingerprinted by its scanned file
 * set (path, mtime, size). Unchanged roots are served from the project's
 * cache db (user cache dir, keyed by the cwd); a changed root alone is rebuilt. stderr reports
 * `cache: <label> hit|miss` per root.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { projectCacheDbPath } from '../../src/lib/storage';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let work: string;

const write = (rel: string, body: string, mtime?: Date) => {
  const f = path.join(work, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  if (mtime) fs.utimesSync(f, mtime, mtime);
};

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, '--no-telemetry', ...args], {
    cwd: work,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0', XDG_CONFIG_HOME: path.join(work, '.xdg') },
    timeout: 120_000,
  });
}

function impact(...extra: string[]) {
  const r = run(['impact', 'Hello', '--format', 'json', ...extra]);
  expect(r.status).toBe(0);
  const cache = r.stderr.split('\n').filter(l => /(^|\s)cache: /.test(l)).map(l => l.slice(l.indexOf('cache: ')));
  const callers = JSON.parse(r.stdout).nodes.map((n: any) => `${n.name} ${n.group} ${n.confidence}`).sort();
  return { cache, callers, stderr: r.stderr };
}

const P = ['-p', 'alpha', '-p', 'beta'];
const BETA = (callers: string) =>
  `package main\n\nimport "example.com/alpha/greet"\n\n${callers}`;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-graph-cache-'));
  write('alpha/go.mod', 'module example.com/alpha\n\ngo 1.22\n');
  write('alpha/greet/greet.go', 'package greet\n\nfunc Hello() string { return "hi" }\n');
  write('beta/go.mod', 'module example.com/beta\n\ngo 1.22\n');
  write('beta/main.go', BETA('func Run() { greet.Hello() }\n'), new Date('2024-01-01T00:00:00Z'));
  write('.xrayrc.json', JSON.stringify({
    lenses: { labspace: { paths: [path.join(work, 'beta'), path.join(work, 'alpha')] } },
  }));
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('merged-graph cache (impact, multi-root)', () => {
  test('first run: every root misses; result has the cross-root caller', () => {
    const r = impact(...P);
    expect(r.cache).toEqual(['cache: alpha miss · beta miss']);
    expect(r.callers).toEqual(['Run beta EXTRACTED']);
    expect(r.stderr).toMatch(/coverage: \d+ files parsed/);
  });

  test('unchanged roots: every root hits, same result', () => {
    const r = impact(...P);
    expect(r.cache).toEqual(['cache: alpha hit · beta hit']);
    expect(r.callers).toEqual(['Run beta EXTRACTED']);
    expect(r.stderr).toMatch(/coverage: served from cache \(\d+ files\)/);
    expect(r.stderr).not.toMatch(/files parsed/);
  });

  test('--lens over the same roots (other order) shares the cache entry', () => {
    const r = impact('--lens', 'labspace');
    expect(r.cache).toEqual(['cache: beta hit · alpha hit']);
    expect(r.callers).toEqual(['Run beta EXTRACTED']);
  });

  test('file edit in one root: only that root misses, and its change shows', () => {
    write('beta/main.go', BETA('func Run() { greet.Hello() }\n\nfunc Run2() { greet.Hello() }\n'),
      new Date('2025-01-01T00:00:00Z'));
    const r = impact(...P);
    expect(r.cache).toEqual(['cache: alpha hit · beta miss']);
    expect(r.callers).toEqual(['Run beta EXTRACTED', 'Run2 beta EXTRACTED']);
    expect(impact(...P).cache).toEqual(['cache: alpha hit · beta hit']);
  });

  test('edit in the callee root rebuilds it and re-links the other (cached) root', () => {
    write('alpha/greet/greet.go', 'package greet\n\nfunc Hello() string { return "hey" }\n\nfunc Other() {}\n',
      new Date('2025-06-01T00:00:00Z'));
    const r = impact(...P);
    expect(r.cache).toEqual(['cache: alpha miss · beta hit']);
    expect(r.callers).toEqual(['Run beta EXTRACTED', 'Run2 beta EXTRACTED']);
  });

  test('new file in a root is a miss for that root', () => {
    write('beta/extra.go', BETA('func Run3() { greet.Hello() }\n'));
    const r = impact(...P);
    expect(r.cache).toEqual(['cache: alpha hit · beta miss']);
    expect(r.callers).toEqual(['Run beta EXTRACTED', 'Run2 beta EXTRACTED', 'Run3 beta EXTRACTED']);
  });

  test('different build options do not share entries', () => {
    expect(impact(...P, '--lang', 'go').cache).toEqual(['cache: alpha miss · beta miss']);
    expect(impact(...P, '--lang', 'go').cache).toEqual(['cache: alpha hit · beta hit']);
  });

  test('single root: no cache line', () => {
    expect(impact('-p', 'beta').cache).toEqual([]);
  });

  test('the cache lives in the user cache dir (keyed by the cwd), not in the cwd or the roots', () => {
    expect(fs.existsSync(projectCacheDbPath(work)!)).toBe(true);
    expect(fs.existsSync(path.join(work, '.xray_cache.db'))).toBe(false);
    expect(fs.existsSync(path.join(work, 'alpha', '.xray_cache.db'))).toBe(false);
  });
});
