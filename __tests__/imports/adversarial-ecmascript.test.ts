import { adversarialSuite, bytes, BAD_UTF8, NOISE, PAD, rep, seq, type LanguageCases } from '../support/imports-adversarial';
import { MODULE_MAX } from '../../src/lib/imports/record';

// Adversarial inputs for TS/JS: see ../support/imports-adversarial.ts.

const ts: LanguageCases = {
  file: 'a.ts',
  deep: n => `const x = ${rep('[require("a"), import("b"), ', n)}0${rep(']', n)};\n`,
  huge: n => `import x from "${'a'.repeat(n)}";\nconst s = \`${'b'.repeat(n >> 4)}\`;\nrequire("m");\n`,
  many: n => seq(n, i => `import a${i} from "m${i}";\nnamespace N${i} { export const q = import("q${i}"); }\n{ require("r${i % 7}"); }\n`),
  long: n => `${rep(`const q = "${PAD}"; `, Math.ceil(n / 78))}import a from "x"; require("y");`,
  escapes: 'import a from "\\x";\nimport b from "\\u{zzzz}";\nimport c from "\\uD800";\nrequire("\\q\\8");\nimport("\\u{110000}");\nimport d from \'unterminated\n',
  binary: bytes('import a from "x";\n', NOISE, '\nimport b from "y";\n'),
  bom: '\uFEFFimport a from "x";\n',
  crlf: 'import a from "x";\r\nimport {\r\n  b,\r\n} from "y";\r\nrequire("z");\r\n',
  surrogates: 'import a from "\uD800x";\nimport b from "\uDC00";\nconst s = "\uD83D";\nrequire("ok");\n',
  invalidUtf8: bytes('import a from "', BAD_UTF8, '";\nrequire("ok");\n'),
  comments: rep('// import a from "x";\n/* require("y") */\n', 1000),
};

const js: LanguageCases = { ...ts, file: 'a.js', many: n => seq(n, i => `import a${i} from "m${i}";\n{ require("r${i % 7}"); }\nfunction f${i}() { return import("q${i}"); }\n`) };

const mods = (f: { imports: Array<{ module: string }> }) => f.imports.map(r => r.module);

for (const [lang, c] of [['typescript', ts], ['javascript', js]] as const) {
  adversarialSuite(lang, c, {
    deep: f => expect(f.imports.length).toBe(2 * 50_000),
    huge: f => {
      expect(f.imports.map(r => r.module.length)).toEqual([MODULE_MAX + 1, 1]);
      expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
      expect(Array.from(f.imports[0].evidence)).toHaveLength(240);
    },
    long: f => expect(mods(f)).toEqual(['x', 'y']),
    bom: f => expect(f.imports.map(r => [r.line, r.column, r.module])).toEqual([[1, 1, 'x']]),
    crlf: f => expect(f.imports.map(r => [r.line, r.column, r.endLine, r.module])).toEqual([[1, 1, 1, 'x'], [2, 1, 4, 'y'], [5, 1, 5, 'z']]),
    binary: f => expect(mods(f)).toEqual(expect.arrayContaining(['x'])),
    surrogates: f => expect(mods(f)).toContain('ok'),
    invalidUtf8: f => expect(mods(f)).toContain('ok'),
    comments: f => expect([f.status, f.imports]).toEqual(['ok', []]),
  });
}
