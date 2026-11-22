import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import MarkdownStrategy from '../strategies/markdown';
import { StrategyContextImpl } from '../src/lib/strategy/context';
import { parseMarkdownDocument } from '../src/lib/markdown/parser';
import { buildShareSummary } from '../src/lib/share-summary';
import { RankedNode } from '../src/types/graph';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

async function analyzeAllMarkdown(strategy: MarkdownStrategy, ctx: StrategyContextImpl, docs: string[]): Promise<void> {
  for (const doc of docs) {
    const res = await strategy.analyze(doc, ctx);
    ctx.setFileMetadata(doc, strategy.name, res.metadata);
  }
}

describe('parseMarkdownDocument', () => {
  it('extracts headings, links, inline code refs, and @file citations outside fences', () => {
    const content = [
      '# Top Title',
      '',
      'See [guide](./guide.md) and `src/app.ts`, `src/app.ts:42`, `src/app.ts#run`.',
      '',
      'Citation: `@file:src/lib/util.ts:10-20@a1b2c3d` and @file:main.go@deadbee.',
      '',
      '```markdown',
      '# Fake Heading',
      '[Fake](./fake.md)',
      '`src/fake.ts:999`',
      '@file:src/fake.ts:1@0000000',
      '```',
      '',
      '## Sub Section!',
    ].join('\n');

    const parsed = parseMarkdownDocument(content);

    expect(parsed.headings).toEqual([
      { level: 1, text: 'Top Title', slug: 'top-title', line: 1 },
      { level: 2, text: 'Sub Section!', slug: 'sub-section', line: 14 },
    ]);

    expect(parsed.links.map(l => ({ target: l.target, line: l.line }))).toEqual([
      { target: './guide.md', line: 3 },
    ]);

    expect(parsed.codeRefs.map(r => ({ path: r.path, line: r.line, symbol: r.symbol }))).toEqual([
      { path: 'src/app.ts', line: undefined, symbol: undefined },
      { path: 'src/app.ts', line: 42, symbol: undefined },
      { path: 'src/app.ts', line: undefined, symbol: 'run' },
    ]);

    expect(parsed.citations).toEqual([
      {
        path: 'src/lib/util.ts',
        lineStart: 10,
        lineEnd: 20,
        sha: 'a1b2c3d',
        docLine: 5,
        raw: '@file:src/lib/util.ts:10-20@a1b2c3d',
      },
      {
        path: 'main.go',
        lineStart: undefined,
        lineEnd: undefined,
        sha: 'deadbee',
        docLine: 5,
        raw: '@file:main.go@deadbee',
      },
    ]);
  });
});

describe('MarkdownStrategy without mdq on PATH', () => {
  let tmpDir: string;
  let origPath: string | undefined;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-md-nomdq-')));
    origPath = process.env.PATH;
    process.env.PATH = tmpDir; // Empty of mdq
  });

  afterEach(() => {
    process.env.PATH = origPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects and runs toc, coverage, and stale without mdq', async () => {
    writeFiles(tmpDir, {
      'src/index.ts': 'export function hello() {\n  return 1;\n}\n',
      'README.md': '# Project\n\n## Usage\n\nSee `src/index.ts#hello`.\n',
    });

    const strategy = new MarkdownStrategy();
    const ctx = new StrategyContextImpl(tmpDir);

    expect(await strategy.detect(ctx)).toBe(true);
    await analyzeAllMarkdown(strategy, ctx, ['README.md']);

    const toc = await strategy.commands!.toc.handler(ctx);
    expect(toc).toContain('Project');
    expect(toc).toContain('Usage');

    const coverage = await strategy.commands!.coverage.handler(ctx);
    expect(coverage.total).toBe(1);
    expect(coverage.documented).toBe(1);
    expect(coverage.coverage).toBe(100);

    const stale = await strategy.commands!.stale.handler(ctx);
    expect(stale.count).toBe(0);
    expect(stale.stale).toEqual([]);
  });
});

describe('MarkdownStrategy multi-language coverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-md-cov-')));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts Go, Python, and TypeScript files in coverage', async () => {
    writeFiles(tmpDir, {
      'main.go': 'package main\nfunc main() {}\n',
      'worker.py': 'def run():\n    pass\n',
      'src/app.ts': 'export const x = 1;\n',
      'README.md': '# Docs\n\nUses `main.go` and `worker.py`.\n',
    });

    const strategy = new MarkdownStrategy();
    const ctx = new StrategyContextImpl(tmpDir);
    await analyzeAllMarkdown(strategy, ctx, ['README.md']);

    const coverage = await strategy.commands!.coverage.handler(ctx);
    expect(coverage.total).toBe(3);
    expect(coverage.documented).toBe(2);
    expect(coverage.undocumented).toBe(1);
    expect(coverage.files.undocumented).toEqual(['src/app.ts']);
  });
});

