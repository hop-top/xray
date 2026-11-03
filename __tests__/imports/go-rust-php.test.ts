import { extractImports } from '../../src/lib/imports';
import { phpNamespaces } from '../../src/lib/imports/lang/php';
import Parser from 'tree-sitter';

// Targeted checks for the Go / Rust / PHP extractors; the goldens under
// __tests__/fixtures/imports/{go,rust,php}/ pin full output.

function records(path: string, content: string) {
  const doc = extractImports([{ path, content }], { root: '.', xrayVersion: 'test' });
  expect(doc.files).toHaveLength(1);
  return doc.files[0].imports;
}

const pick = (rs: ReturnType<typeof records>) =>
  rs.map(r => ({ module: r.module, ...(r.alias ? { alias: r.alias } : {}), ...(r.wildcard ? { wildcard: true } : {}) }));

describe('Go imports', () => {
  it('unquotes raw-string paths and keeps ./_ aliases verbatim', () => {
    const rs = records('a.go', 'package a\nimport (\n\t. "math"\n\t_ `net/http/pprof`\n\tf "fmt"\n\t"C"\n)\n');
    expect(pick(rs)).toEqual([
      { module: 'math', alias: '.' },
      { module: 'net/http/pprof', alias: '_' },
      { module: 'fmt', alias: 'f' },
      { module: 'C' },
    ]);
    expect(rs.every(r => r.kind === 'static' && r.form === 'import')).toBe(true);
    // Resolution: no dot in the first element = stdlib; `C` (cgo) is not.
    expect(rs.map(r => r.locality)).toEqual(['stdlib', 'stdlib', 'stdlib', 'unknown']);
  });

  it('single import spans the declaration; grouped specs span the spec', () => {
    const rs = records('a.go', 'package a\nimport "fmt"\nimport (\n\t"os"\n\t"io"\n)\n');
    expect(rs.map(r => [r.line, r.column, r.endColumn, r.evidence])).toEqual([
      [2, 1, 13, 'import "fmt"'],
      [4, 2, 6, '"os"'],
      [5, 2, 6, '"io"'],
    ]);
  });
});

describe('Rust imports', () => {
  it('flattens use trees to one record per leaf', () => {
    const rs = records('a.rs', 'use serde::{Deserialize, de::{self, Visitor}};\n');
    expect(pick(rs)).toEqual([
      { module: 'serde::Deserialize' },
      { module: 'serde::de' },
      { module: 'serde::de::Visitor' },
    ]);
    expect(rs.map(r => r.column)).toEqual([13, 31, 37]);
  });

  it('handles as, *, self as, leading :: and bare lists', () => {
    const rs = records('a.rs', 'use {std::fmt, serde as s};\nuse super::*;\nuse ::a::{self as aa};\n');
    expect(pick(rs)).toEqual([
      { module: 'std::fmt' },
      { module: 'serde', alias: 's' },
      { module: 'super', wildcard: true },
      { module: 'a', alias: 'aa' },
    ]);
    const lead = rs[3];
    expect(lead).toMatchObject({ package: 'a', locality: 'external', normalized: 'a' });
    expect(rs[0]).toMatchObject({ package: 'std', locality: 'stdlib' });
    expect(rs[2]).toMatchObject({ package: 'crate', locality: 'local', normalized: null });
  });

  it('records extern crate and mod declarations, not inline modules', () => {
    const rs = records('a.rs', 'extern crate foo as bar;\nmod m;\nmod inline { use x::y; }\n#[path = "p.rs"]\nmod n;\n');
    expect(rs.map(r => [r.kind, r.form, r.module, r.alias ?? null, r.line])).toEqual([
      ['static', 'extern-crate', 'foo', 'bar', 1],
      ['include', 'mod', 'm', null, 2],
      ['static', 'use', 'x::y', null, 3],
      ['include', 'mod', 'n', null, 4],
    ]);
    expect(rs[3].evidence).toBe('#[path = "p.rs"] mod n;');
  });
});

describe('PHP imports', () => {
  it('expands grouped use with per-clause function/const types', () => {
    const rs = records('a.php', '<?php\nuse Foo\\{Alpha, Beta\\Gamma as G, function h, const K};\n');
    expect(rs.map(r => [r.form, r.module, r.alias ?? null])).toEqual([
      ['group-use', 'Foo\\Alpha', null],
      ['group-use', 'Foo\\Beta\\Gamma', 'G'],
      ['use-function', 'Foo\\h', null],
      ['use-const', 'Foo\\K', null],
    ]);
    expect(rs.every(r => r.package === 'Foo')).toBe(true);
  });

  it('strips the leading backslash; one record per clause; skips trait use', () => {
    const rs = records('a.php', '<?php\nuse \\Foo\\Baz as Q, Other;\nclass C { use T; }\n');
    expect(rs.map(r => [r.module, r.alias ?? null, r.column])).toEqual([['Foo\\Baz', 'Q', 5], ['Other', null, 20]]);
  });

  it('literal require/include only; __DIR__ concatenation folded', () => {
    const rs = records('sub/a.php', "<?php\nrequire 'a.php';\nrequire_once(\"b.php\");\ninclude __DIR__ . '/../d.php';\ninclude \"$x.php\";\nrequire $p;\n");
    expect(rs.map(r => [r.kind, r.form, r.module, r.normalized])).toEqual([
      ['require', 'require', 'a.php', 'a.php'],
      ['require', 'require_once', 'b.php', 'b.php'],
      ['include', 'include', '__DIR__/../d.php', 'd.php'],
    ]);
  });

  it('module keeps escapes as written; normalized is the PHP string value', () => {
    const rs = records('a.php', "<?php\nrequire 'it\\'s\\\\x.php';\nrequire \"t\\x41\\u{e9}\\q.php\";\n");
    expect(rs.map(r => [r.module, r.normalized])).toEqual([
      ["it\\'s\\\\x.php", "it's\\x.php"],
      ['t\\x41\\u{e9}\\q.php', 'tAé\\q.php'],
    ]);
  });

  it('out-of-range \\u{…} escapes stay verbatim instead of throwing', () => {
    // PHP rejects these at compile time; the extractor must not abort the run.
    const big = '<?php\nrequire "a\\u{110000}.php";\nrequire "b\\u{' + 'F'.repeat(400) + '}.php";\nrequire "c\\u{1F600}.php";\n';
    const rs = records('a.php', big);
    expect(rs.map(r => r.normalized)).toEqual([
      'a\\u{110000}.php',
      'b\\u{' + 'F'.repeat(400) + '}.php',
      'c\u{1F600}.php',
    ]);
  });

  it('phpNamespaces lists each namespace with its range', () => {
    const p = new Parser();
    p.setLanguage(require('tree-sitter-php').php);
    const t = p.parse('<?php\nnamespace A\\B;\nuse X;\nnamespace C { use Y; }\n');
    expect(phpNamespaces(t.rootNode).map(n => [n.name, n.line])).toEqual([['A\\B', 2], ['C', 4]]);
  });
});
