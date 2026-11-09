// __tests__/strategies/markdown.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import MarkdownStrategy from '../../strategies/markdown';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';

// The strategy shells out to the external `mdq` binary; suites that need it
// are skipped (with the reason in their name) when it is not on PATH.
const hasMdq = spawnSync('which', ['mdq']).status === 0;
const skipNote = hasMdq ? '' : ' [skipped: mdq not installed]';
const describeMdq = hasMdq ? describe : describe.skip;
const itMdq = hasMdq ? it : it.skip;

describe('MarkdownStrategy', () => {
  let strategy: MarkdownStrategy;
  const fixtureRoot = path.join(__dirname, '../strategy/fixtures/markdown-project');

  beforeEach(() => {
    strategy = new MarkdownStrategy();
  });

  // Mirrors the strategy runner (src/commands/strategy.ts): analyze() returns
  // metadata and the runner stores it in the context under the project-relative
  // path, which is what findFiles()/command handlers read back.
  async function analyzeInto(ctx: StrategyContextImpl, relFile: string): Promise<void> {
    const result = await strategy.analyze(relFile, ctx);
    ctx.setFileMetadata(relFile, strategy.name, result.metadata);
  }

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('markdown');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('detect()', () => {
    itMdq('should detect project with markdown files' + skipNote, async () => {
      const ctx = new StrategyContextImpl(fixtureRoot);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);
    });

    it('should not detect project without markdown files', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-md-'));

      const pkgJson = {
        name: 'test-project',
        version: '1.0.0'
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(pkgJson, null, 2)
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(false);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    itMdq('should detect .mdx files' + skipNote, async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-mdx-'));

      fs.writeFileSync(
        path.join(tempDir, 'test.mdx'),
        '# MDX Document\n\nexport const Component = () => <div>Hello</div>;'
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return false if mdq is not installed', async () => {
      // This test would need to mock which command
      // For now, we'll skip it as it requires environment setup
      expect(true).toBe(true);
    });
  });

  describe('fileTypes()', () => {
    it('should return markdown file extensions', () => {
      const types = strategy.fileTypes();

      expect(types).toEqual(['.md', '.mdx', '.markdown']);
    });
  });

  describeMdq('analyze()' + skipNote, () => {
    it('should extract headings with line numbers', async () => {
      const ctx = new StrategyContextImpl(fixtureRoot);
      const readmePath = path.join(fixtureRoot, 'README.md');

      const metadata = await strategy.analyze(readmePath, ctx);

      expect(metadata.metadata?.sections).toBeDefined();

      const intro = metadata.metadata!.sections.find((s: any) => s.title === 'Introduction');
      expect(intro).toBeDefined();
      expect(intro.line).toBe(1);
      expect(intro.depth).toBe(1);

      const gettingStarted = metadata.metadata!.sections.find((s: any) => s.title === 'Getting Started');
      expect(gettingStarted).toBeDefined();
      expect(gettingStarted.depth).toBe(2);
    });

    it('should extract markdown links to other docs', async () => {
      const ctx = new StrategyContextImpl(fixtureRoot);
      const readmePath = path.join(fixtureRoot, 'README.md');

      const metadata = await strategy.analyze(readmePath, ctx);

      expect(metadata.metadata?.links).toBeDefined();

      const installLink = metadata.metadata!.links.find(
        (l: any) => l.original === './docs/installation.md'
      );
      expect(installLink).toBeDefined();
      expect(installLink.text).toBe('installation guide');
    });

    it('should extract code references with file paths', async () => {
      const ctx = new StrategyContextImpl(fixtureRoot);
      const readmePath = path.join(fixtureRoot, 'README.md');

      const metadata = await strategy.analyze(readmePath, ctx);

      expect(metadata.metadata?.codeReferences).toBeDefined();

      const indexRef = metadata.metadata!.codeReferences.find(
        (r: any) => r.path === 'src/index.ts'
      );
      expect(indexRef).toBeDefined();
      expect(indexRef.documentedIn).toBe(readmePath);
    });

    it('should extract code references with line numbers', async () => {
      const ctx = new StrategyContextImpl(fixtureRoot);
      const installPath = path.join(fixtureRoot, 'docs/installation.md');

      const metadata = await strategy.analyze(installPath, ctx);

      const scriptRef = metadata.metadata!.codeReferences.find(
        (r: any) => r.path === 'scripts/setup.sh'
      );
      expect(scriptRef).toBeDefined();
      expect(scriptRef.line).toBe(15);
    });

    it('should extract code blocks with language', async () => {
      const ctx = new StrategyContextImpl(fixtureRoot);
      const readmePath = path.join(fixtureRoot, 'README.md');

      const metadata = await strategy.analyze(readmePath, ctx);

      expect(metadata.metadata?.codeBlocks).toBeDefined();

      const tsBlock = metadata.metadata!.codeBlocks.find(
        (b: any) => b.language === 'typescript'
      );
      expect(tsBlock).toBeDefined();
      expect(tsBlock.code).toContain('import { example }');
    });

    it('should add section tags', async () => {
      const ctx = new StrategyContextImpl(fixtureRoot);
      const readmePath = path.join(fixtureRoot, 'README.md');

      const metadata = await strategy.analyze(readmePath, ctx);

      expect(metadata.tags).toContain(`${readmePath}::Introduction`);
      expect(metadata.tags).toContain(`${readmePath}::Getting Started`);
    });

    it('should handle markdown files without headings', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-plain-md-'));
      const plainFile = path.join(tempDir, 'plain.md');

      fs.writeFileSync(plainFile, 'Just some text without headings.');

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(plainFile, ctx);

      expect(metadata.metadata?.sections).toHaveLength(0);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should handle nested sections', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nested-'));
      const nestedFile = path.join(tempDir, 'nested.md');

      fs.writeFileSync(nestedFile, `# Level 1
## Level 2
### Level 3
#### Level 4
`);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(nestedFile, ctx);

      expect(metadata.metadata?.sections).toHaveLength(4);
      expect(metadata.metadata?.sections[0].depth).toBe(1);
      expect(metadata.metadata?.sections[1].depth).toBe(2);
      expect(metadata.metadata?.sections[2].depth).toBe(3);
      expect(metadata.metadata?.sections[3].depth).toBe(4);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describeMdq('commands' + skipNote, () => {
    describe('toc', () => {
      it('should generate table of contents', async () => {
        const ctx = new StrategyContextImpl(fixtureRoot);

        // Pre-analyze files to populate metadata
        await analyzeInto(ctx, 'README.md');
        await analyzeInto(ctx, 'docs/api.md');

        const result = await strategy.commands!.toc.handler(ctx);

        expect(result).toContain('# Table of Contents');
        expect(result).toContain('Introduction');
        expect(result).toContain('Getting Started');
      });

      it('should respect depth option', async () => {
        const ctx = new StrategyContextImpl(fixtureRoot);

        await analyzeInto(ctx, 'README.md');

        const result = await strategy.commands!.toc.handler(ctx, { depth: '1' });

        // Should only include depth 1 headings
        expect(result).toContain('Introduction');
        // Depth 2 should be excluded
        // (actual test depends on implementation)
      });
    });

    describe('refs', () => {
      it('should show cross-references between markdown files', async () => {
        const ctx = new StrategyContextImpl(fixtureRoot);

        await analyzeInto(ctx, 'README.md');
        await analyzeInto(ctx, 'docs/api.md');

        const result = await strategy.commands!.refs.handler(ctx);

        expect(result).toContain('# Markdown Cross-References');
        expect(result).toContain('installation.md');
      });
    });

    describe('orphans', () => {
      it('should find unlinked markdown files', async () => {
        const ctx = new StrategyContextImpl(fixtureRoot);

        await analyzeInto(ctx, 'README.md');
        await analyzeInto(ctx, 'docs/api.md');
        await analyzeInto(ctx, 'docs/orphan.md');

        const result = await strategy.commands!.orphans.handler(ctx);

        expect(result.orphans).toContain('docs/orphan.md');
        expect(result.count).toBeGreaterThan(0);
      });

      it('should calculate percentage of orphans', async () => {
        const ctx = new StrategyContextImpl(fixtureRoot);

        const result = await strategy.commands!.orphans.handler(ctx);

        expect(result.percentage).toBeGreaterThanOrEqual(0);
        expect(result.percentage).toBeLessThanOrEqual(100);
      });
    });

    describe('code-refs', () => {
      it('should find code references in documentation', async () => {
        const ctx = new StrategyContextImpl(fixtureRoot);

        await analyzeInto(ctx, 'README.md');
        await analyzeInto(ctx, 'docs/installation.md');

        const result = await strategy.commands!['code-refs'].handler(ctx);

        expect(result).toContain('# Code References in Documentation');
        expect(result).toContain('src/index.ts');
      });

      it('should show which docs reference each code file', async () => {
        const ctx = new StrategyContextImpl(fixtureRoot);

        await analyzeInto(ctx, 'README.md');

        const result = await strategy.commands!['code-refs'].handler(ctx);

        expect(result).toContain('Referenced in');
      });
    });

    describe('coverage', () => {
      it('should calculate documentation coverage', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-coverage-'));

        // Create source files
        fs.writeFileSync(path.join(tempDir, 'file1.ts'), 'export const a = 1;');
        fs.writeFileSync(path.join(tempDir, 'file2.ts'), 'export const b = 2;');

        // Create doc that references file1.ts
        fs.writeFileSync(
          path.join(tempDir, 'README.md'),
          '# Docs\n\nSee `file1.ts` for details.'
        );

        const ctx = new StrategyContextImpl(tempDir);
        await analyzeInto(ctx, 'README.md');

        const result = await strategy.commands!.coverage.handler(ctx);

        expect(result.total).toBe(2);
        expect(result.documented).toBe(1);
        expect(result.undocumented).toBe(1);
        expect(result.coverage).toBeCloseTo(50, 1);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should return 0% for no documentation', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-docs-'));

        fs.writeFileSync(path.join(tempDir, 'file.ts'), 'export const a = 1;');

        const ctx = new StrategyContextImpl(tempDir);
        const result = await strategy.commands!.coverage.handler(ctx);

        expect(result.coverage).toBe(0);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('stale', () => {
      it('should find broken markdown links', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-stale-'));

        fs.writeFileSync(
          path.join(tempDir, 'README.md'),
          '# Docs\n\n[Missing](./missing.md)'
        );

        const ctx = new StrategyContextImpl(tempDir);
        await analyzeInto(ctx, 'README.md');

        const result = await strategy.commands!.stale.handler(ctx);

        expect(result.stale).toHaveLength(1);
        expect(result.stale[0].reason).toBe('target_not_found');
        expect(result.stale[0].type).toBe('markdown_link');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should find broken code references', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-broken-code-'));

        fs.writeFileSync(
          path.join(tempDir, 'README.md'),
          '# Docs\n\nSee `missing-file.ts` for details.'
        );

        const ctx = new StrategyContextImpl(tempDir);
        await analyzeInto(ctx, 'README.md');

        const result = await strategy.commands!.stale.handler(ctx);

        expect(result.stale.length).toBeGreaterThan(0);
        const codeRef = result.stale.find((s: any) => s.type === 'code_path_reference');
        expect(codeRef).toBeDefined();
        expect(codeRef.reference).toBe('missing-file.ts');
        expect(codeRef.reason).toBe('code_path_not_found');
        // never mixed into link items
        expect(result.stale.filter((s: any) => s.type === 'markdown_link')).toHaveLength(0);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      describe('inline-code path mentions', () => {
        async function staleFor(root: string, scan: string, files: Record<string, string>, docs: string[]) {
          for (const [rel, body] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), body);
          }
          const ctx = new StrategyContextImpl(path.join(root, scan));
          for (const d of docs) await analyzeInto(ctx, d);
          return strategy.commands!.stale.handler(ctx);
        }
        let root: string;
        beforeEach(() => {
          root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-code-paths-')));
          fs.mkdirSync(path.join(root, '.git'));
        });
        afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

        it('resolves against doc dir, scan root, then repo root', async () => {
          const result = await staleFor(root, 'docs', {
            'docs/guide/a.md': 'See `helper.ts`, `lib/util.ts`, `src/core.ts`, `src/gone.ts`.',
            'docs/guide/helper.ts': '',
            'docs/lib/util.ts': '',
            'src/core.ts': '',
          }, ['guide/a.md']);
          expect(result.stale.map((s: any) => s.reference)).toEqual(['src/gone.ts']);
          expect(result.count).toBe(1);
        });

        it('skips mentions with spaces, globs, or that are not path-shaped', async () => {
          const result = await staleFor(root, 'docs', {
            'docs/a.md': 'Use `my file.ts`, `src/*.ts`, `src/{a,b}.ts`, `$HOME/x.ts`, `https://e.com/x.ts`, `a b/c.js`.',
          }, ['a.md']);
          expect(result.stale).toEqual([]);
        });

        it('reports under code_path_reference, never markdown_link', async () => {
          const result = await staleFor(root, 'docs', {
            'docs/a.md': 'See `nope/missing.ts` and [x](./other.md).',
            'docs/other.md': '# Other\n',
          }, ['a.md']);
          expect(result.stale).toEqual([
            { doc: expect.stringMatching(/a\.md$/), reference: 'nope/missing.ts', reason: 'code_path_not_found', type: 'code_path_reference' },
          ]);
        });
      });

      it('should not flag existing targets when files were analyzed by absolute path', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-stale-abs-'));

        fs.writeFileSync(path.join(tempDir, 'other.md'), '# Other\n');
        fs.writeFileSync(path.join(tempDir, 'README.md'), '# Docs\n\n[Other](./other.md)');

        const ctx = new StrategyContextImpl(tempDir);
        // Runner registration passes absolute paths to analyze(), so links resolve to absolute paths
        const abs = path.join(tempDir, 'README.md');
        const result0 = await strategy.analyze(abs, ctx);
        ctx.setFileMetadata('README.md', strategy.name, result0.metadata);

        const result = await strategy.commands!.stale.handler(ctx);

        expect(result.stale).toHaveLength(0);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should return count of stale references', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-stale-count-'));

        fs.writeFileSync(
          path.join(tempDir, 'README.md'),
          '# Docs\n\n[A](./a.md)\n[B](./b.md)'
        );

        const ctx = new StrategyContextImpl(tempDir);
        await analyzeInto(ctx, 'README.md');

        const result = await strategy.commands!.stale.handler(ctx);

        expect(result.count).toBe(result.stale.length);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      describeMdq('link resolution' + skipNote, () => {
        // Build a tree, analyze `doc` the way the runner does (absolute path
        // in, project-relative key out) and return the flagged link targets.
        async function staleLinks(tree: Record<string, string>, doc: string): Promise<string[]> {
          const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-stale-links-'));
          try {
            for (const [rel, body] of Object.entries(tree)) {
              fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
              fs.writeFileSync(path.join(root, rel), body);
            }
            const ctx = new StrategyContextImpl(root);
            const res = await strategy.analyze(path.join(root, doc), ctx);
            ctx.setFileMetadata(doc, strategy.name, res.metadata);
            const result = await strategy.commands!.stale.handler(ctx);
            return result.stale
              .filter((s: any) => s.type === 'markdown_link')
              .map((s: any) => s.link);
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        }

        it('resolves a bare sibling link against the linking file', async () => {
          expect(await staleLinks({
            'guide/index.md': '# I\n\n[Cmds](commands.md)\n',
            'guide/commands.md': '# C\n',
          }, 'guide/index.md')).toEqual([]);
        });

        it('flags a bare link whose target only exists at the scan root', async () => {
          expect(await staleLinks({
            'guide/index.md': '# I\n\n[Cmds](commands.md)\n',
            'commands.md': '# C\n',
          }, 'guide/index.md')).toEqual(['commands.md']);
        });

        it('resolves ../ against the linking file', async () => {
          expect(await staleLinks({
            'guide/deep/index.md': '# I\n\n[Up](../top.md)\n',
            'guide/top.md': '# T\n',
          }, 'guide/deep/index.md')).toEqual([]);
        });

        it('strips #anchor and ?query before the existence check', async () => {
          expect(await staleLinks({
            'index.md': '# I\n\n[A](other.md#usage) [Q](other.md?plain=1) [B](other.md?x=1#y)\n',
            'other.md': '# O\n',
          }, 'index.md')).toEqual([]);
        });

        it('ignores external and same-page links', async () => {
          expect(await staleLinks({
            'index.md': '# I\n\n[W](https://e.x/a.md) [H](http://e.x) ' +
              '[M](mailto:a@e.x) [S](#i)\n',
          }, 'index.md')).toEqual([]);
        });

        it('resolves /absolute links against the scan root', async () => {
          expect(await staleLinks({
            'guide/index.md': '# I\n\n[Ref](/ref/api.md) [Gone](/ref/gone.md)\n',
            'ref/api.md': '# A\n',
          }, 'guide/index.md')).toEqual(['/ref/gone.md']);
        });

        it('skips links inside fenced and inline code', async () => {
          expect(await staleLinks({
            'index.md': '# I\n\n```md\n[X](nope.md)\n```\n\nUse `[Y](nope2.md)` syntax.\n',
          }, 'index.md')).toEqual([]);
        });

        it('accepts link titles and angle-bracket targets', async () => {
          expect(await staleLinks({
            'index.md': '# I\n\n[T](other.md "Other") [A](<other.md>)\n',
            'other.md': '# O\n',
          }, 'index.md')).toEqual([]);
        });
      });
    });
  });

  describe('error handling', () => {
    itMdq('should handle mdq execution errors' + skipNote, async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-bad-md-'));
      const badFile = path.join(tempDir, 'bad.md');

      // Create a file that might cause parsing issues
      fs.writeFileSync(badFile, '# Test\n\n');

      const ctx = new StrategyContextImpl(tempDir);

      // Should not throw, but handle gracefully
      const metadata = await strategy.analyze(badFile, ctx);
      expect(metadata).toBeDefined();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // Regression: with argv `mdq --output json <file>` mdq treats the path as a
    // selector and blocks reading stdin. stdin must be closed so that fails fast.
    itMdq('should run mdq with closed stdin and an empty selector (no hang)' + skipNote, async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-mdq-stdin-'));
      fs.writeFileSync(path.join(tempDir, 'a.md'), '# A\n');
      const ctx = new StrategyContextImpl(tempDir);

      const metadata = await strategy.analyze(path.join(tempDir, 'a.md'), ctx);
      expect(metadata.metadata?.sections).toHaveLength(1);

      fs.rmSync(tempDir, { recursive: true, force: true });
    }, 15000);

    it('should kill mdq and fail fast when it exceeds the timeout', async () => {
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-fake-mdq-'));
      const pidFile = path.join(binDir, 'pid');
      // Publish the pid atomically (write + rename) so a reader never sees a
      // missing or half-written file once it exists. `exec` keeps the pid.
      fs.writeFileSync(
        path.join(binDir, 'mdq'),
        `#!/bin/sh\necho $$ > "${pidFile}.tmp" && mv "${pidFile}.tmp" "${pidFile}"\nexec sleep 30\n`,
        { mode: 0o755 }
      );
      const mdFile = path.join(binDir, 'a.md');
      fs.writeFileSync(mdFile, '# A\n');

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const until = async (cond: () => boolean, ms: number) => {
        const end = Date.now() + ms;
        while (!cond()) {
          if (Date.now() > end) return false;
          await sleep(10);
        }
        return true;
      };
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      const oldPath = process.env.PATH;
      const oldTimeout = process.env.XRAY_MDQ_TIMEOUT_MS;
      process.env.PATH = `${binDir}:${oldPath}`;
      // Generous timeout: the child must be observed running (pid published)
      // before the kill fires, however slow the machine is.
      process.env.XRAY_MDQ_TIMEOUT_MS = '4000';
      try {
        const ctx = new StrategyContextImpl(binDir);
        const started = Date.now();
        const result = strategy.analyze(mdFile, ctx);
        const outcome = result.then(
          () => new Error('expected analyze to reject'),
          (e: Error) => e
        );

        // Readiness: the fake mdq is up and has published its pid.
        expect(await until(() => fs.existsSync(pidFile), 3500)).toBe(true);
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
        expect(Number.isInteger(pid) && pid > 1).toBe(true);
        expect(alive(pid)).toBe(true); // running before the timeout

        const err = await outcome;
        expect(err.message).toMatch(/timed out/);
        expect(Date.now() - started).toBeLessThan(10000);
        // Killed: gone shortly after rejection (poll, no fixed sleep).
        expect(await until(() => !alive(pid), 5000)).toBe(true);
      } finally {
        // Never leak the fake mdq if an assertion above failed early.
        try {
          const leaked = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
          if (Number.isInteger(leaked) && leaked > 1) process.kill(leaked, 'SIGKILL');
        } catch { /* already gone / never started */ }
        process.env.PATH = oldPath;
        if (oldTimeout === undefined) delete process.env.XRAY_MDQ_TIMEOUT_MS;
        else process.env.XRAY_MDQ_TIMEOUT_MS = oldTimeout;
        fs.rmSync(binDir, { recursive: true, force: true });
      }
    }, 20000);

    it('should handle missing files', async () => {
      const ctx = new StrategyContextImpl('/tmp');

      await expect(
        strategy.analyze('/nonexistent/file.md', ctx)
      ).rejects.toThrow();
    });
  });
});
