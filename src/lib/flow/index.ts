import * as path from 'path';
import type Parser from 'tree-sitter';
import type { Cfg, Dfg, FlowResult } from './types';
import { MAX_FLOW_NODES, MAX_FILE_FLOW_NODES, MAX_FLOW_SOURCE_BYTES, flowWorkCap } from './types';
import type { FlowTable } from './table';
import { Scopes } from './scope';
import { CfgBuilder, nestedFunctions } from './cfg';
import { computeDfg } from './dfg';
import { typescriptTable } from './tables/typescript';
import { javascriptTable } from './tables/javascript';
import { pythonTable } from './tables/python';
import { goTable } from './tables/go';

export * from './types';
export type { FlowTable } from './table';

type Node = Parser.SyntaxNode;

/** Flow table by file extension; absent: flow is not supported for the language yet. */
const TABLES: Record<string, FlowTable> = {
  '.ts': typescriptTable,
  '.tsx': typescriptTable,
  '.mts': typescriptTable,
  '.cts': typescriptTable,
  '.js': javascriptTable,
  '.jsx': javascriptTable,
  '.mjs': javascriptTable,
  '.cjs': javascriptTable,
  '.py': pythonTable,
  '.go': goTable,
};

export const flowTableFor = (file: string): FlowTable | undefined => TABLES[path.extname(file)];

/** Languages (by table name) with flow support, for messages. */
export const flowLanguages = (): string[] => [...new Set(Object.values(TABLES).map(t => t.language))];

/**
 * Cache key part for a flow selection: empty when flow is off. Covers the
 * languages that have a table, so supporting a new one invalidates entries
 * cached without its flow; bump FLOW_VERSION when the builders change.
 */
const FLOW_VERSION = 2;
export const flowCacheKey = (cfg: boolean, dfg: boolean): string =>
  !cfg && !dfg ? '' : `${cfg ? 'cf' : ''}${dfg ? 'df' : ''}@${FLOW_VERSION}:${flowLanguages().join('+')}`;

/** The function-like node a tag's name node belongs to, if it has a body. */
export function functionOfName(name: Node, table: FlowTable): Node | null {
  const p = name.parent;
  if (!p) return null;
  let fn: Node | null = null;
  if (table.functions.includes(p.type)) fn = p;
  else if (p.type === table.data.declarator.type) {
    const v = p.childForFieldName(table.data.declarator.value);
    if (v && table.functions.includes(v.type)) fn = v;
  }
  return fn && fn.childForFieldName(table.fn.body) ? fn : null;
}

function closureName(n: Node, table: FlowTable): string {
  const own = n.childForFieldName(table.fn.name);
  if (own) return own.text;
  const named = table.nameOf?.(n);
  if (named) return named;
  const p = n.parent;
  if (p) {
    if (p.type === table.data.declarator.type) return p.childForFieldName(table.data.declarator.name)?.text ?? table.anonymous;
    if (p.type === table.data.assignment.type) return p.childForFieldName(table.data.assignment.left)?.text ?? table.anonymous;
    const key = p.childForFieldName('key');
    if (key) return key.text;
  }
  return table.anonymous;
}

/** Nodes a file may still spend on flow graphs (shared by all its functions and closures). */
export interface FlowBudget { left: number }

function analyze(
  fn: Node, table: FlowTable, scopes: Scopes, want: { cfg: boolean; dfg: boolean }, max: number, budget: FlowBudget
): FlowResult {
  if (budget.left <= 0) return { skipped: 'budget' };
  const built = new CfgBuilder(fn, table, scopes, max, Math.min(flowWorkCap(max), budget.left)).build();
  budget.left -= built.total;
  const truncated = built.total > built.nodes.length || built.partial
    ? { nodes: built.total, limit: built.nodes.length, ...(built.partial ? { partial: true as const } : {}) }
    : undefined;
  const result: FlowResult = {};
  const closures = nestedFunctions(fn, table).map(n => ({
    name: closureName(n, table),
    line: n.startPosition.row,
    res: analyze(n, table, scopes, want, max, budget),
  }));
  if (want.cfg) {
    const cfg: Cfg = {
      nodes: built.nodes.map(({ refs, ...n }) => n),
      edges: built.edges,
    };
    if (truncated) cfg.truncated = truncated;
    const cl = closures.filter(c => c.res.cfg).map(c => ({ ...c.res.cfg!, name: c.name, line: c.line }));
    if (cl.length > 0) cfg.closures = cl;
    result.cfg = cfg;
  }
  if (want.dfg) {
    const dfg: Dfg = computeDfg(built.nodes, built.edges, b => scopes.bindings[b].captured);
    if (truncated) dfg.truncated = truncated;
    const cl = closures.filter(c => c.res.dfg).map(c => ({ ...c.res.dfg!, name: c.name, line: c.line }));
    if (cl.length > 0) dfg.closures = cl;
    result.dfg = dfg;
  }
  return result;
}

/**
 * CFG and/or DFG of one function node. Nested functions (closures, methods
 * of nested classes) get their own graphs under `closures`.
 */
export function buildFlow(
  fn: Node,
  table: FlowTable,
  want: { cfg: boolean; dfg: boolean },
  maxNodes: number = MAX_FLOW_NODES,
  budget: FlowBudget = { left: MAX_FILE_FLOW_NODES }
): FlowResult {
  if (fn.endIndex - fn.startIndex > MAX_FLOW_SOURCE_BYTES) return { skipped: 'size' };
  // Whatever the source does (nesting that overflows the stack, a builder
  // bug), one function never fails the run: it just has no graph.
  try {
    return analyze(fn, table, new Scopes(fn, table), want, maxNodes, budget);
  } catch (e) {
    return { skipped: e instanceof RangeError ? 'depth' : 'error' };
  }
}
