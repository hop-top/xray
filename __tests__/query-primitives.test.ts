import Graph from 'graphology';
import { FunctionAdapter } from '../src/lib/query/adapters/function';
import { GraphBuilder } from '../src/lib/graph/builder';
import { GraphSerializer } from '../src/lib/graph/serializer';
import { CACHE_SCHEMA_VERSION } from '../src/lib/cache/sqlite-cache';
import type { Tag } from '../src/lib/parser/types';

describe('Query primitives & tag metadata', () => {
  describe('CACHE_SCHEMA_VERSION and exported/supertypes serialization', () => {
    it('bumps CACHE_SCHEMA_VERSION to 9', () => {
      expect(CACHE_SCHEMA_VERSION).toBe(9);
    });

    it('persists exported and supertypes through GraphBuilder and GraphSerializer', async () => {
      const builder = new GraphBuilder();
      const tags: Tag[] = [
        {
          file: 'src/service.ts',
          name: 'AuthService',
          kind: 'class',
          line: 1,
          endLine: 20,
          col: 0,
          exported: true,
          supertypes: ['BaseService', 'Serializable'],
        },
        {
          file: 'src/service.ts',
          name: 'internalHelper',
          kind: 'function',
          line: 22,
          endLine: 25,
          col: 0,
          exported: false,
        },
      ];

      await builder.addFile('src/service.ts', tags, []);
      const graph = await builder.getGraph();

      const serializer = new GraphSerializer();
      const serialized = serializer.serialize(graph, '/tmp/project');
      const authNode = serialized.nodes.find((n) => n.id === 'src/service.ts::AuthService');
      const helperNode = serialized.nodes.find((n) => n.id === 'src/service.ts::internalHelper');

      expect(authNode?.exported).toBe(true);
      expect(authNode?.supertypes).toEqual(['BaseService', 'Serializable']);
      expect(helperNode?.exported).toBe(false);
      expect(helperNode?.supertypes).toBeUndefined();

      const deserialized = serializer.deserialize(serialized);
      expect(deserialized.getNodeAttribute('src/service.ts::AuthService', 'exported')).toBe(true);
      expect(deserialized.getNodeAttribute('src/service.ts::AuthService', 'supertypes')).toEqual(['BaseService', 'Serializable']);
      expect(deserialized.getNodeAttribute('src/service.ts::internalHelper', 'exported')).toBe(false);
    });
  });

  describe('implementations()', () => {
    let adapter: FunctionAdapter;
    let graph: any;

    beforeEach(() => {
      adapter = new FunctionAdapter();
      graph = new Graph({ multi: true, type: 'directed' });
      graph.addNode('src/base.ts::Runner', {
        type: 'tag',
        label: 'Runner',
        kind: 'interface',
        file: 'src/base.ts',
        line: 1,
        exported: true,
      });
      graph.addNode('src/fast.ts::FastRunner', {
        type: 'tag',
        label: 'FastRunner',
        kind: 'class',
        file: 'src/fast.ts',
        line: 3,
        exported: true,
        supertypes: ['Runner', 'Loggable'],
      });
      graph.addNode('src/slow.ts::SlowRunner', {
        type: 'tag',
        label: 'SlowRunner',
        kind: 'class',
        file: 'src/slow.ts',
        line: 5,
        exported: true,
        supertypes: ['Runner'],
      });
      graph.addNode('src/other.ts::Other', {
        type: 'tag',
        label: 'Other',
        kind: 'class',
        file: 'src/other.ts',
        line: 2,
        exported: true,
        supertypes: ['Base'],
      });
    });

    it('finds all implementations by exact supertype name', () => {
      const res = adapter.execute('implementations(Runner)', graph);
      expect(res.metadata.queryType).toBe('implementations');
      expect(res.nodes.map((n) => n.name).sort()).toEqual(['FastRunner', 'SlowRunner']);
    });

    it('supports glob matching in implementations()', () => {
      const res = adapter.execute('implementations(*Runner)', graph);
      expect(res.nodes.map((n) => n.name).sort()).toEqual(['FastRunner', 'SlowRunner']);
    });
  });

  describe('cycles()', () => {
    let adapter: FunctionAdapter;
    let graph: any;

    beforeEach(() => {
      adapter = new FunctionAdapter();
      graph = new Graph({ multi: true, type: 'directed' });

      // Files with an import cycle: a.ts -> b.ts -> a.ts, and acyclic c.ts -> a.ts
      graph.addNode('a.ts', { type: 'file', label: 'a.ts' });
      graph.addNode('b.ts', { type: 'file', label: 'b.ts' });
      graph.addNode('c.ts', { type: 'file', label: 'c.ts' });
      graph.addEdge('a.ts', 'b.ts', { type: 'imports' });
      graph.addEdge('b.ts', 'a.ts', { type: 'imports' });
      graph.addEdge('c.ts', 'a.ts', { type: 'imports' });

      // Functions with a call cycle (f1 -> f2 -> f1), a self-loop (f3 -> f3), and acyclic f4 -> f1
      graph.addNode('a.ts::f1', { type: 'tag', label: 'f1', kind: 'function', file: 'a.ts', line: 1 });
      graph.addNode('b.ts::f2', { type: 'tag', label: 'f2', kind: 'function', file: 'b.ts', line: 1 });
      graph.addNode('c.ts::f3', { type: 'tag', label: 'f3', kind: 'function', file: 'c.ts', line: 1 });
      graph.addNode('c.ts::f4', { type: 'tag', label: 'f4', kind: 'function', file: 'c.ts', line: 10 });
      graph.addEdge('a.ts::f1', 'b.ts::f2', { type: 'calls' });
      graph.addEdge('b.ts::f2', 'a.ts::f1', { type: 'calls' });
      graph.addEdge('c.ts::f3', 'c.ts::f3', { type: 'calls' });
      graph.addEdge('c.ts::f4', 'a.ts::f1', { type: 'calls' });
    });

    it('detects call cycles including self-loops with 0-arg cycles()', () => {
      const res = adapter.execute('cycles()', graph);
      expect(res.metadata.queryType).toBe('cycles');
      expect(res.nodes.map((n) => n.name).sort()).toEqual(['f1', 'f2', 'f3']);
      expect(res.edges.length).toBe(3);
    });

    it('detects import cycles with cycles(kind=imports)', () => {
      const res = adapter.execute('cycles(kind=imports)', graph);
      expect(res.nodes.map((n) => n.name).sort()).toEqual(['a.ts', 'b.ts']);
      expect(res.edges.length).toBe(2);
    });
  });

  describe('deadcode()', () => {
    let adapter: FunctionAdapter;
    let graph: any;

    beforeEach(() => {
      adapter = new FunctionAdapter();
      graph = new Graph({ multi: true, type: 'directed' });

      // Non-exported uncalled function -> dead code
      graph.addNode('src/a.ts::unusedHelper', {
        type: 'tag', label: 'unusedHelper', kind: 'function', file: 'src/a.ts', line: 1, exported: false,
      });
      // Non-exported called function -> alive
      graph.addNode('src/a.ts::usedHelper', {
        type: 'tag', label: 'usedHelper', kind: 'function', file: 'src/a.ts', line: 5, exported: false,
      });
      // Exported uncalled function -> alive (public API)
      graph.addNode('src/a.ts::publicApi', {
        type: 'tag', label: 'publicApi', kind: 'function', file: 'src/a.ts', line: 10, exported: true,
      });
      // Entrypoints / constructors / test files -> excluded
      graph.addNode('src/a.ts::main', {
        type: 'tag', label: 'main', kind: 'function', file: 'src/a.ts', line: 15, exported: false,
      });
      graph.addNode('src/a.ts::init', {
        type: 'tag', label: 'init', kind: 'function', file: 'src/a.ts', line: 20, exported: false,
      });
      graph.addNode('src/a.ts::constructor', {
        type: 'tag', label: 'constructor', kind: 'method', file: 'src/a.ts', line: 25, exported: false,
      });
      graph.addNode('__tests__/a.test.ts::testHelper', {
        type: 'tag', label: 'testHelper', kind: 'function', file: '__tests__/a.test.ts', line: 1, exported: false,
      });
      // Non-function symbol -> excluded
      graph.addNode('src/a.ts::MyClass', {
        type: 'tag', label: 'MyClass', kind: 'class', file: 'src/a.ts', line: 30, exported: false,
      });

      graph.addEdge('src/a.ts::publicApi', 'src/a.ts::usedHelper', { type: 'calls' });
    });

    it('returns non-exported uncalled functions/methods excluding entrypoints, constructors, and tests', () => {
      const res = adapter.execute('deadcode()', graph);
      expect(res.metadata.queryType).toBe('deadcode');
      expect(res.nodes.map((n) => n.name)).toEqual(['unusedHelper']);
    });
  });
});
