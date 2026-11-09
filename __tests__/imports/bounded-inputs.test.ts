/**
 * Hostile-size inputs stay linear and bounded:
 * - manifest parsing (Cargo.toml table headers, go.mod / go.work
 *   directives) has no backtracking pattern that goes polynomial on long
 *   lines, blank-line runs or unclosed blocks;
 * - evidence reads at most EVIDENCE_WINDOW source units per record, never
 *   a node's full text, whatever the node's size;
 * - module strings read at most MODULE_WINDOW source units per read, and a
 *   module built from many segments stops reading once past the cap.
 */
import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import { parseGoModRequires, parseGoWorkUses, parseModulePath } from '../../src/lib/graph/go-resolver';
import { extractImports } from '../../src/lib/imports';
import { EVIDENCE_MAX, EVIDENCE_WINDOW, MODULE_MAX, MODULE_WINDOW, evidence } from '../../src/lib/imports/record';
import { cargoBuildScripts } from '../../src/lib/imports/unsupported';

const SRC = path.resolve(__dirname, '..', '..', 'src');

/** ms for fn(n) (best of 3: scheduler noise only inflates). */
function time(fn: (n: number) => void, n: number): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = process.hrtime.bigint();
    fn(n);
    best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
  }
  return best;
}

/** 4x the input costs < 8x the time (linear, with slack); a polynomial parser fails by orders of magnitude. */
function expectLinear(fn: (n: number) => void, small: number) {
  fn(small); // warm-up (JIT)
  const a = Math.max(time(fn, small), 0.5);
  const b = time(fn, small * 4);
  expect(b / a).toBeLessThan(8);
}

describe('Cargo.toml table headers', () => {
  const toml = (n: number) => [{ path: 'Cargo.toml', content: `[${' '.repeat(n)}x\n[package]\nname = "x"\n` }, { path: 'build.rs', content: '' }];

  it('no regex on the header line (structural)', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib', 'imports', 'unsupported.ts'), 'utf8');
    expect(src).not.toMatch(/\/\^\\\[\\s\*/);
  });

  it.each([
    ['unclosed `[` + spaces', (n: number) => `[${' '.repeat(n)}x`],
    ['unclosed `[` + tabs', (n: number) => `[${'\t'.repeat(n)}`],
    ['unclosed `[ x x x`', (n: number) => `[${' x'.repeat(n / 2)}`],
  ])('%s: linear, then 50k and 200k complete', (_what, line) => {
    const run = (n: number) => cargoBuildScripts([{ path: 'Cargo.toml', content: `${line(n)}\n[package]\n` }]);
    // Small sizes first: the old pattern was cubic (2k chars ~4 s, 4k ~35 s), so a regression fails here fast.
    expectLinear(run, 400);
    expectLinear(run, 50_000);
    expect(run(200_000).size).toBe(1);
  });

  it('headers still parse: [package] with spacing, [[bin]] resets', () => {
    expect([...cargoBuildScripts(toml(10)).keys()]).toEqual(['build.rs']);
    expect(cargoBuildScripts([{ path: 'Cargo.toml', content: '[  package  ]\nbuild = "gen.rs"\n' }]).has('gen.rs')).toBe(true);
    expect(cargoBuildScripts([{ path: 'Cargo.toml', content: '[[bin]]\nbuild = "gen.rs"\n' }]).size).toBe(0);
    expect(cargoBuildScripts([{ path: 'Cargo.toml', content: '[]\n[workspace]\n' }]).size).toBe(0);
  });
});

