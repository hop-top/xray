import { extractImports, type FileImports, type ImportsDoc } from '../../src/lib/imports';
import { IMPORT_LANGUAGES } from '../../src/lib/imports/languages';
import { cargoBuildScripts, parseErrors } from '../../src/lib/imports/unsupported';
import Parser from 'tree-sitter';

const Python = require('tree-sitter-python');

// Coverage reporting: unsupported constructs per language, parse errors,
// file status / complete, per-file isolation, unclaimed extensions and the
// summary. Goldens (fixtures/imports/<lang>/unsupported-*) pin full output;
// these isolate the rules.

const doc = (files: { path: string; content: string }[]): ImportsDoc => extractImports(files, { root: '.', xrayVersion: 'x' });
const file = (path: string, content: string): FileImports => doc([{ path, content }]).files[0];
const constructs = (path: string, content: string) => file(path, content).unsupported.map(u => [u.construct, u.evidence]);

describe('unsupported constructs', () => {
  describe('go', () => {
    it('cgo, plugin and linkname; static records kept', () => {
      const f = file('m.go', [
        'package m',
        '',
        'import "C"',
        'import (',
        '\tp "plugin"',
        '\t_ "unsafe"',
        ')',
        '',
        '//go:linkname nanotime runtime.nanotime',
        'func nanotime() int64',
        '',
        'func f() {',
        '\t//go:linkname push',
        '\t// go:linkname not a directive',
        '}',
        '',
      ].join('\n'));
      expect(f.imports.map(r => r.module)).toEqual(['C', 'plugin', 'unsafe']);
      expect(f.unsupported.map(u => [u.line, u.construct, u.detail])).toEqual([
        [3, 'cgo', 'cgo preamble can include C code'],
        [5, 'plugin', 'plugin.Open loads shared objects at run time'],
        [9, 'linkname', 'runtime.nanotime'],
        [13, 'linkname', 'push'],
      ]);
      expect(f.complete).toBe(false);
      expect(f.status).toBe('ok');
    });

    it('a plain file is complete', () => {
      expect(file('m.go', 'package m\n\nimport "fmt"\n')).toMatchObject({ status: 'ok', complete: true, unsupported: [] });
    });
  });

  describe('rust', () => {
    it('include family as invocations, scoped, and inside other macros', () => {
      const f = file('src/lib.rs', [
        'include!("gen.rs");',
        'fn f() {',
        '    let s = std::include_str!("a.txt");',
        '    let b = include_bytes!(concat!(env!("OUT_DIR"), "/b.bin"));',
        '}',
        'lazy_static! { static ref X: &str = include_str!("x"); }',
        'fn g() { x.include!(1); my::include!("y"); }',
      ].join('\n'));
      expect(f.unsupported.map(u => [u.line, u.construct, u.detail, u.evidence])).toEqual([
        [1, 'include-macro', 'include! with a literal path', 'include!("gen.rs")'],
        [3, 'include-data', 'include_str! with a literal path', 'std::include_str!("a.txt")'],
        [4, 'include-data', 'include_bytes! with a non-literal path', 'include_bytes!(concat!(env!("OUT_DIR"), "/b.bin"))'],
        [6, 'include-data', 'include_str! with a literal path', 'include_str!("x")'],
      ]);
    });

    it('build.rs beside a Cargo.toml with [package] is a build script', () => {
      const d = doc([
        { path: 'Cargo.toml', content: '[package]\nname = "a"\n' },
        { path: 'build.rs', content: 'fn main() {}\n' },
        { path: 'src/main.rs', content: 'fn main() {}\n' },
        { path: 'other/build.rs', content: 'fn main() {}\n' },
      ]);
      expect(d.files.map(f => [f.path, f.unsupported.map(u => u.construct)])).toEqual([
        ['build.rs', ['build-script']],
        ['other/build.rs', []],
        ['src/main.rs', []],
      ]);
      expect(d.files[0].unsupported[0]).toMatchObject({ line: 1, column: 1, evidence: 'build.rs' });
    });

    it('Cargo `build =` names the script or disables it; virtual manifests have none', () => {
      const scripts = (toml: string, dir = 'crates/a') =>
        [...cargoBuildScripts([{ path: `${dir}/Cargo.toml`, content: toml }]).entries()].map(([p, u]) => [p, u.evidence]);
      expect(scripts('[package]\nname = "a"\nbuild = "tools/gen.rs" # c\n')).toEqual([['crates/a/tools/gen.rs', 'build = "tools/gen.rs" # c']]);
      expect(scripts("[package]\nbuild = 'b.rs'\n[dependencies]\nbuild = \"x\"\n")).toEqual([['crates/a/b.rs', "build = 'b.rs'"]]);
      expect(scripts('[package]\nbuild = false\n')).toEqual([]);
      expect(scripts('[package]\nbuild = true\n')).toEqual([['crates/a/build.rs', 'build = true']]);
      expect(scripts('[workspace]\nmembers = ["a"]\n')).toEqual([]);
      expect(scripts('[package]\nname = "r"\n', '.')).toEqual([['build.rs', 'build.rs']]);
    });
  });

  describe('php', () => {
    it('eval, dynamic include, dynamic new, dynamic static call, dynamic call', () => {
      const lines = [
        '<?php',
        'eval($code);',
        'require $path;',
        'include_once "lib/$name.php";',
        "require __DIR__ . '/ok.php';",
        "require_once ('ok.php');",
        'new $cls();',
        'new ($a . "B");',
        'new static; new self; new Foo\\Bar; new class {};',
        '$cls::make();',
        'static::make(); Foo::make(); \\A\\B::make();',
        '$fn(); [$o, "m"]();',
        '(function () {})(); (fn() => 1)();',
        "call_user_func($cb); call_user_func_array('f', []); \\call_user_func($cb);",
        'foo(); \\Ns\\foo();',
      ];
      expect(file('a.php', lines.join('\n')).unsupported.map(u => [u.line, u.construct])).toEqual([
        [2, 'eval'],
        [3, 'dynamic-include'],
        [4, 'dynamic-include'],
        [7, 'dynamic-new'],
        [8, 'dynamic-new'],
        [10, 'dynamic-static-call'],
        [12, 'dynamic-call'],
        [12, 'dynamic-call'],
        [14, 'dynamic-call'],
        [14, 'dynamic-call'],
      ]);
    });
  });

  describe('typescript / javascript', () => {
    it('deferred calls carry the reason; eval, Function, createRequire', () => {
      expect(constructs('a.js', [
        'import("./" + name);',
        'require(name);',
        "require('ok');",
        'eval(src);',
        "new Function('return 1');",
        "Function('x');",
        "const r = createRequire(import.meta.url);",
        "module.createRequire(u);",
      ].join('\n'))).toEqual([
        ['dynamic-import', 'import("./" + name)'],
        ['dynamic-require', 'require(name)'],
        ['eval', 'eval(src)'],
        ['eval', "new Function('return 1')"],
        ['eval', "Function('x')"],
        ['create-require', 'createRequire(import.meta.url)'],
        ['create-require', 'module.createRequire(u)'],
      ]);
    });

    it('shadowed require is reported per call with the reason', () => {
      const f = file('a.ts', "const require = createRequire(u);\nrequire('m');\n");
      expect(f.imports).toEqual([]);
      expect(f.unsupported.map(u => [u.line, u.construct, u.detail])).toEqual([
        [1, 'create-require', 'createRequire makes a require the file does not bind'],
        [2, 'dynamic-require', 'require is rebound in this file'],
      ]);
    });

    it('type-position non-literal import() is not reported', () => {
      expect(file('a.ts', 'let x: import(T);\n').unsupported).toEqual([]);
    });
  });

  describe('python', () => {
    it('deferred dynamic imports carry callee and reason', () => {
      const f = file('pkg/m.py', [
        'import importlib',
        '__import__(name)',
        'importlib.import_module(n)',
        "importlib.import_module('.x')",
        "importlib.import_module('ok')",
      ].join('\n'));
      expect(f.unsupported.map(u => [u.line, u.construct, u.detail])).toEqual([
        [2, 'dynamic-import', '__import__ with a non-literal argument'],
        [3, 'dynamic-import', 'importlib.import_module with a non-literal argument'],
        [4, 'dynamic-import', 'importlib.import_module with a relative name and no package'],
      ]);
    });

    it('shadowed __import__', () => {
      expect(file('a.py', "def __import__(x): pass\n__import__('m')\n").unsupported.map(u => u.detail)).toEqual([
        '__import__ is rebound in this file',
      ]);
    });

    it('importlib loaders through import bindings; inert members skipped', () => {
      const f = file('a.py', [
        'import importlib, importlib.util as iu',
        'from importlib.util import spec_from_file_location as sf',
        'from importlib import machinery, reload',
        'importlib.util.spec_from_file_location(n, p)',
        'iu.module_from_spec(spec)',
        'sf(n, p)',
        'machinery.SourceFileLoader(n, p)',
        'importlib.__import__(n)',
        'reload(m); importlib.invalidate_caches(); importlib.resources.files(p); importlib.metadata.version(d)',
        'util.spec_from_file_location(n, p)',
      ].join('\n'));
      expect(f.unsupported.map(u => [u.line, u.detail])).toEqual([
        [4, 'importlib.util.spec_from_file_location: importlib loader API, can load a module xray cannot name'],
        [5, 'importlib.util.module_from_spec: importlib loader API, can load a module xray cannot name'],
        [6, 'importlib.util.spec_from_file_location: importlib loader API, can load a module xray cannot name'],
        [7, 'importlib.machinery.SourceFileLoader: importlib loader API, can load a module xray cannot name'],
        [8, 'importlib.__import__: importlib loader API, can load a module xray cannot name'],
      ]);
    });

    it('exec / eval with any argument, sys.path mutation, site.addsitedir', () => {
      expect(constructs('a.py', [
        'exec(code)',
        'eval("1 + 1")',
        'sys.path.insert(0, d)',
        'sys.path.append(d)',
        'sys.path.extend(ds)',
        'sys.path = [d]',
        'sys.path += [d]',
        'sys.path[0:0] = [d]',
        'site.addsitedir(d)',
        'print(sys.path)',
        'x.sys.path.append(d)',
      ].join('\n'))).toEqual([
        ['exec', 'exec(code)'],
        ['eval', 'eval("1 + 1")'],
        ['sys-path', 'sys.path.insert(0, d)'],
        ['sys-path', 'sys.path.append(d)'],
        ['sys-path', 'sys.path.extend(ds)'],
        ['sys-path', 'sys.path = [d]'],
        ['sys-path', 'sys.path += [d]'],
        ['sys-path', 'sys.path[0:0] = [d]'],
        ['sys-path', 'site.addsitedir(d)'],
      ]);
    });
  });

  it('records sort by line, column, construct', () => {
    const u = file('a.js', 'eval(a); require(b);\nimport(c);\n').unsupported;
    expect(u.map(x => [x.line, x.column, x.construct])).toEqual([[1, 1, 'eval'], [1, 10, 'dynamic-require'], [2, 1, 'dynamic-import']]);
  });
});

