import { adversarialSuite, bytes, BAD_UTF8, NOISE, PAD, rep, seq } from '../support/imports-adversarial';
import { MODULE_MAX } from '../../src/lib/imports/record';

// Adversarial inputs for Python: see ../support/imports-adversarial.ts.

const mods = (f: { imports: Array<{ module: string }> }) => f.imports.map(r => r.module);

adversarialSuite('python', {
  file: 'a.py',
  deep: n => `import importlib\nx = ${rep('[__import__("a"), importlib.import_module("b"), ', n)}0${rep(']', n)}\n`,
  huge: n => `__import__("${'a'.repeat(n)}")\ns = """${'b'.repeat(n >> 4)}"""\nimport m\n`,
  many: n => seq(n, i => `import m${i}\nfrom p${i} import (a, b as c)\nclass C${i}:\n    import q${i % 7}\nif x:\n    exec(s)\n`),
  long: n => `${rep(`q = "${PAD}"; `, Math.ceil(n / 72))}import x; __import__("y")`,
  escapes: '__import__("\\N{bogus}")\n__import__("\\x")\n__import__("\\777")\n__import__(b"\\u1234")\nfrom \\x import y\nimport importlib\nimportlib.import_module(".\\q", "p")\n',
  binary: bytes('import x\n', NOISE, '\nimport y\n'),
  bom: '\uFEFFimport x\n',
  crlf: 'import x\r\nfrom y import (\r\n  a,\r\n)\r\n__import__("z")\r\n',
  surrogates: '__import__("\uD800x")\ns = "\uDC00"\nimport ok\n',
  invalidUtf8: bytes('__import__("', BAD_UTF8, '")\nimport ok\n'),
  comments: rep('# import x\n"""docstring import y"""\n', 1000),
}, {
  deep: f => expect(f.imports.length).toBe(1 + 2 * 50_000),
  huge: f => {
    expect(f.imports.map(r => r.module.length)).toEqual([MODULE_MAX + 1, 1]);
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
  },
  long: f => expect(mods(f)).toEqual(['x', 'y']),
  bom: f => expect(f.imports.map(r => [r.line, r.column, r.module])).toEqual([[1, 8, 'x']]), // range = the clause
  crlf: f => expect(f.imports.map(r => [r.line, r.column, r.endLine, r.module])).toEqual([[1, 8, 1, 'x'], [2, 1, 4, 'y'], [5, 1, 5, 'z']]),
  binary: f => expect(mods(f)).toEqual(expect.arrayContaining(['x'])),
  surrogates: f => expect(mods(f)).toContain('ok'),
  invalidUtf8: f => expect(mods(f)).toContain('ok'),
  comments: f => expect([f.status, f.imports]).toEqual(['ok', []]),
});
