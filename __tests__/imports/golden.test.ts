import * as fs from 'fs';
import * as path from 'path';
import { validate } from '../support/json-schema';
import { extractImports, IMPORTS_EXTRACTOR_VERSION, type ImportsSourceFile } from '../../src/lib/imports';
import type { ImportsDoc } from '../../src/lib/imports/types';

// Golden harness for the imports contract.
//
// Layout: __tests__/fixtures/imports/<lang>/<case>/
//   expected.json  the full ImportsDoc for this case
//   everything else  input files; paths relative to the case dir = root "."
//
// Every case: extractor output == expected.json (values and key order),
// expected.json valid against schemas/xray.imports.v1.json with no
// undeclared fields, and deterministic order (files by posix path; imports
// by line, column, module; unsupported by line, column, construct;
// parseErrors by start).
//
// Header values that change without any output change are pinned here:
// `xray.version` via the option, `xray.extractor` and every
// `grammars.<lang>.version` replaced by a placeholder (asserted separately)
// so a version or grammar bump does not rewrite every golden; record changes
// a grammar bump causes still show up in the goldens.
//
// XRAY_UPDATE_GOLDENS=1 rewrites expected.json from the extractor; review the
// diff before committing.

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, '__tests__', 'fixtures', 'imports');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'xray.imports.v1.json'), 'utf8'));
const GOLDEN_XRAY = { version: '0.0.0-golden', extractor: '0.0.0-golden' };
const UPDATE = process.env.XRAY_UPDATE_GOLDENS === '1';

interface Case { lang: string; name: string; dir: string }

function cases(): Case[] {
  const out: Case[] = [];
  for (const lang of fs.readdirSync(FIXTURES).sort()) {
    const langDir = path.join(FIXTURES, lang);
    if (!fs.statSync(langDir).isDirectory()) continue;
    for (const name of fs.readdirSync(langDir).sort()) {
      const dir = path.join(langDir, name);
      if (fs.statSync(dir).isDirectory()) out.push({ lang, name, dir });
    }
  }
  return out;
}

function inputs(dir: string, rel = ''): ImportsSourceFile[] {
  const out: ImportsSourceFile[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...inputs(dir, p));
    else if (p !== 'expected.json') out.push({ path: p, content: fs.readFileSync(path.join(dir, p)) });
  }
  return out.sort((a, b) => cmp(a.path, b.path));
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

const GOLDEN_GRAMMAR_VERSION = '0.0.0-golden';

function run(c: Case): ImportsDoc {
  const doc = extractImports(inputs(c.dir), { root: '.', xrayVersion: GOLDEN_XRAY.version });
  const grammars = Object.fromEntries(
    Object.entries(doc.grammars).map(([k, g]) => [k, { ...g, version: GOLDEN_GRAMMAR_VERSION }])
  );
  return { ...doc, xray: { ...doc.xray, extractor: GOLDEN_XRAY.extractor }, grammars };
}

function orderViolations(doc: ImportsDoc): string[] {
  const v: string[] = [];
  const sorted = <T>(xs: T[], key: (x: T) => Array<string | number>, what: string) => {
    for (let i = 1; i < xs.length; i++) {
      const a = key(xs[i - 1]), b = key(xs[i]);
      const c = a.map((x, j) => cmp(x, b[j])).find(r => r !== 0) ?? 0;
      if (c > 0) v.push(`${what}[${i}] out of order`);
    }
  };
  sorted(doc.files, f => [f.path], 'files');
  for (const f of doc.files) {
    sorted(f.imports, r => [r.line, r.column, r.module], `${f.path} imports`);
    sorted(f.unsupported, r => [r.line, r.column, r.construct], `${f.path} unsupported`);
    sorted(f.parseErrors, r => [r.start.line, r.start.column], `${f.path} parseErrors`);
  }
  return v;
}

const all = cases();

describe('imports golden fixtures', () => {
  it('finds at least one case', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('order check flags out-of-order files and records', () => {
    const rec = (line: number, column: number, module: string) =>
      ({ line, column, endLine: line, endColumn: column + 1, kind: 'static', form: 'import', module,
         normalized: module, locality: 'unknown', confidence: 'syntactic', evidence: module }) as const;
    const file = (p: string, imports: ReturnType<typeof rec>[]) =>
      ({ path: p, language: 'python', sha256: '0'.repeat(64), status: 'ok', complete: true,
         parseErrors: [], imports: [...imports], unsupported: [] }) as const;
    const base = extractImports([], { root: '.', xrayVersion: 'x' });
    const ok = { ...base, files: [file('a.py', [rec(1, 1, 'b'), rec(1, 8, 'a'), rec(2, 1, 'a'), rec(2, 1, 'b')])] };
    expect(orderViolations(ok as unknown as ImportsDoc)).toEqual([]);
    const badFiles = { ...base, files: [file('b.py', []), file('a.py', [])] };
    expect(orderViolations(badFiles as unknown as ImportsDoc)).toEqual(['files[1] out of order']);
    const badRecs = { ...base, files: [file('a.py', [rec(2, 1, 'a'), rec(1, 1, 'a')])] };
    expect(orderViolations(badRecs as unknown as ImportsDoc)).toEqual(['a.py imports[1] out of order']);
    const badModule = { ...base, files: [file('a.py', [rec(1, 1, 'b'), rec(1, 1, 'a')])] };
    expect(orderViolations(badModule as unknown as ImportsDoc)).toEqual(['a.py imports[1] out of order']);
  });

  it('extractor version is semver', () => {
    expect(IMPORTS_EXTRACTOR_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    const doc = extractImports([], { root: '.', xrayVersion: '1.2.3' });
    expect(doc.xray).toEqual({ version: '1.2.3', extractor: IMPORTS_EXTRACTOR_VERSION });
  });

  it('grammar header reports the loaded module version (placeholder only in goldens)', () => {
    const doc = extractImports([{ path: 'a.py', content: 'import os\n' }], { root: '.', xrayVersion: 'x' });
    const pkg = JSON.parse(fs.readFileSync(require.resolve('tree-sitter-python/package.json'), 'utf8'));
    expect(doc.grammars).toEqual({ python: { module: 'tree-sitter-python', version: pkg.version, source: 'xray' } });
    expect(pkg.version).not.toBe(GOLDEN_GRAMMAR_VERSION);
  });

  describe.each(all.map(c => [`${c.lang}/${c.name}`, c] as const))('%s', (_id, c) => {
    const expectedPath = path.join(c.dir, 'expected.json');

    if (UPDATE) {
      it('updates expected.json', () => {
        fs.writeFileSync(expectedPath, JSON.stringify(run(c), null, 2) + '\n');
      });
    }

    it('has expected.json', () => {
      expect(fs.existsSync(expectedPath)).toBe(true);
    });

    const expected = (): ImportsDoc => JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

    it('expected.json is valid against the schema (no undeclared fields)', () => {
      expect(validate(schema, expected(), { noUndeclared: true })).toEqual([]);
    });

    it('expected.json is in deterministic order', () => {
      expect(orderViolations(expected())).toEqual([]);
    });

    it('extractor output equals expected.json (values and key order)', () => {
      const actual = run(c);
      expect(actual).toEqual(expected());
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected()));
    });
  });
});
