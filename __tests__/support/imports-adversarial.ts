/**
 * Adversarial-input harness for the imports extractor: one table of hostile
 * inputs per language, run through extractImports (parse, extract,
 * resolve, coverage) with deterministic work bounds instead of wall-clock
 * limits.
 *
 * Every case must return normally (no throw, no stack overflow), give one
 * file entry and a document valid against schemas/xray.imports.v1.json.
 * Scalable cases (nesting depth, literal size, block count, line length)
 * are measured at a small size n and at 4n before the full-size run, so a
 * regression fails fast and deterministically:
 * - `.parent` accesses do not grow (node-tree-sitter computes `.parent` by
 *   descending from the root: O(depth) per access, quadratic when done per
 *   node or per record on deep input);
 * - source text read (every `.text` and bounded evidence read goes through
 *   the tree's getText) and child arrays materialized (`children`,
 *   `namedChildren`) grow at most linearly;
 * - reads of a file's record list during resolution grow at most linearly
 *   (a per-record scan of the file's records is quadratic in records).
 */
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { validate } from './json-schema';
import { extractImports, type FileImports, type ImportsDoc, type ImportsSourceFile } from '../../src/lib/imports';
import { resolveImports } from '../../src/lib/imports/resolve';

const SCHEMA = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', 'xray.imports.v1.json'), 'utf8'));

/** Full sizes from the adversarial checklist. */
export const DEPTH = 50_000;
export const BLOCKS = 50_000;
export const LITERAL = 20 * 1024 * 1024;
export const LINE = 5 * 1024 * 1024;

/** Small sizes for the scaling checks (n and 4n). */
const SCALE: Record<Scalable, number> = { deep: 500, many: 500, huge: 64 * 1024, long: 64 * 1024 };

/** Growth allowed from n to 4n: linear with slack; quadratic gives ~16. */
const LINEAR = 5;

type Scalable = 'deep' | 'many' | 'huge' | 'long';
type Content = string | Buffer;

export interface LanguageCases {
  /** File name; its extension picks the language. */
  file: string;
  /** Nesting `n` deep, with an import construct at the innermost level or at every level. */
  deep: (n: number) => Content;
  /** A literal of `n` code units where an import target is read (plus a shorter one elsewhere). */
  huge: (n: number) => Content;
  /** `n` blocks / namespaces / import groups, each with import constructs. */
  many: (n: number) => Content;
  /** One line of about `n` code units, import constructs on it. */
  long: (n: number) => Content;
  /** Invalid escape sequences inside import targets. */
  escapes: Content;
  /** An import before and after binary noise and NUL bytes. */
  binary: Content;
  /** UTF-8 BOM, then an import on line 1. */
  bom: Content;
  /** CRLF line endings. */
  crlf: Content;
  /** Lone UTF-16 surrogates in a JS string (encoded as U+FFFD by the reader). */
  surrogates: Content;
  /** Invalid UTF-8 bytes (stray continuation, overlong, encoded surrogate, truncated). */
  invalidUtf8: Content;
  /** Only comments. */
  comments: Content;
}

export interface Work {
  parent: number;
  text: number;
  children: number;
  resolveReads: number;
}

/** Runtime class behind every node (not declared as a value in the typings). */
const NODE_PROTO = (Parser as unknown as { SyntaxNode: { prototype: object } }).SyntaxNode.prototype;

function getter(name: string): () => unknown {
  const d = Object.getOwnPropertyDescriptor(NODE_PROTO, name);
  if (!d?.get) throw new Error(`no getter ${name} on SyntaxNode`);
  return d.get;
}

const run = (file: string, content: Content): ImportsDoc => extractImports([{ path: file, content }], { root: '.', xrayVersion: 'test' });

/** Record-list reads by the resolution pass, re-run over `doc`'s entries. */
function resolveReads(doc: ImportsDoc, inputs: ImportsSourceFile[]): number {
  let reads = 0;
  const entries: FileImports[] = doc.files.map(f => ({
    ...f,
    imports: new Proxy([...f.imports], {
      get(t, k, r) {
        if (typeof k === 'string' && /^\d+$/.test(k)) reads++;
        return Reflect.get(t, k, r);
      },
    }),
  }));
  resolveImports(entries, inputs);
  return reads;
}

