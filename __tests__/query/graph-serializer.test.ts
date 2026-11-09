import Graph from 'graphology';
import { GraphSerializer } from '../../src/lib/graph/serializer';
import type { SerializedGraph } from '../../src/lib/query/types';

describe('GraphSerializer', () => {
  let graph: any;
  let serializer: GraphSerializer;

  beforeEach(() => {
    graph = new Graph();
    serializer = new GraphSerializer();
  });

  describe('serialize', () => {
    test('serializes empty graph', () => {
      const result = serializer.serialize(graph, '/test/project');

      expect(result.metadata.version).toBe('1.0');
      expect(result.metadata.projectPath).toBe('/test/project');
      expect(result.metadata.nodeCount).toBe(0);
      expect(result.metadata.edgeCount).toBe(0);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    test('serializes graph with file nodes', () => {
      graph.addNode('src/main.ts', {
        type: 'file',
        label: 'src/main.ts',
      });

      const result = serializer.serialize(graph, '/test/project');

      expect(result.metadata.nodeCount).toBe(1);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        id: 'src/main.ts',
        type: 'file',
        label: 'src/main.ts',
      });
    });

    test('serializes graph with tag nodes and all attributes', () => {
      graph.addNode('src/main.ts::main', {
        type: 'tag',
        label: 'main',
        kind: 'function',
        file: 'src/main.ts',
        line: 5,
        endLine: 10,
        signature: 'function main()',
        doc: 'Entry point',
        rank: 0.85,
      });

      const result = serializer.serialize(graph, '/test/project');

      expect(result.nodes[0]).toEqual({
        id: 'src/main.ts::main',
        type: 'tag',
        label: 'main',
        kind: 'function',
        file: 'src/main.ts',
        line: 5,
        endLine: 10,
        signature: 'function main()',
        doc: 'Entry point',
        rank: 0.85,
      });
    });

    test('serializes graph with edges', () => {
      graph.addNode('src/main.ts', { type: 'file', label: 'src/main.ts' });
      graph.addNode('src/main.ts::main', { type: 'tag', label: 'main' });
      graph.addNode('src/api.ts::processData', { type: 'tag', label: 'processData' });

      graph.addEdge('src/main.ts', 'src/main.ts::main', { type: 'defines' });
      graph.addEdge('src/main.ts::main', 'src/api.ts::processData', { type: 'calls' });

      const result = serializer.serialize(graph, '/test/project');

      expect(result.metadata.edgeCount).toBe(2);
      expect(result.edges).toHaveLength(2);
      expect(result.edges).toContainEqual({
        source: 'src/main.ts',
        target: 'src/main.ts::main',
        type: 'defines',
      });
      expect(result.edges).toContainEqual({
        source: 'src/main.ts::main',
        target: 'src/api.ts::processData',
        type: 'calls',
      });
    });

    test('preserves imports attribute', () => {
      const imports = [
        { source: 'lodash', specifier: 'default', as: '_' },
        { source: './utils', specifier: 'named', as: 'validateInput' },
      ];

      graph.addNode('src/main.ts::main', {
        type: 'tag',
        label: 'main',
        imports,
      });

      const result = serializer.serialize(graph, '/test/project');

      expect(result.nodes[0].imports).toEqual(imports);
    });

    test('includes timestamp in metadata', () => {
      const before = new Date().toISOString();
      const result = serializer.serialize(graph, '/test/project');
      const after = new Date().toISOString();

      expect(result.metadata.timestamp).toBeDefined();
      expect(result.metadata.timestamp >= before).toBe(true);
      expect(result.metadata.timestamp <= after).toBe(true);
    });
  });

  describe('deserialize', () => {
    test('deserializes empty graph', () => {
      const serialized: SerializedGraph = {
        metadata: {
          version: '1.0',
          timestamp: new Date().toISOString(),
          projectPath: '/test/project',
          nodeCount: 0,
          edgeCount: 0,
        },
        nodes: [],
        edges: [],
      };

      const result = serializer.deserialize(serialized);

      expect(result.order).toBe(0);
      expect(result.size).toBe(0);
    });

    test('deserializes graph with nodes', () => {
      const serialized: SerializedGraph = {
        metadata: {
          version: '1.0',
          timestamp: new Date().toISOString(),
          projectPath: '/test/project',
          nodeCount: 2,
          edgeCount: 0,
        },
        nodes: [
          { id: 'src/main.ts', type: 'file', label: 'src/main.ts' },
          {
            id: 'src/main.ts::main',
            type: 'tag',
            label: 'main',
            kind: 'function',
            file: 'src/main.ts',
            line: 5,
          },
        ],
        edges: [],
      };

      const result = serializer.deserialize(serialized);

      expect(result.order).toBe(2);
      expect(result.hasNode('src/main.ts')).toBe(true);
      expect(result.hasNode('src/main.ts::main')).toBe(true);
      expect(result.getNodeAttributes('src/main.ts')).toEqual({
        type: 'file',
        label: 'src/main.ts',
      });
      expect(result.getNodeAttributes('src/main.ts::main')).toEqual({
        type: 'tag',
        label: 'main',
        kind: 'function',
        file: 'src/main.ts',
        line: 5,
      });
    });

    test('deserializes graph with edges', () => {
      const serialized: SerializedGraph = {
        metadata: {
          version: '1.0',
          timestamp: new Date().toISOString(),
          projectPath: '/test/project',
          nodeCount: 2,
          edgeCount: 1,
        },
        nodes: [
          { id: 'src/main.ts', type: 'file', label: 'src/main.ts' },
          { id: 'src/main.ts::main', type: 'tag', label: 'main' },
        ],
        edges: [
          { source: 'src/main.ts', target: 'src/main.ts::main', type: 'defines' },
        ],
      };

      const result = serializer.deserialize(serialized);

      expect(result.size).toBe(1);
      expect(result.hasEdge('src/main.ts', 'src/main.ts::main')).toBe(true);
      // Graphs are multi: resolve the edge key before reading attributes.
      const [edgeKey] = result.edges('src/main.ts', 'src/main.ts::main');
      expect(result.getEdgeAttributes(edgeKey)).toEqual({
        type: 'defines',
        // Edges serialized without confidence are backfilled on load.
        confidence: 'EXTRACTED',
      });
    });

    test('preserves all node attributes including optional ones', () => {
      const serialized: SerializedGraph = {
        metadata: {
          version: '1.0',
          timestamp: new Date().toISOString(),
          projectPath: '/test/project',
          nodeCount: 1,
          edgeCount: 0,
        },
        nodes: [
          {
            id: 'src/main.ts::main',
            type: 'tag',
            label: 'main',
            kind: 'function',
            file: 'src/main.ts',
            line: 5,
            endLine: 10,
            signature: 'function main()',
            doc: 'Entry point',
            rank: 0.85,
            imports: [{ source: 'lodash', specifier: 'default', as: '_' }],
          },
        ],
        edges: [],
      };

      const result = serializer.deserialize(serialized);
      const attrs = result.getNodeAttributes('src/main.ts::main');

      expect(attrs).toEqual({
        type: 'tag',
        label: 'main',
        kind: 'function',
        file: 'src/main.ts',
        line: 5,
        endLine: 10,
        signature: 'function main()',
        doc: 'Entry point',
        rank: 0.85,
        imports: [{ source: 'lodash', specifier: 'default', as: '_' }],
      });
    });
  });

  describe('round-trip', () => {
    test('serialize then deserialize preserves graph structure', () => {
      // Build original graph
      graph.addNode('src/main.ts', { type: 'file', label: 'src/main.ts' });
      graph.addNode('src/main.ts::main', {
        type: 'tag',
        label: 'main',
        kind: 'function',
        file: 'src/main.ts',
        line: 5,
        rank: 0.85,
      });
      graph.addNode('src/api.ts::processData', {
        type: 'tag',
        label: 'processData',
        kind: 'function',
      });
      graph.addEdge('src/main.ts', 'src/main.ts::main', { type: 'defines', confidence: 'EXTRACTED' });
      graph.addEdge('src/main.ts::main', 'src/api.ts::processData', { type: 'calls', confidence: 'EXTRACTED' });

      // Serialize
      const serialized = serializer.serialize(graph, '/test/project');

      // Deserialize
      const restored = serializer.deserialize(serialized);

      // Verify structure preserved
      expect(restored.order).toBe(graph.order);
      expect(restored.size).toBe(graph.size);

      // Verify nodes
      graph.forEachNode((nodeId: string, attrs: any) => {
        expect(restored.hasNode(nodeId)).toBe(true);
        expect(restored.getNodeAttributes(nodeId)).toEqual(attrs);
      });

      // Verify edges
      graph.forEachEdge((edgeId: string, attrs: any, source: string, target: string) => {
        expect(restored.hasEdge(source, target)).toBe(true);
        const [restoredKey] = restored.edges(source, target);
        expect(restored.getEdgeAttributes(restoredKey)).toEqual(attrs);
      });
    });
  });
});
