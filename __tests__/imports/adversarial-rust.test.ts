import { adversarialSuite, bytes, BAD_UTF8, NOISE, PAD, rep, seq } from '../support/imports-adversarial';
import { MODULE_MAX } from '../../src/lib/imports/record';

// Adversarial inputs for Rust: see ../support/imports-adversarial.ts.

const mods = (f: { imports: Array<{ module: string }> }) => f.imports.map(r => r.module);

adversarialSuite('rust', {
  file: 'a.rs',
  deep: n => `use ${rep('a::{', n)}b${rep('}', n)};\nfn f() { let x = ${rep('(serde::x(), ', n)}0${rep(')', n)}; m!(${rep('[', n)}tokio::y${rep(']', n)}); }\n`,
  huge: n => `include!("${'a'.repeat(n)}");\nconst S: &str = r#"${'b'.repeat(n >> 4)}"#;\nuse std::fmt;\n`,
  many: n => seq(n, i => `mod m${i};\nuse a${i}::{b, c};\nmod blk${i} { fn f() { serde::x(); } }\n`),
  long: n => `${rep(`const Q: &str = "${PAD}"; `, Math.ceil(n / 84))}use x::y; fn f() { z::w(); }`,
  escapes: 'include!("\\q");\nconst A: &str = "\\u{zzzz}";\nconst B: &[u8] = b"\\xff\\u{1F600}";\ninclude_str!("\\u{110000}");\nuse ok::fine;\n',
  binary: bytes('use x::a;\n', NOISE, '\nuse y::b;\n'),
  bom: '\uFEFFuse x::a;\n',
  crlf: 'use x::a;\r\nuse y::{\r\n  b,\r\n};\r\nfn f() { z::w(); }\r\n',
  surrogates: 'include!("\uD800x");\nuse ok::fine;\n',
  invalidUtf8: bytes('include!("', BAD_UTF8, '");\nuse ok::fine;\n'),
  comments: rep('// use x::a;\n/* serde::x() */\n/// doc tokio::y\n', 1000),
}, {
  deep: f => {
    expect(mods(f)).toEqual([`${rep('a::', 50_000)}b`.slice(0, MODULE_MAX) + '…', 'serde', 'tokio']);
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
  },
  huge: f => {
    expect(mods(f)).toEqual(['std::fmt']);
    expect(f.unsupported.map(u => [u.construct, Array.from(u.evidence).length])).toEqual([['include-macro', 240]]);
  },
  long: f => expect(mods(f)).toEqual(['x::y', 'z']),
  bom: f => expect(f.imports.map(r => [r.line, r.column, r.module])).toEqual([[1, 1, 'x::a']]),
  crlf: f => expect(f.imports.map(r => [r.line, r.column, r.module])).toEqual([[1, 1, 'x::a'], [2, 1, 'y::b'], [5, 10, 'z']]),
  binary: f => expect(mods(f)).toEqual(expect.arrayContaining(['x::a'])),
  surrogates: f => expect(mods(f)).toContain('ok::fine'),
  invalidUtf8: f => expect(mods(f)).toContain('ok::fine'),
  comments: f => expect([f.status, f.imports]).toEqual(['ok', []]),
});
