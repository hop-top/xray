/**
 * Oversized module strings: a record whose `module` (or `normalized`, or
 * Python `relative.module`) is longer than MODULE_MAX UTF-16 units is
 * emitted truncated (MODULE_MAX units + `…`), with `normalized: null`, no
 * `package` / `resolved`, `locality: unknown`, and one `oversized-module`
 * unsupported record at its start, so the file is not complete. Golden-free:
 * no fixture carries a module that long.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractImports, type ImportRecord, type ImportsSourceFile } from '../../src/lib/imports';
import { openImportsCache } from '../../src/lib/imports/cache';
import { MODULE_MAX } from '../../src/lib/imports/record';
import { expectValid } from '../support/imports-adversarial';

const BIG = 20 * 1024 * 1024;
const a = (n: number) => 'a'.repeat(n);
const run = (files: ImportsSourceFile[]) => extractImports(files, { root: '.', xrayVersion: 't' });

/** Truncated record fields + the unsupported entry at its start. */
function expectCapped(file: string, files: ImportsSourceFile[], prefix: string): ImportRecord {
  const doc = run(files);
  const f = expectValid({ ...doc, files: doc.files.filter(x => x.path === file) }, file);
  const r = f.imports.find(x => x.module.endsWith('…'));
  expect(r).toBeDefined();
  expect(r!.module).toHaveLength(MODULE_MAX + 1);
  expect(r!.module.startsWith(prefix)).toBe(true);
  expect(r!).toMatchObject({ normalized: null, locality: 'unknown' });
  expect(r!.package).toBeUndefined();
  expect(r!.resolved).toBeUndefined();
  expect(f.unsupported).toContainEqual(expect.objectContaining({ line: r!.line, column: r!.column, construct: 'oversized-module' }));
  expect(f.complete).toBe(false);
  // Every other record is untouched.
  for (const o of f.imports) if (o !== r) expect(o.module.length).toBeLessThanOrEqual(MODULE_MAX);
  return r!;
}

describe('oversized module strings: truncated, flagged, schema-valid', () => {
  it.each([
    ['typescript import', 'a.ts', `import x from "${a(BIG)}";\nimport "ok";\n`, 'aaa'],
    ['typescript node: prefix (stdlib before the cap)', 'a.ts', `import x from "node:${a(BIG)}";\n`, 'node:aaa'],
    ['javascript require', 'a.js', `require("${a(BIG)}");\nrequire("ok");\n`, 'aaa'],
    ['javascript import()', 'a.js', `import(\`${a(BIG)}\`);\n`, 'aaa'],
    ['python import (huge segment)', 'a.py', `import ${a(BIG)}\nimport ok\n`, 'aaa'],
    ['python import (long dotted path)', 'a.py', `import ${Array(200_000).fill('a').join('.')}\n`, 'a.a.a'],
    ['python from (long dotted path)', 'a.py', `from ${Array(200_000).fill('a').join('.')} import x\n`, 'a.a.a'],
    ['python __import__', 'a.py', `__import__("${a(BIG)}")\n`, 'aaa'],
    ['go import', 'a.go', `package m\n\nimport x "${a(BIG)}"\nimport "fmt"\n`, 'aaa'],
    ['rust use (huge segment)', 'a.rs', `use ${a(BIG)}::x;\nuse std::fmt;\n`, 'aaa'],
    ['rust use (long path)', 'a.rs', `use ${Array(100_000).fill('a').join('::')};\n`, 'a::a::a'],
    ['rust mod', 'a.rs', `mod ${a(BIG)};\n`, 'aaa'],
    ['php use', 'a.php', `<?php\nuse ${a(BIG)}\\X;\nuse Ok\\Fine;\n`, 'aaa'],
    ['php require literal', 'a.php', `<?php\nrequire "${a(BIG)}";\nrequire 'ok.php';\n`, 'aaa'],
    ['php include __DIR__ literal', 'a.php', `<?php\ninclude __DIR__ . '/${a(BIG)}';\n`, '__DIR__/aaa'],
  ])('%s', (_what, file, src, prefix) => {
    expectCapped(file, [{ path: file, content: src }], prefix);
  });

  it('python relative: relative.module truncated the same way, level kept', () => {
    const r = expectCapped('p/a.py', [{ path: 'p/__init__.py', content: '' }, { path: 'p/a.py', content: `from ..${a(BIG)} import x\n` }], '..aaa');
    expect(r.relative).toEqual({ level: 2, module: a(MODULE_MAX) + '…' });
  });

  it('only normalized oversized (PHP namespace prefix): normalized null, module kept', () => {
    const ns = `N${a(MODULE_MAX)}`;
    const doc = run([{ path: 'a.php', content: `<?php\nnamespace ${ns};\nnew X\\Y();\n` }]);
    const f = expectValid(doc, 'a.php');
    expect(f.imports.map(r => [r.module, r.normalized, r.package])).toEqual([['X\\Y', null, undefined]]);
    expect(f.unsupported.map(u => [u.line, u.construct])).toEqual([[3, 'oversized-module']]);
  });

  it('truncation never splits a surrogate pair', () => {
    // 'b' + pairs: unit MODULE_MAX - 1 is a high surrogate, dropped with its low half.
    const doc = run([{ path: 'a.ts', content: `import x from "b${'😀'.repeat(MODULE_MAX)}";\n` }]);
    expect(expectValid(doc, 'a.ts').imports[0].module).toBe(`b${'😀'.repeat(MODULE_MAX / 2 - 1)}…`);
  });

  it('at the cap: a module of exactly MODULE_MAX units is emitted as is', () => {
    const doc = run([{ path: 'a.ts', content: `import x from "${a(MODULE_MAX)}";\n` }]);
    const f = expectValid(doc, 'a.ts');
    expect(f.imports.map(r => r.module)).toEqual([a(MODULE_MAX)]);
    expect([f.unsupported, f.complete]).toEqual([[], true]);
  });

  it('resolution skips the truncated record (go.mod prefix match would make it local)', () => {
    const files = [
      { path: 'go.mod', content: 'module example.com/m\n\nrequire example.com/dep v1.0.0\n' },
      { path: 'a.go', content: `package m\n\nimport (\n\t"example.com/m/${a(BIG)}"\n\t"example.com/dep/${a(BIG)}"\n\t"example.com/m/ok"\n)\n` },
    ];
    const doc = run(files);
    const f = doc.files.find(x => x.path === 'a.go')!;
    expect(f.imports.map(r => [r.module.length, r.locality, r.package])).toEqual([
      [MODULE_MAX + 1, 'unknown', undefined],
      [MODULE_MAX + 1, 'unknown', undefined],
      ['example.com/m/ok'.length, 'local', 'example.com/m'],
    ]);
  });

  it('cache: entries carry the truncated record; cold == warm', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-imports-oversized-')));
    try {
      const files = [{ path: 'a.ts', content: `import x from "${a(BIG)}";\n` }, { path: 'b.py', content: `import ${a(BIG)}\n` }];
      const cold = JSON.stringify(run(files));
      const dir = path.join(tmp, 'cache', 'imports');
      const warm = [0, 1].map(() => {
        const cache = openImportsCache(path.join(tmp, 'root'), { dir })!;
        try {
          return { json: JSON.stringify(extractImports(files, { root: '.', xrayVersion: 't', cache })), stats: { ...cache.stats } };
        } finally {
          cache.close();
        }
      });
      expect(warm.map(w => w.json)).toEqual([cold, cold]);
      expect(warm[1].stats).toEqual({ hits: 2, misses: 0, invalid: 0, writes: 0 });
      expect(cold.length).toBeLessThan(64 * 1024);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
