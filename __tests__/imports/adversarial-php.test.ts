import { adversarialSuite, bytes, BAD_UTF8, NOISE, PAD, rep, seq } from '../support/imports-adversarial';
import { MODULE_MAX } from '../../src/lib/imports/record';

// Adversarial inputs for PHP: see ../support/imports-adversarial.ts.

const mods = (f: { imports: Array<{ module: string }> }) => f.imports.map(r => r.module);

adversarialSuite('php', {
  file: 'a.php',
  deep: n => `<?php\n$x = ${rep('[require "a.php", new \\A\\B(), ', n)}0${rep(']', n)};\n`,
  huge: n => `<?php\nrequire "${'a'.repeat(n)}";\n$s = '${'b'.repeat(n >> 4)}';\nuse X\\Y;\n`,
  many: n => `<?php\n${seq(n, i => `namespace N${i} { use A\\{B, C as D}; new \\X\\Y(); require_once __DIR__ . '/f${i % 7}.php'; }\n`)}`,
  long: n => `<?php ${rep(`$q = '${PAD}'; `, Math.ceil(n / 73))}use X\\Y; require 'z.php';`,
  escapes: '<?php\nrequire "\\u{FFFFFFFFFFFFFFFFFFFF}";\nrequire "\\400";\nrequire "\\x";\nrequire "\\u{D800}";\nrequire "\\u{zz}";\nrequire \'\\q\';\nuse Ok\\Fine;\n',
  binary: bytes('<?php\nuse X\\A;\n', NOISE, '\nuse Y\\B;\n'),
  bom: '\uFEFF<?php use X\\A;\n',
  crlf: '<?php\r\nuse X\\A;\r\nuse Y\\{\r\n  B,\r\n};\r\nrequire "z.php";\r\n',
  surrogates: '<?php\nrequire "\uD800x";\nuse Ok\\Fine;\n',
  invalidUtf8: bytes('<?php\nrequire "', BAD_UTF8, '";\nuse Ok\\Fine;\n'),
  comments: `<?php\n${rep('// use X\\A;\n/* new \\B\\C(); */\n# require "x";\n', 1000)}`,
}, {
  deep: f => expect(f.imports.map(r => [r.module, r.occurrences ?? 1]).filter(([m]) => m !== 'a.php')).toEqual([['A\\B', 50_000]]),
  huge: f => {
    expect(f.imports.map(r => r.module.length)).toEqual([MODULE_MAX + 1, 3]);
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
  },
  long: f => expect(mods(f)).toEqual(['X\\Y', 'z.php']),
  bom: f => expect(f.imports.map(r => [r.line, r.column, r.module])).toEqual([[1, 7, 'X\\A']]),
  crlf: f => expect(f.imports.map(r => [r.line, r.module])).toEqual([[2, 'X\\A'], [3, 'Y\\B'], [6, 'z.php']]),
  binary: f => expect(mods(f)).toEqual(expect.arrayContaining(['X\\A'])),
  surrogates: f => expect(mods(f)).toContain('Ok\\Fine'),
  invalidUtf8: f => expect(mods(f)).toContain('Ok\\Fine'),
  comments: f => expect([f.status, f.imports]).toEqual(['ok', []]),
});
