const Graph = require('graphology');
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../query/types';

/**
 * GraphSerializer handles serialization and deserialization of graphology graphs
 * to/from the canonical SerializedGraph format.
 *
 * This ensures compatibility between:
 * - Query system (xray query --graph)
 * - CQRS system (xray map --save-graph)
 */
export class GraphSerializer {
  /**
   * Serialize a graphology graph to the canonical format
   */
  serialize(graph: any, projectPath: string): SerializedGraph {
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

      nodes.push(node);
    });

    // Serialize edges
    graph.forEachEdge((_: string, attrs: any, source: string, target: string) => {
      edges.push({
        source,
        target,
        type: attrs.type,
      });
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
   * Deserialize a SerializedGraph back into a graphology graph
   */
  deserialize(serialized: SerializedGraph): any {
    const graph = new Graph();

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

      graph.addNode(node.id, attrs);
    }

    // Add edges
    for (const edge of serialized.edges) {
      graph.addEdge(edge.source, edge.target, {
        type: edge.type,
      });
    }

    return graph;
  }
}
