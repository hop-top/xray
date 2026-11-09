import { extractImports, type ImportsSourceFile } from '../../src/lib/imports';
import { resolveImports } from '../../src/lib/imports/resolve';
import { applyResolution } from '../../src/lib/imports/resolve/context';
import { nodeBuiltin } from '../../src/lib/imports/resolve/ecmascript';
import { NODE_BUILTINS, NODE_BUILTINS_VERSION, NODE_PREFIX_ONLY_BUILTINS } from '../../src/lib/imports/resolve/node-builtins';
import { PYTHON_STDLIB } from '../../src/lib/imports/resolve/python-stdlib';
import type { FileImports, ImportRecord } from '../../src/lib/imports/types';

// Targeted checks for the resolution pass; full trees are pinned by the
// goldens under __tests__/fixtures/imports/resolve/.

const doc = (files: Record<string, string>) =>
  extractImports(
    Object.entries(files).map(([path, content]): ImportsSourceFile => ({ path, content })),
    // A root that does not exist: resolution only sees the file set.
    { root: '/nonexistent/xray-resolve-root', xrayVersion: 'test' },
  );

const recs = (files: Record<string, string>, path: string) => {
  const f = doc(files).files.find(x => x.path === path);
  if (!f) throw new Error(`no entry for ${path}`);
  return f.imports;
};

const loc = (rs: ImportRecord[]) =>
  Object.fromEntries(rs.map(r => [r.module, [r.locality, r.package ?? null, r.normalized, r.resolved ?? null]]));

