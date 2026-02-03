/**
 * CQRS Phase 4: Command Orchestrator Tests
 *
 * Testing command composition and orchestration
 *
 * Key behaviors:
 * - Compose multiple commands into workflows
 * - Execute commands sequentially
 * - Handle command failures gracefully
 * - Track execution history
 * - Support conditional execution
 * - Emit events for command execution
 */

import {
  CommandOrchestrator,
  Workflow,
  WorkflowResult,
} from '../../src/lib/commands/orchestrator';
import {
  ScanFilesCommand,
  ParseFilesCommand,
  BuildGraphCommand,
  RankNodesCommand,
} from '../../src/lib/commands';
import { AnalysisState } from '../../src/lib/state/analysis-state';

describe('CommandOrchestrator', () => {
  describe('execute() - single command', () => {
    it('executes single command', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const command = new ScanFilesCommand({
        rootDir: process.cwd(),
        patterns: ['*.ts'],
      });

      const result = await orchestrator.execute(command, initialState);

      expect(result.success).toBe(true);
      expect(result.finalState).toBeInstanceOf(AnalysisState);
    });

    it('returns final state after execution', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const command = new ScanFilesCommand({
        rootDir: process.cwd(),
        patterns: ['package.json'],
      });

      const result = await orchestrator.execute(command, initialState);

      expect(result.finalState).not.toBe(initialState);
      expect(result.finalState.files.length).toBeGreaterThan(0);
    });

    it('handles command errors', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      // Command that will fail
      const command = new BuildGraphCommand();

      const result = await orchestrator.execute(command, initialState);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('executeWorkflow() - multiple commands', () => {
    it('executes commands sequentially', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'scan-and-parse',
        commands: [
          new ScanFilesCommand({
            rootDir: process.cwd(),
            patterns: ['package.json'],
          }),
          new ParseFilesCommand({
            language: 'json',
          }),
        ],
      };

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(2);
    });

    it('threads state through commands', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'full-analysis',
        commands: [
          new ScanFilesCommand({
            rootDir: process.cwd(),
            patterns: ['package.json'],
          }),
          new ParseFilesCommand({ language: 'json' }),
        ],
      };

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      // Each command should receive state from previous
      expect(result.finalState.files.length).toBeGreaterThan(0);
      expect(result.finalState.metadata.parsed).toBeDefined();
    });

    it('stops on command failure by default', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'failing-workflow',
        commands: [
          new BuildGraphCommand(), // Will fail (no parsed data)
          new RankNodesCommand({ algorithm: 'pagerank' }), // Should not execute
        ],
      };

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result.success).toBe(false);
      expect(result.stepsExecuted).toBe(1); // Stopped after first failure
      expect(result.errors).toHaveLength(1);
    });

    it('continues on failure if continueOnError is true', async () => {
      const orchestrator = new CommandOrchestrator({
        continueOnError: true,
      });

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'resilient-workflow',
        commands: [
          new BuildGraphCommand(), // Will fail
          new ScanFilesCommand({
            rootDir: process.cwd(),
            patterns: ['package.json'],
          }), // Should still execute
        ],
      };

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result.stepsExecuted).toBe(2);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.partialSuccess).toBe(true);
    });
  });

  describe('execution history', () => {
    it('tracks execution history', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const command = new ScanFilesCommand({
        rootDir: process.cwd(),
        patterns: ['package.json'],
      });

      await orchestrator.execute(command, initialState);

      const history = orchestrator.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].command).toBe('ScanFilesCommand');
      expect(history[0].success).toBe(true);
    });

    it('tracks workflow execution', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'test-workflow',
        commands: [
          new ScanFilesCommand({
            rootDir: process.cwd(),
            patterns: ['package.json'],
          }),
          new ParseFilesCommand({ language: 'json' }),
        ],
      };

      await orchestrator.executeWorkflow(workflow, initialState);

      const history = orchestrator.getHistory();

      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('includes execution time', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const command = new ScanFilesCommand({
        rootDir: process.cwd(),
        patterns: ['package.json'],
      });

      await orchestrator.execute(command, initialState);

      const history = orchestrator.getHistory();

      expect(history[0].duration).toBeDefined();
      expect(typeof history[0].duration).toBe('number');
      expect(history[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('can clear history', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const command = new ScanFilesCommand({
        rootDir: process.cwd(),
        patterns: ['package.json'],
      });

      await orchestrator.execute(command, initialState);
      expect(orchestrator.getHistory()).toHaveLength(1);

      orchestrator.clearHistory();
      expect(orchestrator.getHistory()).toHaveLength(0);
    });
  });

  describe('workflow result', () => {
    it('includes success flag', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
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

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('includes final state', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
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

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result).toHaveProperty('finalState');
      expect(result.finalState).toBeInstanceOf(AnalysisState);
    });

    it('includes steps executed count', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
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
          new ParseFilesCommand({ language: 'json' }),
        ],
      };

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result).toHaveProperty('stepsExecuted');
      expect(result.stepsExecuted).toBeGreaterThan(0);
    });

    it('includes errors array', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow: Workflow = {
        name: 'test',
        commands: [new BuildGraphCommand()],
      };

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe('predefined workflows', () => {
    it('provides standard analysis workflow', () => {
      const orchestrator = new CommandOrchestrator();

      const workflow = orchestrator.getStandardWorkflow('analysis');

      expect(workflow).toBeDefined();
      expect(workflow.name).toContain('analysis');
      expect(workflow.commands.length).toBeGreaterThan(0);
    });

    it('standard workflow executes successfully', async () => {
      const orchestrator = new CommandOrchestrator();

      const initialState = new AnalysisState({
        graph: null,
        files: [],
        metadata: {},
      });

      const workflow = orchestrator.getStandardWorkflow('scan');

      const result = await orchestrator.executeWorkflow(workflow, initialState);

      expect(result.success).toBe(true);
    });
  });
});
