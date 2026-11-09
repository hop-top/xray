/**
 * Imports cache (src/lib/imports/cache.ts): a warm run returns the cold
 * document byte for byte on every golden fixture, every untrusted or stale
 * entry is a miss with identical output, and the store lives outside the
 * scanned root with private permissions.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { Logger } from '../../src/lib/logger';
import { extractImports, IMPORTS_EXTRACTOR_VERSION, type ImportsSourceFile } from '../../src/lib/imports';
import { importsCacheDir, openImportsCache, type ImportsCache } from '../../src/lib/imports/cache';
import { IMPORT_LANGUAGES } from '../../src/lib/imports/languages';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('@hop-top/kit/sqlstore') as {
  open: (p: string) => { get<T>(k: string): T | null; put(k: string, v: unknown): void; db(): { prepare(s: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }; close(): void };
};

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'imports');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function inputs(dir: string, rel = ''): ImportsSourceFile[] {
  const out: ImportsSourceFile[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...inputs(dir, p));
    else if (p !== 'expected.json') out.push({ path: p, content: fs.readFileSync(path.join(dir, p)) });
  }
  return out.sort((a, b) => cmp(a.path, b.path));
}

function cases(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const lang of fs.readdirSync(FIXTURES).sort()) {
    const langDir = path.join(FIXTURES, lang);
    if (!fs.statSync(langDir).isDirectory()) continue;
    for (const name of fs.readdirSync(langDir).sort()) {
      const dir = path.join(langDir, name);
      if (fs.statSync(dir).isDirectory()) out.push([`${lang}/${name}`, dir]);
    }
  }
  return out;
}

let tmp: string;
beforeAll(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-imports-cache-'))); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

let n = 0;
const freshDir = () => path.join(tmp, `c${++n}`, 'imports');

/** One extraction through a cache opened for `root`; returns JSON + stats. */
function cachedRun(root: string, files: ImportsSourceFile[], dir: string) {
  const cache = openImportsCache(root, { dir });
  expect(cache).toBeDefined();
  try {
    return { json: JSON.stringify(extractImports(files, { root: '.', xrayVersion: 'x', cache })), cache: cache! };
  } finally {
    cache!.close();
  }
}

const cold = (files: ImportsSourceFile[]) => JSON.stringify(extractImports(files, { root: '.', xrayVersion: 'x' }));

/** Files that go through the cache: no content to extract for the other statuses. */
const BYPASS = new Set(['unsupported-language', 'grammar-missing']);
const cacheable = (files: Array<{ status: string }>) => files.filter(f => !BYPASS.has(f.status));

describe('imports cache: cold == warm on every golden fixture', () => {
  it.each(cases())('%s', (_id, dir) => {
    const files = inputs(dir);
    const expected = cold(files);
    const cacheDir = freshDir();
    const first = cachedRun(dir, files, cacheDir);
    const second = cachedRun(dir, files, cacheDir);
    expect(first.json).toBe(expected);
    expect(second.json).toBe(expected);
    const parsed = cacheable(JSON.parse(expected).files).length;
    expect(first.cache.stats).toEqual({ hits: 0, misses: parsed, invalid: 0, writes: parsed });
    expect(second.cache.stats).toEqual({ hits: parsed, misses: 0, invalid: 0, writes: 0 });
  });
});