describe('resolution: TS/JS', () => {
  it('builtins bare and prefixed; prefix-only builtins need the prefix', () => {
    const rs = recs({ 'a.ts': "import 'fs';\nimport 'fs/promises';\nimport 'node:test';\nimport 'test';\n" }, 'a.ts');
    expect(loc(rs)).toEqual({
      fs: ['stdlib', 'fs', 'fs', null],
      'fs/promises': ['stdlib', 'fs', 'fs/promises', null],
      'node:test': ['stdlib', 'test', 'test', null],
      test: ['unknown', 'test', 'test', null],
    });
  });

  it('builtin set is vendored: the running Node `module.builtinModules` does not change output', () => {
    const files = {
      'a.ts': "import 'fs';\nimport 'node:sqlite';\nimport 'sqlite';\nimport 'madeup';\nimport 'node:madeup-only';\n",
    };
    const baseline = loc(recs(files, 'a.ts'));
    expect(baseline).toEqual({
      fs: ['stdlib', 'fs', 'fs', null],
      'node:sqlite': ['stdlib', 'sqlite', 'sqlite', null],
      sqlite: ['unknown', 'sqlite', 'sqlite', null],
      madeup: ['unknown', 'madeup', 'madeup', null],
      // `node:` is stdlib by prefix in the extractor; resolution leaves it alone.
      'node:madeup-only': ['stdlib', 'madeup-only', 'madeup-only', null],
    });
    // Same records through a resolver loaded against a different Node
    // (drops `fs`, adds `madeup` bare and `sqlite` without the prefix).
    // Only the resolver module is reloaded: the parser stays in the outer registry;
    // the records' locality comes from nodeBuiltin, so equal answers = equal output.
    const specs = Object.keys(baseline);
    let isolated: Array<string | undefined> = [];
    jest.isolateModules(() => {
      jest.doMock('module', () => ({
        ...jest.requireActual<typeof import('module')>('module'),
        builtinModules: ['madeup', 'sqlite', 'node:madeup-only'],
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../../src/lib/imports/resolve/ecmascript') as typeof import('../../src/lib/imports/resolve/ecmascript');
      // Called while the mock is live: catches reads at load time and at call time.
      isolated = specs.map(s => mod.nodeBuiltin(s));
    });
    jest.dontMock('module');
    expect(isolated).toEqual(specs.map(s => nodeBuiltin(s)));
  });

  it('vendored Node builtin list: prefix-only modules listed apart, none overlap', () => {
    expect(NODE_BUILTINS.has('fs')).toBe(true);
    expect(NODE_BUILTINS.has('fs/promises')).toBe(true);
    expect(NODE_BUILTINS.has('test')).toBe(false);
    expect(NODE_PREFIX_ONLY_BUILTINS.has('test')).toBe(true);
    expect(NODE_PREFIX_ONLY_BUILTINS.has('sqlite')).toBe(true);
    expect([...NODE_PREFIX_ONLY_BUILTINS].filter(m => NODE_BUILTINS.has(m))).toEqual([]);
    expect([...NODE_BUILTINS, ...NODE_PREFIX_ONLY_BUILTINS].every(m => !m.startsWith('node:'))).toBe(true);
    expect(NODE_BUILTINS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('relative specifiers are local; resolved by extension and index rules', () => {
    const rs = recs({ 'src/a.ts': "import './b';\nimport './d';\nimport './gone';\n", 'src/b.tsx': '', 'src/d/index.js': '' }, 'src/a.ts');
    expect(loc(rs)).toEqual({
      './b': ['local', null, './b', { file: 'src/b.tsx' }],
      './d': ['local', null, './d', { file: 'src/d/index.js' }],
      './gone': ['local', null, './gone', null],
    });
  });

  it('external only when declared in the nearest package.json', () => {
    const files = {
      'package.json': JSON.stringify({ devDependencies: { jest: '1' } }),
      'pkg/package.json': JSON.stringify({ optionalDependencies: { chalk: '1' } }),
      'pkg/a.ts': "import 'chalk';\nimport 'jest';\n",
      'b.ts': "import 'jest';\n",
    };
    const locality = (rs: ImportRecord[]) => Object.fromEntries(rs.map(r => [r.module, r.locality]));
    expect(locality(recs(files, 'pkg/a.ts'))).toEqual({ chalk: 'external', jest: 'unknown' });
    expect(locality(recs(files, 'b.ts'))).toEqual({ jest: 'external' });
  });

  it('workspace package names map to local dirs before declared deps', () => {
    const files = {
      'app/package.json': JSON.stringify({ dependencies: { '@x/u': 'workspace:*' } }),
      'app/a.ts': "import '@x/u';\nimport '@x/u/lib';\n",
      'u/package.json': JSON.stringify({ name: '@x/u' }),
      'u/lib.ts': '',
    };
    expect(loc(recs(files, 'app/a.ts'))).toEqual({
      '@x/u': ['local', '@x/u', '@x/u', { dir: 'u' }],
      '@x/u/lib': ['local', '@x/u', '@x/u/lib', { file: 'u/lib.ts' }],
    });
  });

  it('invalid package.json is ignored', () => {
    expect(recs({ 'package.json': '{oops', 'a.js': "import 'x';\n" }, 'a.js')[0].locality).toBe('unknown');
  });
});

describe('resolution: Python', () => {
  it('vendored stdlib list is CPython 3.13 sys.stdlib_module_names', () => {
    expect(PYTHON_STDLIB.size).toBe(290);
    for (const m of ['os', 'json', '__future__', 'tomllib', 'asyncio']) expect(PYTHON_STDLIB.has(m)).toBe(true);
    for (const m of ['requests', 'distutils', 'imp']) expect(PYTHON_STDLIB.has(m)).toBe(false);
  });

  it('relative imports become absolute from the __init__.py chain', () => {
    const files = { 'p/__init__.py': '', 'p/q/__init__.py': '', 'p/q/m.py': 'from .. import x\nfrom .n import y\nfrom ... import z\n', 'p/q/n.py': '' };
    expect(loc(recs(files, 'p/q/m.py'))).toEqual({
      '..': ['local', 'p', 'p', { file: 'p/__init__.py' }],
      '.n': ['local', 'p', 'p.q.n', { file: 'p/q/n.py' }],
      '...': ['unknown', null, null, null],
    });
  });

  it('a root __init__.py gives no package name; relative stays null', () => {
    const rs = recs({ '__init__.py': '', 'p/__init__.py': '', 'p/m.py': 'from . import x\n' }, 'p/m.py');
    expect(rs[0]).toMatchObject({ normalized: null, locality: 'unknown' });
    expect(rs[0].package).toBeUndefined();
  });

  it('absolute imports resolve under the package root, the scan root and src/', () => {
    const files = { 'src/a/__init__.py': '', 'src/a/b.py': '', 'top.py': '', 'x.py': 'import a.b\nimport top\nimport nope\n' };
    expect(loc(recs(files, 'x.py'))).toEqual({
      'a.b': ['local', 'a', 'a.b', { file: 'src/a/b.py' }],
      top: ['local', 'top', 'top', { file: 'top.py' }],
      nope: ['unknown', 'nope', 'nope', null],
    });
  });
});

describe('resolution: Go', () => {
  const work = {
    'go.work': 'go 1.22\nuse ./a // only a\n',
    'a/go.mod': 'module ex.com/a\nrequire (\n\tgithub.com/x/y v1.0.0\n\tgithub.com/x/y/v2 v2.0.0\n)\n',
    'a/p/p.go': 'package p\n',
    'b/go.mod': 'module ex.com/b\n',
    'b/q/q.go': 'package q\n',
    'a/main.go': 'package main\nimport (\n\t"ex.com/a/p"\n\t"ex.com/b/q"\n\t"github.com/x/y/v2/z"\n\t"strings"\n\t"C"\n)\n',
  };

  it('go.work narrows the module set; longest require wins; C is not stdlib', () => {
    expect(loc(recs(work, 'a/main.go'))).toEqual({
      'ex.com/a/p': ['local', 'ex.com/a', 'ex.com/a/p', { dir: 'a/p' }],
      'ex.com/b/q': ['unknown', null, 'ex.com/b/q', null],
      'github.com/x/y/v2/z': ['external', 'github.com/x/y/v2', 'github.com/x/y/v2/z', null],
      strings: ['stdlib', 'strings', 'strings', null],
      C: ['unknown', null, 'C', null],
    });
  });

  it('without go.work every go.mod of the tree is local', () => {
    const { 'go.work': _, ...noWork } = work;
    expect(loc(recs(noWork, 'a/main.go'))['ex.com/b/q']).toEqual(['local', 'ex.com/b', 'ex.com/b/q', { dir: 'b/q' }]);
  });

  it('a dotless module path is local, not stdlib', () => {
    const rs = recs({ 'go.mod': 'module app\n', 'main.go': 'package main\nimport "app/x"\n' }, 'main.go');
    expect(loc(rs)).toEqual({ 'app/x': ['local', 'app', 'app/x', null] });
  });
});

describe('resolution: Rust', () => {
  const crate = {
    'Cargo.toml': '[package]\nname = "c"\n',
    'src/lib.rs': 'mod a;\nuse a::X;\nuse self::a::Y;\nuse std::io;\nuse serde::de;\n',
    'src/a.rs': 'mod b;\nuse super::Z;\nuse super::super::W;\n',
    'src/a/b.rs': 'use super::super::Q;\n',
  };

  it('self/super rewritten to crate paths; mod files resolved', () => {
    expect(loc(recs(crate, 'src/lib.rs'))).toEqual({
      a: ['local', 'crate', 'crate::a', { file: 'src/a.rs' }],
      'a::X': ['local', 'crate', 'crate::a::X', null],
      'self::a::Y': ['local', 'crate', 'crate::a::Y', null],
      'std::io': ['stdlib', 'std', 'std::io', null],
      'serde::de': ['external', 'serde', 'serde::de', null],
    });
    expect(loc(recs(crate, 'src/a.rs'))).toEqual({
      b: ['local', 'crate', 'crate::a::b', { file: 'src/a/b.rs' }],
      'super::Z': ['local', 'crate', 'crate::Z', null],
      'super::super::W': ['local', 'crate', null, null],
    });
    expect(loc(recs(crate, 'src/a/b.rs'))['super::super::Q']).toEqual(['local', 'crate', 'crate::Q', null]);
  });

  it('without Cargo.toml self/super stay null but mod files still resolve', () => {
    const { 'Cargo.toml': _, ...bare } = crate;
    const rs = loc(recs(bare, 'src/lib.rs'));
    expect(rs.a).toEqual(['local', 'crate', null, { file: 'src/a.rs' }]);
    expect(rs['self::a::Y']).toEqual(['local', 'crate', null, null]);
  });

  it('mod-declared roots: the file\'s records are read a bounded number of times per record, not scanned per record', () => {
    // Reads of the record list while resolving N records: linear means a
    // constant per record; a per-record scan of the list is ~N per record.
    const readsPerRecord = (n: number) => {
      const src = Array.from({ length: n }, (_, i) => `mod m${i};\nuse x${i}::y;\n`).join('') + 'use m0::z;\n';
      const entries = doc({ 'src/lib.rs': src }).files;
      let reads = 0;
      const counted: FileImports[] = entries.map(f => ({
        ...f,
        imports: new Proxy([...f.imports], {
          get(t, k, r) {
            if (typeof k === 'string' && /^\d+$/.test(k)) reads++;
            return Reflect.get(t, k, r);
          },
        }),
      }));
      resolveImports(counted, [{ path: 'src/lib.rs', content: src }]);
      const m0z = counted[0].imports.find(r => r.module === 'm0::z')!;
      expect([m0z.locality, m0z.package]).toEqual(['local', 'crate']);
      return reads / counted[0].imports.length;
    };
    expect(readsPerRecord(50)).toBeLessThanOrEqual(3);
    expect(readsPerRecord(2000)).toBeLessThanOrEqual(3);
  });
});

describe('resolution: PHP', () => {
  it('literal includes resolve against the file dir; namespaces stay unknown', () => {
    const files = { 'a/x.php': "<?php\nuse A\\B;\ninclude 'y.php';\nrequire __DIR__ . '/../z.php';\ninclude '/abs.php';\n", 'a/y.php': '', 'z.php': '' };
    expect(loc(recs(files, 'a/x.php'))).toEqual({
      'A\\B': ['unknown', 'A', 'A\\B', null],
      'y.php': ['local', null, 'y.php', { file: 'a/y.php' }],
      '__DIR__/../z.php': ['local', null, 'z.php', { file: 'z.php' }],
      '/abs.php': ['unknown', null, '/abs.php', null],
    });
  });
});

describe('resolution pass', () => {
  const rec = (over: Partial<ImportRecord>): ImportRecord => ({
    line: 1, column: 1, endLine: 1, endColumn: 2, kind: 'static', form: 'import', module: 'm', normalized: 'm',
    locality: 'unknown', confidence: 'syntactic', evidence: 'm', ...over,
  });
  const entry = (path: string, language: string, imports: ImportRecord[]): FileImports => ({
    path, language, sha256: '0'.repeat(64), status: 'ok', complete: true, parseErrors: [], imports, unsupported: [],
  });

  it('works on record fields, whatever the kind (require / dynamic / reference)', () => {
    const entries = [
      entry('a.js', 'javascript', [rec({ kind: 'require', form: 'require', module: './b', normalized: './b' }), rec({ kind: 'dynamic', form: 'import()', module: 'node:fs', normalized: 'node:fs' }), rec({ kind: 'static', form: 'import-type', module: './b', normalized: './b', typeOnly: true })]),
      entry('p/m.py', 'python', [rec({ kind: 'dynamic', form: 'import_module', module: '.n', normalized: null, relative: { level: 1, module: 'n' } }), rec({ kind: 'dynamic', form: '__import__', module: 'n', normalized: null, relative: { level: 1, module: 'n' } })]),
      entry('r.rs', 'rust', [rec({ kind: 'reference', form: 'path-root', module: 'tokio', normalized: 'tokio', confidence: 'inferred', occurrences: 2 })]),
    ];
    resolveImports(entries, [{ path: 'a.js', content: '' }, { path: 'b.js', content: '' }, { path: 'p/__init__.py', content: '' }, { path: 'p/n.py', content: '' }]);
    expect(entries.map(e => e.imports.map(r => [r.locality, r.normalized, r.resolved ?? null]))).toEqual([
      [['local', './b', { file: 'b.js' }], ['stdlib', 'fs', null], ['local', './b', { file: 'b.js' }]],
      [['local', 'p.n', { file: 'p/n.py' }], ['local', 'p.n', { file: 'p/n.py' }]],
      [['external', 'tokio', null]],
    ]);
    // Existing keys keep their order (here `occurrences` last, as the helper built it); `package` slots in before `locality`.
    expect(Object.keys(entries[2].imports[0])).toEqual([
      'line', 'column', 'endLine', 'endColumn', 'kind', 'form', 'module', 'normalized', 'package', 'locality',
      'confidence', 'evidence', 'occurrences',
    ]);
  });

  it('applyResolution inserts new keys in contract order and keeps existing order', () => {
    const { confidence, evidence, ...head } = rec({});
    const r = applyResolution({ ...head, alias: 'x', confidence, evidence }, { package: 'p', locality: 'local', resolved: { file: 'f' } });
    expect(Object.keys(r)).toEqual([
      'line', 'column', 'endLine', 'endColumn', 'kind', 'form', 'module', 'normalized', 'package', 'locality',
      'alias', 'resolved', 'confidence', 'evidence',
    ]);
    expect(applyResolution(rec({}), { resolved: undefined })).not.toHaveProperty('resolved');
  });
});
