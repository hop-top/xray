/**
 * `xray impact <symbol>`: what calls <symbol>, transitively, grouped by
 * area. Reads a saved graph (`--graph`) or builds one in-process for the
 * resolved roots exactly as `map --format json` does (config, `--lens`,
 * `--scope`; no strategy auto-detect), without writing a map file.
 */
import type { Command } from 'commander';
import { GraphSerializer } from '../lib/graph/serializer';
import { computeImpact, DEFAULT_IMPACT_DEPTH, editorLine, impactToQueryResult, renderImpactBrief, renderImpactText, type ImpactResult } from '../lib/query/impact';
import type { SerializedGraph } from '../lib/query/types';
import type { ParseCoverage } from '../lib/xray';
import { Logger } from '../lib/logger';
import { UsageError } from '../lib/error/types';
import {
  adaptFormatter, addOutputFlags, assertFormat, colsRequested, columns, emit, formatterOf,
  outputRegistry, textFormatter,
} from '../lib/output';
import { formatTree, readSerializedGraph } from './query';
import { buildGraphForRoots, cacheLine, resolveRunOptions, validateRunRoots, type BuiltGraph } from './generate';

export interface ImpactCommandOptions {
  depth?: string;
  strict?: boolean;
  graph?: string;
  path?: string[];
  lens?: string;
  scope?: string;
  lang?: string[];
  config?: string;
  format?: string;
}

/** Table/csv columns (and the `--cols` vocabulary) for callers. */
export const IMPACT_COLUMNS = columns('name', 'kind', 'file', 'line', 'depth', 'group', 'confidence', 'id');
const DEFAULT_IMPACT_COLUMNS = columns('name', 'file', 'line', 'depth', 'group', 'confidence');

function buildRegistry() {
  const base = outputRegistry();
  const rows = (r: ImpactResult) => r.nodes;
  /** Table rows: editor (1-based) lines, as query table and impact text show them. */
  const tableRows = (r: ImpactResult) => r.nodes.map(n => (n.line == null ? n : { ...n, line: editorLine(n.line) }));
  return outputRegistry(
    adaptFormatter<ImpactResult>(formatterOf(base, 'json'), (r) => r, true),
    adaptFormatter<ImpactResult>(formatterOf(base, 'yaml'), (r) => r, true),
    adaptFormatter<ImpactResult>(formatterOf(base, 'table'), tableRows),
    adaptFormatter<ImpactResult>(formatterOf(base, 'csv'), rows),
    textFormatter<ImpactResult>('text', (r, put, s) => renderImpactText(r, put, s)),
    textFormatter<ImpactResult>('brief', (r, put) => {
      const text = renderImpactBrief(r);
      if (text) put(text);
    }),
    textFormatter<ImpactResult>('tree', (r, put, s) => {
      put(formatTree(impactToQueryResult(r), s).replace(/\n$/, ''));
    })
  );
}
const impactRegistry = buildRegistry();

/** `--depth` as a positive integer; anything else is a usage error. */
export function parseImpactDepth(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_IMPACT_DEPTH;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s) || Number(s) < 1) {
    throw new UsageError(`invalid --depth '${raw}' (expected a positive integer)`);
  }
  return Number(s);
}

/**
 * One stderr line: files parsed (or served from the cache, when every root
 * hit) / skipped grammars. `cache` is the per-root outcome of a cached build.
 */
export function coverageLine(c: ParseCoverage, cache?: BuiltGraph['cache']): string {
  const skipped = c.skipped.length === 0
    ? 'none'
    : c.skipped.map(s => `${s.language} (${s.count} ${s.extensions.join('/')})`).join(', ');
  const cached = cache !== undefined && cache.length > 0 && cache.every(r => r.hit);
  const files = cached ? `served from cache (${c.parsed} files)` : `${c.parsed} files parsed`;
  return `coverage: ${files} · skipped grammars: ${skipped}`;
}