/** Deterministic work counters for one extraction. */
export function measure(file: string, content: Content): Work & { doc: ImportsDoc } {
  const w: Work = { parent: 0, text: 0, children: 0, resolveReads: 0 };
  const parentGet = getter('parent');
  const childrenGet = getter('children');
  const namedGet = getter('namedChildren');
  const spies = [
    jest.spyOn(NODE_PROTO as { parent: unknown }, 'parent', 'get').mockImplementation(function (this: unknown) {
      w.parent++;
      return parentGet.call(this);
    }),
    jest.spyOn(NODE_PROTO as { children: unknown[] }, 'children', 'get').mockImplementation(function (this: unknown) {
      const cs = childrenGet.call(this) as unknown[];
      w.children += cs.length;
      return cs;
    }),
    jest.spyOn(NODE_PROTO as { namedChildren: unknown[] }, 'namedChildren', 'get').mockImplementation(function (this: unknown) {
      const cs = namedGet.call(this) as unknown[];
      w.children += cs.length;
      return cs;
    }),
  ];
  const parse = Parser.prototype.parse;
  spies.push(jest.spyOn(Parser.prototype, 'parse').mockImplementation(function (this: Parser, ...args: Parameters<Parser['parse']>) {
    const tree = parse.apply(this, args);
    const getText = tree.getText.bind(tree);
    tree.getText = (n: Parser.SyntaxNode) => {
      const s = getText(n);
      w.text += s.length;
      return s;
    };
    return tree;
  }) as unknown as jest.SpyInstance);
  try {
    const doc = run(file, content);
    for (const s of spies) s.mockRestore();
    w.resolveReads = resolveReads(doc, [{ path: file, content }]);
    return { ...w, doc };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}

/**
 * Array elements visited through the array iterator while `fn` runs:
 * spread, for-of, Array.from, destructuring. Replacing
 * Array.prototype[Symbol.iterator] turns off V8's fast path, so every
 * element copied by `[...a, ...b]` is counted: a prefix copied per nesting
 * level shows up as quadratic.
 */
export function iterations<T>(fn: () => T): { count: number; value: T } {
  const original = Array.prototype[Symbol.iterator];
  let count = 0;
  Array.prototype[Symbol.iterator] = function (this: unknown[]) {
    const it = original.call(this);
    return { next: () => (count++, it.next()), [Symbol.iterator]() { return this; } } as unknown as IterableIterator<unknown>;
  } as typeof original;
  try {
    const value = fn();
    return { count, value };
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
}

/** Contract checks every case shares. */
export function expectValid(doc: ImportsDoc, file: string): FileImports {
  expect(doc.files.map(f => f.path)).toEqual([file]);
  expect(validate(SCHEMA, doc, { noUndeclared: true })).toEqual([]);
  return doc.files[0];
}

/** Work at n and 4n: `.parent` flat, everything else at most linear. */
export function expectBoundedWork(file: string, gen: (n: number) => Content, n: number): { small: Work; large: Work } {
  const { doc: smallDoc, ...small } = measure(file, gen(n));
  expectValid(smallDoc, file);
  const { doc: largeDoc, ...large } = measure(file, gen(4 * n));
  expectValid(largeDoc, file);
  const growth = (k: keyof Work) => (large[k] <= 16 ? 0 : large[k] / Math.max(1, small[k]));
  expect({ case: `${file} @${n}`, parent: large.parent }).toEqual({ case: `${file} @${n}`, parent: small.parent });
  expect({ text: growth('text') <= LINEAR, children: growth('children') <= LINEAR, resolveReads: growth('resolveReads') <= LINEAR })
    .toEqual({ text: true, children: true, resolveReads: true });
  return { small, large };
}

const FULL: Record<Scalable, number> = { deep: DEPTH, many: BLOCKS, huge: LITERAL, long: LINE };

/**
 * The checklist as jest cases for one language. `check` gets each case's
 * file entry for language-specific assertions (records still found, lines
 * and columns right).
 */
export function adversarialSuite(lang: string, c: LanguageCases, check: Partial<Record<keyof Omit<LanguageCases, 'file'>, (f: FileImports) => void>> = {}): void {
  describe(`${lang}: adversarial inputs`, () => {
    describe.each(['deep', 'many', 'huge', 'long'] as const)('%s', kind => {
      it(`bounded work at ${SCALE[kind]} and ${4 * SCALE[kind]}, then the full size (${FULL[kind]}) returns a valid document`, () => {
        expectBoundedWork(c.file, c[kind], SCALE[kind]);
        const f = expectValid(run(c.file, c[kind](FULL[kind])), c.file);
        check[kind]?.(f);
      });
    });

    it.each(['escapes', 'binary', 'bom', 'crlf', 'surrogates', 'invalidUtf8', 'comments'] as const)('%s: returns a valid document', kind => {
      const f = expectValid(run(c.file, c[kind]), c.file);
      check[kind]?.(f);
    });

    it('empty file: ok, complete, no records', () => {
      const f = expectValid(run(c.file, ''), c.file);
      expect([f.status, f.complete, f.imports, f.unsupported, f.parseErrors]).toEqual(['ok', true, [], [], []]);
    });
  });
}

/** Bytes: UTF-8 of each string part, raw bytes for each number array. */
export function bytes(...parts: Array<string | number[]>): Buffer {
  return Buffer.concat(parts.map(p => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p))));
}

/** Binary noise: NULs, control bytes, invalid UTF-8, a fake ELF header. */
export const NOISE = [0x00, 0x00, 0x7f, 0x45, 0x4c, 0x46, 0x01, 0x00, 0xff, 0xfe, 0x00, 0x80, 0x1b, 0x07, 0x00, 0xc0, 0xaf, 0x0a];

/** Invalid UTF-8: stray continuation, overlong `/`, encoded surrogate, truncated 3-byte sequence. */
export const BAD_UTF8 = [0x80, 0xc0, 0xaf, 0xed, 0xa0, 0x80, 0xe2, 0x82];

export const rep = (s: string, n: number) => s.repeat(n);
/** 64-unit literal body: long-line statements carry one so a 5 MB line is ~70k statements, not ~600k. */
export const PAD = 'x'.repeat(64);
export const seq = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('');
