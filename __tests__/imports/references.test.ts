import { extractImports } from '../../src/lib/imports';

// Targeted checks for kind `reference` records (Rust path roots, PHP
// qualified names); the goldens rust/path-roots, rust/attr-macro-paths and
// php/fqn-references pin full output.

function refs(path: string, content: string) {
  const doc = extractImports([{ path, content }], { root: '.', xrayVersion: 'test' });
  expect(doc.files).toHaveLength(1);
  return doc.files[0].imports.filter(r => r.kind === 'reference');
}

const brief = (rs: ReturnType<typeof refs>) =>
  rs.map(r => [r.module, r.normalized, r.confidence, r.occurrences]);

describe('Rust path-root references', () => {
  it('emits the root of a call path once per file with occurrences', () => {
    const rs = refs('a.rs', 'fn f() {\n    serde_json::to_string(&x);\n    serde_json::from_str(s);\n}\n');
    expect(rs).toEqual([{
      line: 2, column: 5, endLine: 2, endColumn: 26,
      kind: 'reference', form: 'path-root', module: 'serde_json', normalized: 'serde_json', package: 'serde_json',
      locality: 'external', confidence: 'inferred', occurrences: 2, evidence: 'serde_json::to_string',
    }]);
  });

  it('covers types, impl headers and qualified types', () => {
    const rs = refs('a.rs', [
      'fn g(v: http::Request) -> anyhow::Result<()> {}',
      'impl tokio::io::AsyncRead for S {}',
      'type Q = <S as futures::Stream>::Item;',
    ].join('\n'));
    expect(rs.map(r => r.module)).toEqual(['http', 'anyhow', 'tokio', 'futures']);
  });

  it('leading :: is syntactic; std/core/alloc are stdlib', () => {
    const rs = refs('a.rs', 'fn f() -> ::bytes::Bytes { std::mem::drop(1); core::x(); alloc::y(); }');
    expect(rs.map(r => [r.module, r.locality, r.confidence])).toEqual([
      ['bytes', 'external', 'syntactic'],
      ['std', 'stdlib', 'inferred'],
      ['core', 'stdlib', 'inferred'],
      ['alloc', 'stdlib', 'inferred'],
    ]);
  });

  it('skips crate/self/super/Self, CamelCase, primitive and metavariable roots', () => {
    const rs = refs('a.rs', 'fn f() { crate::a(); self::b(); super::c(); Self::d(); Vec::<u8>::new(); Option::Some(1); u32::MAX; str::from_utf8(b); }\nmacro_rules! m { () => { $crate::q::r } }');
    expect(rs).toEqual([]);
  });

  it('skips roots bound by use, extern crate, mod and local items', () => {
    const rs = refs('a.rs', [
      'use std::collections::hash_map;',
      'use a::{b as c, d::{self}};',
      'extern crate rand as rng;',
      'mod util;',
      'mod inner { }',
      'fn helper() {}',
      'const lim: u8 = 1;',
      'fn f() { hash_map::new(); c::x(); d::y(); rng::r(); util::u(); inner::i(); helper::h(); b::kept(); }',
    ].join('\n'));
    expect(rs.map(r => r.module)).toEqual(['b']);
  });

  it('does not read paths inside use declarations as references', () => {
    expect(refs('a.rs', 'use serde::de::Visitor;\nuse ::tokio::io;\n')).toEqual([]);
  });

  it('a leading :: root is never shadowed by a local binding', () => {
    const rs = refs('a.rs', 'mod serde {}\nfn f() { serde::x(); ::serde::y(); }');
    expect(brief(rs)).toEqual([['serde', 'serde', 'syntactic', 1]]);
  });

  it('scans attribute and macro token trees for ident :: ident', () => {
    const rs = refs('a.rs', [
      '#[derive(::serde::Serialize, Debug, serde_derive::Deserialize)]',
      'struct S;',
      'fn f() { println!("{}", chrono::Utc::now(), a.b::c, self::x, crate::y, u8::MAX, $crate::z, "regex::Regex"); }',
    ].join('\n'));
    expect(rs.map(r => [r.module, r.confidence, r.line, r.column, r.endColumn, r.evidence])).toEqual([
      ['serde', 'syntactic', 1, 10, 28, '::serde::Serialize'],
      ['serde_derive', 'inferred', 1, 37, 62, 'serde_derive::Deserialize'],
      ['chrono', 'inferred', 3, 25, 41, 'chrono::Utc::now'],
    ]);
  });

  it('token-tree occurrences count with parsed ones; first occurrence wins', () => {
    const rs = refs('a.rs', 'fn f() { log::info!("a"); dbg!(log::Level::Info); log::warn!("b"); }');
    expect(rs.map(r => [r.module, r.occurrences, r.column, r.evidence])).toEqual([['log', 3, 10, 'log::info']]);
  });

  it('nested token trees keep document order for the first occurrence', () => {
    const rs = refs('a.rs', 'fn f() { m!(g(serde::a), serde::b); }');
    expect(rs.map(r => [r.module, r.occurrences, r.evidence])).toEqual([['serde', 2, 'serde::a']]);
  });

  it('parsed attribute paths (#[tokio::main]) are references', () => {
    expect(refs('a.rs', '#[tokio::main]\nasync fn main() {}').map(r => r.module)).toEqual(['tokio']);
  });

  it('macro_rules bodies are scanned; $crate / $x roots skipped', () => {
    const rs = refs('a.rs', 'macro_rules! m { ($x:ident) => { $crate::a; $x::y; ::std::fmt::Debug; core::mem::swap } }');
    expect(rs.map(r => [r.module, r.confidence])).toEqual([['std', 'syntactic'], ['core', 'inferred']]);
  });
});