async function obtainGraph(options: ImpactCommandOptions): Promise<SerializedGraph> {
  if (options.graph) {
    const building = (options.path?.length ?? 0) > 0 || options.lens || options.scope;
    if (building) {
      throw new UsageError('--graph reads a saved graph; it cannot be combined with --path, --lens or --scope');
    }
    return readSerializedGraph(options.graph);
  }
  const cli = { path: options.path ?? [], lens: options.lens, scope: options.scope, lang: options.lang ?? [], config: options.config };
  const { mergedOptions } = resolveRunOptions(cli);
  validateRunRoots(mergedOptions, options.config);
  const built = await buildGraphForRoots(mergedOptions, options.config, { format: 'json', quiet: true, cache: true });
  if (built.cache) Logger.info(cacheLine(built.cache));
  Logger.info(coverageLine(built.coverage, built.cache));
  return built.graph;
}

/** Compute the impact result (no rendering). */
export async function handleImpactAction(symbol: string, options: ImpactCommandOptions): Promise<ImpactResult> {
  if (!symbol || !symbol.trim()) throw new UsageError('<symbol> is required');
  const depth = parseImpactDepth(options.depth);
  const serialized = await obtainGraph(options);
  const graph = new GraphSerializer().deserialize(serialized);
  try {
    return computeImpact(graph, symbol.trim(), {
      depth,
      strict: Boolean(options.strict),
      roots: serialized.metadata?.roots,
    });
  } catch (error) {
    // findNodes rejects over-complex globs.
    throw new UsageError((error as Error).message, error as Error);
  }
}

/** Commander action: compute, then render through the kit format registry. */
export async function runImpactCommand(symbol: string, options: ImpactCommandOptions, cmd: Command): Promise<void> {
  assertFormat(cmd, impactRegistry);
  parseImpactDepth(options.depth); // fail fast (exit 2) before any build
  const result = await handleImpactAction(symbol, options);
  await emit(cmd, result, {
    registry: impactRegistry,
    columns: colsRequested(cmd) ? IMPACT_COLUMNS : DEFAULT_IMPACT_COLUMNS,
    defaultFormat: 'text',
  });
}

const HELP_AFTER = `Walks inbound call edges from every definition matching <symbol> (exact
name or glob, as in \`query\`) and reports each caller once, at its
shortest depth, grouped by root label (merged multi-root graph) or by
top-level directory. Callers are shown with their definition line; the
graph stores no call-site positions.

EXTRACTED edges were resolved in the caller's file, directory or imports;
INFERRED edges matched by name only. --strict follows EXTRACTED only.

Without --graph the graph is built in memory for the configured roots
(--path, --lens, --scope; same resolution as \`map --format json\`) and
no map file is written.

--format brief is the text summary cut down for hook scripts: header, one
line per group (top 3 callers), edges footer, at most 1200 chars; it
prints nothing when no symbol matches or nothing calls it.

Examples:
  xray impact createSession
  xray impact 'New*' --depth 1 --strict
  xray map --format json -o graph.json && xray impact Run --graph graph.json --format json
  xray --quiet impact Run --graph graph.json --format brief
`;

/** Register `xray impact`. */
export function registerImpactCommand(program: Command): Command {
  const cmd = program
    .command('impact')
    .description('Show transitive callers of a symbol, by area')
    .argument('<symbol>', 'Symbol name or glob (e.g. "createSession", "New*")')
    .option('--depth <n>', `Caller levels to follow (default: ${DEFAULT_IMPACT_DEPTH})`)
    .option('--strict', 'Follow EXTRACTED call edges only (drop INFERRED)')
    .option('--graph <file>', 'Read a saved graph (map --format json) instead of building one')
    .option('-p, --path <path>', 'Root directory to analyze (repeatable) [default: config paths or current directory]',
      (value: string, previous: string[]) => previous.concat([value]), [])
    .option('--lens <name>', 'Use named lens (config-file option overlay)')
    .option('--scope <name>', 'Use specific scope from config file')
    .option('--lang <list>', 'Languages to parse, comma-separated names or bundles (repeatable)',
      (value: string, previous: string[]) => previous.concat(value.split(',').map(s => s.trim()).filter(Boolean)), []);
  addOutputFlags(cmd, impactRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, brief, tree, json, yaml, table, csv',
    showInHelp: ['cols', 'output'],
  });
  return cmd.addHelpText('after', HELP_AFTER).action(runImpactCommand);
}
