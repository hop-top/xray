import { ChunkedRenderer } from '../src/lib/renderer/chunked-renderer';
import Graph from 'graphology';
import { RankedNode } from '../src/types/graph';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('ChunkedRenderer', () => {
  let graph: Graph;
  let rankedNodes: RankedNode[];

  // renderChunked creates the output directory (2f6a6f6), so use a real tmp dir.
  let outputDir: string;
  let outputBase: string;

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-chunked-'));
    outputBase = path.join(outputDir, '.xray');
    // Setup mock graph and ranked nodes
    graph = new Graph();

    // Add file nodes
    graph.addNode('src/index.ts', { type: 'file', imports: [] });
    graph.addNode('src/lib/utils.ts', { type: 'file', imports: [] });
    graph.addNode('src/lib/config.ts', { type: 'file', imports: [] });

    // Add tag nodes
    graph.addNode('src/index.ts::main', {
      type: 'tag',
      file: 'src/index.ts',
      label: 'main',
      kind: 'function',
      line: 10,
      endLine: 20,
    });

    graph.addNode('src/lib/utils.ts::helper', {
      type: 'tag',
      file: 'src/lib/utils.ts',
      label: 'helper',
      kind: 'function',
      line: 5,
      endLine: 15,
    });

    // Create ranked nodes
    rankedNodes = [
      {
        id: 'src/index.ts',
        rank: 1.0,
        attributes: { type: 'file', label: 'src/index.ts' },
      },
      {
        id: 'src/lib/utils.ts',
        rank: 0.8,
        attributes: { type: 'file', label: 'src/lib/utils.ts' },
      },
      {
        id: 'src/lib/config.ts',
        rank: 0.6,
        attributes: { type: 'file', label: 'src/lib/config.ts' },
      },
      {
        id: 'src/index.ts::main',
        rank: 0.9,
        attributes: {
          type: 'tag',
          file: 'src/index.ts',
          label: 'main',
          kind: 'function',
          line: 10,
          endLine: 20,
        },
      },
      {
        id: 'src/lib/utils.ts::helper',
        rank: 0.7,
        attributes: {
          type: 'tag',
          file: 'src/lib/utils.ts',
          label: 'helper',
          kind: 'function',
          line: 5,
          endLine: 15,
        },
      },
    ];
  });

  describe('renderChunked', () => {
    it('should organize files by directory', async () => {
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: rankedNodes,
        graph: graph as any,
        tokenLimit: 4096,
      });

      const result = await renderer.renderChunked(outputBase);

      expect(result.chunks.size).toBeGreaterThan(0);
      expect(result.metadata.length).toBeGreaterThan(0);
      expect(result.rootChunk).toBeTruthy();
    });

    it('should respect depth limits', async () => {
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: rankedNodes,
        graph: graph as any,
        tokenLimit: 4096,
        maxDepth: 1,
      });

      const result = await renderer.renderChunked(outputBase);

      // Should only include directories at depth <= 1
      const depthViolations = result.metadata.filter(m => m.depth > 1);
      expect(depthViolations).toHaveLength(0);
    });

    it('should create parent-child links', async () => {
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: rankedNodes,
        graph: graph as any,
        tokenLimit: 4096,
      });

      const result = await renderer.renderChunked(outputBase);

      // Check that child directories have parent references
      const childMetadata = result.metadata.find(m => m.directory === 'src/lib');
      if (childMetadata) {
        expect(childMetadata.parent).toBe('src');
      }

      // Check that parent directories have child references
      const parentMetadata = result.metadata.find(m => m.directory === 'src');
      if (parentMetadata) {
        expect(parentMetadata.children).toContain('src/lib');
      }
    });

    it('should include navigation links in content', async () => {
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: rankedNodes,
        graph: graph as any,
        tokenLimit: 4096,
      });

      const result = await renderer.renderChunked(outputBase);

      // Find a chunk with a parent
      for (const [chunkPath, content] of result.chunks.entries()) {
        const metadata = result.metadata.find(m => m.filePath === chunkPath);
        if (metadata && metadata.parent) {
          expect(content).toContain('## Navigation');
          expect(content).toContain('**Parent:**');
          break;
        }
      }
    });

    it('should respect token limits per chunk', async () => {
      const tokenLimit = 100;
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: rankedNodes,
        graph: graph as any,
        tokenLimit,
      });

      const result = await renderer.renderChunked(outputBase);

      // Each chunk should respect the token limit
      for (const metadata of result.metadata) {
        expect(metadata.tokenCount).toBeLessThanOrEqual(tokenLimit);
      }
    });

    it('should generate unique chunk file paths', async () => {
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: rankedNodes,
        graph: graph as any,
        tokenLimit: 4096,
      });

      const result = await renderer.renderChunked(outputBase);

      const paths = Array.from(result.chunks.keys());
      const uniquePaths = new Set(paths);

      expect(paths.length).toBe(uniquePaths.size);
    });
  });

  describe('directory organization', () => {
    it('counts files, not tags, per directory chunk', async () => {
      const g = new Graph();
      const file = (id: string): RankedNode => ({ id, rank: 1, attributes: { type: 'file', label: id } });
      const tag = (id: string, f: string, label: string): RankedNode => ({
        id, rank: 0.5, attributes: { type: 'tag', file: f, label, kind: 'function', line: 1, endLine: 2 },
      });
      const nodes: RankedNode[] = [
        file('src/a.ts'), file('src/b.ts'), file('src/c.ts'), file('empty/e.ts'), file('empty/f.ts'),
        tag('src/a.ts::one', 'src/a.ts', 'one'), tag('src/a.ts::two', 'src/a.ts', 'two'),
        tag('src/a.ts::three', 'src/a.ts', 'three'), tag('src/b.ts::four', 'src/b.ts', 'four'),
      ];
      for (const n of nodes) g.addNode(n.id, n.attributes as any);
      const result = await new ChunkedRenderer({ root: '/project', ranked: nodes, graph: g as any, tokenLimit: 4096 })
        .renderChunked(outputBase);
      const count = (dir: string) => result.metadata.find(m => m.directory === dir)?.fileCount;
      expect(count('src')).toBe(3); // 4 tags, 3 files (c.ts has no symbols)
      expect(count('empty')).toBe(2); // no tags at all
    });

    it('should handle root directory', async () => {
      const rootNodes: RankedNode[] = [
        {
          id: 'index.ts',
          rank: 1.0,
          attributes: { type: 'file', label: 'index.ts' },
        },
        {
          id: 'index.ts::main',
          rank: 0.9,
          attributes: {
            type: 'tag',
            file: 'index.ts',
            label: 'main',
            kind: 'function',
            line: 1,
            endLine: 10,
          },
        },
      ];

      const rootGraph = new Graph();
      rootGraph.addNode('index.ts', { type: 'file', imports: [] });

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: rootNodes,
        graph: rootGraph as any,
        tokenLimit: 4096,
      });

      const result = await renderer.renderChunked(outputBase);

      expect(result.chunks.size).toBeGreaterThan(0);
      expect(result.rootChunk).toBeTruthy();
    });

    it('should handle nested directories', async () => {
      const nestedNodes: RankedNode[] = [
        {
          id: 'a/b/c/deep.ts',
          rank: 0.5,
          attributes: { type: 'file', label: 'a/b/c/deep.ts' },
        },
      ];

      const nestedGraph = new Graph();
      nestedGraph.addNode('a/b/c/deep.ts', { type: 'file', imports: [] });

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: nestedNodes,
        graph: nestedGraph as any,
        tokenLimit: 4096,
      });

      const result = await renderer.renderChunked(outputBase);

      // Should have a chunk for the nested directory
      const deepDirMeta = result.metadata.find(m => m.directory === 'a/b/c');
      expect(deepDirMeta).toBeTruthy();
    });
  });

  describe('imports handling', () => {
    it('should include imports when requested', async () => {
      const graphWithImports = new Graph();
      graphWithImports.addNode('src/index.ts', {
        type: 'file',
        imports: [
          { source: './lib/utils', text: "import { helper } from './lib/utils';" },
          { source: 'external-lib', text: "import external from 'external-lib';" },
        ],
      });

      // Files only render when they own at least one tag.
      const mainTag = {
        type: 'tag' as const,
        file: 'src/index.ts',
        label: 'main',
        kind: 'function',
        line: 1,
      };
      graphWithImports.addNode('src/index.ts::main', mainTag);

      const nodesWithImports: RankedNode[] = [
        {
          id: 'src/index.ts',
          rank: 1.0,
          attributes: { type: 'file', label: 'src/index.ts' },
        },
        { id: 'src/index.ts::main', rank: 0.9, attributes: mainTag },
      ];

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: nodesWithImports,
        graph: graphWithImports as any,
        tokenLimit: 4096,
        includeImports: true,
      });

      const result = await renderer.renderChunked(outputBase);

      // Check that at least one chunk contains import information
      let foundImport = false;
      for (const content of result.chunks.values()) {
        if (content.includes("import { helper } from './lib/utils';")) {
          foundImport = true;
          break;
        }
      }
      expect(foundImport).toBe(true);
    });

    it('should not include imports when not requested', async () => {
      const graphWithImports = new Graph();
      graphWithImports.addNode('src/index.ts', {
        type: 'file',
        imports: [
          { source: './lib/utils', text: "import { helper } from './lib/utils';" },
        ],
      });

      // Files only render when they own at least one tag.
      const mainTag = {
        type: 'tag' as const,
        file: 'src/index.ts',
        label: 'main',
        kind: 'function',
        line: 1,
      };
      graphWithImports.addNode('src/index.ts::main', mainTag);

      const nodesWithImports: RankedNode[] = [
        {
          id: 'src/index.ts',
          rank: 1.0,
          attributes: { type: 'file', label: 'src/index.ts' },
        },
        { id: 'src/index.ts::main', rank: 0.9, attributes: mainTag },
      ];

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: nodesWithImports,
        graph: graphWithImports as any,
        tokenLimit: 4096,
        includeImports: false,
      });

      const result = await renderer.renderChunked(outputBase);

      expect(result.chunks.size).toBeGreaterThan(0);
      for (const content of result.chunks.values()) {
        expect(content).not.toContain("import { helper } from './lib/utils';");
      }
    });
  });

  describe('cross-file references performance', () => {
    it('should efficiently find cross-file callers using graph edges', async () => {
      // Create a graph with cross-file references
      const perfGraph = new Graph();

      // Add two files
      perfGraph.addNode('src/a.ts', { type: 'file', imports: [] });
      perfGraph.addNode('src/b.ts', { type: 'file', imports: [] });

      // Add tag in file A
      perfGraph.addNode('src/a.ts::helper', {
        type: 'tag',
        file: 'src/a.ts',
        label: 'helper',
        kind: 'function',
        line: 5,
        endLine: 10,
      });

      // Add tag in file B that calls helper
      perfGraph.addNode('src/b.ts::main', {
        type: 'tag',
        file: 'src/b.ts',
        label: 'main',
        kind: 'function',
        line: 3,
        endLine: 8,
      });

      // Add edge from B to A (B calls A)
      perfGraph.addEdge('src/b.ts::main', 'src/a.ts::helper', { type: 'calls' });

      const perfNodes: RankedNode[] = [
        {
          id: 'src/a.ts',
          rank: 1.0,
          attributes: { type: 'file', label: 'src/a.ts' },
        },
        {
          id: 'src/b.ts',
          rank: 0.9,
          attributes: { type: 'file', label: 'src/b.ts' },
        },
        {
          id: 'src/a.ts::helper',
          rank: 0.8,
          attributes: {
            type: 'tag',
            file: 'src/a.ts',
            label: 'helper',
            kind: 'function',
            line: 5,
            endLine: 10,
          },
        },
        {
          id: 'src/b.ts::main',
          rank: 0.7,
          attributes: {
            type: 'tag',
            file: 'src/b.ts',
            label: 'main',
            kind: 'function',
            line: 3,
            endLine: 8,
          },
        },
      ];

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked: perfNodes,
        graph: perfGraph as any,
        tokenLimit: 4096,
      });

      const result = await renderer.renderChunked(outputBase);

      // Find the chunk containing src/a.ts
      let foundReference = false;
      for (const content of result.chunks.values()) {
        if (content.includes('src/a.ts') && content.includes('used by')) {
          foundReference = true;
          expect(content).toContain('src/b.ts');
          expect(content).toContain('L4'); // main function line (3 + 1)
        }
      }

      expect(foundReference).toBe(true);
    });
  });

  describe('renderChunked (community grouping)', () => {
    // Build a small graph where nodes carry a `community` attribute, then
    // assert renderChunkedByCommunity emits one chunk per community plus a
    // root index, and that metadata length matches chunks.size.
    function buildCommunityFixture() {
      const g = new Graph();
      // Two communities: 0 and 1
      g.addNode('src/a/one.ts', { type: 'file', community: 0, imports: [] });
      g.addNode('src/a/two.ts', { type: 'file', community: 0, imports: [] });
      g.addNode('src/b/three.ts', { type: 'file', community: 1, imports: [] });
      g.addNode('src/a/one.ts::alpha', {
        type: 'tag', file: 'src/a/one.ts', label: 'alpha', kind: 'function',
        line: 0, endLine: 5, community: 0,
      });
      g.addNode('src/a/two.ts::beta', {
        type: 'tag', file: 'src/a/two.ts', label: 'beta', kind: 'function',
        line: 0, endLine: 5, community: 0,
      });
      g.addNode('src/b/three.ts::gamma', {
        type: 'tag', file: 'src/b/three.ts', label: 'gamma', kind: 'function',
        line: 0, endLine: 5, community: 1,
      });

      const ranked: any[] = [
        { id: 'src/a/one.ts::alpha', rank: 0.9, attributes: { type: 'tag', file: 'src/a/one.ts', label: 'alpha', kind: 'function', line: 0, endLine: 5, community: 0 } },
        { id: 'src/a/two.ts::beta',  rank: 0.8, attributes: { type: 'tag', file: 'src/a/two.ts', label: 'beta',  kind: 'function', line: 0, endLine: 5, community: 0 } },
        { id: 'src/b/three.ts::gamma', rank: 0.7, attributes: { type: 'tag', file: 'src/b/three.ts', label: 'gamma', kind: 'function', line: 0, endLine: 5, community: 1 } },
      ];
      return { g, ranked };
    }

    it('emits one chunk per community plus a root index chunk', async () => {
      const { g, ranked } = buildCommunityFixture();
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked,
        graph: g as any,
        tokenLimit: 4096,
        grouping: 'community',
      });

      const result = await renderer.renderChunked(outputBase);

      // 2 communities + 1 root
      expect(result.chunks.size).toBe(3);
      // metadata.length must match chunks.size (root chunk has its own entry)
      expect(result.metadata.length).toBe(result.chunks.size);

      // Verify community keys
      const keys = Array.from(result.chunks.keys());
      const hasCommunity0 = keys.some(k => k.includes('community_0'));
      const hasCommunity1 = keys.some(k => k.includes('community_1'));
      const hasRoot = keys.some(k => k.includes('_root'));
      expect(hasCommunity0).toBe(true);
      expect(hasCommunity1).toBe(true);
      expect(hasRoot).toBe(true);

      // Root chunk path is exposed
      expect(result.rootChunk).toBeTruthy();
      expect(result.rootChunk).toContain('_root');
    });

    it('reports unique file count (not node count) per community', async () => {
      const { g, ranked } = buildCommunityFixture();
      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked,
        graph: g as any,
        tokenLimit: 4096,
        grouping: 'community',
      });

      const result = await renderer.renderChunked(outputBase);

      // Community 0 has 2 unique files (one.ts, two.ts) — not 2 tag nodes.
      const c0 = result.metadata.find(m => m.directory === 'community_0');
      expect(c0).toBeDefined();
      expect(c0!.fileCount).toBe(2);

      // Community 1 has 1 unique file (three.ts).
      const c1 = result.metadata.find(m => m.directory === 'community_1');
      expect(c1).toBeDefined();
      expect(c1!.fileCount).toBe(1);
    });

    it('places nodes without community in the unclustered bucket', async () => {
      const g = new Graph();
      g.addNode('src/orphan.ts', { type: 'file', imports: [] });
      g.addNode('src/orphan.ts::lone', {
        type: 'tag', file: 'src/orphan.ts', label: 'lone', kind: 'function',
        line: 0, endLine: 1,
      });
      const ranked: any[] = [
        { id: 'src/orphan.ts::lone', rank: 0.5, attributes: { type: 'tag', file: 'src/orphan.ts', label: 'lone', kind: 'function', line: 0, endLine: 1 } },
      ];

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked,
        graph: g as any,
        tokenLimit: 4096,
        grouping: 'community',
      });

      const result = await renderer.renderChunked(outputBase);
      const keys = Array.from(result.chunks.keys());
      expect(keys.some(k => k.includes('unclustered'))).toBe(true);
    });

    it('honours includeImports inside community chunks', async () => {
      const g = new Graph();
      g.addNode('src/a.ts', {
        type: 'file',
        community: 0,
        imports: [{ source: './b.ts', text: "import { x } from './b.ts'" }],
      });
      g.addNode('src/a.ts::foo', {
        type: 'tag', file: 'src/a.ts', label: 'foo', kind: 'function',
        line: 0, endLine: 5, community: 0,
      });
      const ranked: any[] = [
        { id: 'src/a.ts::foo', rank: 0.9, attributes: { type: 'tag', file: 'src/a.ts', label: 'foo', kind: 'function', line: 0, endLine: 5, community: 0 } },
      ];

      const renderer = new ChunkedRenderer({
        root: '/project',
        ranked,
        graph: g as any,
        tokenLimit: 4096,
        grouping: 'community',
        includeImports: true,
      });

      const result = await renderer.renderChunked(outputBase);
      const communityChunks = Array.from(result.chunks.entries())
        .filter(([k]) => k.includes('community_0'));
      expect(communityChunks.length).toBe(1);
      expect(communityChunks[0][1]).toContain("import { x } from './b.ts'");
    });
  });
});