describe('imports cache: coverage output (unsupported, parse errors, status)', () => {
  const coverage = cases().filter(([id]) => /\/(unsupported-|parse-error)/.test(id));

  it('the coverage fixtures exist', () => {
    expect(coverage.map(([id]) => id)).toEqual(expect.arrayContaining([
      'go/unsupported-cgo-plugin-linkname', 'javascript/unsupported-dynamic', 'none/unsupported-language',
      'php/unsupported-dynamic', 'python/parse-error', 'python/unsupported-dynamic',
      'rust/unsupported-include-build', 'typescript/unsupported-create-require',
    ]));
  });

  it.each(coverage)('%s: cold == warm, warm all hits, nothing invalid', (_id, dir) => {
    const files = inputs(dir);
    const expected = cold(files);
    const cacheDir = freshDir();
    const first = cachedRun(dir, files, cacheDir);
    const second = cachedRun(dir, files, cacheDir);
    expect(first.json).toBe(expected);
    expect(second.json).toBe(expected);
    const n = cacheable(JSON.parse(expected).files).length;
    expect(second.cache.stats).toEqual({ hits: n, misses: 0, invalid: 0, writes: 0 });
  });

  it('every construct, status and parse-error kind a cold run emits is accepted on read', () => {
    const files = coverage.flatMap(([id, dir]) => inputs(dir).map(f => ({ ...f, path: `${id}/${f.path}` })));
    const doc = JSON.parse(cold(files));
    const statuses = new Set(doc.files.map((f: { status: string }) => f.status));
    expect([...statuses].sort()).toEqual(['ok', 'parse-error', 'unsupported-language']);
    const constructs = new Set(doc.files.flatMap((f: { unsupported: Array<{ construct: string }> }) => f.unsupported.map(u => u.construct)));
    expect(constructs).toContain('dynamic-call');
    const root = fs.mkdtempSync(path.join(tmp, 'r-'));
    const dir = freshDir();
    cachedRun(root, files, dir);
    const warm = cachedRun(root, files, dir);
    expect(warm.json).toBe(JSON.stringify(doc));
    expect(warm.cache.stats).toEqual({ hits: cacheable(doc.files).length, misses: 0, invalid: 0, writes: 0 });
  });

  it('unsupported-language files bypass the cache', () => {
    const dir = path.join(FIXTURES, 'none', 'unsupported-language');
    const files = inputs(dir);
    const doc = JSON.parse(cold(files));
    const unclaimed = doc.files.filter((f: { status: string }) => f.status === 'unsupported-language');
    expect(unclaimed.length).toBeGreaterThan(0);
    const cacheDir = freshDir();
    const first = cachedRun(dir, files, cacheDir);
    expect(first.cache.stats).toEqual({ hits: 0, misses: doc.files.length - unclaimed.length, invalid: 0, writes: doc.files.length - unclaimed.length });
    const warm = cachedRun(dir, files, cacheDir);
    expect(warm.cache.stats).toEqual({ hits: doc.files.length - unclaimed.length, misses: 0, invalid: 0, writes: 0 });
  });

  it('a file whose extraction threw is not written to the cache', () => {
    const original = IMPORT_LANGUAGES.python.extract;
    const files = [{ path: 'bad.py', content: 'import os\n' }, { path: 'good.py', content: 'import sys\n' }];
    const root = fs.mkdtempSync(path.join(tmp, 'r-'));
    const dir = freshDir();
    try {
      IMPORT_LANGUAGES.python.extract = (r, ctx) => {
        if (ctx.path === 'bad.py') throw new Error('boom');
        return original(r, ctx);
      };
      const first = cachedRun(root, files, dir);
      expect(JSON.parse(first.json).files[0].status).toBe('parse-error');
      expect(first.cache.stats.writes).toBe(1);
    } finally {
      IMPORT_LANGUAGES.python.extract = original;
    }
    const warm = cachedRun(root, files, dir);
    expect(warm.json).toBe(cold(files));
    expect(JSON.parse(warm.json).files[0].status).toBe('ok');
    expect(warm.cache.stats).toEqual({ hits: 1, misses: 1, invalid: 0, writes: 1 });
  });

  it('isolation covers the cache lookup: a throwing cache.get yields that file only as parse-error', () => {
    const files = [{ path: 'a.py', content: 'import os\n' }, { path: 'b.py', content: 'import sys\n' }];
    const cache: ImportsCache = {
      get: (k) => { if (k.path === 'a.py') throw new Error('store exploded'); return undefined; },
      set: () => undefined,
      stats: { hits: 0, misses: 0, invalid: 0, writes: 0 },
      file: 'x',
      close: () => undefined,
    };
    const doc = extractImports(files, { root: '.', xrayVersion: 'x', cache });
    expect(doc.files.map(f => f.status)).toEqual(['parse-error', 'ok']);
    expect(doc.files[1].imports.map(i => i.module)).toEqual(['sys']);
  });

  it('Cargo build scripts depend on Cargo.toml, not the cached file: applied after the cache', () => {
    const withBuild = [
      { path: 'Cargo.toml', content: '[package]\nname = "x"\nbuild = "gen.rs"\n' },
      { path: 'gen.rs', content: 'fn main() {}\n' },
    ];
    const without = [{ path: 'Cargo.toml', content: '[package]\nname = "x"\n' }, withBuild[1]];
    const root = fs.mkdtempSync(path.join(tmp, 'r-'));
    const dir = freshDir();
    const first = cachedRun(root, withBuild, dir);
    expect(first.json).toBe(cold(withBuild));
    expect(first.json).toContain('"build-script"');
    const warm = cachedRun(root, without, dir);
    expect(warm.cache.stats.hits).toBe(1);
    expect(warm.json).toBe(cold(without));
    expect(warm.json).not.toContain('"build-script"');
    const back = cachedRun(root, withBuild, dir);
    expect(back.cache.stats.hits).toBe(1);
    expect(back.json).toBe(cold(withBuild));
  });
});

