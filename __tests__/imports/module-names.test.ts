import { extractImports, type FileImports } from '../../src/lib/imports';
import { MODULE_MAX } from '../../src/lib/imports/record';
import { decodeEcmaScriptString, decodeGoString } from '../../src/lib/imports/escapes';

// `normalized` is the real module name: decoded string escapes (Go, JS),
// NFKC identifiers and no line continuations (Python), no `r#` (Rust), names
// that end at `?>` (PHP), and every `require` call form yields a record.
// `module` stays as written.

const file = (path: string, content: string): FileImports =>
  extractImports([{ path, content }], { root: '.', xrayVersion: 'x' }).files[0];
const norm = (path: string, content: string) => file(path, content).imports.map(r => r.normalized);
const mods = (path: string, content: string) => file(path, content).imports.map(r => r.module);
const kinds = (path: string, content: string) => file(path, content).unsupported.map(u => u.construct);

describe('JS: require call forms', () => {
  it.each([
    "new require('t')",
    "new require('t')()",
    "new require('t').X()",
    "(require)('t')",
    "(0, require)('t')",
    "new (require)('t')",
    "require('t').x",
    "require?.('t')",
  ])('%s -> one record for t', src => {
    const f = file('a.js', src);
    expect(f.imports.map(r => [r.kind, r.form, r.module, r.normalized])).toEqual([['require', 'require', 't', 't']]);
    expect(f.unsupported).toEqual([]);
    expect(f.complete).toBe(true);
  });

  it('new require with a non-literal argument is reported, as the plain call is', () => {
    expect(kinds('a.js', 'new require(x)')).toEqual(['dynamic-require']);
  });

  it('new require is not a require call when require is rebound', () => {
    const f = file('a.js', "var require = x; new require('t')");
    expect(f.imports).toEqual([]);
    expect(f.unsupported.map(u => [u.construct, u.detail])).toEqual([['dynamic-require', 'require is rebound in this file']]);
  });

  it('(0, eval)(...) is reported like eval(...)', () => {
    expect(kinds('a.js', "(0, eval)('x')")).toEqual(['eval']);
  });
});

describe('JS: string escapes in module strings', () => {
  it('decodes static import; module stays as written', () => {
    const [r] = file('a.js', "import '\\x41';").imports;
    expect([r.module, r.normalized, r.package]).toEqual(['\\x41', 'A', 'A']);
  });

  it.each([
    ["import '\\x41\\u0042\\u{43}\\u{1F600}'", 'ABC😀'],
    ["export * from 'a\\u002fb'", 'a/b'],
    ["import x = require('\\x41')", 'A'],
    ["import('\\x41')", 'A'],
    ["require('\\x41')", 'A'],
    ['require(`\\x41`)', 'A'],
    ["import 'a\\\nb'", 'ab'],
    ["import 'a\\qb'", 'aqb'],
    ["import '\\0'", '\0'],
    ["import 'node:\\x66s'", 'fs'],
  ])('%s -> %j', (src, want) => {
    const f = file('a.ts', src);
    expect(f.imports.map(r => r.normalized)).toEqual([want]);
    expect(f.unsupported).toEqual([]);
  });

  it.each(["import '\\x4'", "import '\\u{110000}x'", "import '\\u{}'", "import('\\u{110000}')"])(
    '%s: no normalized, reported',
    src => {
      const f = file('a.js', src);
      expect(f.imports.map(r => [r.normalized, r.package])).toEqual([[null, undefined]]);
      expect(f.unsupported.map(u => u.construct)).toEqual(['invalid-escape']);
      expect(f.complete).toBe(false);
    },
  );

  it.each(["import '\\uZZZZ'", "import('\\x')", "require('\\u{41')", "require('\\x4G')"])('%s: malformed beyond the grammar is a parse error, never a clean file', src => {
    const f = file('a.js', src);
    expect([f.status, f.complete]).toEqual(['parse-error', false]);
    expect(f.imports.filter(r => r.normalized !== null)).toEqual([]);
  });

  it('resolves on the decoded name', () => {
    const [r] = file('a.js', "require('node:\\x66s')").imports;
    expect([r.module, r.normalized, r.locality]).toEqual(['node:\\x66s', 'fs', 'stdlib']);
  });

  it('caps after decoding: the cap sees the written and the decoded string', () => {
    const f = file('a.js', `import '${'\\x41'.repeat(1500)}';`);
    const [r] = f.imports;
    expect(r.module.length).toBe(MODULE_MAX + 1);
    expect(r.normalized).toBeNull();
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
  });

  it('decoder: template literals reject legacy octal', () => {
    expect(decodeEcmaScriptString('\\101')).toBe('A');
    expect(decodeEcmaScriptString('\\101', true)).toBeUndefined();
    expect(decodeEcmaScriptString('\\8')).toBe('8');
  });
});

