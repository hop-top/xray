import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import { extractImports, type ImportRecord } from '../../src/lib/imports';
import { literalArg as jsLiteral, scanEcmaScript } from '../../src/lib/imports/lang/ecmascript';
import { literalArg as pyLiteral, resolveName, scanPython } from '../../src/lib/imports/lang/python';

const JavaScript = require('tree-sitter-javascript');
const Python = require('tree-sitter-python');

// Call-based imports: literal-argument helpers, binding (shadowing) rules and
// the deferred list of call sites that produce no record (non-literal,
// shadowed, unresolvable) kept for the unsupported pass.

type Lang = Parameters<Parser['setLanguage']>[0];
const parse = (lang: Lang, src: string) => {
  const p = new Parser();
  p.setLanguage(lang);
  return p.parse(src).rootNode;
};

/** First argument of the first call in `src`. */
function firstArg(lang: Lang, src: string, callType: string): Parser.SyntaxNode {
  const root = parse(lang, src);
  const call = root.descendantsOfType(callType)[0];
  return call.childForFieldName('arguments')!.namedChildren[0];
}

const records = (path: string, content: string): ImportRecord[] =>
  extractImports([{ path, content }], { root: '.', xrayVersion: 'x' }).files[0].imports;
/** Call-form records only (static statements in the same source dropped). */
const calls = (path: string, content: string) => records(path, content).filter(r => r.form !== 'import' && r.form !== 'from');

describe('ecmascript literalArg', () => {
  it.each([
    ["f('a')", 'a'],
    ['f("@s/p/x")', '@s/p/x'],
    ['f(`./t.js`)', './t.js'],
    ["f('')", ''],
    ['f(`./${x}.js`)', undefined],
    ["f('a' + 'b')", undefined],
    ["f('a\\x2e')", 'a.'],
    ['f(`a\\n`)', 'a\n'],
    ["f('\\x41\\u0042\\u{43}')", 'ABC'],
    ["f('\\x4')", undefined],
    ['f(`\\1`)', undefined],
    ['f(x)', undefined],
  ])('%s -> %s', (src, want) => {
    expect(jsLiteral(firstArg(JavaScript, src, 'call_expression'))).toBe(want);
  });
});

describe('python literalArg', () => {
  it.each([
    ["f('a.b')", 'a.b'],
    ['f("a")', 'a'],
    ["f('a' 'b')", 'ab'],
    ["f(r'a')", 'a'],
    ["f(f'a')", 'a'],
    ["f(f'a{b}')", undefined],
    ["f('a' f'{b}')", undefined],
    ["f(b'a')", undefined],
    ["f('a\\x2e')", undefined],
    ['f(x)', undefined],
  ])('%s -> %s', (src, want) => {
    expect(pyLiteral(firstArg(Python, src, 'call'))).toBe(want);
  });
});

describe('python resolveName (importlib semantics)', () => {
  it.each([
    ['.b', 'app.pkg', 'app.pkg.b'],
    ['..c', 'app.pkg', 'app.c'],
    ['.', 'app.pkg', 'app.pkg'],
    ['...x', 'app.pkg', null],
  ])('%s from %s -> %s', (name, pkg, want) => {
    expect(resolveName(name, pkg)).toBe(want);
  });
});

describe('ecmascript call imports', () => {
  it('require -> kind require, import() -> kind dynamic, at any depth', () => {
    const rs = records('a.js', "function f() { if (x) { return require('a'); } }\nconst g = async () => import('b');\n");
    expect(rs.map(r => [r.kind, r.form, r.module, r.line, r.column, r.evidence])).toEqual([
      ['require', 'require', 'a', 1, 32, "require('a')"],
      ['dynamic', 'import()', 'b', 2, 23, "import('b')"],
    ]);
  });

  it('defers non-literal and shadowed calls; member callees and bare reads are ignored', () => {
    const root = parse(JavaScript, [
      'require(name);',
      'import(`./${x}`);',
      "require.resolve('r');",
      "typeof require === 'function';",
      'require();',
    ].join('\n'));
    const scan = scanEcmaScript(root);
    expect(scan.imports).toEqual([]);
    expect(scan.deferred.map(d => [d.construct, d.reason, d.node.text])).toEqual([
      ['dynamic-require', 'non-literal', 'require(name)'],
      ['dynamic-import', 'non-literal', 'import(`./${x}`)'],
    ]);
  });

  it.each([
    'function require() {}',
    'const require = createRequire(import.meta.url);',
    'let { require } = m;',
    'const [require] = m;',
    'function f(require) {}',
    'const f = require => 0;',
    "import require from 'x';",
    "import { a as require } from 'x';",
    'require = 1;',
    'try {} catch (require) {}',
  ])('`%s` shadows require file-wide', decl => {
    const scan = scanEcmaScript(parse(JavaScript, `${decl}\nrequire('m');\n`));
    expect(scan.imports.filter(r => r.kind === 'require')).toEqual([]);
    expect(scan.deferred.map(d => [d.reason, d.node.text])).toEqual([['shadowed', "require('m')"]]);
  });

  it('TS ambient declarations do not shadow require', () => {
    const rs = records('a.ts', "declare const require: any;\ndeclare function require(id: string): any;\nrequire('m');\n");
    expect(rs.map(r => r.module)).toEqual(['m']);
  });

  it('type-position import() is static + typeOnly with form import-type', () => {
    const rs = records('a.ts', "type A = import('./t').Foo;\nconst v = x as import('./c').C;\nconst w = import('./run');\n");
    expect(rs.map(r => [r.kind, r.form, r.module, r.typeOnly ?? false])).toEqual([
      ['static', 'import-type', './t', true],
      ['static', 'import-type', './c', true],
      ['dynamic', 'import()', './run', false],
    ]);
  });

  it('import x = require() stays one static import-equals record', () => {
    expect(records('a.ts', "import x = require('m');\n").map(r => [r.kind, r.form])).toEqual([['static', 'import-equals']]);
  });
});

