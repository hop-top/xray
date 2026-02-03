/**
 * Queries - State reading operations for CQRS pattern
 *
 * Key features:
 * - Queries read state without modification
 * - Queries are idempotent
 * - Queries can compose/transform data
 * - Queries work with serialized state
 * - Queries never mutate state
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - "Commands mutate state, queries read state (never mixed)"
 */

import { AnalysisState } from '../state/analysis-state';
import { XrayError } from '../error/types';

/**
 * Query result
 */
export interface QueryResult<T = any> {
  /**
   * Whether query succeeded
   */
  success: boolean;

  /**
   * Query result data
   */
  data: T;

  /**
   * Error (only present on failure)
   */
  error?: XrayError;

  /**
   * Additional metadata about execution
   */
  metadata?: Record<string, any>;
}

/**
 * Base query interface
 */
export interface Query<TResult = any> {
  /**
   * Execute query and return data
   */
  execute(state: AnalysisState): QueryResult<TResult>;
}

/**
 * Options for GetFilesQuery
 */
export interface GetFilesOptions {
  pattern?: string;
}

/**
 * GetFilesQuery - Get files list from state
 */
export class GetFilesQuery implements Query<string[]> {
  constructor(private options: GetFilesOptions = {}) {}

  execute(state: AnalysisState): QueryResult<string[]> {
    let files = [...state.files];

    // Filter by pattern if provided
    if (this.options.pattern) {
      const pattern = this.options.pattern;
      files = files.filter((file) => {
        // Simple glob matching (*.test.ts -> ends with .test.ts)
        if (pattern.startsWith('*')) {
          const suffix = pattern.substring(1);
          return file.endsWith(suffix);
        }
        return file.includes(pattern);
      });
    }

    return {
      success: true,
      data: files,
    };
  }
}

/**
 * Options for GetGraphQuery
 */
export interface GetGraphOptions {
  nodeType?: string;
}

/**
 * GetGraphQuery - Get graph from state
 */
export class GetGraphQuery implements Query<any> {
  constructor(private options: GetGraphOptions = {}) {}

  execute(state: AnalysisState): QueryResult<any> {
    if (!state.graph) {
      return {
        success: true,
        data: null,
      };
    }

    let graph = state.graph;

    // Filter by node type if provided
    if (this.options.nodeType) {
      const nodeType = this.options.nodeType;
      graph = {
        ...graph,
        nodes: graph.nodes.filter((node: any) => node.type === nodeType),
      };
    }

    return {
      success: true,
      data: graph,
    };
  }
}

/**
 * Options for GetNodeRanksQuery
 */
export interface GetNodeRanksOptions {
  sort?: boolean;
  limit?: number;
}

/**
 * GetNodeRanksQuery - Get node ranks from metadata
 */
export class GetNodeRanksQuery implements Query<Record<string, number>> {
  constructor(private options: GetNodeRanksOptions = {}) {}

  execute(state: AnalysisState): QueryResult<Record<string, number>> {
    const ranks = (state.metadata as any).ranks || {};

    if (!this.options.sort) {
      return {
        success: true,
        data: { ...ranks },
      };
    }

    // Sort by rank value (descending)
    const entries = Object.entries(ranks) as [string, number][];
    entries.sort((a, b) => b[1] - a[1]);

    // Limit if specified
    const limited = this.options.limit
      ? entries.slice(0, this.options.limit)
      : entries;

    const sorted: Record<string, number> = {};
    for (const [key, value] of limited) {
      sorted[key] = value;
    }

    return {
      success: true,
      data: sorted,
    };
  }
}

/**
 * Options for SearchNodesQuery
 */
export interface SearchNodesOptions {
  query: string;
  caseSensitive?: boolean;
  limit?: number;
}

/**
 * SearchNodesQuery - Search nodes by query string
 */
export class SearchNodesQuery implements Query<any[]> {
  constructor(private options: SearchNodesOptions) {}

  execute(state: AnalysisState): QueryResult<any[]> {
    if (!state.graph || !state.graph.nodes) {
      return {
        success: true,
        data: [],
      };
    }

    const query = this.options.caseSensitive
      ? this.options.query
      : this.options.query.toLowerCase();

    const matches = state.graph.nodes.filter((node: any) => {
      const searchText = this.options.caseSensitive
        ? (node.name || node.id)
        : (node.name || node.id).toLowerCase();

      return searchText.includes(query);
    });

    // Limit if specified
    const limited = this.options.limit
      ? matches.slice(0, this.options.limit)
      : matches;

    return {
      success: true,
      data: limited,
    };
  }
}

/**
 * Statistics result
 */
export interface Statistics {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  metadataKeys: string[];
  hasGraph: boolean;
}

/**
 * GetStatisticsQuery - Get statistics about state
 */
export class GetStatisticsQuery implements Query<Statistics> {
  execute(state: AnalysisState): QueryResult<Statistics> {
    const stats: Statistics = {
      fileCount: state.files.length,
      nodeCount: state.graph ? state.graph.nodes.length : 0,
      edgeCount: state.graph ? state.graph.edges.length : 0,
      metadataKeys: Object.keys(state.metadata),
      hasGraph: state.graph !== null,
    };

    return {
      success: true,
      data: stats,
    };
  }
}