describe('PHP qualified-name references', () => {
  const src = [
    '<?php',
    'namespace App\\Http;',
    'use Vendor\\Pkg as P, Other\\Lib;',
    'use function Fn\\helper;',
    'new \\Vendor\\Pkg\\Thing();',
    'P\\Factory::make();',
    'lib\\x\\call();',
    'namespace\\Sub\\K::class;',
    '$a instanceof Models\\User;',
    'helper\\nested();',
    'new Foo();',
    'function f(\\Vendor\\Pkg\\Thing $t): P\\Res { return \\Vendor\\Pkg\\Thing::X; }',
  ].join('\n');

  it('resolves per PHP rules: FQN, use alias (case-insensitive), namespace\\, file namespace', () => {
    expect(refs('a.php', src).map(r => [r.module, r.normalized, r.package, r.confidence, r.occurrences])).toEqual([
      ['Vendor\\Pkg\\Thing', 'Vendor\\Pkg\\Thing', 'Vendor', 'syntactic', 3],
      ['P\\Factory', 'Vendor\\Pkg\\Factory', 'Vendor', 'syntactic', 1],
      ['lib\\x\\call', 'Other\\Lib\\x\\call', 'Other', 'syntactic', 1],
      ['namespace\\Sub\\K', 'App\\Http\\Sub\\K', 'App', 'syntactic', 1],
      ['Models\\User', 'App\\Http\\Models\\User', 'App', 'syntactic', 1],
      ['helper\\nested', 'App\\Http\\helper\\nested', 'App', 'syntactic', 1],
      ['P\\Res', 'Vendor\\Pkg\\Res', 'Vendor', 'syntactic', 1],
    ]);
  });

  it('every PHP reference is syntactic: alias- and namespace-resolved names included', () => {
    expect(refs('a.php', src).every(r => r.confidence === 'syntactic')).toBe(true);
    const rs = refs('a.php', '<?php\nnamespace N;\nuse V\\W;\nnew W\\X();\nnew Q\\R();\n');
    expect(rs.map(r => [r.normalized, r.confidence])).toEqual([['V\\W\\X', 'syntactic'], ['N\\Q\\R', 'syntactic']]);
  });

  it('first occurrence gives position and evidence; form fqn, kind reference', () => {
    const [r] = refs('a.php', src);
    expect(r).toEqual({
      line: 5, column: 5, endLine: 5, endColumn: 22,
      kind: 'reference', form: 'fqn', module: 'Vendor\\Pkg\\Thing', normalized: 'Vendor\\Pkg\\Thing', package: 'Vendor',
      locality: 'unknown', confidence: 'syntactic', occurrences: 3, evidence: '\\Vendor\\Pkg\\Thing',
    });
  });

  it('skips use clauses, namespace names and unqualified names', () => {
    expect(refs('a.php', '<?php\nnamespace A\\B;\nuse X\\Y;\nuse X\\{Z, W\\V};\nnew Foo(); Y::m(); strlen($s);\n')).toEqual([]);
  });

  it('use aliases are scoped to their namespace', () => {
    const rs = refs('a.php', '<?php\nnamespace One;\nuse Vendor\\Lib;\nnew Lib\\A();\nnamespace Two;\nnew Lib\\B();\n');
    expect(rs.map(r => r.normalized)).toEqual(['Vendor\\Lib\\A', 'Two\\Lib\\B']);
  });

  it('braced namespaces and the global namespace', () => {
    const rs = refs('a.php', '<?php\nnamespace N { use V\\W; new W\\X(); }\nnamespace { new W\\Y(); new \\G(); }\n');
    expect(rs.map(r => r.normalized)).toEqual(['V\\W\\X', 'W\\Y', 'G']);
  });

  it('trait use inside a class is a reference', () => {
    expect(refs('a.php', '<?php\nclass C { use \\Traits\\T; }\n').map(r => r.normalized)).toEqual(['Traits\\T']);
  });
});