describe('parse errors', () => {
  const parse = (src: string) => {
    const p = new Parser();
    p.setLanguage(Python);
    return p.parse(src).rootNode;
  };

  it('ERROR and MISSING nodes, 1-based ranges, document order, nested errors folded', () => {
    expect(parseErrors(parse('def f(:\n  pass\nimport os\nx = (1,'))).toEqual([
      { kind: 'missing', start: { line: 1, column: 7 }, end: { line: 1, column: 7 } },
      { kind: 'error', start: { line: 4, column: 1 }, end: { line: 4, column: 8 } },
    ]);
    expect(parseErrors(parse('import os\n'))).toEqual([]);
    // (module (ERROR (identifier) (list (integer) (ERROR)))): the inner ERROR is part of the outer one.
    expect(parseErrors(parse('x = ((( [ 1 ,, ] '))).toEqual([
      { kind: 'error', start: { line: 1, column: 1 }, end: { line: 1, column: 17 } },
    ]);
  });

  it('a file with errors is parse-error, incomplete, and keeps its imports', () => {
    const f = file('a.py', 'import os\ndef f(:\n  pass\nimport sys\n');
    expect(f.status).toBe('parse-error');
    expect(f.complete).toBe(false);
    expect(f.imports.map(r => r.module)).toEqual(['os', 'sys']);
    expect(f.parseErrors.length).toBeGreaterThan(0);
  });

  it('columns are UTF-16 code units', () => {
    const f = file('a.ts', "const s = '😀'; let = ;\n");
    expect(f.parseErrors[0].start.column).toBeGreaterThan(14);
    const [e] = f.parseErrors;
    expect(e.start.line).toBe(1);
  });
});

