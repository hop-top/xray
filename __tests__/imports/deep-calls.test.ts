import Parser from 'tree-sitter';
import { extractImports } from '../../src/lib/imports';

// Deep-input guards for the call-form passes (TS/JS, Python, PHP includes), bounded by
// operation count, not wall-clock: node-tree-sitter computes `.parent` by
// descending from the root (O(depth) per access), so any ancestor climb per
// node makes a pass quadratic on deep input. The passes must carry ancestor
// state down their walk instead: `.parent` accesses do not grow from N to 4N,
// and are zero (one access per identifier is already O(depth) each).

/** Runtime class behind every node (not declared as a value in the typings). */
const NODE_PROTO = (Parser as unknown as { SyntaxNode: { prototype: { readonly parent: unknown } } }).SyntaxNode.prototype;

function parentAccesses(path: string, content: string): { count: number; imports: ReturnType<typeof extractImports>['files'][number]['imports'] } {
  const spy = jest.spyOn(NODE_PROTO, 'parent', 'get');
  try {
    const doc = extractImports([{ path, content }], { root: '.', xrayVersion: 'test' });
    expect(doc.files).toHaveLength(1);
    return { count: spy.mock.calls.length, imports: doc.files[0].imports };
  } finally {
    spy.mockRestore();
  }
}

const N = 60;

/** `.parent` accesses at N and 4N. */
function scaling(path: string, gen: (n: number) => string) {
  const small = parentAccesses(path, gen(N));
  const large = parentAccesses(path, gen(4 * N));
  return { small, large };
}

describe('TS/JS call forms on deeply nested input', () => {
  it('nested require() calls: binding checks do not climb', () => {
    const { small, large } = scaling('a.js', n => `${'require('.repeat(n)}'m'${')'.repeat(n)};\n`);
    expect(large.imports.filter(r => r.form === 'require').map(r => r.module)).toEqual(['m']);
    expect([small.count, large.count]).toEqual([0, 0]);
  });

  it('`require` bound deep inside nested arrows: ambient check does not climb', () => {
    const gen = (n: number) => `${'(a) => '.repeat(n)}(require) => 0;\nrequire('m');\n`;
    const { small, large } = scaling('a.ts', gen);
    // Shadowed: no require record.
    expect(large.imports.filter(r => r.form === 'require')).toEqual([]);
    expect([small.count, large.count]).toEqual([0, 0]);
  });

  it('`require` declared deep inside an ambient module stays global', () => {
    const gen = (n: number) => `declare module 'x' { ${'namespace A { '.repeat(n)}const require: any;${' }'.repeat(n)} }\nrequire('m');\n`;
    const { small, large } = scaling('a.ts', gen);
    expect(large.imports.filter(r => r.form === 'require').map(r => r.module)).toEqual(['m']);
    expect([small.count, large.count]).toEqual([0, 0]);
  });

  it('nested non-literal import() calls: type-position check does not climb', () => {
    const { small, large } = scaling('a.ts', n => `const x = ${'import('.repeat(n)}'m'${')'.repeat(n)};\n`);
    expect(large.imports.filter(r => r.form === 'import()').map(r => r.module)).toEqual(['m']);
    expect([small.count, large.count]).toEqual([0, 0]);
  });

  it('import() deep inside a type: still a type import, without climbing', () => {
    const gen = (n: number) => `type T = ${'Array<'.repeat(n)}import('m').X${'>'.repeat(n)};\nconst y = ${'['.repeat(n)}import('n')${']'.repeat(n)} as ${'Array<'.repeat(n)}import('o').Y${'>'.repeat(n)};\n`;
    const { small, large } = scaling('a.ts', gen);
    expect(large.imports.map(r => [r.module, r.form])).toEqual([
      ['m', 'import-type'], ['n', 'import()'], ['o', 'import-type'],
    ]);
    expect([small.count, large.count]).toEqual([0, 0]);
  });
});

describe('Python call forms on deeply nested input', () => {
  it('nested __import__() calls: binding checks do not climb', () => {
    const { small, large } = scaling('a.py', n => `${'__import__('.repeat(n)}'m'${')'.repeat(n)}\n`);
    expect(large.imports.map(r => [r.module, r.form])).toEqual([['m', '__import__']]);
    expect([small.count, large.count]).toEqual([0, 0]);
  });

  it('`__import__` bound deep inside nested functions shadows the builtin', () => {
    const gen = (n: number) =>
      `${Array.from({ length: n }, (_, i) => `${'    '.repeat(i)}def f${i}():\n`).join('')}${'    '.repeat(n)}__import__ = 1\n__import__('m')\n`;
    const { small, large } = scaling('a.py', gen);
    expect(large.imports).toEqual([]);
    expect([small.count, large.count]).toEqual([0, 0]);
  });

  it('`from m import __import__` deep in nested blocks shadows the builtin', () => {
    const gen = (n: number) =>
      `${Array.from({ length: n }, (_, i) => `${'    '.repeat(i)}if x:\n`).join('')}${'    '.repeat(n)}from m import __import__\n__import__('k')\n`;
    const { small, large } = scaling('a.py', gen);
    expect(large.imports.map(r => [r.module, r.form])).toEqual([['m', 'from']]);
    expect([small.count, large.count]).toEqual([0, 0]);
  });
});

describe('PHP include forms on deeply nested input', () => {
  it('literal require/include records nested in arrays: statement evidence without climbing', () => {
    const { small, large } = scaling('a.php', n => `<?php\n$x = ${'[require "a.php", '.repeat(n)}0${']'.repeat(n)};\n`);
    expect(large.imports.filter(r => r.kind === 'require')).toHaveLength(4 * N);
    expect([small.count, large.count]).toEqual([0, 0]);
  });

  it('a statement-level include still takes the statement as evidence', () => {
    const { large } = scaling('a.php', n => `<?php\n${'require_once "b.php";\n'.repeat(n)}f(include "c.php");\n`);
    const forms = large.imports.map(r => [r.form, r.evidence]);
    expect(forms[0]).toEqual(['require_once', 'require_once "b.php";']);
    expect(forms[forms.length - 1]).toEqual(['include', 'include "c.php"']);
  });
});
