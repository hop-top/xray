import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addExploreOutputFlags, handleExploreAction } from '../src/commands/explore';
import {
  TrigramIndex,
  extractBranchLiterals,
  MAX_INDEX_FILE_BYTES,
  MAX_UNIQUE_TRIGRAMS,
} from '../src/lib/search/trigram-index';

describe('TrigramIndex', () => {
  let tmpDir: string;
  let dbPath: string;
  let repoDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-trigram-test-')));
    dbPath = path.join(tmpDir, 'search.db');
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeRepoFile = (rel: string, content: string, mtimeMs?: number): string => {
    const abs = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    if (mtimeMs !== undefined) {
      const t = new Date(mtimeMs);
      fs.utimesSync(abs, t, t);
    }
    return abs;
  };

  describe('extractBranchLiterals', () => {
    it('extracts literals from simple regex and alternation', () => {
      expect(extractBranchLiterals('foo|bar')).toEqual(['foo', 'bar']);
      expect(extractBranchLiterals('alpha.*beta')).toEqual(['alpha']);
      expect(extractBranchLiterals('(?:foo|bar)')).toBeNull();
    });

    it('returns null when any branch lacks a required >=3 char literal', () => {
      expect(extractBranchLiterals('foo|ab')).toBeNull();
      expect(extractBranchLiterals('ab?c')).toBeNull();
      expect(extractBranchLiterals('a*bc')).toBeNull();
      expect(extractBranchLiterals('.*')).toBeNull();
      expect(extractBranchLiterals('a{0,3}bc')).toBeNull();
    });

    it('handles required quantifiers safely', () => {
      expect(extractBranchLiterals('foo+bar')).toEqual(['foo']);
      expect(extractBranchLiterals('foo*bar')).toEqual(['bar']);
    });
  });

  it('indexes files and supports plain case-insensitive and case-sensitive search', () => {
    writeRepoFile('src/a.ts', 'export function HelloWorld() {\n  return "hello";\n}\n');
    writeRepoFile('src/b.ts', 'export const other = 1;\n');

    const idx = new TrigramIndex(repoDir, dbPath);
    try {
      const sync1 = idx.sync(repoDir, ['src/a.ts', 'src/b.ts']);
      expect(sync1.indexed).toBe(2);

      const ci = idx.search('helloworld', { caseSensitive: false });
      expect(ci.usedFts).toBe(true);
      expect(ci.matches.map((m) => ({ rel: m.relPath, line: m.line }))).toEqual([
        { rel: 'src/a.ts', line: 1 },
      ]);

      const csMiss = idx.search('helloworld', { caseSensitive: true });
      expect(csMiss.matches).toEqual([]);

      const csHit = idx.search('HelloWorld', { caseSensitive: true });
      expect(csHit.matches).toHaveLength(1);
    } finally {
      idx.close();
    }
  });

  it('handles regex alternation, optional quantifiers, and short (<3 char) patterns', () => {
    writeRepoFile('src/one.ts', 'const foo = 1;\nconst ac = 2;\nconst x = 9;\n');
    writeRepoFile('src/two.ts', 'const bar = 3;\nconst abc = 4;\n');

    const idx = new TrigramIndex(repoDir, dbPath);
    try {
      idx.sync(repoDir, ['src/one.ts', 'src/two.ts']);

      // Alternation with >=3-char literals on all branches uses FTS5 UNION
      const alt = idx.search('foo|bar', { regex: true });
      expect(alt.usedFts).toBe(true);
      expect(alt.matches.map((m) => m.relPath).sort()).toEqual(['src/one.ts', 'src/two.ts']);

      // Optional quantifier falls back to full scan and still matches `ac` and `abc`
      const opt = idx.search('ab?c', { regex: true });
      expect(opt.usedFts).toBe(false);
      expect(opt.matches.map((m) => m.relPath).sort()).toEqual(['src/one.ts', 'src/two.ts']);

      // Short (<3 char) plain pattern falls back to full scan
      const shortPlain = idx.search('= 9');
      expect(shortPlain.usedFts).toBe(true);
      const veryShort = idx.search('9;');
      expect(veryShort.usedFts).toBe(false);
      expect(veryShort.matches).toHaveLength(1);
      expect(veryShort.matches[0].relPath).toBe('src/one.ts');
    } finally {
      idx.close();
    }
  });

  it('performs incremental re-sync: skips unchanged, updates modified, removes deleted', () => {
    const t0 = 1_700_000_000_000;
    writeRepoFile('src/keep.ts', 'const keepToken = 1;\n', t0);
    writeRepoFile('src/edit.ts', 'const beforeEdit = 1;\n', t0);
    writeRepoFile('src/drop.ts', 'const dropToken = 1;\n', t0);

    const idx = new TrigramIndex(repoDir, dbPath);
    try {
      const s1 = idx.sync(repoDir, ['src/keep.ts', 'src/edit.ts', 'src/drop.ts']);
      expect(s1).toEqual({ indexed: 3, unchanged: 0, skipped: 0, removed: 0 });

      writeRepoFile('src/edit.ts', 'const afterEdit = 1;\n', t0 + 5000);
      fs.unlinkSync(path.join(repoDir, 'src/drop.ts'));

      const s2 = idx.sync(repoDir, ['src/keep.ts', 'src/edit.ts']);
      expect(s2).toEqual({ indexed: 1, unchanged: 1, skipped: 0, removed: 1 });

      expect(idx.search('beforeEdit').matches).toEqual([]);
      expect(idx.search('afterEdit').matches).toHaveLength(1);
      expect(idx.search('dropToken').matches).toEqual([]);
      expect(idx.search('keepToken').matches).toHaveLength(1);
    } finally {
      idx.close();
    }
  });

  it('skips files >2MB and minified files exceeding trigram cap', () => {
    writeRepoFile('src/normal.ts', 'const findableToken = true;\n');
    writeRepoFile('src/huge.ts', 'a'.repeat(MAX_INDEX_FILE_BYTES + 1024));

    // Generate > 20_000 unique trigrams in a single-line minified-like file
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$';
    const chunks: string[] = [];
    outer: for (let i = 0; i < chars.length; i++) {
      for (let j = 0; j < chars.length; j++) {
        for (let k = 0; k < chars.length; k++) {
          chunks.push(chars[i] + chars[j] + chars[k]);
          if (chunks.length > MAX_UNIQUE_TRIGRAMS + 500) break outer;
        }
      }
    }
    writeRepoFile('src/minified.js', chunks.join(''));

    const idx = new TrigramIndex(repoDir, dbPath);
    try {
      const s = idx.sync(repoDir, ['src/normal.ts', 'src/huge.ts', 'src/minified.js']);
      expect(s.indexed).toBe(1);
      expect(s.skipped).toBe(2);

      const res = idx.search('findableToken');
      expect(res.matches).toHaveLength(1);
      expect(res.matches[0].relPath).toBe('src/normal.ts');
    } finally {
      idx.close();
    }
  });

  it('truncates long lines to 500 chars and slices windows with offset/limit', () => {
    const longLine = `const marker = "${'z'.repeat(600)}";`;
    const manyLines = Array.from({ length: 15 }, (_, i) => `const item_${i} = "paginated";`).join('\n');
    writeRepoFile('src/long.ts', longLine);
    writeRepoFile('src/many.ts', manyLines);

    const idx = new TrigramIndex(repoDir, dbPath);
    try {
      idx.sync(repoDir, ['src/long.ts', 'src/many.ts']);

      const longRes = idx.search('marker');
      expect(longRes.matches).toHaveLength(1);
      expect(longRes.matches[0].content).toContain('… [truncated ');
      expect(longRes.matches[0].content.length).toBeLessThan(540);

      const page1 = idx.search('paginated', { offset: 2, limit: 5 });
      expect(page1.total).toBe(15);
      expect(page1.offset).toBe(2);
      expect(page1.limit).toBe(5);
      expect(page1.hasMore).toBe(true);
      expect(page1.matches).toHaveLength(5);
      expect(page1.matches[0].line).toBe(3);
    } finally {
      idx.close();
    }
  });
});

