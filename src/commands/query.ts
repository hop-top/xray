import * as fs from 'fs';
import type { Command } from 'commander';
import { styles, type Styles } from '../lib/tui';
import { GraphSerializer } from '../lib/graph/serializer';
import { QueryAdapterRegistry } from '../lib/query/registry';
import { FunctionAdapter } from '../lib/query/adapters/function';
import type { QueryResult, SerializedGraph } from '../lib/query/types';
import { editorLine, withEditorLine } from '../lib/query/impact';
import { QueryCommandOptions } from '../types/command-options';
import { Logger } from '../lib/logger';
import { obtainGraph } from './graph-source';
import { terminalSafe } from '../lib/terminal-safe';
import { NotFoundError, UsageError } from '../lib/error/types';
import {
  adaptFormatter, addOutputFlags, assertFormat, colsRequested, columns, emit, formatterOf,
  outputRegistry, textFormatter,
} from '../lib/output';

/**
 * Run a query. Returns the structured QueryResult, or the rendered adapter
 * list for `--list-adapters`.
 */
export async function handleQueryAction(query: string, options: QueryCommandOptions): Promise<any> {
  if (options.listAdapters) {
    return listAdapters();
  }

  if (!query || !query.trim()) {
    throw new UsageError('Query is required');
  }

  const graph = new GraphSerializer().deserialize(await obtainGraph(options));
  const registry = new QueryAdapterRegistry();
  registry.register(new FunctionAdapter());

  const adapter = registry.find(query);
  if (!adapter) {
    throw new UsageError('No query adapter found');
  }

  try {
    return adapter.execute(query, graph);
  } catch (error) {
    throw new UsageError((error as Error).message, error as Error);
  }
}

/** Table/csv columns (and the `--cols` vocabulary) for result nodes. */
export const QUERY_COLUMNS = columns('name', 'kind', 'file', 'line', 'depth', 'score', 'id');
const DEFAULT_QUERY_COLUMNS = columns('name', 'kind', 'file', 'line');

/** Result nodes with editor (1-based) lines, as tree, impact and map show them. */
const nodeRows = (r: QueryResult) => r.nodes.map(withEditorLine);
/** Whole result document with editor (1-based) lines; the saved graph stays 0-based. */
const document = (r: QueryResult): QueryResult => ({ ...r, nodes: r.nodes.map(withEditorLine) });

/**
 * Formats: json/yaml emit the whole QueryResult document (nodes, edges,
 * metadata) and csv/table the result nodes; tree the call tree. Every
 * format shows editor (1-based) lines; the saved graph stays 0-based.
 */
function buildRegistry() {
  const base = outputRegistry();
  return outputRegistry(
    adaptFormatter<QueryResult>(formatterOf(base, 'json'), document, true),
    adaptFormatter<QueryResult>(formatterOf(base, 'yaml'), document, true),
    adaptFormatter<QueryResult>(formatterOf(base, 'table'), nodeRows),
    adaptFormatter<QueryResult>(formatterOf(base, 'csv'), nodeRows),
    textFormatter<QueryResult>('tree', (r, put, s) => {
      put(formatTree(r, s).replace(/\n$/, ''));
    })
  );
}
const queryRegistry = buildRegistry();

/** Attach query's output flags (`--format json|yaml|table|csv|tree`, ...). */
export function addQueryOutputFlags(cmd: Command): Command {
  return addOutputFlags(cmd, queryRegistry, {
    defaultFormat: 'table',
    description: 'Output format: table, json, yaml, csv, tree (default: table)',
  });
}

/**
 * Commander action for `xray query`: run the query and render it through
 * kit output. `--format json` is one JSON document on stdout. Errors
 * propagate (CodedError -> exit code).
 */
export async function runQueryCommand(
  query: string | undefined,
  options: QueryCommandOptions,
  cmd: Command
): Promise<void> {
  if (options.listAdapters) {
    Logger.output(listAdapters().replace(/\n$/, ''));
    return;
  }
  assertFormat(cmd, queryRegistry);
  const result = (await handleQueryAction(query ?? '', options)) as QueryResult;
  // tree prints its own empty notice; other formats stay pure data.
  if (result.nodes.length === 0 && cmd.opts().format !== 'tree') Logger.info('No results found');
  await emit(cmd, result, {
    registry: queryRegistry,
    // Validate --cols against every node column; default to the short set.
    columns: colsRequested(cmd) ? QUERY_COLUMNS : DEFAULT_QUERY_COLUMNS,
    defaultFormat: 'table',
  });
}

/**
 * Read a saved graph (`map --format json`). Missing file: NotFoundError
 * (exit 3); invalid JSON: UsageError (exit 2).
 */
export function readSerializedGraph(graphPath: string): SerializedGraph {
  if (!fs.existsSync(graphPath)) {
    throw new NotFoundError('Graph file not found: ' + graphPath);
  }
  try {
    return JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new UsageError('Invalid JSON in graph file: ' + graphPath);
    }
    throw error;
  }
}

function listAdapters(): string {
  const registry = new QueryAdapterRegistry();
  registry.register(new FunctionAdapter());
  const adapters = registry.list();

  let output = styles().bold('\nAvailable Query Adapters:\n\n');
  for (const adapter of adapters) {
    output += styles().accent('  ' + adapter.syntax) + styles().muted(' - ' + adapter.name + '\n');
  }
  output += styles().muted('\nExample: xray query "calls(main)"  (or: xray query --graph graph.json "calls(main)")\n');
  return output;
}

/**
 * ` (file:Lline)` suffix with the editor line (graph line + 1); graph
 * line 0 is a real line, only null/undefined is absent.
 */
function nodeLocation(node: { file?: string; line?: number }): string {
  return node.file && node.line != null ? ' (' + terminalSafe(node.file) + ':L' + editorLine(node.line) + ')' : '';
}

/** Render the call tree for a query result. */
export function formatTree(result: QueryResult, s: Styles = styles()): string {
  let output = s.bold('\nCall Tree:\n\n');

  if (result.nodes.length === 0) {
    output += s.muted('  No results found\n');
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
      const location = nodeLocation(node);
      output += terminalSafe(node.name) + s.muted(location) + '\n';
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
      printNode(rootArray[i], '', i === rootArray.length - 1, nodeMap, childrenMap, visited, s, (line) => {
        output += line + '\n';
      });
    }
  } else {
    // No clear roots, just print all nodes as a flat tree
    for (const node of result.nodes) {
      const location = nodeLocation(node);
      output += terminalSafe(node.name) + s.muted(location) + '\n';
    }
  }

  return output;
}

function printNode(
  nodeId: string, prefix: string, isLast: boolean,
  nodeMap: Map<string, any>, childrenMap: Map<string, string[]>,
  visited: Set<string>, s: Styles, print: (line: string) => void
): void {
  if (visited.has(nodeId)) return;
  visited.add(nodeId);

  const node = nodeMap.get(nodeId);
  if (!node) return;

  const connector = isLast ? '└─→ ' : '├─→ ';
  const location = nodeLocation(node);
  print(prefix + connector + terminalSafe(String(node.name)) + s.muted(location) + (node.note ? ` (${node.note})` : ''));

  const children = childrenMap.get(nodeId) || [];
  const newPrefix = prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < children.length; i++) {
    printNode(children[i], newPrefix, i === children.length - 1, nodeMap, childrenMap, visited, s, print);
  }
}
