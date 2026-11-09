/**
 * `xray imports --no-ignore`: every source under the root is listed, git
 * ignores and nested repos notwithstanding; the default listing is
 * unchanged; the per-file cache serves both modes identically.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleImportsAction } from '../../src/commands/imports';
import { collectImportFiles } from '../../src/lib/imports/collect';
import { ImportsDoc } from '../../src/lib/imports';

let sandbox: string;
let repo: string;
const savedXdg = process.env.XDG_CACHE_HOME;

const put = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), content);
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const paths = (root: string, includeIgnored?: boolean) => collectImportFiles(root, { includeIgnored }).map(f => f.path);

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-noignore-'));
  repo = path.join(sandbox, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q');
  put('.gitignore', 'gen/\nnode_modules/\n');
  put('src/a.ts', "import { b } from './b';\n");
  put('src/b.ts', 'export const b = 1;\n');
  put('gen/ignored.py', 'import os\n');
  put('node_modules/dep/index.js', "require('x');\n");
  put('node_modules/react/package.json', '{"name":"react"}\n');
  put('web/package.json', '{"name":"web","dependencies":{"react":"1"}}\n');
  put('web/use.ts', "import 'react';\n");
    put('legacy/lib.rb', "require 'x'\n");
  git('add', '.gitignore', 'src', 'web');
  // Nested repo: git lists it as one untracked dir at best, never its files.
  put('vendor/inner/main.go', 'package main\n');
  execFileSync('git', ['init', '-q'], { cwd: path.join(repo, 'vendor', 'inner') });
  put('vendor/inner/.git/HEAD.ts', 'export {};\n');
  fs.symlinkSync(path.join(repo, 'src'), path.join(repo, 'loop'));
  fs.symlinkSync(path.join(repo, 'src', 'b.ts'), path.join(repo, 'link.ts'));
  fs.writeFileSync(path.join(sandbox, 'outside.ts'), 'export {};\n');
  fs.symlinkSync(path.join(sandbox, 'outside.ts'), path.join(repo, 'escape.ts'));
  process.env.XDG_CACHE_HOME = path.join(sandbox, 'cache');
});

afterAll(() => {
  if (savedXdg === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedXdg;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('collectImportFiles includeIgnored', () => {
  it('default listing omits ignored files, vendored dirs and nested repos', () => {
    const p = paths(repo);
    expect(p).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts', 'web/use.ts']));
    expect(p.some(x => x.startsWith('gen/') || x.startsWith('node_modules/') || x.startsWith('vendor/'))).toBe(false);
  });

  it('lists git-ignored files, nested-repo files and node_modules; skips .git', () => {
    const p = paths(repo, true);
    expect(p).toEqual(expect.arrayContaining([
      'gen/ignored.py', 'node_modules/dep/index.js', 'vendor/inner/main.go', 'src/a.ts', 'legacy/lib.rb',
    ]));
    expect(p.some(x => x.split('/').includes('.git'))).toBe(false);
  });

  it('does not follow directory symlinks; file symlinks count only inside the root', () => {
    const p = paths(repo, true);
    expect(p.some(x => x.startsWith('loop/'))).toBe(false);
    expect(p).toContain('link.ts');
    expect(p).not.toContain('escape.ts');
  });

  it('vendored package.json files are not resolution inputs', () => {
    const p = paths(repo, true);
    expect(p).not.toContain('node_modules/react/package.json');
    expect(p).toContain('web/package.json');
  });
});

describe('handleImportsAction --no-ignore', () => {
  const byPath = (d: ImportsDoc) => Object.fromEntries(d.files.map(f => [f.path, f]));

  it('reports ignored sources, with a status for those not parsed', () => {
    const d = handleImportsAction([], { path: repo, ignore: false, cache: false });
    const f = byPath(d);
    expect(f['gen/ignored.py'].status).toBe('ok');
    expect(f['node_modules/dep/index.js']).toBeDefined();
    expect(f['vendor/inner/main.go']).toBeDefined();
    expect(f['src/a.ts']).toBeDefined();
    // Known source without an import extractor: listed, not parsed.
    expect(f['legacy/lib.rb'].status).toBe('unsupported-language');
  });

  it('keeps resolution of non-vendored files: bare react stays external', () => {
    const def = byPath(handleImportsAction([], { path: repo, cache: false }));
    const all = byPath(handleImportsAction([], { path: repo, ignore: false, cache: false }));
    expect(all['web/use.ts']).toEqual(def['web/use.ts']);
  });

  it('default output is unchanged by the option existing', () => {
    const a = handleImportsAction([], { path: repo, cache: false });
    expect(a.files.map(f => f.path)).toEqual(paths(repo).filter(x => !x.endsWith('package.json')));
  });

  it('cache never serves one listing to the other mode', () => {
    const opts = { path: repo };
    const coldDefault = handleImportsAction([], { ...opts, cache: false });
    const coldAll = handleImportsAction([], { ...opts, ignore: false, cache: false });
    // Warm in the order all -> default -> all -> default; each must equal its uncached twin.
    const w1 = handleImportsAction([], { ...opts, ignore: false });
    const w2 = handleImportsAction([], { ...opts });
    const w3 = handleImportsAction([], { ...opts, ignore: false });
    const w4 = handleImportsAction([], { ...opts });
    expect(w1).toEqual(coldAll);
    expect(w3).toEqual(coldAll);
    expect(w2).toEqual(coldDefault);
    expect(w4).toEqual(coldDefault);
    expect(coldAll.files.length).toBeGreaterThan(coldDefault.files.length);
  });
});
