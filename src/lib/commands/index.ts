/**
 * Commands - State mutation operations for CQRS pattern
 *
 * Key features:
 * - Commands mutate state (return new state)
 * - Commands never query/read state for decisions
 * - Single responsibility per command
 * - Integrate with error handling
 * - Support collect-and-continue pattern
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - "Commands mutate state, queries read state (never mixed)"
 */

import { AnalysisState } from '../state/analysis-state';
import { XrayError } from '../error/types';
import { glob } from 'glob';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Command result
 */
export interface CommandResult<T = AnalysisState> {
  /**
   * Whether command succeeded
   */
  success: boolean;

  /**
   * New state (always present, may be unchanged on error)
   */
  state: T;

  /**
   * Error (only present on failure)
   */
  error?: XrayError;

  /**
   * Whether operation had partial success
   */
  partialSuccess?: boolean;

  /**
   * Additional metadata about execution
   */
  metadata?: Record<string, any>;
}

/**
 * Base command interface
 */
export interface Command<TState = AnalysisState> {
  /**
   * Execute command and return new state
   */
  execute(state: TState): Promise<CommandResult<TState>>;
}

/**
 * Options for ScanFilesCommand
 */
export interface ScanFilesOptions {
  rootDir: string;
  patterns: string[];
  exclude?: string[];
}

/**
 * ScanFilesCommand - Scan filesystem for files
 *
 * Mutates state by updating files list
 */
export class ScanFilesCommand implements Command {
  constructor(private options: ScanFilesOptions) {}

  async execute(state: AnalysisState): Promise<CommandResult> {
    try {
      const files: string[] = [];

      // Scan for each pattern
      for (const pattern of this.options.patterns) {
        const matchedFiles = await glob(pattern, {
          cwd: this.options.rootDir,
          ignore: this.options.exclude || [],
          absolute: false,
        });

        files.push(...matchedFiles);
      }

      // Remove duplicates
      const uniqueFiles = Array.from(new Set(files));

      // Update state with scanned files
      const newState = state.withFiles(uniqueFiles);

      return {
        success: true,
        state: newState,
        metadata: {
          filesScanned: uniqueFiles.length,
        },
      };
    } catch (error) {
      // Return error but preserve state
      return {
        success: false,
        state,
        error: error instanceof XrayError
          ? error
          : new (require('../error/types').UnknownError)(
              error instanceof Error ? error.message : 'Scan failed'
            ),
      };
    }
  }
}

/**
 * Options for ParseFilesCommand
 */
export interface ParseFilesOptions {
  language: string;
  parserOptions?: Record<string, any>;
}

/**
 * ParseFilesCommand - Parse source files
 *
 * Mutates state by updating metadata with parse results
 */
export class ParseFilesCommand implements Command {
  constructor(private options: ParseFilesOptions) {}

  async execute(state: AnalysisState): Promise<CommandResult> {
    try {
      const files = state.files as string[];

      if (files.length === 0) {
        // No files to parse - not an error
        return {
          success: true,
          state: state.withMetadata({
            ...state.metadata,
            parsed: {},
          }),
        };
      }

      // Mock parsing for now (would integrate with actual parser)
      const parsed: Record<string, any> = {};
      let successCount = 0;
      let errorCount = 0;

      for (const file of files) {
        try {
          // Placeholder: would actually parse file
          parsed[file] = {
            ast: {},
            symbols: [],
          };
          successCount++;
        } catch (error) {
          errorCount++;
          // Collect-and-continue: record error but keep processing
        }
      }

      const newState = state.withMetadata({
        ...state.metadata,
        parsed,
        parseStats: {
          total: files.length,
          success: successCount,
          errors: errorCount,
        },
      });

      return {
        success: true,
        state: newState,
        partialSuccess: errorCount > 0,
        metadata: {
          filesProcessed: files.length,
          successCount,
          errorCount,
        },
      };
    } catch (error) {
      return {
        success: false,
        state,
        error: error instanceof XrayError
          ? error
          : new (require('../error/types').UnknownError)(
              error instanceof Error ? error.message : 'Parse failed'
            ),
      };
    }
  }
}

/**
 * BuildGraphCommand - Build dependency graph
 *
 * Mutates state by setting graph
 */
export class BuildGraphCommand implements Command {
  async execute(state: AnalysisState): Promise<CommandResult> {
    try {
      const parsed = (state.metadata as any).parsed;

      if (!parsed) {
        return {
          success: false,
          state,
          error: new (require('../error/types').GraphBuildError)(
            'No parsed data available. Run ParseFilesCommand first.'
          ),
        };
      }

      // Mock graph building (would integrate with actual graph builder)
      const graph = {
        nodes: Object.keys(parsed).map((file) => ({
          id: file,
          type: 'file',
        })),
        edges: [],
      };

      const newState = state.withGraph(graph);

      return {
        success: true,
        state: newState,
        metadata: {
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        state,
        error: error instanceof XrayError
          ? error
          : new (require('../error/types').GraphBuildError)(
              error instanceof Error ? error.message : 'Graph build failed'
            ),
      };
    }
  }
}

/**
 * Options for RankNodesCommand
 */
export interface RankNodesOptions {
  algorithm: 'pagerank' | 'betweenness' | 'closeness';
}

/**
 * RankNodesCommand - Rank nodes in graph
 *
 * Mutates state by updating metadata with ranks
 */
export class RankNodesCommand implements Command {
  constructor(private options: RankNodesOptions) {}

  async execute(state: AnalysisState): Promise<CommandResult> {
    try {
      if (!state.graph) {
        return {
          success: false,
          state,
          error: new (require('../error/types').RankError)(
            'No graph available. Run BuildGraphCommand first.'
          ),
        };
      }

      // Mock ranking (would integrate with actual ranking algorithm)
      const ranks: Record<string, number> = {};

      for (const node of state.graph.nodes) {
        ranks[node.id] = Math.random(); // Placeholder
      }

      const newState = state.withMetadata({
        ...state.metadata,
        ranks,
        rankAlgorithm: this.options.algorithm,
      });

      return {
        success: true,
        state: newState,
        metadata: {
          nodesRanked: Object.keys(ranks).length,
          algorithm: this.options.algorithm,
        },
      };
    } catch (error) {
      return {
        success: false,
        state,
        error: error instanceof XrayError
          ? error
          : new (require('../error/types').RankError)(
              error instanceof Error ? error.message : 'Ranking failed'
            ),
      };
    }
  }
}