describe('Go: interpreted path escapes', () => {
  it('decodes; module stays as written', () => {
    const [r] = file('a.go', 'package a\nimport "x/\\x63obra"\n').imports;
    expect([r.module, r.normalized, r.package]).toEqual(['x/\\x63obra', 'x/cobra', 'x']);
  });

  it('all valid forms', () => {
    expect(norm('a.go', 'package a\nimport "\\x41\\u00e9\\U0001F600\\101\\n\\\\"\n')).toEqual(['Aé😀A\n\\']);
    expect(norm('a.go', 'package a\nimport "x\\x2f\\101\\u00e9\\U0001F600\\t\\\\\\""\n')).toEqual(['x/Aé😀\t\\"']);
    expect(norm('a.go', 'package a\nimport "\\377\\x80"\n')).toEqual([null]);
    expect(norm('a.go', 'package a\nimport "\\xc3\\xa9"\n')).toEqual(['é']);
  });

  it('raw strings are not decoded', () => {
    expect(norm('a.go', 'package a\nimport `x\\x63`\n')).toEqual(['x\\x63']);
  });

  it('raw strings lose their carriage returns', () => {
    const [r] = file('a.go', 'package a\nimport `a\r\nb`\n').imports;
    expect([r.module, r.normalized]).toEqual(['a\r\nb', 'a\nb']);
  });

  it.each(['\\q', '\\x4', '\\x 1', '\\u0x41', '\\777', '\\400', '\\8', '\\12', '\\U00110000', '\\ud800', '\\U0000DC00', "\\'", '\\u41', '\\xff'])(
    'invalid %s: no normalized, reported',
    esc => {
      const f = file('a.go', `package a\nimport "a${esc}"\n`);
      expect(f.imports.map(r => [r.normalized, r.package])).toEqual([[null, undefined]]);
      expect(f.unsupported.map(u => u.construct)).toEqual(['invalid-escape']);
      expect(f.complete).toBe(false);
    },
  );

  it('cgo and plugin are recognized through escapes; stdlib on the decoded path', () => {
    expect(kinds('a.go', 'package a\nimport "\\x43"\n')).toEqual(['cgo']);
    expect(kinds('a.go', 'package a\nimport "\\x70lugin"\n')).toEqual(['plugin']);
    const [r] = file('a.go', 'package a\nimport "\\x66mt"\n').imports;
    expect([r.normalized, r.package, r.locality]).toEqual(['fmt', 'fmt', 'stdlib']);
  });

  it('caps after decoding', () => {
    const f = file('a.go', `package a\nimport "${'\\x41'.repeat(1500)}"\n`);
    expect(f.imports[0].normalized).toBeNull();
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
  });

  it('decoder: bytes are UTF-8', () => {
    expect(decodeGoString('\\xe2\\x82\\xac')).toBe('€');
    expect(decodeGoString('\\xe2\\x82')).toBeUndefined();
  });
});

