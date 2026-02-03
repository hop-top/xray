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
}

/**
 * Serialized edge in the graph
 */
export interface SerializedEdge {
  source: string;
  target: string;
  type: 'defines' | 'calls';
}

/**
 * Serialized graph format (single source of truth for graph persistence)
 * This schema is used by both:
 * - Query system (xray query --graph)
 * - CQRS system (xray map --save-graph)
 */
export interface SerializedGraph {
  metadata: {
    version: string;
    timestamp: string;
    projectPath: string;
    nodeCount: number;
    edgeCount: number;
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
