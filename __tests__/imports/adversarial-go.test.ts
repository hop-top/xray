import { adversarialSuite, bytes, BAD_UTF8, NOISE, PAD, rep, seq } from '../support/imports-adversarial';
import { MODULE_MAX } from '../../src/lib/imports/record';

// Adversarial inputs for Go: see ../support/imports-adversarial.ts. Imports
// are top-level only; nesting and size go into function bodies, literals,
// import groups and directive comments.

const mods = (f: { imports: Array<{ module: string }> }) => f.imports.map(r => r.module);

adversarialSuite('go', {
  file: 'a.go',
  deep: n => `package main\n\nimport "fmt"\n\nfunc f() {\n\tx := ${rep('[]any{(', n)}1${rep(')}', n)}\n\t${rep('{', n)}${rep('}', n)}\n}\n`,
  huge: n => `package main\n\nimport x "${'a'.repeat(n)}"\nimport "fmt"\n\nconst s = \`${'b'.repeat(n >> 4)}\`\n\n//go:linkname ${'c'.repeat(n >> 4)} runtime.x\n`,
  many: n => `package main\n\n${seq(n, i => `import (\n\tm${i} "x/m${i}"\n\t"C"\n)\n//go:linkname f${i} runtime.f${i}\n`)}`,
  long: n => `package main; import "x"; ${rep(`var q = "${PAD}"; `, Math.ceil(n / 76))}import "y"`,
  escapes: 'package main\n\nimport (\n\t"\\q"\n\t"\\u00"\n\t"\\xZZ"\n\t"ok"\n)\n',
  binary: bytes('package main\n\nimport "x"\n', NOISE, '\nimport "y"\n'),
  bom: '\uFEFFpackage main\n\nimport "x"\n',
  crlf: 'package main\r\n\r\nimport "x"\r\nimport (\r\n\t"y"\r\n)\r\n',
  surrogates: 'package main\n\nimport "\uD800x"\nimport "ok"\n',
  invalidUtf8: bytes('package main\n\nimport "', BAD_UTF8, '"\nimport "ok"\n'),
  comments: rep('// import "x"\n/* import "y" */\n', 1000),
}, {
  deep: f => expect(mods(f)).toEqual(['fmt']),
  huge: f => {
    expect(f.imports.map(r => r.module.length)).toEqual([MODULE_MAX + 1, 3]);
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module', 'linkname']);
  },
  many: f => expect(f.unsupported.length).toBe(2 * 50_000),
  long: f => expect(mods(f)).toEqual(expect.arrayContaining(['x'])),
  bom: f => expect(f.imports.map(r => [r.line, r.column, r.module])).toEqual([[3, 1, 'x']]),
  crlf: f => expect(f.imports.map(r => [r.line, r.column, r.module])).toEqual([[3, 1, 'x'], [5, 2, 'y']]),
  binary: f => expect(mods(f)).toEqual(expect.arrayContaining(['x'])),
  surrogates: f => expect(mods(f)).toContain('ok'),
  invalidUtf8: f => expect(mods(f)).toContain('ok'),
  comments: f => expect(f.imports).toEqual([]),
});
