import { ChunkedRenderer } from '../src/lib/renderer/chunked-renderer';
import Graph from 'graphology';
import { RankedNode } from '../src/types/graph';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/** Build a graph + ranking with one tagged function per file. */
function fixture(files: string[]): { graph: Graph; ranked: RankedNode[] } {
  const graph = new Graph();
  const ranked: RankedNode[] = [];
  for (const f of files) {
    graph.addNode(f, { type: 'file', imports: [] });
    const tagId = `${f}::fn`;
    graph.addNode(tagId, { type: 'tag', file: f, label: 'fn', kind: 'function', line: 1, endLine: 2 });
    ranked.push({ id: f, rank: 1, attributes: { type: 'file', label: f } } as RankedNode);
    ranked.push({
      id: tagId,
      rank: 0.5,
      attributes: { type: 'tag', file: f, label: 'fn', kind: 'function', line: 1, endLine: 2 },
    } as RankedNode);
  }
  return { graph, ranked };
}

/** Every `[text](target)` in a chunk's Navigation block. */
function navLinks(content: string): { kind: 'parent' | 'child'; text: string; target: string }[] {
  const out: { kind: 'parent' | 'child'; text: string; target: string }[] = [];
  for (const line of content.split('\n')) {
    const p = /\*\*Parent:\*\* \[([^\]]*)\]\(([^)]*)\)/.exec(line);
    if (p) out.push({ kind: 'parent', text: p[1], target: p[2] });
    const c = /^\s+- \[([^\]]*)\]\(([^)]*)\)/.exec(line);
    if (c) out.push({ kind: 'child', text: c[1], target: c[2] });
  }
  return out;
}

const SCENARIOS: { name: string; files: string[]; rel: string; maxDepth?: number }[] = [
  {
    name: 'default output name',
    files: ['a.ts', 'src/b.ts', 'src/lib/c.ts', 'pkg/d.ts'],
    rel: '.xray',
  },
  {
    name: 'output in a subdirectory with a custom name',
    files: ['a.ts', 'src/b.ts', 'src/lib/c.ts', 'pkg/d.ts'],
    rel: path.join('out', 'sub', 'proj.md'),
  },
  {
    name: 'no top-level source files',
    files: ['src/b.ts', 'src/lib/c.ts', 'pkg/d.ts'],
    rel: path.join('out', 'proj.md'),
  },
  {
    name: 'directory without files between two populated ones',
    files: ['a/x.ts', 'a/b/c/y.ts', 'a/b/c/d/z.ts'],
    rel: '.xray',
  },
  {
    name: 'maxDepth hides deeper directories',
    files: ['a.ts', 'src/b.ts', 'src/lib/c.ts', 'src/lib/deep/e.ts'],
    rel: '.xray',
    maxDepth: 1,
  },
];

describe('ChunkedRenderer navigation links', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-links-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it.each(SCENARIOS)('$name: every link resolves to a written chunk', async ({ files, rel, maxDepth }) => {
    const { graph, ranked } = fixture(files);
    const renderer = new ChunkedRenderer({
      root: '/project',
      ranked,
      graph: graph as any,
      tokenLimit: 4096,
      maxDepth,
    });
    const result = await renderer.renderChunked(path.join(tmp, rel));

    // Write like `xray map` does, then check against the real file system.
    for (const [p, content] of result.chunks) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    expect(result.chunks.size).toBeGreaterThan(0);

    let linkCount = 0;
    for (const [chunkPath, content] of result.chunks) {
      const meta = result.metadata.find(m => m.filePath === chunkPath)!;
      const links = navLinks(content);
      linkCount += links.length;
      for (const l of links) {
        const resolved = path.resolve(path.dirname(chunkPath), l.target);
        expect(fs.existsSync(resolved)).toBe(true);
        expect(resolved).not.toBe(chunkPath); // never link to itself
        expect(path.dirname(resolved)).toBe(path.dirname(chunkPath)); // chunks are siblings
      }

      // Links mirror the metadata, and each chunk below the root has a parent.
      const parents = links.filter(l => l.kind === 'parent');
      const children = links.filter(l => l.kind === 'child');
      expect(parents.map(l => l.text)).toEqual(meta.parent ? [meta.parent] : []);
      expect(children.map(l => l.text)).toEqual(meta.children);
      if (chunkPath !== result.rootChunk) expect(meta.parent).toBeDefined();
      if (chunkPath === result.rootChunk) expect(meta.parent).toBeUndefined();

      // Reciprocal: a parent links down to the child and the child up to it.
      if (meta.parent) {
        const up = result.metadata.find(m => m.directory === meta.parent)!;
        expect(up.children).toContain(meta.directory);
      }
    }
    expect(linkCount).toBeGreaterThan(0);

    // Every chunk is reachable from the root by following child links.
    const seen = new Set<string>();
    const walk = (p: string) => {
      if (seen.has(p)) return;
      seen.add(p);
      for (const l of navLinks(fs.readFileSync(p, 'utf8'))) {
        if (l.kind === 'child') walk(path.resolve(path.dirname(p), l.target));
      }
    };
    walk(result.rootChunk);
    expect([...seen].sort()).toEqual([...result.chunks.keys()].sort());
  });
});