describe('Python: identifiers', () => {
  it('NFKC: fullwidth json is json', () => {
    const [r] = file('a.py', 'import ｊｓｏｎ\n').imports;
    expect([r.module, r.normalized, r.package]).toEqual(['ｊｓｏｎ', 'json', 'json']);
  });

  it.each([
    ['import ﬁle\n', 'file'],
    ['from ｊｓｏｎ import x\n', 'json'],
    ['import ｊｓｏｎ.ｔｏｏｌ as t\n', 'json.tool'],
  ])('%j -> %s', (src, want) => {
    expect(norm('a.py', src)).toEqual([want]);
  });

  it('__import__ strings are used as given (no NFKC)', () => {
    expect(norm('a.py', "__import__('ｊｓｏｎ')\n")).toEqual(['ｊｓｏｎ']);
  });

  it('a line continuation inside a dotted name is not part of it', () => {
    const [r] = file('a.py', 'import a \\\n .b\n').imports;
    expect([r.module, r.normalized, r.package]).toEqual(['a.b', 'a.b', 'a']);
    expect(norm('a.py', 'import a.\\\n b\n')).toEqual(['a.b']);
    expect(norm('a.py', 'from a \\\n .b import c\n')).toEqual(['a.b']);
  });

  it('NFKC can lengthen a name past the cap: capped on normalized', () => {
    const f = file('a.py', `import ${'ﬃ'.repeat(1400)}\n`);
    expect(f.imports[0].normalized).toBeNull();
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
  });
});

describe('Rust: raw identifiers', () => {
  it('normalized has no r#; module as written', () => {
    const f = file('a.rs', 'use r#serde::x;\nextern crate r#tokio;\nuse a::r#b::c;\n');
    expect(f.imports.map(r => [r.module, r.normalized, r.package])).toEqual([
      ['r#serde::x', 'serde::x', 'serde'],
      ['r#tokio', 'tokio', 'tokio'],
      ['a::r#b::c', 'a::b::c', 'a'],
    ]);
  });

  it('path roots: r#serde::x() is serde; bound names compare without the prefix', () => {
    const [r] = file('a.rs', 'fn f() { r#serde::x(); }').imports;
    expect([r.kind, r.module, r.normalized, r.package]).toEqual(['reference', 'r#serde', 'serde', 'serde']);
    expect(file('a.rs', 'fn serde() {}\nfn f() { r#serde::x(); }').imports).toEqual([]);
    expect(file('a.rs', 'fn f() { serde::x(); r#serde::y(); }').imports.map(r => r.occurrences)).toEqual([2]);
  });

  it('resolution sees the real name', () => {
    expect(file('a.rs', 'use r#std::fmt;\n').imports[0].locality).toBe('stdlib');
    expect(file('a.rs', 'use ::r#std::fmt;\n').imports[0].package).toBe('std');
  });
});

describe('PHP: names end at a close tag', () => {
  it('references', () => {
    const f = file('a.php', '<?php \\A\\B ?>html\\C\\D');
    expect(f.imports.map(r => r.normalized)).toEqual(['A\\B']);
    expect(f.unsupported).toEqual([]);
  });

  it('PHP after the HTML is its own name', () => {
    expect(norm('a.php', '<?php \\A\\B ?> \\C\\D <?php \\E\\F;')).toEqual(['A\\B', 'E\\F']);
    expect(norm('a.php', 'html <?php \\A\\B ?> html \\C\\D <?= \\E\\F;')).toEqual(['A\\B', 'E\\F']);
  });

  it('use and new', () => {
    expect(mods('a.php', '<?php\nuse \\A\\B ?>html\\C\\D\n')).toEqual(['A\\B']);
    expect(norm('a.php', '<?php\n$x = new \\A\\B ?>html\\C\\D\n')).toEqual(['A\\B']);
  });

  it('a name without a close tag is unchanged', () => {
    expect(norm('a.php', '<?php \\A \\B\\C;')).toEqual(['A\\B\\C']);
  });
});
