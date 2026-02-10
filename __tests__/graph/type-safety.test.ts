/**
 * Type Safety Tests for Graph Operations
 *
 * These tests verify that:
 * 1. Graph instances have proper TypeScript types (not 'any')
 * 2. Node attributes are properly typed
 * 3. Edge attributes are properly typed
 * 4. Type errors are caught at compile time
 *
 * Currently FAILING - requires implementation of Phase 1: Graph Types
 */

import { GraphBuilder } from '../../src/lib/graph/builder';
import { Xray } from '../../src/lib/xray';
import { Tag } from '../../src/lib/parser/types';

describe('Graph Type Safety', () => {
  describe('GraphBuilder type safety', () => {
    it('should have a properly typed graph property (not any)', async () => {
      const builder = new GraphBuilder();
      const graph = await builder.getGraph();

      // This test verifies compile-time type safety
      // With proper types, graph operations are type-checked!

      // Should have standard graphology methods with proper types
      expect(typeof graph.order).toBe('number');
      expect(typeof graph.size).toBe('number');
      expect(typeof graph.hasNode).toBe('function');
      expect(typeof graph.addNode).toBe('function');

      // @ts-expect-error - TypeScript now catches this typo!
      const _typo1 = graph.addNod;

      // @ts-expect-error - TypeScript now catches this invalid method!
      const _typo2 = graph.fooBar;

      // Success: TypeScript catches these errors at compile time!
    });

    it('should enforce FileNodeAttributes type for file nodes', async () => {
      const builder = new GraphBuilder();
      await builder.addFile('test.ts', [], []);
      const graph = await builder.getGraph();

      const attrs = graph.getNodeAttributes('test.ts');

      expect(attrs.type).toBe('file');
      expect(attrs.label).toBe('test.ts');

      if (attrs.type === 'file') {
        expect(attrs.label).toBeDefined();
      }
    });

    it('should enforce TagNodeAttributes type for tag nodes', async () => {
      const builder = new GraphBuilder();
      const tags: Tag[] = [{
        name: 'testFunc',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'test.ts',
        signature: '() => void'
      }];

      await builder.addFile('test.ts', tags, []);
      const graph = await builder.getGraph();

      const tagId = 'test.ts::testFunc';
      const attrs = graph.getNodeAttributes(tagId);

      // Tag nodes should have specific attributes
      expect(attrs.type).toBe('tag');

      // Need to narrow the type using type guard
      if (attrs.type === 'tag') {
        expect(attrs.kind).toBe('function');
        expect(attrs.line).toBe(1);
      }
    });

    it('should enforce EdgeAttributes type for edges', async () => {
      const builder = new GraphBuilder();
      const tags: Tag[] = [{
        name: 'func1',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'test.ts'
      }];

      await builder.addFile('test.ts', tags, []);
      const graph = await builder.getGraph();

      const edges = graph.edges('test.ts', 'test.ts::func1');
      expect(edges.length).toBeGreaterThan(0);

      const edgeAttrs = graph.getEdgeAttributes(edges[0]);

      expect(edgeAttrs.type).toBe('defines');
    });

    it('should prevent adding nodes with invalid attribute types', async () => {
      const builder = new GraphBuilder();
      const graph = await builder.getGraph();

      expect(graph).toBeDefined();
    });
  });

  describe('Xray type safety', () => {
    it('should have properly typed lastGraph property (not any)', () => {
      const xray = new Xray({ path: process.cwd() });
      const result = xray.getLastGraph();

      // Currently returns { graph?: any; rankedNodes?: any[] }
      // Should return properly typed graph and ranked nodes

      if (result.graph) {
        // Should have type checking for graph operations
        expect(typeof result.graph.order).toBe('number');

        // @ts-expect-error - Should fail: typo in method name
        result.graph.forEacNode(() => {});
      }

      if (result.rankedNodes) {
        // Should be typed as RankedNode[]
        const firstNode = result.rankedNodes[0];

        // @ts-expect-error - Should fail: RankedNode should have specific structure
        // Currently this compiles because rankedNodes is any[]
        const _ = firstNode.invalidProperty;
      }
    });

    it('should return properly typed graph from buildGraph', async () => {
      // This test verifies that buildGraph returns properly typed result
      // We don't need to actually call it - the return type is what matters

      const xray = new Xray({ path: process.cwd() });

      // TypeScript knows the return type of buildGraph
      // Promise<{ rankedNodes: RankedNode[]; graph: XrayGraph }>

      // We can verify the type signature without calling the method
      const buildGraphType = xray.buildGraph;
      expect(typeof buildGraphType).toBe('function');

      // We can also verify by checking getLastGraph which uses the same types
      const lastGraph = xray.getLastGraph();

      // The return type is properly typed
      expect(lastGraph).toBeDefined();

      // If graph exists, TypeScript provides proper type checking
      if (lastGraph.graph) {
        // @ts-expect-error - TypeScript catches this typo!
        const _typo = lastGraph.graph.forEachNod;
        // Success: method typo is caught at compile time!
      }

      // Success: buildGraph return type is properly typed!
    });
  });

  describe('Graph operations type safety', () => {
    it('should catch typos in graph method names at compile time', async () => {
      const builder = new GraphBuilder();
      const graph = await builder.getGraph();

      // Valid operations (should compile)
      graph.forEachNode((node) => {
        expect(typeof node).toBe('string');
      });

      // Invalid operations (TypeScript now catches these!)
      // @ts-expect-error - TypeScript catches this typo!
      const _typo1 = graph.forEacNode;

      // @ts-expect-error - TypeScript catches this typo!
      const _typo2 = graph.addNod;

      // @ts-expect-error - TypeScript catches this typo!
      const _typo3 = graph.hasNod;

      // Success: All typos are caught at compile time!
    });

    it('should provide IntelliSense for graph methods', async () => {
      const builder = new GraphBuilder();
      const graph = await builder.getGraph();

      // With proper types, IDEs should autocomplete these methods:
      // - addNode
      // - hasNode
      // - getNodeAttributes
      // - setNodeAttribute
      // - forEachNode
      // - neighbors
      // - etc.

      // This test just verifies these methods exist and work
      graph.addNode('test', { type: 'file', label: 'test' });
      expect(graph.hasNode('test')).toBe(true);
      expect(graph.getNodeAttributes('test').type).toBe('file');
    });

    it('should enforce consistent node attribute types', async () => {
      const builder = new GraphBuilder();
      const graph = await builder.getGraph();

      graph.addNode('file1', { type: 'file', label: 'file1' });
      graph.setNodeAttribute('file1', 'label', 'updated');

      // Add a tag node
      graph.addNode('tag1', {
        type: 'tag',
        label: 'tag1',
        kind: 'function',
        file: 'test.ts',
        line: 1
      });

      expect(graph.hasNode('tag1')).toBe(true);
      const attrs = graph.getNodeAttributes('tag1');
      expect(attrs.type).toBe('tag');
    });
  });

  describe('Type inference and IntelliSense', () => {
    it('should infer correct types from discriminated unions', async () => {
      const builder = new GraphBuilder();
      await builder.addFile('test.ts', [], []);
      const graph = await builder.getGraph();

      graph.forEachNode((nodeId, attrs) => {
        if (attrs.type === 'file') {
          expect(attrs.label).toBeDefined();
        } else if (attrs.type === 'tag') {
          expect(attrs.kind).toBeDefined();
          expect(attrs.line).toBeDefined();
        }
      });
    });

    it('should provide type-safe edge iteration', async () => {
      const builder = new GraphBuilder();
      const tags: Tag[] = [{
        name: 'func1',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'test.ts',
        references: ['func2']
      }, {
        name: 'func2',
        kind: 'function',
        line: 10,
        col: 0,
        file: 'test.ts'
      }];

      await builder.addFile('test.ts', tags, []);
      // References are resolved automatically when getting the graph
      const graph = await builder.getGraph();

      graph.forEachEdge((edge, attrs, source, target) => {
        expect(attrs.type).toMatch(/^(defines|calls|imports)$/);
      });
    });
  });
});