describe('xray explore --search CLI flags', () => {
  let base: string;
  let repo: string;
  let writeSpy: jest.SpyInstance;
  let logSpies: jest.SpyInstance[];

  const captured = () => writeSpy.mock.calls.map((c) => String(c[0])).join('');

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-explore-trigram-')));
    repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'src', 'app.ts'),
      [
        'export const AlphaOne = 1;',
        'export const alphaone = 2;',
        'export const BetaTwo = 3;',
        'export const ac = 4;',
        'export const abc = 5;',
      ].join('\n')
    );
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logSpies = (['log', 'error', 'warn', 'info'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation()
    );
  });

  afterEach(() => {
    writeSpy.mockRestore();
    logSpies.forEach((s) => s.mockRestore());
  });

  async function runExplore(...args: string[]): Promise<any[]> {
    writeSpy.mockClear();
    const program = new Command();
    program.exitOverride();
    const cmd = program
      .command('explore')
      .option('-p, --path <path>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-m, --match <pattern>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-s, --search <keyword>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-t, --type <ext>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('--regex')
      .option('--case-sensitive')
      .option('--offset <n>', '', (v: string) => parseInt(v, 10))
      .option('--limit <n>', '', (v: string) => parseInt(v, 10))
      .option('--stats');
    addExploreOutputFlags(cmd).action((opts, c) => handleExploreAction(opts, c));
    await program.parseAsync(['node', 'test', 'explore', '-p', repo, '--format', 'json', ...args]);
    return JSON.parse(captured());
  }

  it('supports --regex, --case-sensitive, --offset, and --limit', async () => {
    const cs = await runExplore('-s', 'AlphaOne', '--case-sensitive');
    expect(cs.map((r) => r.line)).toEqual([1]);

    const rx = await runExplore('-s', 'AlphaOne|BetaTwo', '--regex', '--case-sensitive');
    expect(rx.map((r) => r.line)).toEqual([1, 3]);

    const opt = await runExplore('-s', 'ab?c', '--regex');
    expect(opt.map((r) => r.line)).toEqual([4, 5]);

    const paged = await runExplore('-s', 'export', '--offset', '1', '--limit', '2');
    expect(paged.map((r) => r.line)).toEqual([2, 3]);
  });
});
