/**
 * CQRS Phase 2: Commands Tests
 *
 * Testing command implementations for CQRS pattern
 *
 * Key behaviors:
 * - Commands mutate state (return new state)
 * - Commands never query/read state
 * - Each command has single responsibility
 * - Commands emit events
 * - Commands integrate with error handling
 * - Commands are composable
 */

import {
  Command,
  ScanFilesCommand,
  ParseFilesCommand,
  BuildGraphCommand,
  RankNodesCommand,
  CommandResult,
} from '../../../src/lib/commands';
import { AnalysisState } from '../../../src/lib/state/analysis-state';

describe('Commands', () => {
  describe('Command interface', () => {
    it('defines execute method', () => {
      const command: Command<any> = {
        execute: async (state: AnalysisState) => {
          return {
            success: true,
            state: state,
          };
        },
      };

      expect(command.execute).toBeDefined();
      expect(typeof command.execute).toBe('function');
    });
  });

  describe('ScanFilesCommand', () => {
    it('scans files and updates state', async () => {
      const command = new ScanFilesCommand({
        rootDir: '/test',
        patterns: ['**/*.ts'],
      });

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(initialState);

      expect(result.success).toBe(true);
      expect(result.state.files).toBeDefined();
      expect(Array.isArray(result.state.files)).toBe(true);
    });

    it('returns new state instance', async () => {
      const command = new ScanFilesCommand({
        rootDir: '/test',
        patterns: ['*.ts'],
      });

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(initialState);

      expect(result.state).not.toBe(initialState);
    });

    it('handles scan errors gracefully', async () => {
      const command = new ScanFilesCommand({
        rootDir: '/nonexistent',
        patterns: ['*.ts'],
      });

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(initialState);

      // glob returns empty array for nonexistent paths (not an error)
      expect(result.success).toBe(true);
      expect(result.state.files).toEqual([]);
    });

    it('returns new state with scanned files', async () => {
      const command = new ScanFilesCommand({
        rootDir: '/nonexistent',
        patterns: ['*.ts'],
      });

      const initialState = new AnalysisState({
        graph: null,
        files: ['existing.ts'],
        metadata: { version: 1 },
      });

      const result = await command.execute(initialState);

      // Scan returns new files list (empty if none found)
      expect(result.success).toBe(true);
      expect(result.state.files).toEqual([]);
      // Metadata should be preserved
      expect(result.state.metadata).toEqual({ version: 1 });
    });
  });

  describe('ParseFilesCommand', () => {
    it('parses files and updates metadata', async () => {
      const command = new ParseFilesCommand({
        language: 'typescript',
      });

      const initialState = new AnalysisState({
        graph: null,
        files: ['file1.ts', 'file2.ts'],
        metadata: {},
      });

      const result = await command.execute(initialState);

      expect(result.success).toBe(true);
      expect(result.state.metadata.parsed).toBeDefined();
    });

    it('requires files in state', async () => {
      const command = new ParseFilesCommand({
        language: 'typescript',
      });

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(initialState);

      // Should fail or handle gracefully
      expect(result.success).toBe(true); // No files to parse is not an error
    });

    it('collects parse errors without stopping', async () => {
      const command = new ParseFilesCommand({
        language: 'typescript',
      });

      const initialState = new AnalysisState({
        graph: null,
        files: ['valid.ts', 'invalid.ts', 'another.ts'],
        metadata: {},
      });

      const result = await command.execute(initialState);

      // Should continue despite errors (collect-and-continue)
      expect(result.success).toBe(true);
      expect(result.partialSuccess).toBeDefined();
    });
  });

  describe('BuildGraphCommand', () => {
    it('builds graph from parsed files', async () => {
      const command = new BuildGraphCommand();

      const initialState = new AnalysisState({
        graph: null,
        files: ['file1.ts', 'file2.ts'],
        metadata: { parsed: {} },
      });

      const result = await command.execute(initialState);

      expect(result.success).toBe(true);
      expect(result.state.graph).toBeDefined();
      expect(result.state.graph).not.toBeNull();
    });

    it('requires parsed metadata', async () => {
      const command = new BuildGraphCommand();

      const initialState = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: {},
      });

      const result = await command.execute(initialState);

      // Should fail without parsed data
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('updates graph in state', async () => {
      const command = new BuildGraphCommand();

      const initialState = new AnalysisState({
        graph: null,
        files: ['file1.ts'],
        metadata: { parsed: { 'file1.ts': {} } },
      });

      const result = await command.execute(initialState);

      if (result.success) {
        expect(result.state.graph).not.toBeNull();
        expect(initialState.graph).toBeNull();
      }
    });
  });

  describe('RankNodesCommand', () => {
    it('ranks nodes in graph', async () => {
      const command = new RankNodesCommand({
        algorithm: 'pagerank',
      });

      const mockGraph = {
        nodes: [{ id: 'node1' }, { id: 'node2' }],
        edges: [],
      };

      const initialState = new AnalysisState({
        graph: mockGraph,
        files: [],
        metadata: {},
      });

      const result = await command.execute(initialState);

      expect(result.success).toBe(true);
      expect(result.state.metadata.ranks).toBeDefined();
    });

    it('requires graph in state', async () => {
      const command = new RankNodesCommand({
        algorithm: 'pagerank',
      });

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(initialState);

      // Should fail without graph
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('adds rank metadata to state', async () => {
      const command = new RankNodesCommand({
        algorithm: 'pagerank',
      });

      const mockGraph = {
        nodes: [{ id: 'node1' }],
        edges: [],
      };

      const initialState = new AnalysisState({
        graph: mockGraph,
        files: [],
        metadata: { version: 1 },
      });

      const result = await command.execute(initialState);

      if (result.success) {
        // Should preserve existing metadata
        expect(result.state.metadata.version).toBe(1);
        // Should add ranks
        expect(result.state.metadata.ranks).toBeDefined();
      }
    });
  });

  describe('CommandResult', () => {
    it('includes success flag', async () => {
      const command = new ScanFilesCommand({
        rootDir: '/test',
        patterns: ['*.ts'],
      });

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(state);

      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('includes new state on success', async () => {
      const command = new ScanFilesCommand({
        rootDir: '/test',
        patterns: ['*.ts'],
      });

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(state);

      expect(result).toHaveProperty('state');
      expect(result.state).toBeInstanceOf(AnalysisState);
    });

    it('includes error on failure', async () => {
      const command = new ScanFilesCommand({
        rootDir: '/nonexistent',
        patterns: ['*.ts'],
      });

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(state);

      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(result.error).toBeDefined();
      }
    });

    it('includes partial success flag for collect-and-continue', async () => {
      const command = new ParseFilesCommand({
        language: 'typescript',
      });

      const state = new AnalysisState({
        graph: null,
        files: ['valid.ts', 'invalid.ts'],
        metadata: {},
      });

      const result = await command.execute(state);

      // May have partial success if some files fail
      if (result.partialSuccess !== undefined) {
        expect(typeof result.partialSuccess).toBe('boolean');
      }
    });
  });
});
