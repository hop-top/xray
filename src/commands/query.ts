import * as fs from 'fs';
import chalk from 'chalk';
import { GraphSerializer } from '../lib/graph/serializer';
import { QueryAdapterRegistry } from '../lib/query/registry';
import { FunctionAdapter } from '../lib/query/adapters/function';
import type { QueryResult } from '../lib/query/types';
import { QueryCommandOptions } from '../types/command-options';

export async function handleQueryAction(query: string, options: QueryCommandOptions): Promise<any> {
  if (options.listAdapters) {
    return listAdapters();
  }

  if (!query || !query.trim()) {
    throw new Error('Query is required');
  }

  if (!options.graph) {
    throw new Error('--graph flag is required');
  }

  const graph = await loadGraph(options.graph);
  const registry = new QueryAdapterRegistry();
  registry.register(new FunctionAdapter());

  const adapter = registry.find(query);
  if (!adapter) {
    throw new Error('No query adapter found');
  }

  const result = adapter.execute(query, graph);
  const outputFormat = options.format || 'table';

  return formatOutput(result, outputFormat);
}

async function loadGraph(graphPath: string): Promise<any> {
  if (!fs.existsSync(graphPath)) {
    throw new Error('Graph file not found: ' + graphPath);
  }

  try {
    const content = fs.readFileSync(graphPath, 'utf-8');
    const serialized = JSON.parse(content);
    const serializer = new GraphSerializer();
    return serializer.deserialize(serialized);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON in graph file: ' + graphPath);
    }
    throw error;
  }
}

function listAdapters(): string {
  const registry = new QueryAdapterRegistry();
  registry.register(new FunctionAdapter());
  const adapters = registry.list();

  let output = chalk.bold('\nAvailable Query Adapters:\n\n');
  for (const adapter of adapters) {
    output += chalk.cyan('  ' + adapter.syntax) + chalk.gray(' - ' + adapter.name + '\n');
  }
  output += chalk.gray('\nExample: xray query --graph graph.json "calls(main)"\n');
  return output;
}

function formatOutput(result: QueryResult, format: string): any {
  switch (format) {
    case 'json': return result;
    case 'table': return formatTable(result);
    case 'tree': return formatTree(result);
    default: return formatTable(result);
  }
}

function formatTable(result: QueryResult): string {
  const nodeCount = result.nodes.length;
  let output = chalk.bold('\nResults (' + nodeCount + '):\n\n');

  if (result.nodes.length === 0) {
    output += chalk.gray('  No results found\n');
    return output;
  }

  const nameHeader = 'Name'.padEnd(30);
  const fileHeader = 'File'.padEnd(40);
  const lineHeader = 'Line'.padEnd(10);
  output += chalk.bold(nameHeader + ' ' + fileHeader + ' ' + lineHeader + '\n');
  output += '-'.repeat(80) + '\n';

  for (const node of result.nodes) {
    const name = (node.name || '').padEnd(30).substring(0, 30);
    const file = (node.file || '').padEnd(40).substring(0, 40);
    const lineStr = node.line ? ('L' + node.line).padEnd(10) : ''.padEnd(10);
    output += name + ' ' + chalk.gray(file) + ' ' + chalk.cyan(lineStr) + '\n';
  }

  const timeMsg = 'Query time: ' + result.metadata.executionTime + 'ms';
  output += '\n' + chalk.gray(timeMsg) + '\n';
  return output;
}

function formatTree(result: QueryResult): string {
  let output = chalk.bold('\nCall Tree:\n\n');

  if (result.nodes.length === 0) {
    output += chalk.gray('  No results found\n');
    return output;
  }

  const childrenMap = new Map<string, string[]>();
  const roots = new Set<string>();

  for (const edge of result.edges) {
    if (!childrenMap.has(edge.from)) {
      childrenMap.set(edge.from, []);
    }
    childrenMap.get(edge.from)!.push(edge.to);
    roots.add(edge.from);
  }

  for (const edge of result.edges) {
    roots.delete(edge.to);
  }

  if (result.edges.length === 0) {
    for (const node of result.nodes) {
      const location = node.file && node.line ? (' (' + node.file + ':L' + node.line + ')') : '';
      output += node.name + chalk.gray(location) + '\n';
    }
    return output;
  }

  // Build node map - include nodes from edges that might not be in nodes list
  const nodeMap = new Map(result.nodes.map(n => [n.id, n]));

  // Add any edge sources/targets that aren't in the nodes list (e.g., root caller)
  for (const edge of result.edges) {
    if (!nodeMap.has(edge.from)) {
      // Create a minimal node entry for the source
      nodeMap.set(edge.from, { id: edge.from, name: edge.from.split('::').pop() || edge.from });
    }
    if (!nodeMap.has(edge.to)) {
      nodeMap.set(edge.to, { id: edge.to, name: edge.to.split('::').pop() || edge.to });
    }
  }

  const visited = new Set<string>();

  // If there are roots in edges, print from roots
  if (roots.size > 0) {
    const rootArray = Array.from(roots);
    for (let i = 0; i < rootArray.length; i++) {
      printNode(rootArray[i], '', i === rootArray.length - 1, nodeMap, childrenMap, visited, (line) => {
        output += line + '\n';
      });
    }
  } else {
    // No clear roots, just print all nodes as a flat tree
    for (const node of result.nodes) {
      const location = node.file && node.line ? (' (' + node.file + ':L' + node.line + ')') : '';
      output += node.name + chalk.gray(location) + '\n';
    }
  }

  return output;
}

function printNode(
  nodeId: string, prefix: string, isLast: boolean,
  nodeMap: Map<string, any>, childrenMap: Map<string, string[]>,
  visited: Set<string>, print: (line: string) => void
): void {
  if (visited.has(nodeId)) return;
  visited.add(nodeId);

  const node = nodeMap.get(nodeId);
  if (!node) return;

  const connector = isLast ? '└─→ ' : '├─→ ';
  const location = node.file && node.line ? (' (' + node.file + ':L' + node.line + ')') : '';
  print(prefix + connector + node.name + chalk.gray(location));

  const children = childrenMap.get(nodeId) || [];
  const newPrefix = prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < children.length; i++) {
    printNode(children[i], newPrefix, i === children.length - 1, nodeMap, childrenMap, visited, print);
  }
}