describe('ChunkedRenderer "used by" calls-edge confidence', () => {
  let outputDir: string;
  afterEach(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-chunked-conf-'));
  });

  async function render(callers: { file: string; confidence?: 'EXTRACTED' | 'INFERRED' }[]): Promise<string[]> {
    const g = new Graph({ multi: true });
    g.addNode('lib.ts', { type: 'file', imports: [] });
    g.addNode('lib.ts::target', { type: 'tag', file: 'lib.ts', label: 'target', kind: 'function', line: 0, endLine: 2 });
    callers.forEach((c, i) => {
      const id = `${c.file}::caller${i}`;
      g.addNode(id, { type: 'tag', file: c.file, label: `caller${i}`, kind: 'function', line: i, endLine: i });
      const attrs: Record<string, unknown> = { type: 'calls' };
      if (c.confidence) attrs.confidence = c.confidence;
      g.addEdge(id, 'lib.ts::target', attrs);
    });
    const ranked: RankedNode[] = [
      { id: 'lib.ts', rank: 1, attributes: { type: 'file', label: 'lib.ts' } },
      { id: 'lib.ts::target', rank: 0.9, attributes: { type: 'tag', file: 'lib.ts', label: 'target', kind: 'function', line: 0, endLine: 2 } },
    ];
    const renderer = new ChunkedRenderer({ root: '/project', ranked, graph: g as any, tokenLimit: 4096 });
    const result = await renderer.renderChunked(path.join(outputDir, '.xray'));
    const lines: string[] = [];
    for (const content of result.chunks.values()) {
      lines.push(...content.split('\n').filter((l) => l.includes('→')));
    }
    return lines;
  }

  it('prints EXTRACTED callers before INFERRED ones and suffixes INFERRED with (inferred)', async () => {
    expect(await render([
      { file: 'far/x.ts', confidence: 'INFERRED' },
      { file: 'near/y.ts', confidence: 'EXTRACTED' },
    ])).toEqual([
      '│       → used by: [near/y.ts:L2]',
      '│       → used by: [far/x.ts:L1] (inferred)',
    ]);
  });

  it('caps INFERRED callers at 3 per symbol and summarises the rest as +N inferred', async () => {
    expect(await render([
      { file: 'a.ts', confidence: 'INFERRED' },
      { file: 'b.ts', confidence: 'INFERRED' },
      { file: 'c.ts', confidence: 'INFERRED' },
      { file: 'd.ts', confidence: 'INFERRED' },
      { file: 'e.ts', confidence: 'EXTRACTED' },
    ])).toEqual([
      '│       → used by: [e.ts:L5]',
      '│       → used by: [a.ts:L1] (inferred)',
      '│       → used by: [b.ts:L2] (inferred)',
      '│       → used by: [c.ts:L3] (inferred)',
      '│       → +1 inferred',
    ]);
  });

  it('treats edges without confidence as EXTRACTED (pre-confidence graphs)', async () => {
    expect(await render([{ file: 'a.ts' }])).toEqual(['│       → used by: [a.ts:L1]']);
  });
});
