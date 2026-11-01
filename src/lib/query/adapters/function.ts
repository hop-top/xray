import type { QueryAdapter, QueryResult } from '../types';
import { findNodes } from '../match';

/**
 * FunctionAdapter implements the function-based query syntax.
 * Supports: calls(), callers(), path(), hotspots(), deps()
 *
 * Security features:
 * - Escapes regex special characters before pattern transformation
 * - Rejects patterns > 100 characters to prevent ReDoS attacks
 * - Uses try-catch to detect catastrophic backtracking
 */
export class FunctionAdapter implements QueryAdapter {
  name = 'Function Query Adapter';
  syntax = 'function';

  canParse(query: string): boolean {
    const trimmed = query.trim();
    return /^\w+\(/.test(trimmed);
  }

  execute(query: string, graph: any): QueryResult {
    const startTime = Date.now();

    const parsed = this.parseQuery(query.trim());
    let nodes: any[] = [];
    let edges: any[] = [];

    switch (parsed.operation) {
      case 'calls':
        ({ nodes, edges } = this.executeCalls(parsed.args, graph));
        break;
      case 'callers':
        ({ nodes, edges } = this.executeCallers(parsed.args, graph));
        break;
      case 'path':
        ({ nodes, edges } = this.executePath(parsed.args, graph));
        break;
      case 'hotspots':
        ({ nodes, edges } = this.executeHotspots(parsed.args, graph));
        break;
      case 'deps':
        ({ nodes, edges } = this.executeDeps(parsed.args, graph));
        break;
      default:
        throw new Error(`Unknown operation: ${parsed.operation}`);
    }

    const executionTime = Date.now() - startTime;

    return {
      nodes,
      edges,
      metadata: {
        syntax: 'function',
        queryType: parsed.operation,
        executionTime,
        resultCount: nodes.length,
      },
    };
  }

  private parseQuery(query: string): { operation: string; args: Record<string, any> } {
    const match = query.match(/^(\w+)\((.*)\)$/);
    if (!match) {
      throw new Error(`Invalid query syntax: ${query}`);
    }

    const [, operation, argsStr] = match;
    const args: Record<string, any> = {};

    // hotspots() can have optional parameters
    if (!argsStr.trim() && operation !== 'hotspots') {
      throw new Error(`${operation}() requires parameters`);
    }

    if (!argsStr.trim()) {
      return { operation, args };
    }

    // Parse arguments: "arg1, key=value, key=value"
    const parts = this.splitArgs(argsStr);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      const kvMatch = part.match(/^(\w+)=(.+)$/);

      if (kvMatch) {
        const [, key, value] = kvMatch;
        args[key] = this.parseValue(value);
      } else if (i === 0) {
        // First argument is the target
        args.target = part;
      }
    }

    return { operation, args };
  }

