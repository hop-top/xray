import { extractImports, type ImportRecord } from '../../src/lib/imports';
import { evidence, EVIDENCE_MAX } from '../../src/lib/imports/record';
import { specifierPackage } from '../../src/lib/imports/lang/ecmascript';
import { IMPORT_LANGUAGES, importLanguageFor } from '../../src/lib/imports/languages';
import { getGrammar, resetGrammarCache } from '../../src/lib/parser/grammars';

// Behaviour the goldens do not isolate: helper edge cases, file-level
// handling (unclaimed extensions, missing grammar, BOM) and the extension map.

const one = (path: string, content: string | Buffer) => extractImports([{ path, content }], { root: '.', xrayVersion: 'x' });
const records = (path: string, content: string): ImportRecord[] => one(path, content).files[0].imports;

describe('specifierPackage', () => {
  it.each([
    ['react', 'react'],
    ['lodash/fp', 'lodash'],
    ['@scope/pkg', '@scope/pkg'],
    ['@scope/pkg/deep/x', '@scope/pkg'],
    ['@scope', undefined],
    ['@/alias', undefined],
    ['./x', undefined],
    ['../x', undefined],
    ['.', undefined],
    ['/abs/x', undefined],
    ['#internal', undefined],
    ['https://cdn.example/x.js', undefined],
    ['npm:react', undefined],
    ['', undefined],
  ])('%s -> %s', (spec, pkg) => {
    expect(specifierPackage(spec)).toBe(pkg);
  });
});

describe('evidence', () => {
  it('collapses whitespace and trims', () => {
    expect(evidence('  import {\n\ta,\n  b }  from "x"; ')).toBe('import { a, b } from "x";');
  });

  it('caps at EVIDENCE_MAX code points, astral characters counted once', () => {
    const long = 'import x from "' + '😀'.repeat(300) + '";';
    const ev = evidence(long);
    expect(Array.from(ev)).toHaveLength(EVIDENCE_MAX);
    expect(ev.endsWith('…')).toBe(true);
    expect(evidence('a'.repeat(EVIDENCE_MAX))).toBe('a'.repeat(EVIDENCE_MAX));
  });
});

describe('extractImports file handling', () => {
  afterEach(() => {
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
  });

  it('does not list files of extensions no language claims (yet)', () => {
    const doc = extractImports(
      [{ path: 'a.txt', content: 'import os' }, { path: 'b.py', content: 'import os\n' }],
      { root: '.', xrayVersion: 'x' }
    );
    expect(doc.files.map(f => f.path)).toEqual(['b.py']);
    expect(doc.summary).toEqual({ files: 1, complete: 1, imports: 1, unsupported: 0, parseErrors: 0 });
  });

  it('reports grammar-missing without a grammars entry', () => {
    process.env.XRAY_LANG_BLOCK = 'python';
    resetGrammarCache();
    const doc = one('a.py', 'import os\n');
    expect(doc.grammars).toEqual({});
    expect(doc.files[0]).toMatchObject({ status: 'grammar-missing', complete: false, imports: [] });
  });

  it('hashes the raw bytes but does not count a BOM as a column', () => {
    const doc = one('a.py', Buffer.from('﻿import os\n', 'utf8'));
    expect(doc.files[0].sha256).toBe(require('crypto').createHash('sha256').update(Buffer.from('﻿import os\n', 'utf8')).digest('hex'));
    expect(doc.files[0].imports[0]).toMatchObject({ line: 1, column: 8 });
  });

  it('columns are UTF-16 code units, not bytes or code points', () => {
    // 'é' = 1 unit / 2 bytes, '😀' = 2 units / 4 bytes / 1 code point.
    const [r] = records('a.ts', "const s = 'é😀'; import x from 'y';\n");
    expect(r).toMatchObject({ line: 1, column: 18, endColumn: 36 });
  });

  it('parses .tsx with the tsx grammar (imports after JSX are kept)', () => {
    const src = "const a = <div>it's</div>;\nimport { later } from './later';\n";
    expect(records('v.tsx', src).map(r => r.module)).toEqual(['./later']);
  });

  it('Python `import a, b` yields one record per module', () => {
    expect(records('a.py', 'import a.b as c, d\n').map(r => [r.module, r.alias, r.column])).toEqual([
      ['a.b', 'c', 8],
      ['d', undefined, 18],
    ]);
  });

  it('call forms get their own kinds, never static (details: calls.test.ts)', () => {
    expect(records('a.js', "const a = require('a'); import('b');\n").map(r => [r.kind, r.form])).toEqual([
      ['require', 'require'],
      ['dynamic', 'import()'],
    ]);
    expect(records('a.py', "__import__('a')\n").map(r => [r.kind, r.form])).toEqual([['dynamic', '__import__']]);
  });
});

describe('contract extension map', () => {
  it('claims .mjs/.cjs for javascript and .mts/.cts/.tsx for typescript', () => {
    expect(['.js', '.jsx', '.mjs', '.cjs'].map(importLanguageFor)).toEqual(Array(4).fill('javascript'));
    expect(['.ts', '.tsx', '.mts', '.cts'].map(importLanguageFor)).toEqual(Array(4).fill('typescript'));
    expect(importLanguageFor('.py')).toBe('python');
    expect(importLanguageFor('.txt')).toBeUndefined();
  });

  it('every entry names a known grammar pack and claims each extension once', () => {
    const seen = new Set<string>();
    for (const [lang, l] of Object.entries(IMPORT_LANGUAGES)) {
      expect(getGrammar(l.pack).module).not.toBe('');
      for (const e of l.extensions) {
        expect({ lang, ext: e, dup: seen.has(e) }).toEqual({ lang, ext: e, dup: false });
        seen.add(e);
      }
    }
  });
});