describe('per-file isolation', () => {
  const original = IMPORT_LANGUAGES.python.extract;
  afterEach(() => {
    IMPORT_LANGUAGES.python.extract = original;
  });

  it('an extractor exception marks only that file and the run continues', () => {
    IMPORT_LANGUAGES.python.extract = (_root, ctx) => {
      if (ctx.path === 'bad.py') throw new Error(`boom at /abs/secret/${ctx.path}\n    at Object.<anonymous> (/abs/x.ts:1:1)`);
      return original(_root, ctx);
    };
    const d = doc([
      { path: 'a.py', content: 'import os\n' },
      { path: 'bad.py', content: 'import os\nimport é\n' },
      { path: 'c.go', content: 'package c\nimport "fmt"\n' },
    ]);
    expect(d.files.map(f => [f.path, f.status, f.complete, f.imports.length])).toEqual([
      ['a.py', 'ok', true, 1],
      ['bad.py', 'parse-error', false, 0],
      ['c.go', 'ok', true, 1],
    ]);
    const bad = d.files[1];
    expect(bad.parseErrors).toEqual([{ kind: 'error', start: { line: 1, column: 1 }, end: { line: 3, column: 1 } }]);
    expect(bad.unsupported).toEqual([]);
    expect(bad.sha256).toMatch(/^[0-9a-f]{64}$/);
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/boom|secret|\/abs\/|Object\.<anonymous>/);
    expect(d.summary).toEqual({ files: 3, complete: 2, imports: 2, unsupported: 0, parseErrors: 1 });
  });

  it('a non-Error throw is isolated too', () => {
    IMPORT_LANGUAGES.python.extract = () => { throw 'nope'; };
    const f = file('a.py', 'x = 1');
    expect(f).toMatchObject({ status: 'parse-error', complete: false, imports: [] });
    expect(f.parseErrors).toEqual([{ kind: 'error', start: { line: 1, column: 1 }, end: { line: 1, column: 6 } }]);
  });
});

