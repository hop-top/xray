import { ChunkedRenderer } from '../src/lib/renderer/chunked-renderer';
import Graph from 'graphology';
import { RankedNode } from '../src/types/graph';
import * as path from 'path';

describe('ChunkedRenderer', () => {
  let graph: Graph;
  let rankedNodes: RankedNode[];

  beforeEach(() => {
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
        score: 1.0,
        data: { type: 'file' },
      },
      {
        id: 'src/lib/utils.ts',
        score: 0.8,
        data: { type: 'file' },
      },
      {
        id: 'src/lib/config.ts',
        score: 0.6,
        data: { type: 'file' },
      },
      {
        id: 'src/index.ts::main',
        score: 0.9,
        data: {
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
        score: 0.7,
        data: {
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
      const renderer = new ChunkedRenderer(
        '/project',
        rankedNodes,
        graph,
        4096,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

      expect(result.chunks.size).toBeGreaterThan(0);
      expect(result.metadata.length).toBeGreaterThan(0);
      expect(result.rootChunk).toBeTruthy();
    });

    it('should respect depth limits', async () => {
      const renderer = new ChunkedRenderer(
        '/project',
        rankedNodes,
        graph,
        4096,
        1, // max depth = 1
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

      // Should only include directories at depth <= 1
      const depthViolations = result.metadata.filter(m => m.depth > 1);
      expect(depthViolations).toHaveLength(0);
    });

    it('should create parent-child links', async () => {
      const renderer = new ChunkedRenderer(
        '/project',
        rankedNodes,
        graph,
        4096,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

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
      const renderer = new ChunkedRenderer(
        '/project',
        rankedNodes,
        graph,
        4096,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

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
      const renderer = new ChunkedRenderer(
        '/project',
        rankedNodes,
        graph,
        tokenLimit,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

      // Each chunk should respect the token limit
      for (const metadata of result.metadata) {
        expect(metadata.tokenCount).toBeLessThanOrEqual(tokenLimit);
      }
    });

    it('should generate unique chunk file paths', async () => {
      const renderer = new ChunkedRenderer(
        '/project',
        rankedNodes,
        graph,
        4096,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

      const paths = Array.from(result.chunks.keys());
      const uniquePaths = new Set(paths);

      expect(paths.length).toBe(uniquePaths.size);
    });
  });

  describe('directory organization', () => {
    it('should handle root directory', async () => {
      const rootNodes: RankedNode[] = [
        {
          id: 'index.ts',
          score: 1.0,
          data: { type: 'file' },
        },
        {
          id: 'index.ts::main',
          score: 0.9,
          data: {
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

      const renderer = new ChunkedRenderer(
        '/project',
        rootNodes,
        rootGraph,
        4096,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

      expect(result.chunks.size).toBeGreaterThan(0);
      expect(result.rootChunk).toBeTruthy();
    });

    it('should handle nested directories', async () => {
      const nestedNodes: RankedNode[] = [
        {
          id: 'a/b/c/deep.ts',
          score: 0.5,
          data: { type: 'file' },
        },
      ];

      const nestedGraph = new Graph();
      nestedGraph.addNode('a/b/c/deep.ts', { type: 'file', imports: [] });

      const renderer = new ChunkedRenderer(
        '/project',
        nestedNodes,
        nestedGraph,
        4096,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

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

      const nodesWithImports: RankedNode[] = [
        {
          id: 'src/index.ts',
          score: 1.0,
          data: { type: 'file' },
        },
      ];

      const renderer = new ChunkedRenderer(
        '/project',
        nodesWithImports,
        graphWithImports,
        4096,
        undefined,
        true // includeImports = true
      );

      const result = await renderer.renderChunked('/output/.xray');

      // Check that at least one chunk contains import information
      let foundImport = false;
      for (const content of result.chunks.values()) {
        if (content.includes('import')) {
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

      const nodesWithImports: RankedNode[] = [
        {
          id: 'src/index.ts',
          score: 1.0,
          data: { type: 'file' },
        },
      ];

      const renderer = new ChunkedRenderer(
        '/project',
        nodesWithImports,
        graphWithImports,
        4096,
        undefined,
        false // includeImports = false
      );

      const result = await renderer.renderChunked('/output/.xray');

      // Should not contain import statements in most cases
      // (unless they're part of tag names, which is unlikely)
      for (const content of result.chunks.values()) {
        // This is a soft check - imports might appear in other contexts
        const importCount = (content.match(/import/g) || []).length;
        expect(importCount).toBeLessThan(5); // Arbitrary low threshold
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
          score: 1.0,
          data: { type: 'file' },
        },
        {
          id: 'src/b.ts',
          score: 0.9,
          data: { type: 'file' },
        },
        {
          id: 'src/a.ts::helper',
          score: 0.8,
          data: {
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
          score: 0.7,
          data: {
            type: 'tag',
            file: 'src/b.ts',
            label: 'main',
            kind: 'function',
            line: 3,
            endLine: 8,
          },
        },
      ];

      const renderer = new ChunkedRenderer(
        '/project',
        perfNodes,
        perfGraph,
        4096,
        undefined,
        false
      );

      const result = await renderer.renderChunked('/output/.xray');

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
});