describe('imports cache: untrusted entries are misses', () => {
  const root = path.join(FIXTURES, 'python', 'relative');
  const files = inputs(root);
  const target = 'app/pkg/mod.py';

  /** Warm a fresh cache, rewrite the target's row, then re-run. */
  function tampered(mutate: (stored: any, raw: { put: (v: unknown) => void; putRaw: (s: string) => void }) => void) {
    const dir = freshDir();
    const warm = cachedRun(root, files, dir);
    const db = open(warm.cache.file);
    const key = `imports:${target}`;
    const stored = db.get<any>(key);
    expect(stored).not.toBeNull();
    mutate(stored, {
      put: (v) => db.put(key, v),
      putRaw: (s) => db.db().prepare('UPDATE kv SET value = ? WHERE key = ?').run(s, key),
    });
    db.close();
    const again = cachedRun(root, files, dir);
    const third = cachedRun(root, files, dir);
    return { again, third };
  }

  const sum = (v: unknown) => require('crypto').createHash('sha256').update(JSON.stringify(v)).digest('hex');

  it.each([
    ['malformed JSON', (_s: any, raw: any) => raw.putRaw('{"key":')],
    ['value edited, checksum stale', (s: any, raw: any) => { s.value.imports[0].module = 'evil'; raw.put(s); }],
    ['value edited, checksum recomputed, extra field', (s: any, raw: any) => {
      s.value.imports[0].extra = 1; s.sum = sum(s.value); raw.put(s);
    }],
    ['value edited, checksum recomputed, bad enum', (s: any, raw: any) => {
      s.value.imports[0].kind = 'magic'; s.sum = sum(s.value); raw.put(s);
    }],
    ['value edited, checksum recomputed, sha256 of other content', (s: any, raw: any) => {
      s.value.sha256 = 'f'.repeat(64); s.sum = sum(s.value); raw.put(s);
    }],
    ['wrong envelope', (_s: any, raw: any) => raw.put([1, 2, 3])],
    ['identity of other content', (s: any, raw: any) => { s.key = s.key.replace(/^[0-9a-f]{64}/, '0'.repeat(64)); raw.put(s); }],
  ])('%s: miss, identical output, entry rewritten', (_what, mutate) => {
    const { again, third } = tampered(mutate);
    expect(again.json).toBe(cold(files));
    expect(again.cache.stats.invalid).toBe(1);
    expect(again.cache.stats.misses).toBe(1);
    expect(again.cache.stats.writes).toBe(1);
    expect(third.cache.stats.misses).toBe(0);
    expect(third.json).toBe(cold(files));
  });

  it('a validly shaped, re-checksummed edit with the right identity is the one thing the cache trusts', () => {
    // Documents the trust boundary: shape + identity + checksum, not authenticity.
    const { again } = tampered((s, raw) => { s.value.imports[0].evidence = 'edited'; s.sum = sum(s.value); raw.put(s); });
    expect(again.cache.stats.hits).toBe(files.filter(f => f.path.endsWith('.py')).length);
  });
});