describe('go.mod / go.work directives', () => {
  it.each([
    ['module after a blank-line run', (n: number) => parseModulePath(`${'\n'.repeat(n)}x`)],
    ['require after a blank-line run', (n: number) => parseGoModRequires(`${'\n'.repeat(n)}x`)],
    ['many unclosed require blocks', (n: number) => parseGoModRequires('require (\n'.repeat(n / 10))],
    ['use after a blank-line run', (n: number) => parseGoWorkUses(`${'\n'.repeat(n)}x`, '/w')],
    ['many unclosed use blocks', (n: number) => parseGoWorkUses('use (\n'.repeat(n / 10), '/w')],
  ])('%s: linear, then 200k completes', (_what, fn) => {
    // Old patterns were quadratic (20k ~0.7-6 s): small sizes first so a regression fails fast.
    expectLinear(fn, 5_000);
    expectLinear(fn, 50_000);
    fn(200_000);
  });

  it('same results as the directive grammar', () => {
    const mod = [
      '// header', 'module "example.com/m" // c', '', 'go 1.22',
      'require example.com/a v1.0.0', 'require (', '\texample.com/b v1.2.3 // indirect', '\t"example.com/c" v0.1.0', '', '\t`example.com/d` v2', ')',
      'require ( example.com/e v1 )', 'requirex example.com/no v1', 'require example.com/nover', 'require (', 'example.com/unclosed v1',
    ].join('\n');
    expect(parseModulePath(mod)).toBe('example.com/m');
    expect(parseModulePath('module\texample.com/t\r\n')).toBe('example.com/t');
    expect(parseModulePath('modulex a\n')).toBeNull();
    expect(parseGoModRequires(mod)).toEqual(['example.com/b', 'example.com/c', 'example.com/d', 'example.com/e', 'example.com/a']);
    const work = ['go 1.22', 'use ./a', 'use (', '  ./b', '  "./c" // x', ')', 'use(./d)'].join('\n');
    expect([...parseGoWorkUses(work, '/w')].sort()).toEqual(['/w/a', '/w/b', '/w/c', '/w/d']);
  });
});

const BIG = 20 * 1024 * 1024;

/** Length of every source read (getText) from trees parsed in the current test. */
function spyReads(): number[] {
  const reads: number[] = [];
  const parse = Parser.prototype.parse;
  beforeEach(() => {
    reads.length = 0;
    // Each tree gets its own getText at parse; every node `.text` and bounded read goes through it.
    jest.spyOn(Parser.prototype, 'parse').mockImplementation(function (this: Parser, ...args: Parameters<Parser['parse']>) {
      const tree = parse.apply(this, args);
      const getText = tree.getText.bind(tree);
      tree.getText = (n: Parser.SyntaxNode) => {
        const s = getText(n);
        reads.push(s.length);
        return s;
      };
      return tree;
    });
  });
  afterEach(() => jest.restoreAllMocks());
  return reads;
}

describe('evidence is bounded by EVIDENCE_WINDOW, not the node', () => {
  const reads = spyReads();

  it('window = EVIDENCE_MAX * 4', () => {
    expect(EVIDENCE_WINDOW).toBe(EVIDENCE_MAX * 4);
  });

  it.each([
    ['javascript eval', 'a.js', (pad: string) => `eval(x + "${pad}");\n`, 'eval'],
    ['python exec', 'a.py', (pad: string) => `exec(x + "${pad}")\n`, 'exec'],
    ['php eval', 'a.php', (pad: string) => `<?php eval($x . "${pad}");\n`, 'eval'],
  ])('%s over a 20 MB node: no read beyond the window', (_what, file, src, construct) => {
    const doc = extractImports([{ path: file, content: src('a'.repeat(BIG)) }], { root: '.', xrayVersion: 't' });
    const u = doc.files[0].unsupported;
    expect(u.map(r => r.construct)).toEqual([construct]);
    expect(Array.from(u[0].evidence)).toHaveLength(EVIDENCE_MAX);
    expect(u[0].evidence.endsWith('…')).toBe(true);
    expect(Math.max(0, ...reads)).toBeLessThanOrEqual(EVIDENCE_WINDOW);
  });

  it.each([
    ['python import list', 'a.py', (n: number) => `import ${Array.from({ length: n }, (_, i) => `m${i}`).join(', ')}\n`],
    ['rust use group', 'a.rs', (n: number) => `use c::{${Array.from({ length: n }, (_, i) => `m${i}`).join(', ')}};\n`],
    ['php use group', 'a.php', (n: number) => `<?php use A\\{${Array.from({ length: n }, (_, i) => `M${i}`).join(', ')}};\n`],
  ])('%s: per-record evidence reads stay within the window (no whole-statement reads)', (_what, file, src) => {
    const n = 20_000;
    const doc = extractImports([{ path: file, content: src(n) }], { root: '.', xrayVersion: 't' });
    expect(doc.files[0].imports.length).toBeGreaterThanOrEqual(n);
    expect(Math.max(0, ...reads)).toBeLessThanOrEqual(EVIDENCE_WINDOW);
  });

  it('string evidence() is bounded the same way and matches the unbounded rule on short input', () => {
    expect(evidence('  import   a\n\tfrom  b ')).toBe('import a from b');
    const long = 'x'.repeat(BIG);
    expect(evidence(long)).toBe('x'.repeat(EVIDENCE_MAX - 1) + '…');
    expect(evidence('😀'.repeat(300))).toBe('😀'.repeat(EVIDENCE_MAX - 1) + '…');
  });
});