describe('python call imports', () => {
  it('needs an importlib binding in the file; __import__ is the builtin unless rebound', () => {
    expect(calls('a.py', "__import__('a')\nimportlib.import_module('b')\n").map(r => [r.form, r.module])).toEqual([
      ['__import__', 'a'],
    ]);
    expect(calls('a.py', "def __import__(n): pass\n__import__('a')\n")).toEqual([]);
  });

  it.each([
    ['__import__ = f', '__import__'],
    ['from builtins import __import__', '__import__'],
    ['import x as __import__', '__import__'],
    ['def g(__import__): pass', '__import__'],
    ['for __import__ in xs: pass', '__import__'],
  ])('`%s` shadows %s file-wide', decl => {
    const scan = scanPython(parse(Python, `${decl}\n__import__('m')\n`), { path: 'a.py', language: 'python' });
    expect(scan.imports.filter(r => r.kind === 'dynamic')).toEqual([]);
    expect(scan.deferred.map(d => [d.reason, d.node.text])).toEqual([['shadowed', "__import__('m')"]]);
  });

  it('relative name: literal package -> normalized, no relative field', () => {
    const [r] = calls('m.py', "import importlib\nimportlib.import_module('..c', package='app.pkg')\n");
    expect(r).toMatchObject({ kind: 'dynamic', form: 'import_module', module: '..c', normalized: 'app.c', package: 'app' });
    expect(r.relative).toBeUndefined();
  });

  it('package=__name__ anchors at the module itself (package-relative form in `relative`)', () => {
    const src = "from importlib import import_module as im\nim('.a', package=__name__)\nim('..b', __name__)\nim('.c', package=__package__)\n";
    expect(calls('app/pkg/mod.py', src).map(r => [r.module, r.normalized, r.relative])).toEqual([
      ['.a', null, { level: 1, module: 'mod.a' }],
      ['..b', null, { level: 1, module: 'b' }],
      ['.c', null, { level: 1, module: 'c' }],
    ]);
    expect(calls('app/pkg/__init__.py', src).map(r => r.relative)).toEqual([
      { level: 1, module: 'a' },
      { level: 2, module: 'b' },
      { level: 1, module: 'c' },
    ]);
  });

  it('defers non-literal names, relative names without a literal package, and splats', () => {
    const src = [
      'import importlib',
      '__import__(n)',
      "importlib.import_module('.x')",
      "importlib.import_module('.y', package=p)",
      'importlib.import_module(*args)',
      "__import__('z', level=lvl)",
    ].join('\n');
    const scan = scanPython(parse(Python, src), { path: 'a.py', language: 'python' });
    expect(scan.imports.filter(r => r.kind === 'dynamic')).toEqual([]);
    expect(scan.deferred.map(d => [d.construct, d.reason])).toEqual([
      ['dynamic-import', 'non-literal'],
      ['dynamic-import', 'relative-without-package'],
      ['dynamic-import', 'non-literal'],
      ['dynamic-import', 'non-literal'],
      ['dynamic-import', 'non-literal'],
    ]);
  });
});

describe('deferred call sites in the golden fixtures (seam for the unsupported pass)', () => {
  const fx = (p: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'imports', p), 'utf8');
  const js = (p: string) => scanEcmaScript(parse(JavaScript, fx(p))).deferred.map(d => [d.reason, d.node.text]);
  const py = (p: string) => scanPython(parse(Python, fx(p)), { path: p, language: 'python' }).deferred.map(d => [d.reason, d.node.text]);

  it('javascript/require-dynamic', () => {
    expect(js('javascript/require-dynamic/dynamic.js')).toEqual([['non-literal', 'require(name)']]);
    expect(js('javascript/require-dynamic/depth.js')).toEqual([
      ['non-literal', 'require(`./${load.name}.js`)'],
      ['non-literal', "import('./a' + '.js')"],
    ]);
    expect(js('javascript/require-dynamic/shadow/amd.js')).toEqual([['shadowed', "require('amd-dep')"]]);
  });

  it('python/dynamic', () => {
    expect(py('python/dynamic/app/pkg/mod.py')).toEqual([
      ['non-literal', '__import__(name)'],
      ['non-literal', "import_module(f'mod_{name}')"],
      ['relative-without-package', "import_module('.nopkg')"],
      ['non-literal', "import_module('.dyn', package=name)"],
      ['non-literal', "import_module(b'bytes')"],
      ['non-literal', "import_module('esc\\x2e')"],
    ]);
    expect(py('python/dynamic/shadow.py')).toEqual([['shadowed', "__import__('shadowed')"]]);
  });
});