describe('imports cache: key components', () => {
  const root = path.join(FIXTURES, 'python', 'relative');
  const files = inputs(root);

  function keyOf(c: ImportsCache, overrides: Record<string, unknown>) {
    const f = files.find(x => x.path === 'app/pkg/mod.py')!;
    const sha256 = require('crypto').createHash('sha256').update(f.content).digest('hex');
    const pkg = JSON.parse(fs.readFileSync(require.resolve('tree-sitter-python/package.json'), 'utf8'));
    return {
      path: f.path, sha256, extractor: IMPORTS_EXTRACTOR_VERSION, language: 'python',
      grammar: { module: 'tree-sitter-python', version: pkg.version, source: 'xray' }, ...overrides,
    } as Parameters<ImportsCache['get']>[0];
  }

  it.each([
    ['extractor version bump', { extractor: '99.0.0' }],
    ['grammar version bump', { grammar: { module: 'tree-sitter-python', version: '99.0.0', source: 'xray' } }],
    ['grammar source change', { grammar: { module: 'tree-sitter-python', version: 'x', source: 'user' } }],
    ['content change', { sha256: 'a'.repeat(64) }],
    ['other language', { language: 'go' }],
  ])('%s -> miss', (_what, overrides) => {
    const dir = freshDir();
    cachedRun(root, files, dir);
    const c = openImportsCache(root, { dir })!;
    try {
      expect(c.get(keyOf(c, {}))).toBeDefined();
      expect(c.get(keyOf(c, overrides))).toBeUndefined();
      expect(c.stats).toEqual({ hits: 1, misses: 1, invalid: 1, writes: 0 });
    } finally {
      c.close();
    }
  });

  it.each(['0.3.0', '0.4.0', '0.5.0'])('an entry written by extractor %s is a miss under the current extractor (0.6.0)', stale => {
    // 0.4.0: unsupported[] / parseErrors[] / status output; a 0.3.0 entry lacks them.
    // 0.5.0: oversized module strings truncated; a 0.4.0 entry may hold one at full size.
    // 0.6.0: module strings decoded, PHP / Python / Rust names normalized; a 0.5.0 entry holds the old values.
    expect(IMPORTS_EXTRACTOR_VERSION).toBe('0.6.0');
    const dir = freshDir();
    const c = openImportsCache(root, { dir })!;
    const old = JSON.parse(cold(files)).files.find((f: { path: string }) => f.path === 'app/pkg/mod.py');
    const { path: _p, ...entry } = old;
    c.set(keyOf(c, { extractor: stale }), entry);
    c.close();
    const warm = cachedRun(root, files, dir);
    expect(warm.json).toBe(cold(files));
    expect(warm.cache.stats.invalid).toBe(1);
    expect(warm.cache.stats.hits).toBe(0);
  });

  it('same content at another path is a separate entry (extraction reads the path)', () => {
    const src = Buffer.from("import importlib\nimportlib.import_module('.x', package=__name__)\n");
    const dir = freshDir();
    const a = [{ path: 'pkg/__init__.py', content: src }];
    const b = [{ path: 'pkg/mod.py', content: src }];
    const root = fs.mkdtempSync(path.join(tmp, 'r-'));
    const warmA = cachedRun(root, a, dir);
    const coldB = cold(b);
    expect(JSON.parse(coldB).files[0].imports).not.toEqual(JSON.parse(warmA.json).files[0].imports);
    expect(cachedRun(root, b, dir).json).toBe(coldB);
  });

  it('resolution is recomputed per run: cached entries carry no `resolved`', () => {
    const dir = freshDir();
    const withSibling = [
      { path: 'a.py', content: 'from . import b\nimport b\n' },
      { path: 'b.py', content: '' },
    ];
    const alone = [withSibling[0]];
    const root = fs.mkdtempSync(path.join(tmp, 'r-'));
    const first = cachedRun(root, withSibling, dir);
    expect(first.json).toContain('"resolved"');
    const warm = cachedRun(root, alone, dir);
    expect(warm.cache.stats.hits).toBe(1);
    expect(warm.json).toBe(cold(alone));
    expect(warm.json).not.toContain('"resolved"');
  });
});

