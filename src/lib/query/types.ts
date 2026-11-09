import type { Confidence } from '../../types/graph';
import type { Cfg, Dfg } from '../flow/types';

/**
 * Import specification for a module
 */
export interface Import {
  source: string;
  specifier: 'default' | 'named' | 'namespace';
  as: string;
}

/**
 * Serialized node in the graph
 */
export interface SerializedNode {
  id: string;
  type: 'file' | 'tag';
  label: string;
  kind?: string;
  file?: string;
  line?: number;
  endLine?: number;
  signature?: string;
  doc?: string;
  rank?: number;
  imports?: Import[];
  /**
   * Unresolved references of a tag (raw parser form). Only on per-root
   * graphs serialized for a multi-root merge; stripped from merged output.
   */
  references?: string[];
  /** Control flow graph of a function/method; only with `--with cf` (graph, or map with cf). */
  cfg?: Cfg;
  /** Data flow graph of a function/method; only with `--with df`. */
  dfg?: Dfg;
}

/**
 * Serialized edge in the graph
 */
export interface SerializedEdge {
  source: string;
  target: string;
  type: 'defines' | 'calls' | 'imports';
  /**
   * Edge provenance tag. Optional on the serialized side because older
   * cached graphs may lack it; new scans always populate it via
   * GraphBuilder (see Confidence in src/types/graph.ts).
   */
  confidence?: Confidence;
  community?: string;
  /** Calls edge created by the cross-root pass of a merged multi-root graph. */
  crossRoot?: boolean;
  // Index signature is `any` (not `unknown`) because plugins extend edges
  // with arbitrary attributes; tightening to `unknown` would force every
  // existing consumer to type-narrow. Declared keys above stay typed.
  [key: string]: any;
}

/**
 * Serialized graph format (single source of truth for graph persistence)
 * This schema is used by both:
 * - Query system (xray query --graph)
 * - CQRS system (xray map --format json)
 */
export interface SerializedGraph {
  metadata: {
    version: string;
    timestamp: string;
    projectPath: string;
    nodeCount: number;
    edgeCount: number;
    /**
     * Present only on merged multi-root graphs. Every node id (and
     * `file`) in such a graph is prefixed `<label>/`; this maps each label
     * to the absolute root it came from.
     */
    roots?: Array<{ label: string; path: string }>;
  };
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

/**
 * Result of a query operation
 */
export interface QueryResult {
  nodes: Array<{
    id: string;
    name: string;
    file?: string;
    line?: number;
    kind?: string;
    depth?: number;
    score?: number;
    /** Tree-view suffix after the location, e.g. `inferred` -> ` (inferred)`. */
    note?: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
  }>;
  metadata: {
    syntax: string;
    queryType: string;
    executionTime: number;
    resultCount: number;
  };
}

/**
 * Query adapter interface for plugin architecture
 */
export interface QueryAdapter {
  name: string;
  syntax: string;

  /**
   * Return true if this adapter can parse the query
   */
  canParse(query: string): boolean;

  /**
   * Parse and execute the query against the graph
   */
  execute(query: string, graph: any): QueryResult;
}