describe('unclaimed extensions', () => {
  it('source in a non-contract language the scanner knows is listed as unsupported-language', () => {
    const d = doc([
      { path: 'A.java', content: 'import java.util.List;\n' },
      { path: 'a.py', content: 'import os\n' },
      { path: 'notes.txt', content: 'import os' },
      { path: 'logo.png', content: 'x' },
    ]);
    expect(d.files.map(f => [f.path, f.language, f.status, f.complete])).toEqual([
      ['A.java', 'java', 'unsupported-language', false],
      ['a.py', 'python', 'ok', true],
    ]);
    expect(d.files[0]).toMatchObject({ parseErrors: [], imports: [], unsupported: [] });
    expect(Object.keys(d.grammars)).toEqual(['python']);
  });

  it('resolution-only manifests are never listed', () => {
    const d = doc(['go.mod', 'go.work', 'package.json', 'Cargo.toml', 'sub/package.json', 'sub/Cargo.toml'].map(path => ({ path, content: '' })));
    expect(d.files).toEqual([]);
  });
});

describe('summary', () => {
  it('counts agree with the file entries', () => {
    const d = doc([
      { path: 'a.py', content: 'import os\nexec(x)\n' },
      { path: 'b.py', content: 'def f(:\n' },
      { path: 'c.js', content: "import 'x';\n" },
      { path: 'D.java', content: 'class D {}\n' },
    ]);
    const s = d.summary;
    expect(s.files).toBe(d.files.length);
    expect(s.complete).toBe(d.files.filter(f => f.status === 'ok' && f.unsupported.length === 0).length);
    expect(s.complete).toBe(1);
    expect(s.unsupported).toBe(d.files.reduce((n, f) => n + f.unsupported.length, 0));
    expect(s.parseErrors).toBe(d.files.reduce((n, f) => n + f.parseErrors.length, 0));
    expect(s.unsupported).toBe(1);
    expect(s.parseErrors).toBeGreaterThan(0);
    for (const f of d.files) expect(f.complete).toBe(f.status === 'ok' && f.unsupported.length === 0);
  });
});
