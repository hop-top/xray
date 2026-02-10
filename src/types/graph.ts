/**
 * Graph Type Definitions
 * ======================
 *
 * Type-safe wrappers for graphology Graph with xray-specific node and edge attributes.
 *
 * This file provides:
 * - FileNodeAttributes: Attributes for file nodes
 * - TagNodeAttributes: Attributes for tag/symbol nodes
 * - NodeAttributes: Discriminated union of all node types
 * - EdgeAttributes: Attributes for edges (defines, calls, imports)
 * - XrayGraph: Type alias for properly-typed graphology Graph
 */

import Graph from 'graphology';
import { Import } from '../lib/parser/types';

/**
 * Base attributes for file nodes in the graph.
 *
 * File nodes represent source code files.
 */
export interface BaseFileNodeAttributes {
  type: 'file';
  label: string;
  imports?: Import[];
}

/**
 * Base attributes for tag nodes in the graph.
 *
 * Tag nodes represent code symbols (functions, classes, methods, etc.)
 * discovered by tree-sitter parsing.
 */
export interface BaseTagNodeAttributes {
  type: 'tag';
  label: string;
  kind: string;
  file: string;
  line: number;
  endLine?: number;
  col?: number;
  signature?: string;
  doc?: string;
}

/**
 * File node attributes with support for plugin-added custom fields.
 *
 * Plugins can extend nodes with additional properties using the index signature.
 */
export type FileNodeAttributes = BaseFileNodeAttributes & { [key: string]: any };

/**
 * Tag node attributes with support for plugin-added custom fields.
 *
 * Plugins can extend nodes with additional properties using the index signature.
 */
export type TagNodeAttributes = BaseTagNodeAttributes & { [key: string]: any };

/**
 * Discriminated union of all node attribute types.
 *
 * TypeScript can narrow this type based on the 'type' field:
 *
 * ```typescript
 * if (attrs.type === 'file') {
 *   // TypeScript knows attrs is FileNodeAttributes
 *   console.log(attrs.imports);
 * } else if (attrs.type === 'tag') {
 *   // TypeScript knows attrs is TagNodeAttributes
 *   console.log(attrs.kind, attrs.line);
 * }
 * ```
 */
export type NodeAttributes = FileNodeAttributes | TagNodeAttributes;

/**
 * Base attributes for edges in the graph.
 *
 * Edge types:
 * - 'defines': File defines a tag (file -> tag)
 * - 'calls': Tag calls another tag (tag -> tag)
 * - 'imports': File imports another file (file -> file)
 */
export interface BaseEdgeAttributes {
  type: 'defines' | 'calls' | 'imports';
}

/**
 * Edge attributes with support for plugin-added custom fields.
 *
 * Plugins can extend edges with additional properties using the index signature.
 */
export type EdgeAttributes = BaseEdgeAttributes & { [key: string]: any };

/**
 * Type alias for a properly-typed xray graph.
 *
 * This is a graphology Graph with:
 * - NodeAttributes: FileNodeAttributes | TagNodeAttributes
 * - EdgeAttributes: { type: 'defines' | 'calls' | 'imports' }
 * - GraphAttributes: Record<string, any> (graph-level metadata)
 *
 * Usage:
 * ```typescript
 * import { XrayGraph } from '../types/graph';
 *
 * function processGraph(graph: XrayGraph) {
 *   graph.forEachNode((nodeId, attrs) => {
 *     // attrs is properly typed as NodeAttributes
 *     if (attrs.type === 'file') {
 *       // TypeScript knows attrs.imports exists
 *     }
 *   });
 * }
 * ```
 */
export type XrayGraph = Graph<NodeAttributes, EdgeAttributes>;

/**
 * Ranked node interface for graph ranking results.
 *
 * Represents a node with its computed rank score.
 */
export interface RankedNode {
  id: string;
  rank: number;
  attributes: NodeAttributes;
}

/**
 * Type-specific ranked nodes for better type narrowing
 */
export interface RankedFileNode extends RankedNode {
  attributes: FileNodeAttributes;
}

export interface RankedTagNode extends RankedNode {
  attributes: TagNodeAttributes;
}

/**
 * Type guard to check if a ranked node is a file node
 */
export function isRankedFileNode(node: RankedNode): node is RankedFileNode {
  return node.attributes.type === 'file';
}

/**
 * Type guard to check if a ranked node is a tag node
 */
export function isRankedTagNode(node: RankedNode): node is RankedTagNode {
  return node.attributes.type === 'tag';
}
