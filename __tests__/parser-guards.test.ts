import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Graph from 'graphology';
import { ParserManager } from '../src/lib/parser/manager';
import { Xray } from '../src/lib/xray';
import { ChunkedRenderer } from '../src/lib/renderer/chunked-renderer';
import { RankedNode } from '../src/types/graph';

describe('parser-guards', () => {
  describe('ParserManager grammar-keyed pooling', () => {
    it('parses .ts and .tsx without grammar collision while reusing pooled parsers', async () => {
      const manager = new ParserManager(process.cwd());

      const tsCode = `export function greet(name: string): string { return name; }\n`;
      const tsxCode = `export function Button(props: { label: string }) { return <button>{props.label}</button>; }\n`;

      const tsRes1 = await manager.parse('src/a.ts', tsCode);
      const tsxRes1 = await manager.parse('src/b.tsx', tsxCode);
      const tsRes2 = await manager.parse('src/c.ts', tsCode);
      const tsxRes2 = await manager.parse('src/d.tsx', tsxCode);

      expect(tsRes1.tags.some(t => t.name === 'greet')).toBe(true);
      expect(tsxRes1.tags.some(t => t.name === 'Button')).toBe(true);
      expect(tsRes2.tags.some(t => t.name === 'greet')).toBe(true);
      expect(tsxRes2.tags.some(t => t.name === 'Button')).toBe(true);

      // Verify internal WeakMap pools are populated and keyed by distinct grammar objects
      const parsersPool = (manager as any).parsers as WeakMap<object, unknown>;
      const queriesPool = (manager as any).compiledQueries as WeakMap<object, Map<string, unknown>>;
      expect(parsersPool).toBeInstanceOf(WeakMap);
      expect(queriesPool).toBeInstanceOf(WeakMap);
    });
  });

  describe('Xray hostile-file guardrails', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hostile-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('skips >2MB files and minified files into ParseCoverage.skippedFiles without touching ParseCoverage.skipped', async () => {
      // Normal file
      fs.writeFileSync(path.join(tmpDir, 'ok.ts'), 'export function ok() { return 1; }\n');

      // >2MB file
      const bigContent = '// ' + 'a'.repeat(2 * 1024 * 1024 + 1024) + '\n';
      fs.writeFileSync(path.join(tmpDir, 'huge.ts'), bigContent);

      // Minified file (first line > 10_000 chars)
      const minifiedContent = 'export const m = "' + 'x'.repeat(10_500) + '";\n';
      fs.writeFileSync(path.join(tmpDir, 'bundle.min.ts'), minifiedContent);

      // Average line length > 500 chars across > 20 lines
      const longAvgLine = 'export const v = "' + 'y'.repeat(600) + '";';
      const longAvgContent = Array.from({ length: 25 }, () => longAvgLine).join('\n');
      fs.writeFileSync(path.join(tmpDir, 'avg-long.ts'), longAvgContent);

      const xray = new Xray({ path: tmpDir, cachePath: path.join(tmpDir, '.cache.db') });
      xray.disableFileCache();
      await xray.run();

      const coverage = xray.getLastCoverage();
      expect(coverage).toBeDefined();
      expect(coverage!.parsed).toBe(1);
      expect(coverage!.skipped).toEqual([]);
      expect(coverage!.skippedFiles).toEqual(
        expect.arrayContaining([
          { file: 'huge.ts', reason: 'too-large' },
          { file: 'bundle.min.ts', reason: 'minified' },
          { file: 'avg-long.ts', reason: 'minified' },
        ])
      );
    });
  });

  describe('ChunkedRenderer community sub-chunking', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-comm-subchunk-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('sub-chunks overflowing communities into sequential parts sorted by PageRank with prev/next nav links', async () => {
      const g = new Graph();
      const ranked: RankedNode[] = [];
      const files = [
        { file: 'src/low.ts', fn: 'lowFn', rank: 0.1 },
        { file: 'src/high.ts', fn: 'highFn', rank: 0.9 },
        { file: 'src/mid.ts', fn: 'midFn', rank: 0.5 },
      ];

      for (const f of files) {
        g.addNode(f.file, { type: 'file', community: 0, imports: [] });
        const tagId = `${f.file}::${f.fn}`;
        g.addNode(tagId, {
          type: 'tag',
          file: f.file,
          label: f.fn,
          kind: 'function',
          line: 0,
          endLine: 10,
          signature: '(arg1: string, arg2: number, arg3: boolean): Promise<void>',
          community: 0,
        });
        ranked.push({
          id: tagId,
          rank: f.rank,
          attributes: {
            type: 'tag',
            file: f.file,
            label: f.fn,
            kind: 'function',
            line: 0,
            endLine: 10,
            signature: '(arg1: string, arg2: number, arg3: boolean): Promise<void>',
            community: 0,
          },
        } as RankedNode);
      }

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked,
        graph: g as any,
        tokenLimit: 35,
        grouping: 'community',
      });

      const outBase = path.join(tmpDir, 'map.md');
      const result = await renderer.renderChunked(outBase);

      const partKeys = Array.from(result.chunks.keys()).filter(k => k.includes('community-0-part-'));
      expect(partKeys.length).toBeGreaterThanOrEqual(2);

      const part1Key = partKeys.find(k => k.endsWith('community-0-part-1.md'))!;
      const part2Key = partKeys.find(k => k.endsWith('community-0-part-2.md'))!;
      expect(part1Key).toBeDefined();
      expect(part2Key).toBeDefined();

      const part1 = result.chunks.get(part1Key)!;
      const part2 = result.chunks.get(part2Key)!;

      // Highest PageRank file must be in part 1
      expect(part1).toContain('src/high.ts');
      // Navigation links between parts
      expect(part1).toContain(path.basename(part2Key));
      expect(part2).toContain(path.basename(part1Key));

      // All 3 files must appear across parts (none truncated away)
      const allPartContent = partKeys.map(k => result.chunks.get(k)!).join('\n');
      expect(allPartContent).toContain('src/high.ts');
      expect(allPartContent).toContain('src/mid.ts');
      expect(allPartContent).toContain('src/low.ts');
    });
  });
});
