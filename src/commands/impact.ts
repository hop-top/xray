/**
 * `xray impact <symbol>`: what calls <symbol>, transitively, grouped by
 * area. Reads a saved graph (`--graph`) or builds one in-process for the
 * resolved roots exactly as `map --format json` does (config, `--lens`,
 * `--scope`; no strategy auto-detect), without writing a map file.
 */
import type { Command } from 'commander';
import { GraphSerializer } from '../lib/graph/serializer';
import { computeImpact, DEFAULT_IMPACT_DEPTH, impactToQueryResult, renderImpactBrief, renderImpactText, type ImpactResult, withEditorLine } from '../lib/query/impact';
import { UsageError } from '../lib/error/types';
import {
  adaptFormatter, addOutputFlags, assertFormat, colsRequested, columns, emit, formatterOf,
  outputRegistry, textFormatter,
} from '../lib/output';
import { formatTree } from './query';
import { addGraphSourceOptions, obtainGraph } from './graph-source';
import { declareEffect } from './side-effect';

export { coverageLine, matchNote } from './graph-source';

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
  /** Result nodes with editor (1-based) lines, as text and tree show them. */
  const rows = (r: ImpactResult) => r.nodes.map(withEditorLine);
  /** Whole result document with editor lines; the saved graph stays 0-based. */
  const document = (r: ImpactResult): ImpactResult => ({
    ...r,
    symbol: { ...r.symbol, matches: r.symbol.matches.map(withEditorLine) },
    nodes: rows(r),
  });
  return outputRegistry(
    adaptFormatter<ImpactResult>(formatterOf(base, 'json'), document, true),
    adaptFormatter<ImpactResult>(formatterOf(base, 'yaml'), document, true),
    adaptFormatter<ImpactResult>(formatterOf(base, 'table'), rows),
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
shortest depth, grouped by top-level directory (\`internal\`), or by
root then directory on a merged multi-root graph (\`api/internal\`).
Callers are shown with their definition line; the graph stores no
call-site positions.

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
  const cmd = addGraphSourceOptions(program
    .command('impact')
    .description('Show transitive callers of a symbol, by area')
    .argument('<symbol>', 'Symbol name or glob (e.g. "createSession", "New*")')
    .option('--depth <n>', `Caller levels to follow (default: ${DEFAULT_IMPACT_DEPTH})`)
    .option('--strict', 'Follow EXTRACTED call edges only (drop INFERRED)'));
  addOutputFlags(cmd, impactRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, brief, tree, json, yaml, table, csv',
    showInHelp: ['cols', 'output'],
  });
  return declareEffect(cmd.addHelpText('after', HELP_AFTER).action(runImpactCommand), 'read', 'yes');
}
