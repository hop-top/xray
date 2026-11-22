import type { QueryAdapter, QueryResult } from '../types';
import type { CallSite } from '../../parser/types';
import { findNodes } from '../match';
import { compileSymbolGlob } from '../../path-match';

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
      case 'implementations':
        ({ nodes, edges } = this.executeImplementations(parsed.args, graph));
        break;
      case 'cycles':
        ({ nodes, edges } = this.executeCycles(parsed.args, graph));
        break;
      case 'deadcode':
        ({ nodes, edges } = this.executeDeadcode(graph));
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

    // hotspots(), cycles(), and deadcode() can have 0 arguments
    const zeroArgOps = new Set(['hotspots', 'cycles', 'deadcode']);
    if (!argsStr.trim() && !zeroArgOps.has(operation)) {
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
              const callSites = this.edgeCallSites(edgeAttrs);
              nodes.push(this.nodeToResult(target, targetAttrs, 1));
              edges.push({
                from: sourceId,
                to: target,
                type: 'calls',
                ...(callSites ? { callSites } : {}),
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
              const callSites = this.edgeCallSites(edgeAttrs);
              nodes.push({
                ...this.nodeToResult(source, sourceAttrs, 1),
                ...(callSites ? { callSites } : {}),
              });
              edges.push({
                from: source,
                to: targetId,
                type: 'calls',
                ...(callSites ? { callSites } : {}),
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
          const callSites = this.edgeCallSites(edgeAttrs);
          edges.push({
            from: source,
            to: nodeId,
            type: 'calls',
            ...(callSites ? { callSites } : {}),
          });

          if (!visited.has(source)) {
            visited.add(source);
            nodes.push({
              ...this.nodeToResult(source, sourceAttrs, currentDepth + 1),
              ...(callSites ? { callSites } : {}),
            });
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

  private executeImplementations(args: Record<string, any>, graph: any): { nodes: any[]; edges: any[] } {
    const target = args.target;
    if (!target || typeof target !== 'string') {
      throw new Error('implementations() requires a target type name');
    }

    const isGlob = target.includes('*') || target.includes('?');
    const matcher = isGlob ? compileSymbolGlob(target) : null;
    const nodes: any[] = [];

    graph.forEachNode((nodeId: string, attrs: any) => {
      if (attrs.type !== 'tag') return;
      if (!Array.isArray(attrs.supertypes) || attrs.supertypes.length === 0) return;

      const matched = attrs.supertypes.some((st: string) =>
        matcher ? matcher(st) : st === target
      );
      if (matched) {
        nodes.push(this.nodeToResult(nodeId, attrs, 0));
      }
    });

    return { nodes, edges: [] };
  }

  private executeCycles(args: Record<string, any>, graph: any): { nodes: any[]; edges: any[] } {
    const kind = String(args.kind || args.target || 'calls');
    if (kind !== 'calls' && kind !== 'imports') {
      throw new Error(`cycles() kind must be "calls" or "imports", got "${kind}"`);
    }

    // Build adjacency list and self-loop set for edges of `kind`
    const adj = new Map<string, Set<string>>();
    const selfLoops = new Set<string>();
    const rawEdges: Array<{ from: string; to: string }> = [];

    graph.forEachEdge((_: string, attrs: any, source: string, target: string) => {
      if (attrs?.type !== kind) return;
      if (source === target) {
        selfLoops.add(source);
      }
      let next = adj.get(source);
      if (!next) {
        next = new Set<string>();
        adj.set(source, next);
      }
      next.add(target);
      if (!adj.has(target)) {
        adj.set(target, new Set<string>());
      }
      rawEdges.push({ from: source, to: target });
    });

    // Tarjan's Strongly Connected Components
    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    const strongConnect = (v: string): void => {
      indices.set(v, index);
      lowlink.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      const neighbors = adj.get(v);
      if (neighbors) {
        for (const w of neighbors) {
          if (!indices.has(w)) {
            strongConnect(w);
            lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
          } else if (onStack.has(w)) {
            lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
          }
        }
      }

      if (lowlink.get(v) === indices.get(v)) {
        const component: string[] = [];
        while (true) {
          const w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
          if (w === v) break;
        }
        if (component.length > 1 || (component.length === 1 && selfLoops.has(component[0]))) {
          sccs.push(component);
        }
      }
    };

    for (const nodeId of adj.keys()) {
      if (!indices.has(nodeId)) {
        strongConnect(nodeId);
      }
    }

    const nodeToScc = new Map<string, number>();
    const nodes: any[] = [];
    sccs.forEach((scc, sccIdx) => {
      for (const nodeId of scc) {
        nodeToScc.set(nodeId, sccIdx);
        const attrs = graph.getNodeAttributes(nodeId);
        nodes.push({
          id: nodeId,
          name: attrs.label ?? nodeId,
          file: attrs.file ?? nodeId,
          line: attrs.line ?? 0,
          kind: attrs.kind ?? attrs.type,
          depth: 0,
        });
      }
    });

    const edges: any[] = [];
    for (const e of rawEdges) {
      const sccFrom = nodeToScc.get(e.from);
      const sccTo = nodeToScc.get(e.to);
      if (sccFrom !== undefined && sccFrom === sccTo) {
        edges.push({ from: e.from, to: e.to, type: kind });
      }
    }

    return { nodes, edges };
  }

  private executeDeadcode(graph: any): { nodes: any[]; edges: any[] } {
    const excludedNames = new Set(['main', 'init', 'constructor', '__init__']);
    const isTestFile = (filePath: unknown): boolean => {
      if (typeof filePath !== 'string') return false;
      const norm = filePath.replace(/\\/g, '/');
      return (
        /(^|\/)(__tests__|tests?|spec)\//i.test(norm) ||
        /\.(test|spec)\.[^.]+$/i.test(norm) ||
        /_test\.[^.]+$/i.test(norm) ||
        /(^|\/)test_[^/]+\.py$/i.test(norm)
      );
    };

    const nodes: any[] = [];
    graph.forEachNode((nodeId: string, attrs: any) => {
      if (attrs.type !== 'tag') return;
      if (attrs.kind !== 'function' && attrs.kind !== 'method') return;
      if (attrs.exported !== false) return;
      if (excludedNames.has(attrs.label)) return;
      if (isTestFile(attrs.file)) return;

      const hasInboundCall = graph.inEdges(nodeId).some((edge: string) => {
        const edgeAttrs = graph.getEdgeAttributes(edge);
        return edgeAttrs?.type === 'calls';
      });
      if (!hasInboundCall) {
        nodes.push(this.nodeToResult(nodeId, attrs, 0));
      }
    });

    return { nodes, edges: [] };
  }

  private findNodes(pattern: string, graph: any): string[] {
    return findNodes(pattern, graph);
  }

  private edgeCallSites(edgeAttrs: any): CallSite[] | undefined {
    return Array.isArray(edgeAttrs?.callSites) && edgeAttrs.callSites.length > 0
      ? edgeAttrs.callSites
      : undefined;
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