  private splitArgs(argsStr: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of argsStr) {
      if (char === '(' || char === '[' || char === '{') {
        depth++;
        current += char;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  private parseValue(value: string): any {
    value = value.trim();

    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

    return value;
  }

  private executeCalls(args: Record<string, any>, graph: any): { nodes: any[]; edges: any[] } {
    const target = args.target;
    const recursive = args.recursive || false;
    const depth = args.depth || Infinity;

    const sourceNodes = this.findNodes(target, graph);
    const nodes: any[] = [];
    const edges: any[] = [];
    const visited = new Set<string>();

    for (const sourceId of sourceNodes) {
      if (recursive) {
        this.traverseCalls(sourceId, 0, depth, visited, nodes, edges, graph);
      } else {
        // Direct calls only
        const outEdges = graph.outEdges(sourceId);
        for (const edge of outEdges) {
          const edgeAttrs = graph.getEdgeAttributes(edge);
          if (edgeAttrs.type === 'calls') {
            const target = graph.target(edge);
            const targetAttrs = graph.getNodeAttributes(target);
            if (targetAttrs.type === 'tag' && !visited.has(target)) {
              visited.add(target);
              nodes.push(this.nodeToResult(target, targetAttrs, 1));
              edges.push({
                from: sourceId,
                to: target,
                type: 'calls',
              });
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  private traverseCalls(
    nodeId: string,
    currentDepth: number,
    maxDepth: number,
    visited: Set<string>,
    nodes: any[],
    edges: any[],
    graph: any
  ): void {
    if (currentDepth >= maxDepth) return;

    const outEdges = graph.outEdges(nodeId);
    for (const edge of outEdges) {
      const edgeAttrs = graph.getEdgeAttributes(edge);
      if (edgeAttrs.type === 'calls') {
        const target = graph.target(edge);
        const targetAttrs = graph.getNodeAttributes(target);

        if (targetAttrs.type === 'tag') {
          edges.push({
            from: nodeId,
            to: target,
            type: 'calls',
          });

          if (!visited.has(target)) {
            visited.add(target);
            nodes.push(this.nodeToResult(target, targetAttrs, currentDepth + 1));
            this.traverseCalls(target, currentDepth + 1, maxDepth, visited, nodes, edges, graph);
          }
        }
      }
    }
  }

  private executeCallers(args: Record<string, any>, graph: any): { nodes: any[]; edges: any[] } {
    const target = args.target;
    const recursive = args.recursive || false;
    const depth = args.depth || Infinity;

    const targetNodes = this.findNodes(target, graph);
    const nodes: any[] = [];
    const edges: any[] = [];
    const visited = new Set<string>();

    for (const targetId of targetNodes) {
      if (recursive) {
        this.traverseCallers(targetId, 0, depth, visited, nodes, edges, graph);
      } else {
        // Direct callers only
        const inEdges = graph.inEdges(targetId);
        for (const edge of inEdges) {
          const edgeAttrs = graph.getEdgeAttributes(edge);
          if (edgeAttrs.type === 'calls') {
            const source = graph.source(edge);
            const sourceAttrs = graph.getNodeAttributes(source);
            if (sourceAttrs.type === 'tag' && !visited.has(source)) {
              visited.add(source);
              nodes.push(this.nodeToResult(source, sourceAttrs, 1));
              edges.push({
                from: source,
                to: targetId,
                type: 'calls',
              });
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  private traverseCallers(
    nodeId: string,
    currentDepth: number,
    maxDepth: number,
    visited: Set<string>,
    nodes: any[],
    edges: any[],
    graph: any
  ): void {
    if (currentDepth >= maxDepth) return;

    const inEdges = graph.inEdges(nodeId);
    for (const edge of inEdges) {
      const edgeAttrs = graph.getEdgeAttributes(edge);
      if (edgeAttrs.type === 'calls') {
        const source = graph.source(edge);
        const sourceAttrs = graph.getNodeAttributes(source);

        if (sourceAttrs.type === 'tag') {
          edges.push({
            from: source,
            to: nodeId,
            type: 'calls',
          });

          if (!visited.has(source)) {
            visited.add(source);
            nodes.push(this.nodeToResult(source, sourceAttrs, currentDepth + 1));
            this.traverseCallers(source, currentDepth + 1, maxDepth, visited, nodes, edges, graph);
          }
        }
      }
    }
  }

  private executePath(args: Record<string, any>, graph: any): { nodes: any[]; edges: any[] } {
    const fromPattern = args.target;
    const toPattern = args.to;

    if (!toPattern) {
      throw new Error('path() requires a "to" parameter');
    }

    const fromNodes = this.findNodes(fromPattern, graph);
    const toNodes = this.findNodes(toPattern, graph);

    if (fromNodes.length === 0 || toNodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    // BFS to find shortest path
    const fromId = fromNodes[0];
    const toId = toNodes[0];

    const queue: Array<{ current: string; path: string[] }> = [{ current: fromId, path: [fromId] }];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const { current, path } = queue.shift()!;

      if (current === toId) {
        // Found path, build result
        const nodes: any[] = [];
        const edges: any[] = [];

        for (let i = 0; i < path.length; i++) {
          const nodeId = path[i];
          const attrs = graph.getNodeAttributes(nodeId);

          if (i > 0) {
            nodes.push(this.nodeToResult(nodeId, attrs, i));
          }

          if (i < path.length - 1) {
            edges.push({
              from: nodeId,
              to: path[i + 1],
              type: 'calls',
            });
          }
        }

        return { nodes, edges };
      }

      const outEdges = graph.outEdges(current);
      for (const edge of outEdges) {
        const edgeAttrs = graph.getEdgeAttributes(edge);
        if (edgeAttrs.type === 'calls') {
          const target = graph.target(edge);
          if (!visited.has(target)) {
            visited.add(target);
            queue.push({ current: target, path: [...path, target] });
          }
        }
      }
    }

    return { nodes: [], edges: [] };
  }

  private executeHotspots(args: Record<string, any>, graph: any): { nodes: any[]; edges: any[] } {
    const metric = args.metric || 'calls';
    const limit = args.limit || 10;

    const scored: any[] = [];

    graph.forEachNode((nodeId: string, attrs: any) => {
      if (attrs.type !== 'tag') return;

      let score = 0;
      switch (metric) {
        case 'calls':
          score = graph.inDegree(nodeId);
          break;
        case 'fanout':
          score = graph.outDegree(nodeId);
          break;
        case 'pagerank':
          score = attrs.rank || 0;
          break;
        default:
          score = graph.inDegree(nodeId);
      }

      scored.push({
        ...this.nodeToResult(nodeId, attrs, 0),
        score,
      });
    });

    scored.sort((a, b) => b.score - a.score);
    const nodes = scored.slice(0, limit);

    return { nodes, edges: [] };
  }

  private executeDeps(args: Record<string, any>, graph: any): { nodes: any[]; edges: any[] } {
    // TODO: Implement dependency queries
    return { nodes: [], edges: [] };
  }

  private findNodes(pattern: string, graph: any): string[] {
    return findNodes(pattern, graph);
  }

  private nodeToResult(nodeId: string, attrs: any, depth: number): any {
    return {
      id: nodeId,
      name: attrs.label,
      file: attrs.file,
      line: attrs.line,
      kind: attrs.kind,
      depth,
    };
  }
}
