/**
 * CQRS Index Exports Tests
 *
 * Testing that all CQRS components are properly exported
 * and can be imported from the main index module
 */

import {
  // State
  AnalysisState,
  AnalysisStateBuilder,
  StateSnapshot,
  PartialState,
  // Commands
  Command,
  CommandResult,
  ScanFilesCommand,
  ScanFilesOptions,
  ParseFilesCommand,
  ParseFilesOptions,
  BuildGraphCommand,
  RankNodesCommand,
  RankNodesOptions,
  // Orchestrator
  CommandOrchestrator,
  OrchestratorOptions,
  Workflow,
  WorkflowResult,
  HistoryEntry,
  // Queries
  Query,
  QueryResult,
  GetFilesQuery,
  GetFilesOptions,
  GetGraphQuery,
  GetGraphOptions,
  GetNodeRanksQuery,
  GetNodeRanksOptions,
  SearchNodesQuery,
  SearchNodesOptions,
  GetStatisticsQuery,
  Statistics,
} from '../../src/lib/cqrs';

describe('CQRS Index Exports', () => {
  describe('State', () => {
    it('exports AnalysisState class', () => {
      expect(AnalysisState).toBeDefined();
      expect(typeof AnalysisState).toBe('function');
    });

    it('exports AnalysisStateBuilder class', () => {
      expect(AnalysisStateBuilder).toBeDefined();
      expect(typeof AnalysisStateBuilder).toBe('function');
    });

    it('can instantiate AnalysisState', () => {
      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });
      expect(state).toBeInstanceOf(AnalysisState);
    });

    it('can use AnalysisStateBuilder', () => {
      const builder = new AnalysisStateBuilder();
      const state = builder
        .setFiles(['file1.ts'])
        .setMetadata({ version: 1 })
        .build();

      expect(state).toBeInstanceOf(AnalysisState);
      expect(state.files).toEqual(['file1.ts']);
    });
  });

  describe('Commands', () => {
    it('exports command classes', () => {
      expect(ScanFilesCommand).toBeDefined();
      expect(ParseFilesCommand).toBeDefined();
      expect(BuildGraphCommand).toBeDefined();
      expect(RankNodesCommand).toBeDefined();
    });

    it('can instantiate commands', () => {
      const scanCmd = new ScanFilesCommand({
        rootDir: '/test',
        patterns: ['*.ts'],
      });
      const parseCmd = new ParseFilesCommand({
        language: 'typescript',
      });
      const buildCmd = new BuildGraphCommand();
      const rankCmd = new RankNodesCommand({
        algorithm: 'pagerank',
      });

      expect(scanCmd).toBeInstanceOf(ScanFilesCommand);
      expect(parseCmd).toBeInstanceOf(ParseFilesCommand);
      expect(buildCmd).toBeInstanceOf(BuildGraphCommand);
      expect(rankCmd).toBeInstanceOf(RankNodesCommand);
    });

    it('commands have execute method', async () => {
      const command = new ScanFilesCommand({
        rootDir: process.cwd(),
        patterns: ['package.json'],
      });

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const result = await command.execute(state);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('state');
    });
  });

  describe('CommandOrchestrator', () => {
    it('exports CommandOrchestrator class', () => {
      expect(CommandOrchestrator).toBeDefined();
      expect(typeof CommandOrchestrator).toBe('function');
    });

    it('can instantiate CommandOrchestrator', () => {
      const orchestrator = new CommandOrchestrator();
      expect(orchestrator).toBeInstanceOf(CommandOrchestrator);
    });

    it('can execute workflow', async () => {
      const orchestrator = new CommandOrchestrator();

      const state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'test',
        commands: [
          new ScanFilesCommand({
            rootDir: process.cwd(),
            patterns: ['package.json'],
          }),
        ],
      };

      const result = await orchestrator.executeWorkflow(workflow, state);

      expect(result.success).toBe(true);
      expect(result.finalState).toBeInstanceOf(AnalysisState);
    });
  });

  describe('Queries', () => {
    it('exports query classes', () => {
      expect(GetFilesQuery).toBeDefined();
      expect(GetGraphQuery).toBeDefined();
      expect(GetNodeRanksQuery).toBeDefined();
      expect(SearchNodesQuery).toBeDefined();
      expect(GetStatisticsQuery).toBeDefined();
    });

    it('can instantiate queries', () => {
      const filesQuery = new GetFilesQuery();
      const graphQuery = new GetGraphQuery();
      const ranksQuery = new GetNodeRanksQuery();
      const searchQuery = new SearchNodesQuery({ query: 'test' });
      const statsQuery = new GetStatisticsQuery();

      expect(filesQuery).toBeInstanceOf(GetFilesQuery);
      expect(graphQuery).toBeInstanceOf(GetGraphQuery);
      expect(ranksQuery).toBeInstanceOf(GetNodeRanksQuery);
      expect(searchQuery).toBeInstanceOf(SearchNodesQuery);
      expect(statsQuery).toBeInstanceOf(GetStatisticsQuery);
    });

    it('queries have execute method', () => {
      const query = new GetFilesQuery();

      const state = new AnalysisState({
        graph: null,
        files: ['file1.ts', 'file2.ts'],
        metadata: {},
      });

      const result = query.execute(state);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('data');
    });
  });

  describe('Integration - Using exported components together', () => {
    it('can build state, execute commands, and run queries', async () => {
      // Build initial state
      const state = new AnalysisStateBuilder()
        .setFiles(['file1.ts', 'file2.ts'])
        .setMetadata({ version: 1 })
        .build();

      // Execute command
      const parseCmd = new ParseFilesCommand({
        language: 'typescript',
      });

      const cmdResult = await parseCmd.execute(state);
      expect(cmdResult.success).toBe(true);

      // Run query
      const filesQuery = new GetFilesQuery();
      const queryResult = filesQuery.execute(cmdResult.state);

      expect(queryResult.success).toBe(true);
      expect(queryResult.data).toEqual(['file1.ts', 'file2.ts']);
    });

    it('can orchestrate workflow and query results', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'scan-and-stats',
        commands: [
          new ScanFilesCommand({
            rootDir: process.cwd(),
            patterns: ['package.json'],
          }),
        ],
      };

      const workflowResult = await orchestrator.executeWorkflow(
        workflow,
        initialState
      );

      expect(workflowResult.success).toBe(true);

      // Query the final state
      const statsQuery = new GetStatisticsQuery();
      const stats = statsQuery.execute(workflowResult.finalState);

      expect(stats.success).toBe(true);
      expect(stats.data.fileCount).toBeGreaterThan(0);
    });

    it('demonstrates command-query separation', async () => {
      let state = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      // Command mutates state
      const command = new ScanFilesCommand({
        rootDir: process.cwd(),
        patterns: ['package.json'],
      });

      const cmdResult = await command.execute(state);
      const newState = cmdResult.state;

      expect(newState).not.toBe(state);
      expect(newState.files.length).toBeGreaterThan(0);

      // Query reads state without mutation
      const query = new GetFilesQuery();
      const stateBefore = newState.toSnapshot();

      query.execute(newState);

      const stateAfter = newState.toSnapshot();
      expect(stateAfter).toEqual(stateBefore);
    });
  });
});