describe('module strings are bounded by MODULE_WINDOW, not the node', () => {
  const reads = spyReads();
  const big = 'a'.repeat(BIG);
  const sum = () => reads.reduce((n, x) => n + x, 0);

  it('window = MODULE_MAX * 2', () => {
    expect(MODULE_WINDOW).toBe(MODULE_MAX * 2);
  });

  it.each([
    ['typescript string specifier', 'a.ts', `import x from "${big}";\n`],
    ['javascript require literal', 'a.js', `require("${big}");\n`],
    ['javascript import() template', 'a.js', `import(\`${big}\`);\n`],
    ['python import (one huge segment)', 'a.py', `import ${big}\n`],
    ['python __import__ literal', 'a.py', `__import__("${big}")\n`],
    ['go import path', 'a.go', `package m\n\nimport "${big}"\n`],
    ['rust use path (one huge segment)', 'a.rs', `use ${big}::x;\n`],
    ['rust mod name', 'a.rs', `mod ${big};\n`],
    ['php use name', 'a.php', `<?php\nuse ${big}\\X;\n`],
    ['php use name, whitespace-padded', 'a.php', `<?php\nuse A${' '.repeat(BIG >> 2)}\\${big}\\X;\n`],
    ['php include literal', 'a.php', `<?php\nrequire "${big}";\n`],
  ])('%s over 20 MB: no read beyond the window, module truncated', (_what, file, src) => {
    const doc = extractImports([{ path: file, content: src }], { root: '.', xrayVersion: 't' });
    const f = doc.files[0];
    expect(Math.max(0, ...reads)).toBeLessThanOrEqual(MODULE_WINDOW);
    expect(f.imports.map(r => r.module.length)).toEqual([MODULE_MAX + 1]);
    expect(f.unsupported.map(u => u.construct)).toEqual(['oversized-module']);
  });

  it.each([
    ['python long dotted path', 'a.py', (n: number) => `import ${Array(n).fill('a').join('.')}\n`],
    ['python from long dotted path', 'a.py', (n: number) => `from ${Array(n).fill('a').join('.')} import x\n`],
  ])('%s: segment reads stop past the cap (total read independent of the path length)', (_what, file, src) => {
    const total = (n: number) => {
      reads.length = 0;
      const doc = extractImports([{ path: file, content: src(n) }], { root: '.', xrayVersion: 't' });
      expect(doc.files[0].imports.map(r => r.module.length)).toEqual([MODULE_MAX + 1]);
      return sum();
    };
    const small = total(50_000);
    expect(total(200_000)).toBe(small);
    // A few bounded module reads of the path (record, loader bindings) plus evidence.
    expect(small).toBeLessThanOrEqual(4 * MODULE_WINDOW);
  });
});