// Untrusted input: nesting depth must not overflow the JS stack (or go
// quadratic) and abort extraction. 20k overflowed the recursive versions on
// Node 26 (10k already did); tree-sitter itself parses these fine.
describe('Rust extractor on deeply nested input', () => {
  const DEPTH = 20000;
  const segs = (d: number) => Array.from({ length: d }, (_, i) => `a${i}`).join('::');
  const all = (content: string) =>
    extractImports([{ path: 'a.rs', content }], { root: '.', xrayVersion: 'test' }).files[0].imports;

  it('token trees (macro args)', () => {
    const rs = refs('a.rs', `fn f() { m!(${'('.repeat(DEPTH)}x::y${')'.repeat(DEPTH)}); serde::x(); }`);
    expect(rs.map(r => r.module)).toEqual(['x', 'serde']);
  });

  it('use trees (nested lists)', () => {
    const rs = all(`use ${'a::{'.repeat(DEPTH)}b${'}'.repeat(DEPTH)};\nfn f() { serde::x(); }`);
    expect(rs.map(r => [r.kind, r.module.length > 0 ? r.module.split('::').length : 0])).toEqual([['static', DEPTH + 1], ['reference', 1]]);
    expect(rs[1].module).toBe('serde');
  });

  it('use trees nested 100k deep, linear time', () => {
    const t0 = Date.now();
    const rs = all(`use ${'a::{'.repeat(100000)}b${'}'.repeat(100000)};`);
    expect(rs.map(r => r.module.length)).toEqual([100000 * 3 + 1]);
    // Copying the prefix per level was quadratic (~29 s at this depth; ~1 s now).
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  it('use paths (long scoped_identifier chains)', () => {
    const rs = all(`use ${segs(DEPTH)};\nfn f() { serde::x(); }`);
    expect(rs.map(r => [r.kind, r.module.split('::').length])).toEqual([['static', DEPTH], ['reference', 1]]);
  });

  it('expression paths (long scoped_identifier chains), linear time', () => {
    const t0 = Date.now();
    const rs = refs('a.rs', `fn f() { ${segs(DEPTH)}(); serde::x(); }`);
    expect(rs.map(r => [r.module, r.evidence.length])).toEqual([['a0', 240], ['serde', 8]]);
    // Climbing `.parent` per chain link was quadratic (~11 s at this depth; ~0.1 s now).
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('many distinct roots deep in token trees, linear time', () => {
    const t0 = Date.now();
    const rs = refs('a.rs', `fn f() { m!(${Array.from({ length: DEPTH }, (_, i) => `r${i}::x(`).join('')}${')'.repeat(DEPTH)}); }`);
    expect(rs).toHaveLength(DEPTH);
    expect(rs[DEPTH - 1].evidence).toBe(`r${DEPTH - 1}::x`);
    // Range text via `.parent` per record was quadratic (~77 s at this depth; ~0.4 s now).
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe('PHP extractor on deeply nested input', () => {
  it('qualified names nested 20k deep, linear time', () => {
    const t0 = Date.now();
    const rs = refs('a.php', `<?php\n${'\\A\\f('.repeat(20000)}${')'.repeat(20000)}; new \\V\\X();`);
    expect(rs.map(r => [r.normalized, r.occurrences])).toEqual([['A\\f', 20000], ['V\\X', 1]]);
    // `.parent` per name was quadratic (~27 s at this depth; ~0.3 s now).
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  it('many names and many namespace blocks: linear time', () => {
    const N = 60000;
    // Worst case for a per-name scan over regions: every name in the first
    // region, N empty regions after it.
    const src = `<?php\nnamespace First;\n${'X\\Y;\n'.repeat(N)}${Array.from({ length: N }, (_, i) => `namespace N${i};\n`).join('')}`;
    const t0 = Date.now();
    const rs = refs('a.php', src);
    expect(rs.map(r => [r.normalized, r.occurrences])).toEqual([['First\\X\\Y', N]]);
    // Scanning every namespace region per name was O(names x namespaces): ~7 s here; ~1.3 s now.
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it('region lookup: nested and overlapping regions resolve to the latest-starting container', () => {
    const rs = refs('a.php', '<?php\nnamespace A { namespace B { new X\\Y(); } new P\\Q(); }\nnew G\\H();\n');
    expect(rs.map(r => r.normalized)).toEqual(['B\\X\\Y', 'A\\P\\Q', 'G\\H']);
    // Unbraced `namespace B;` inside a braced block runs to the next namespace, past A's end.
    const ov = refs('a.php', '<?php\nnamespace A { new A1\\Z(); namespace B; new X\\Y(); }\nnew P\\Q();\nnamespace C;\nnew R\\S();\n');
    expect(ov.map(r => r.normalized)).toEqual(['A\\A1\\Z', 'B\\X\\Y', 'B\\P\\Q', 'C\\R\\S']);
  });
});

