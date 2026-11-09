/**
 * Command Orchestrator - Compose commands into workflows
 *
 * Key features:
 * - Execute single commands
 * - Compose multiple commands into workflows
 * - Sequential execution with state threading
 * - Error handling and recovery
 * - Execution history tracking
 * - Predefined workflows
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - "Command orchestrator for composition"
 */

import { Command, CommandResult } from './index';
import { AnalysisState } from '../state/analysis-state';
import { XrayError } from '../error/types';

/**
 * Workflow definition
 */
export interface Workflow {
  /**
   * Workflow name
   */
  name: string;

  /**
   * Commands to execute in sequence
   */
  commands: Command[];

  /**
   * Description (optional)
   */
  description?: string;
}

/**
 * Workflow execution result
 */
export interface WorkflowResult {
  /**
   * Whether workflow succeeded
   */
  success: boolean;

  /**
   * Final state after all commands
   */
  finalState: AnalysisState;

  /**
   * Number of steps executed
   */
  stepsExecuted: number;

  /**
   * Errors encountered
   */
  errors: XrayError[];

  /**
   * Whether workflow had partial success
   */
  partialSuccess?: boolean;

  /**
   * Execution metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Execution history entry
 */
export interface HistoryEntry {
  /**
   * Command name
   */
  command: string;

  /**
   * Whether command succeeded
   */
  success: boolean;

  /**
   * Execution duration in milliseconds
   */
  duration: number;

  /**
   * Timestamp
   */
  timestamp: number;

  /**
   * Error if failed
   */
  error?: XrayError;
}

/**
 * Orchestrator options
 */
export interface OrchestratorOptions {
  /**
   * Continue executing commands even if one fails
   * Default: false
   */
  continueOnError?: boolean;

  /**
   * Track execution history
   * Default: true
   */
  trackHistory?: boolean;
}

/**
 * CommandOrchestrator manages command execution and composition
 *
 * Usage:
 * ```typescript
 * const orchestrator = new CommandOrchestrator();
 *
 * // Execute single command
 * const result = await orchestrator.execute(command, state);
 *
 * // Execute workflow
 * const workflow = {
 *   name: 'full-analysis',
 *   commands: [scanCmd, parseCmd, buildCmd, rankCmd],
 * };
 * const workflowResult = await orchestrator.executeWorkflow(workflow, state);
 * ```
 */
export class CommandOrchestrator {
  private options: Required<OrchestratorOptions>;
  private history: HistoryEntry[] = [];

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      continueOnError: options.continueOnError ?? false,
      trackHistory: options.trackHistory ?? true,
    };
  }

  /**
   * Execute single command
   */
  async execute(
    command: Command,
    state: AnalysisState
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const result = await command.execute(state);
    const duration = Date.now() - startTime;

    // Track history
    if (this.options.trackHistory) {
      this.history.push({
        command: command.constructor.name,
        success: result.success,
        duration,
        timestamp: Date.now(),
        error: result.error,
      });
    }

    return {
      success: result.success,
      finalState: result.state,
      stepsExecuted: 1,
      errors: result.error ? [result.error] : [],
    };
  }

  /**
   * Execute workflow (multiple commands in sequence)
   */
  async executeWorkflow(
    workflow: Workflow,
    initialState: AnalysisState
  ): Promise<WorkflowResult> {
    let currentState = initialState;
    let stepsExecuted = 0;
    const errors: XrayError[] = [];

    for (const command of workflow.commands) {
      const startTime = Date.now();
      const result = await command.execute(currentState);
      const duration = Date.now() - startTime;

      stepsExecuted++;

      // Track history
      if (this.options.trackHistory) {
        this.history.push({
          command: command.constructor.name,
          success: result.success,
          duration,
          timestamp: Date.now(),
          error: result.error,
        });
      }

      if (result.success) {
        // Update state for next command
        currentState = result.state;
      } else {
        // Command failed
        if (result.error) {
          errors.push(result.error);
        }

        if (!this.options.continueOnError) {
          // Stop execution
          return {
            success: false,
            finalState: currentState,
            stepsExecuted,
            errors,
          };
        }

        // Continue with existing state
      }
    }

    // All commands executed
    const success = errors.length === 0;
    const partialSuccess = errors.length > 0 && stepsExecuted === workflow.commands.length;

    return {
      success,
      finalState: currentState,
      stepsExecuted,
      errors,
      partialSuccess,
    };
  }

  /**
   * Get execution history
   */
  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * Clear execution history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Get predefined standard workflow
   */
  getStandardWorkflow(type: 'scan' | 'analysis' | 'rank'): Workflow {
    const { ScanFilesCommand, ParseFilesCommand, BuildGraphCommand, RankNodesCommand } =
      require('./index');

    switch (type) {
      case 'scan':
        return {
          name: 'scan-workflow',
          description: 'Scan files in directory',
          commands: [
            new ScanFilesCommand({
              rootDir: process.cwd(),
              patterns: ['**/*.ts', '**/*.js'],
              exclude: ['**/node_modules/**', '**/dist/**'],
            }),
          ],
        };

      case 'analysis':
        return {
          name: 'full-analysis-workflow',
          description: 'Complete analysis workflow',
          commands: [
            new ScanFilesCommand({
              rootDir: process.cwd(),
              patterns: ['**/*.ts', '**/*.js'],
              exclude: ['**/node_modules/**', '**/dist/**'],
            }),
            new ParseFilesCommand({
              language: 'typescript',
            }),
            new BuildGraphCommand(),
          ],
        };

      case 'rank':
        return {
          name: 'rank-workflow',
          description: 'Build graph and rank nodes',
          commands: [
            new BuildGraphCommand(),
            new RankNodesCommand({
              algorithm: 'pagerank',
            }),
          ],
        };

      default:
        throw new Error(`Unknown workflow type: ${type}`);
    }
  }
}