describe('MarkdownStrategy stale checks (symbols, lines, and git SHA drift)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-md-stale-')));
    git(tmpDir, 'init');
    git(tmpDir, 'config', 'user.email', 'test@example.com');
    git(tmpDir, 'config', 'user.name', 'Test User');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports target_not_found, code_path_not_found, symbol_not_found, line_out_of_range, pinned_sha_missing, and code_changed_since_sha', async () => {
    writeFiles(tmpDir, {
      'src/math.ts': [
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        '',
        'export function mul(a: number, b: number): number {',
        '  return a * b;',
        '}',
      ].join('\n'),
      'src/stable.ts': 'export const VERSION = 1;\n',
    });

    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-m', 'initial');
    const sha1 = git(tmpDir, 'rev-parse', '--short', 'HEAD');

    // Modify lines 1-3 of src/math.ts in a second commit; leave src/stable.ts untouched.
    writeFiles(tmpDir, {
      'src/math.ts': [
        'export function add(a: number, b: number): number {',
        '  return a + b + 0;',
        '}',
        '',
        'export function mul(a: number, b: number): number {',
        '  return a * b;',
        '}',
      ].join('\n'),
    });
    git(tmpDir, 'add', 'src/math.ts');
    git(tmpDir, 'commit', '-m', 'update add');
    const sha2 = git(tmpDir, 'rev-parse', '--short', 'HEAD');

    writeFiles(tmpDir, {
      'README.md': [
        '# Docs',
        '',
        '- Broken link: [missing](./nope.md)',
        '- Missing code: `src/missing.ts`',
        '- Valid symbol: `src/math.ts#add`',
        '- Missing symbol: `src/math.ts#divide`',
        '- Valid line: `src/math.ts:2`',
        '- Bad line: `src/math.ts:99`',
        `- Stale SHA range: @file:src/math.ts:1-3@${sha1}`,
        `- Unchanged range since sha1: @file:src/math.ts:5-7@${sha1}`,
        `- Untouched file since sha1: @file:src/stable.ts:1@${sha1}`,
        `- Fresh SHA range: @file:src/math.ts:1-3@${sha2}`,
        '- Missing SHA: @file:src/stable.ts:1@deadbeef0000',
      ].join('\n'),
    });

    const strategy = new MarkdownStrategy();
    const ctx = new StrategyContextImpl(tmpDir);
    await analyzeAllMarkdown(strategy, ctx, ['README.md']);

    const result = await strategy.commands!.stale.handler(ctx);
    const reasons = result.stale.map((item: any) => item.reason).sort();

    expect(reasons).toEqual([
      'code_changed_since_sha',
      'code_path_not_found',
      'line_out_of_range',
      'pinned_sha_missing',
      'symbol_not_found',
      'target_not_found',
    ]);
  });
});

describe('buildShareSummary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-share-')));
    git(tmpDir, 'init');
    git(tmpDir, 'config', 'user.email', 'test@example.com');
    git(tmpDir, 'config', 'user.name', 'Test User');
    writeFiles(tmpDir, { 'src/index.ts': 'export function main() {}\n' });
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-m', 'init');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prepends YAML frontmatter and formats top files/tags with @file:<relPath>:<line>@<shortSha>', () => {
    const headSha = git(tmpDir, 'rev-parse', 'HEAD');
    const shortSha = headSha.slice(0, 7);

    const rankedNodes: RankedNode[] = [
      {
        id: 'src/index.ts',
        score: 1,
        attributes: { type: 'file', label: 'index.ts' },
      },
      {
        id: 'src/index.ts::main',
        score: 0.9,
        attributes: {
          type: 'tag',
          label: 'main',
          kind: 'function',
          file: 'src/index.ts',
          line: 1,
        },
      },
    ];

    const summary = buildShareSummary({
      projectPath: tmpDir,
      outputPath: path.join(tmpDir, 'xray.md'),
      chunked: false,
      rankedNodes,
    });

    expect(summary.startsWith('---\n')).toBe(true);
    expect(summary).toContain('generatedAt:');
    expect(summary).toContain(`commitSha: ${headSha}`);
    expect(summary).toContain(`@file:src/index.ts:1@${shortSha}`);
  });
});
