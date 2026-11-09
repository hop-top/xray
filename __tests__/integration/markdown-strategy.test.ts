// __tests__/integration/markdown-strategy.test.ts
import { StrategyLoader } from '../../src/lib/strategy/loader';
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import { registerExtensionCommands } from '../../src/commands/registration/strategies';
import MarkdownStrategy from '../../strategies/markdown';

// The strategy shells out to the external `mdq` binary; tests that need it are
// skipped (reason in their name) when it is not runnable. CI installs a pinned mdq.
const hasMdq = spawnSync('mdq', ['--version']).status === 0;
const skipNote = hasMdq ? '' : ' [skipped: mdq not installed]';
const itMdq = hasMdq ? it : it.skip;
const describeMdq = hasMdq ? describe : describe.skip;

describe('Markdown Strategy Integration', () => {
  const fixtureRoot = path.join(__dirname, '../strategy/fixtures/markdown-project');

  it('should be discovered by strategy loader', async () => {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();

    const markdown = strategies.find(s => s.name === 'markdown');
    expect(markdown).toBeDefined();
    expect(markdown?.version).toBe('0.1.0');
  });

  itMdq('should detect markdown project' + skipNote, async () => {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    const markdown = strategies.find(s => s.name === 'markdown');

    expect(markdown).toBeDefined();

    const ctx = new StrategyContextImpl(fixtureRoot);
    const detected = await markdown!.detect(ctx);

    expect(detected).toBe(true);
  });

  itMdq('should analyze markdown files and extract structure' + skipNote, async () => {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    const markdown = strategies.find(s => s.name === 'markdown');

    expect(markdown).toBeDefined();

    const ctx = new StrategyContextImpl(fixtureRoot);
    const readmePath = path.join(fixtureRoot, 'README.md');

    const result = await markdown!.analyze(readmePath, ctx);

    // Check sections were extracted
    expect(result.metadata?.sections).toBeDefined();
    expect(result.metadata?.sections.length).toBeGreaterThan(0);

    // Check tags were created
    expect(result.tags.length).toBeGreaterThan(0);
    expect(result.tags.some((t: string) => t.includes('Introduction'))).toBe(true);

    // Check links were extracted
    expect(result.metadata?.links).toBeDefined();
    expect(result.metadata?.links.length).toBeGreaterThan(0);

    // Check code references were extracted
    expect(result.metadata?.codeReferences).toBeDefined();
    expect(result.metadata?.codeReferences.length).toBeGreaterThan(0);
  });

  itMdq('should work with real markdown files from docs/' + skipNote, async () => {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    const markdown = strategies.find(s => s.name === 'markdown');

    expect(markdown).toBeDefined();

    // Use the actual xray project docs
    const projectRoot = path.join(__dirname, '../../');
    const ctx = new StrategyContextImpl(projectRoot);

    const detected = await markdown!.detect(ctx);

    if (detected) {
      // Try to analyze a real doc file
      const docsPath = path.join(projectRoot, 'docs');
      if (fs.existsSync(docsPath)) {
        const docFiles = fs.readdirSync(docsPath)
          .filter(f => f.endsWith('.md'))
          .slice(0, 1); // Just test one file

        if (docFiles.length > 0) {
          const docPath = path.join(docsPath, docFiles[0]);
          const result = await markdown!.analyze(docPath, ctx);

          expect(result).toBeDefined();
          expect(result.metadata).toBeDefined();
        }
      }
    }
  });

  itMdq('should handle MDX files' + skipNote, async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-mdx-integration-'));

    try {
      // Create an MDX file
      const mdxContent = `# MDX Document

This is an MDX file with React components.

\`\`\`jsx
export const Button = () => <button>Click me</button>;
\`\`\`

See the [API documentation](./api.md) for more details.
`;

      fs.writeFileSync(path.join(tempDir, 'test.mdx'), mdxContent);

      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();
      const markdown = strategies.find(s => s.name === 'markdown');

      expect(markdown).toBeDefined();

      const ctx = new StrategyContextImpl(tempDir);
      const mdxPath = path.join(tempDir, 'test.mdx');

      const result = await markdown!.analyze(mdxPath, ctx);

      expect(result).toBeDefined();
      expect(result.metadata?.sections).toBeDefined();
      expect(result.metadata?.codeBlocks).toBeDefined();
      expect(result.metadata?.links).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itMdq('should extract cross-references between documentation files' + skipNote, async () => {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    const markdown = strategies.find(s => s.name === 'markdown');

    expect(markdown).toBeDefined();

    const ctx = new StrategyContextImpl(fixtureRoot);

    // Analyze all markdown files in the fixture
    const readmeResult = await markdown!.analyze(
      path.join(fixtureRoot, 'README.md'),
      ctx
    );
    const apiResult = await markdown!.analyze(
      path.join(fixtureRoot, 'docs/api.md'),
      ctx
    );

    // README should link to docs
    expect(readmeResult.metadata?.links.some(
      (l: any) => l.original.includes('docs/')
    )).toBe(true);

    // API should link back to README
    expect(apiResult.metadata?.links.some(
      (l: any) => l.original.includes('../README.md')
    )).toBe(true);
  });

  itMdq('should extract code file references from documentation' + skipNote, async () => {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    const markdown = strategies.find(s => s.name === 'markdown');

    expect(markdown).toBeDefined();

    const ctx = new StrategyContextImpl(fixtureRoot);
    const readmeResult = await markdown!.analyze(
      path.join(fixtureRoot, 'README.md'),
      ctx
    );

    // Should have extracted code references
    expect(readmeResult.metadata?.codeReferences).toBeDefined();
    expect(readmeResult.metadata?.codeReferences.length).toBeGreaterThan(0);

    // Check for specific references
    const hasCodeRef = readmeResult.metadata?.codeReferences.some(
      (r: any) => r.path.includes('.ts')
    );
    expect(hasCodeRef).toBe(true);
  });

  itMdq('should handle malformed markdown gracefully' + skipNote, async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-malformed-'));

    try {
      // Create a minimal markdown file
      fs.writeFileSync(path.join(tempDir, 'test.md'), '# Test\n\nSome text.');

      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();
      const markdown = strategies.find(s => s.name === 'markdown');

      expect(markdown).toBeDefined();

      const ctx = new StrategyContextImpl(tempDir);
      const mdPath = path.join(tempDir, 'test.md');

      // Should not throw
      const result = await markdown!.analyze(mdPath, ctx);
      expect(result).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describeMdq('`markdown stale --path` through the CLI runner' + skipNote, () => {
    let repo: string;
    const cwd0 = process.cwd();

    beforeAll(() => {
      repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-stale-cli-')));
      const files: Record<string, string> = {
        'docs/guide/index.md':
          '# Guide\n\n[Commands](commands.md)\n[Top](../top.md#intro)\n[Gone](missing.md)\n',
        'docs/guide/commands.md': '# Commands\n',
        'docs/top.md': '# Top\n\n## Intro\n',
      };
      for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), body);
      }
    });

    afterAll(() => {
      process.chdir(cwd0);
      fs.rmSync(repo, { recursive: true, force: true });
    });

    afterEach(() => jest.restoreAllMocks());

    async function runStale(pathArg: string): Promise<any> {
      const md = new MarkdownStrategy();
      jest.spyOn(StrategyLoader.prototype, 'discoverStrategies').mockResolvedValue([md]);
      jest.spyOn(StrategyLoader.prototype, 'discoverExtensions').mockResolvedValue([md as any]);
      const program = new Command().exitOverride();
      await registerExtensionCommands(program, { projectCode: false });
      let out = '';
      for (const m of ['error', 'warn', 'log', 'info'] as const) {
        jest.spyOn(console, m).mockImplementation(() => undefined);
      }
      jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
        out += String(chunk);
        return true;
      });
      process.chdir(repo);
      try {
        await program.parseAsync(['markdown', 'stale', '--path', pathArg, '--format', 'json'], { from: 'user' });
      } finally {
        process.chdir(cwd0);
      }
      try { return JSON.parse(out); } catch { throw new Error(out); }
    }

    test.each([
      ['relative', 'docs'],
      ['absolute', 'ABS'],
    ])('%s --path reports exactly the broken link', async (_kind, arg) => {
      const result = await runStale(arg === 'ABS' ? path.join(repo, 'docs') : arg);
      expect(result.stale.map((s: any) => [s.doc, s.link])).toEqual([
        ['guide/index.md', 'missing.md'],
      ]);
      expect(result.count).toBe(1);
    });
  });
});
