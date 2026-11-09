const Graph = require('graphology');
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../query/types';

/**
 * Well-known edge attribute keys that the serializer copies through
 * in both directions. Extend this list when adding new declared
 * attributes on SerializedEdge so the serializer stays in sync with
 * the type system rather than relying on ad-hoc memory.
 */
const WELL_KNOWN_EDGE_KEYS = ['type', 'confidence', 'community', 'crossRoot'] as const;

/**
 * GraphSerializer handles serialization and deserialization of graphology graphs
 * to/from the canonical SerializedGraph format.
 *
 * This ensures compatibility between:
 * - Query system (xray query --graph)
 * - CQRS system (xray map --format json)
 */
export class GraphSerializer {
  /**
   * Serialize a graphology graph to the canonical format. `references`
   * keeps each tag's unresolved references (input of the cross-root pass of
   * a multi-root merge); off by default, so map output never carries them.
   */
  serialize(graph: any, projectPath: string, opts: { references?: boolean } = {}): SerializedGraph {
    const nodes: SerializedNode[] = [];
    const edges: SerializedEdge[] = [];

    // Serialize nodes
    graph.forEachNode((nodeId: string, attrs: any) => {
      const node: SerializedNode = {
        id: nodeId,
        type: attrs.type,
        label: attrs.label,
      };

      // Add optional attributes if they exist
      if (attrs.kind !== undefined) node.kind = attrs.kind;
      if (attrs.file !== undefined) node.file = attrs.file;
      if (attrs.line !== undefined) node.line = attrs.line;
      if (attrs.endLine !== undefined) node.endLine = attrs.endLine;
      if (attrs.signature !== undefined) node.signature = attrs.signature;
      if (attrs.doc !== undefined) node.doc = attrs.doc;
      if (attrs.rank !== undefined) node.rank = attrs.rank;
      if (attrs.imports !== undefined) node.imports = attrs.imports;
      if (attrs.cfg !== undefined) node.cfg = attrs.cfg;
      if (attrs.dfg !== undefined) node.dfg = attrs.dfg;
      if (opts.references && Array.isArray(attrs.references) && attrs.references.length > 0) {
        node.references = [...attrs.references];
      }

      nodes.push(node);
    });

    // Serialize edges
    graph.forEachEdge((_: string, attrs: any, source: string, target: string) => {
      const edge: SerializedEdge = {
        source,
        target,
        type: attrs.type,
      };
      for (const key of WELL_KNOWN_EDGE_KEYS) {
        if (key === 'type') continue;
        if (attrs[key] !== undefined) edge[key] = attrs[key];
      }
      edges.push(edge);
    });

    return {
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString(),
        projectPath,
        nodeCount: graph.order,
        edgeCount: graph.size,
      },
      nodes,
      edges,
    };
  }

  /**
   * Deserialize a SerializedGraph back into a graphology graph.
   *
   * Constructs the graph with `{ multi: true, type: 'directed' }` to match
   * the producer (`GraphBuilder` in `src/lib/graph/builder.ts`). A default
   * graphology graph would throw on parallel edges between the same nodes
   * (e.g. when both `defines` and `imports` exist between two files).
   */
  deserialize(serialized: SerializedGraph): any {
    const graph = new Graph({ multi: true, type: 'directed' });

    // Add nodes
    for (const node of serialized.nodes) {
      const attrs: Record<string, any> = {
        type: node.type,
        label: node.label,
      };

      // Add optional attributes if they exist
      if (node.kind !== undefined) attrs.kind = node.kind;
      if (node.file !== undefined) attrs.file = node.file;
      if (node.line !== undefined) attrs.line = node.line;
      if (node.endLine !== undefined) attrs.endLine = node.endLine;
      if (node.signature !== undefined) attrs.signature = node.signature;
      if (node.doc !== undefined) attrs.doc = node.doc;
      if (node.rank !== undefined) attrs.rank = node.rank;
      if (node.imports !== undefined) attrs.imports = node.imports;
      if (node.cfg !== undefined) attrs.cfg = node.cfg;
      if (node.dfg !== undefined) attrs.dfg = node.dfg;

      graph.addNode(node.id, attrs);
    }

    // Add edges
    for (const edge of serialized.edges) {
      const attrs: Record<string, any> = {
        type: edge.type,
        // BaseEdgeAttributes.confidence is required. Older serialized
        // graphs (pre-confidence-level-init) may lack the field — backfill
        // with EXTRACTED so the deserialized graph satisfies the type
        // invariant without forcing a schema migration.
        confidence: edge.confidence ?? 'EXTRACTED',
      };
      for (const key of WELL_KNOWN_EDGE_KEYS) {
        if (key === 'type' || key === 'confidence') continue;
        if (edge[key] !== undefined) attrs[key] = edge[key];
      }
      graph.addEdge(edge.source, edge.target, attrs);
    }

    return graph;
  }
}
