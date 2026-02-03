/**
 * CQRS Phase 1: AnalysisState Tests
 *
 * Testing immutable AnalysisState for CQRS pattern
 *
 * Key behaviors:
 * - Immutable state object
 * - Builder pattern for state creation
 * - State transitions return new instances
 * - Serialization/deserialization
 * - Deep equality checking
 * - State validation
 */

import {
  AnalysisState,
  AnalysisStateBuilder,
  StateSnapshot,
} from '../../../src/lib/state/analysis-state';

describe('AnalysisState', () => {
  describe('creation and immutability', () => {
    it('creates state with initial values', () => {
      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      expect(state.graph).toBeNull();
      expect(state.files).toEqual([]);
      expect(state.metadata).toEqual({});
    });

    it('is immutable - cannot modify properties', () => {
      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      // Should not be able to mutate
      expect(() => {
        (state as any).files = [];
      }).toThrow();
    });

    it('returns new instance on state updates', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const state2 = state1.withFiles(['file1.ts', 'file2.ts']);

      expect(state2).not.toBe(state1);
      expect(state1.files).toEqual(['file1.ts']);
      expect(state2.files).toEqual(['file1.ts', 'file2.ts']);
    });
  });

  describe('withGraph() - graph updates', () => {
    it('creates new state with updated graph', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const mockGraph = { nodes: [], edges: [] };
      const state2 = state1.withGraph(mockGraph as any);

      expect(state2.graph).toBe(mockGraph);
      expect(state1.graph).toBeNull();
    });

    it('preserves other state properties', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      const state2 = state1.withGraph({ nodes: [], edges: [] } as any);

      expect(state2.files).toEqual(['file1.ts']);
      expect(state2.metadata).toEqual({ version: 1 });
    });
  });

  describe('withFiles() - file list updates', () => {
    it('creates new state with updated files', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const state2 = state1.withFiles(['file1.ts', 'file2.ts']);

      expect(state2.files).toEqual(['file1.ts', 'file2.ts']);
      expect(state1.files).toEqual(['file1.ts']);
    });

    it('creates defensive copy of files array', () => {
      const files = ['file1.ts'];
      const state = new AnalysisState({
        graph: null,
        files,
        metadata: {},
      });

      files.push('file2.ts');

      // State should not be affected
      expect(state.files).toEqual(['file1.ts']);
    });
  });

  describe('withMetadata() - metadata updates', () => {
    it('creates new state with updated metadata', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: [],
        metadata: { version: 1 },
      });

      const state2 = state1.withMetadata({ version: 2, timestamp: Date.now() });

      expect(state2.metadata).toEqual({ version: 2, timestamp: expect.any(Number) });
      expect(state1.metadata).toEqual({ version: 1 });
    });

    it('creates defensive copy of metadata', () => {
      const metadata = { version: 1 };
      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata,
      });

      metadata.version = 2;

      expect(state.metadata.version).toBe(1);
    });
  });

  describe('merge() - partial updates', () => {
    it('merges partial state updates', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      const state2 = state1.merge({
        files: ['file2.ts'],
      });

      expect(state2.files).toEqual(['file2.ts']);
      expect(state2.graph).toBeNull();
      expect(state2.metadata).toEqual({ version: 1 });
    });

    it('allows updating multiple properties at once', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const mockGraph = { nodes: [], edges: [] };
      const state2 = state1.merge({
        graph: mockGraph as any,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      expect(state2.graph).toBe(mockGraph);
      expect(state2.files).toEqual(['file1.ts']);
      expect(state2.metadata).toEqual({ version: 1 });
    });
  });

  describe('toSnapshot() - serialization', () => {
    it('converts state to plain object snapshot', () => {
      const state = new AnalysisState({
        graph: { nodes: [], edges: [] } as any,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      const snapshot = state.toSnapshot();

      expect(snapshot).toEqual({
        graph: { nodes: [], edges: [] },
        files: ['file1.ts'],
        metadata: { version: 1 },
      });
    });

    it('creates deep copy for snapshot', () => {
      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      const snapshot = state.toSnapshot();
      snapshot.files.push('file2.ts');

      expect(state.files).toEqual(['file1.ts']);
    });
  });

  describe('fromSnapshot() - deserialization', () => {
    it('creates state from snapshot', () => {
      const snapshot: StateSnapshot = {
        graph: { nodes: [], edges: [] } as any,
        files: ['file1.ts'],
        metadata: { version: 1 },
      };

      const state = AnalysisState.fromSnapshot(snapshot);

      expect(state.graph).toEqual({ nodes: [], edges: [] });
      expect(state.files).toEqual(['file1.ts']);
      expect(state.metadata).toEqual({ version: 1 });
    });

    it('round-trips through serialization', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: ['file1.ts', 'file2.ts'],
        metadata: { version: 1, count: 2 },
      });

      const snapshot = state1.toSnapshot();
      const state2 = AnalysisState.fromSnapshot(snapshot);

      expect(state2.files).toEqual(state1.files);
      expect(state2.metadata).toEqual(state1.metadata);
    });
  });

  describe('equals() - equality checking', () => {
    it('returns true for equal states', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      const state2 = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: { version: 1 },
      });

      expect(state1.equals(state2)).toBe(true);
    });

    it('returns false for different files', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const state2 = new AnalysisState({
        graph: null,
        files: ['file2.ts'],
        metadata: {},
      });

      expect(state1.equals(state2)).toBe(false);
    });

    it('returns false for different metadata', () => {
      const state1 = new AnalysisState({
        graph: null,
        files: [],
        metadata: { version: 1 },
      });

      const state2 = new AnalysisState({
        graph: null,
        files: [],
        metadata: { version: 2 },
      });

      expect(state1.equals(state2)).toBe(false);
    });
  });

  describe('AnalysisStateBuilder - builder pattern', () => {
    it('builds state incrementally', () => {
      const builder = new AnalysisStateBuilder();

      const state = builder
        .setFiles(['file1.ts', 'file2.ts'])
        .setMetadata({ version: 1 })
        .build();

      expect(state.files).toEqual(['file1.ts', 'file2.ts']);
      expect(state.metadata).toEqual({ version: 1 });
    });

    it('allows setting graph', () => {
      const builder = new AnalysisStateBuilder();
      const mockGraph = { nodes: [], edges: [] };

      const state = builder.setGraph(mockGraph as any).build();

      expect(state.graph).toBe(mockGraph);
    });

    it('creates empty state if nothing set', () => {
      const builder = new AnalysisStateBuilder();
      const state = builder.build();

      expect(state.graph).toBeNull();
      expect(state.files).toEqual([]);
      expect(state.metadata).toEqual({});
    });
  });
});