describe('imports cache: location', () => {
  const files = [{ path: 'a.py', content: 'import os\n' }];

  it('under the platform cache dir, honouring XDG_CACHE_HOME; relative XDG_CACHE_HOME is ignored', () => {
    const prev = process.env.XDG_CACHE_HOME;
    try {
      process.env.XDG_CACHE_HOME = path.join(tmp, 'xdg-cache');
      expect(importsCacheDir()).toBe(path.join(tmp, 'xdg-cache', 'xray', 'imports'));
      process.env.XDG_CACHE_HOME = 'rel/cache';
      expect(importsCacheDir()).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = prev;
    }
  });

  it('never inside the scanned root (directly, nested or through a symlink)', () => {
    const root = fs.mkdtempSync(path.join(tmp, 'root-'));
    const link = path.join(tmp, `link-${n}`);
    fs.symlinkSync(root, link);
    expect(openImportsCache(root, { dir: root })).toBeUndefined();
    expect(openImportsCache(root, { dir: path.join(root, 'deep', 'cache') })).toBeUndefined();
    expect(openImportsCache(link, { dir: path.join(root, 'c') })).toBeUndefined();
    expect(openImportsCache(root, { dir: path.join(link, 'c') })).toBeUndefined();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('one store per root, directory 0700, file 0600', () => {
    const dir = freshDir();
    const r1 = fs.mkdtempSync(path.join(tmp, 'r1-'));
    const r2 = fs.mkdtempSync(path.join(tmp, 'r2-'));
    const a = cachedRun(r1, files, dir).cache.file;
    const b = cachedRun(r2, files, dir).cache.file;
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(a).mode & 0o777).toBe(0o600);
  });

  it('an unusable store (a directory where the file goes) runs uncached', () => {
    const dir = freshDir();
    const root = fs.mkdtempSync(path.join(tmp, 'r-'));
    const probe = cachedRun(root, files, dir).cache.file;
    fs.rmSync(probe);
    fs.mkdirSync(probe);
    expect(openImportsCache(root, { dir })).toBeUndefined();
  });
});

(process.platform === 'win32' ? describe.skip : describe)('imports cache: hostile shared cache dir', () => {
  const savedXdg = process.env.XDG_CACHE_HOME;
  const mode = (p: string) => fs.statSync(p).mode & 0o777;
  afterEach(() => {
    jest.restoreAllMocks();
    if (savedXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = savedXdg;
  });
  const setup = () => {
    const base = fs.mkdtempSync(path.join(tmp, 'h-'));
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    const sentinel = path.join(outside, 'sentinel');
    fs.writeFileSync(sentinel, 'secret');
    fs.chmodSync(sentinel, 0o644);
    const root = path.join(base, 'root');
    fs.mkdirSync(root);
    return { base, outside, sentinel, root };
  };

  it('a planted symlink where the xray dir belongs: no cache, one warning, nothing created outside', () => {
    const { base, outside, root } = setup();
    const shared = path.join(base, 'shared');
    fs.mkdirSync(shared);
    fs.symlinkSync(outside, path.join(shared, 'xray'));
    process.env.XDG_CACHE_HOME = shared;
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(openImportsCache(root)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(outside)).toEqual(['sentinel']);
  });

  it('a planted symlink at the db path: no cache, target untouched', () => {
    const { base, sentinel, root } = setup();
    const dir = path.join(base, 'cache', 'imports');
    fs.mkdirSync(dir, { recursive: true });
    const id = createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16);
    // an empty file is a valid (empty) sqlite db: the store would happily adopt it
    fs.writeFileSync(sentinel, '');
    fs.symlinkSync(sentinel, path.join(dir, `${id}.db`));
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(openImportsCache(root, { dir })).toBeUndefined();
    expect(mode(sentinel)).toBe(0o644);
    expect(fs.statSync(sentinel).size).toBe(0);
  });

  it('a cache dir owned by someone else (uid injected): no cache, one warning', () => {
    const { base, root } = setup();
    const dir = path.join(base, 'cache', 'imports');
    fs.mkdirSync(dir, { recursive: true });
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(openImportsCache(root, { dir, uid: process.getuid!() + 1 })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('the db and its sidecars end up 0600 in a 0700 dir', () => {
    const { base, root } = setup();
    const dir = path.join(base, 'cache2', 'imports');
    const c = openImportsCache(root, { dir })!;
    expect(c).toBeDefined();
    c.close();
    expect(mode(dir)).toBe(0o700);
    expect(mode(c.file)).toBe(0o600);
  });
});
