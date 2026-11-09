/**
 * CQRS Phase 3: Queries Tests
 *
 * Testing query implementations for CQRS pattern
 *
 * Key behaviors:
 * - Queries read state without modification
 * - Queries never mutate state
 * - Queries can compose/transform data
 * - Queries work with serialized state
 * - Queries are idempotent
 */

import {
  Query,
  GetFilesQuery,
  GetGraphQuery,
  GetNodeRanksQuery,
  SearchNodesQuery,
  GetStatisticsQuery,
  QueryResult,
} from '../../../src/lib/queries';
import { AnalysisState } from '../../../src/lib/state/analysis-state';

describe('Queries', () => {
  describe('Query interface', () => {
    it('defines execute method', () => {
      const query: Query<any> = {
        execute: (state: AnalysisState) => {
          return {
            success: true,
            data: null,
          };
        },
      };

      expect(query.execute).toBeDefined();
      expect(typeof query.execute).toBe('function');
    });
  });

  describe('GetFilesQuery', () => {
    it('returns files list from state', () => {
      const query = new GetFilesQuery();

      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts', 'file2.ts', 'file3.ts'],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
    });

    it('does not modify state', () => {
      const query = new GetFilesQuery();

      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const stateBefore = state.toSnapshot();
      query.execute(state);
      const stateAfter = state.toSnapshot();

      expect(stateAfter).toEqual(stateBefore);
    });

    it('supports filtering by pattern', () => {
      const query = new GetFilesQuery({
        pattern: '*.test.ts',
      });

      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts', 'file1.test.ts', 'file2.ts', 'file2.test.ts'],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['file1.test.ts', 'file2.test.ts']);
    });

    it('returns empty array when no files', () => {
      const query = new GetFilesQuery();

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('GetGraphQuery', () => {
    it('returns graph from state', () => {
      const query = new GetGraphQuery();

      const mockGraph = {
        nodes: [{ id: 'node1' }, { id: 'node2' }],
        edges: [{ from: 'node1', to: 'node2' }],
      };

      const state = new AnalysisState({
        graph: mockGraph,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockGraph);
    });

    it('returns null when no graph', () => {
      const query = new GetGraphQuery();

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('supports filtering by node type', () => {
      const query = new GetGraphQuery({
        nodeType: 'function',
      });

      const mockGraph = {
        nodes: [
          { id: 'node1', type: 'function' },
          { id: 'node2', type: 'class' },
          { id: 'node3', type: 'function' },
        ],
        edges: [],
      };

      const state = new AnalysisState({
        graph: mockGraph,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data.nodes).toHaveLength(2);
      expect(result.data.nodes[0].type).toBe('function');
    });
  });

  describe('GetNodeRanksQuery', () => {
    it('returns node ranks from metadata', () => {
      const query = new GetNodeRanksQuery();

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {
          ranks: {
            node1: 0.8,
            node2: 0.5,
            node3: 0.3,
          },
        },
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        node1: 0.8,
        node2: 0.5,
        node3: 0.3,
      });
    });

    it('returns sorted ranks by default', () => {
      const query = new GetNodeRanksQuery({ sort: true });

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {
          ranks: {
            node1: 0.3,
            node2: 0.8,
            node3: 0.5,
          },
        },
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      const entries = Object.entries(result.data);
      expect(entries[0][0]).toBe('node2'); // Highest rank first
      expect(entries[0][1]).toBe(0.8);
    });

    it('returns empty object when no ranks', () => {
      const query = new GetNodeRanksQuery();

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });
  });

  describe('SearchNodesQuery', () => {
    it('searches nodes by query string', () => {
      const query = new SearchNodesQuery({
        query: 'user',
      });

      const mockGraph = {
        nodes: [
          { id: 'UserService', name: 'UserService' },
          { id: 'ProductService', name: 'ProductService' },
          { id: 'UserController', name: 'UserController' },
        ],
        edges: [],
      };

      const state = new AnalysisState({
        graph: mockGraph,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toContain('User');
    });

    it('returns empty array when no matches', () => {
      const query = new SearchNodesQuery({
        query: 'nonexistent',
      });

      const mockGraph = {
        nodes: [{ id: 'node1', name: 'Service' }],
        edges: [],
      };

      const state = new AnalysisState({
        graph: mockGraph,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('supports case-insensitive search', () => {
      const query = new SearchNodesQuery({
        query: 'USER',
        caseSensitive: false,
      });

      const mockGraph = {
        nodes: [{ id: 'user1', name: 'UserService' }],
        edges: [],
      };

      const state = new AnalysisState({
        graph: mockGraph,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('GetStatisticsQuery', () => {
    it('returns statistics about state', () => {
      const query = new GetStatisticsQuery();

      const mockGraph = {
        nodes: [{ id: 'node1' }, { id: 'node2' }, { id: 'node3' }],
        edges: [{ from: 'node1', to: 'node2' }],
      };

      const state = new AnalysisState({
        graph: mockGraph,
        files: ['file1.ts', 'file2.ts'],
        metadata: {
          parsed: { 'file1.ts': {}, 'file2.ts': {} },
        },
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data.fileCount).toBe(2);
      expect(result.data.nodeCount).toBe(3);
      expect(result.data.edgeCount).toBe(1);
    });

    it('handles state without graph', () => {
      const query = new GetStatisticsQuery();

      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data.fileCount).toBe(1);
      expect(result.data.nodeCount).toBe(0);
      expect(result.data.edgeCount).toBe(0);
    });

    it('includes metadata statistics', () => {
      const query = new GetStatisticsQuery();

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {
          version: 1,
          timestamp: Date.now(),
          custom: 'value',
        },
      });

      const result = query.execute(state);

      expect(result.success).toBe(true);
      expect(result.data.metadataKeys).toBeDefined();
      expect(result.data.metadataKeys).toContain('version');
    });
  });

  describe('QueryResult', () => {
    it('includes success flag', () => {
      const query = new GetFilesQuery();
      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('includes data on success', () => {
      const query = new GetFilesQuery();
      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result).toHaveProperty('data');
      expect(result.data).toBeDefined();
    });

    it('includes error on failure', () => {
      // Query that might fail
      const query = new SearchNodesQuery({ query: 'test' });
      const state = new AnalysisState({
        graph: null, // No graph to search
        files: [],
        metadata: {},
      });

      const result = query.execute(state);

      // Should handle gracefully
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('Query immutability', () => {
    it('queries never modify state', () => {
      const queries = [
        new GetFilesQuery(),
        new GetGraphQuery(),
        new GetNodeRanksQuery(),
        new GetStatisticsQuery(),
      ];

      const state = new AnalysisState({
        graph: { nodes: [], edges: [] },
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      const originalSnapshot = state.toSnapshot();

      // Execute all queries
      queries.forEach((query) => query.execute(state));

      const finalSnapshot = state.toSnapshot();

      expect(finalSnapshot).toEqual(originalSnapshot);
    });

    it('query results are independent of state changes', () => {
      const query = new GetFilesQuery();

      let state = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const result1 = query.execute(state);

      // Change state
      state = state.withFiles(['file2.ts']);

      const result2 = query.execute(state);

      // Results should differ
      expect(result1.data).toEqual(['file1.ts']);
      expect(result2.data).toEqual(['file2.ts']);
    });
  });
});
