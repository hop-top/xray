import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import { UsageError } from '../lib/error/types';
import { loadConfig } from '../lib/config';
import { cluster } from '../lib/graph/cluster';
import { GraphSerializer } from '../lib/graph/serializer';
import { Logger } from '../lib/logger';
import { renderMermaid, type MermaidView } from '../lib/renderer/mermaid-renderer';
import { bindFlag, staticValues } from './completion';
import { resolvePath } from './common';
import { assertContextExclusive, buildGraphForRoots, cacheLine, confineFor, resolveRunOptions, validateRunRoots } from './generate';
import { addGraphSourceOptions, coverageLine, matchNote, type GraphSourceOptions } from './graph-source';
import { readSerializedGraph } from './query';
import { declareEffect } from './side-effect';

const VALID_VIEWS: readonly MermaidView[] = ['architecture', 'calls', 'cfg', 'dfg'];

export interface DiagramCommandOptions extends GraphSourceOptions {
  view?: string;
  anchor?: string;
  symbol?: string[];
  catch?: string[];
  depth?: string;
  maxNodes?: string;
  output?: string;
}

function parseOptionalPositiveInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    throw new UsageError(`invalid ${flag} '${raw}' (expected a positive integer)`);
  }
  return Number(trimmed);
}

function parseOptionalNonNegativeInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new UsageError(`invalid ${flag} '${raw}' (expected a non-negative integer)`);
  }
  return Number(trimmed);
}

function parseView(raw: string | undefined): MermaidView {
  const value = (raw ?? 'architecture').trim().toLowerCase();
  if ((VALID_VIEWS as readonly string[]).includes(value)) {
    return value as MermaidView;
  }
  throw new UsageError(
    `invalid --view '${raw}' (expected one of: ${VALID_VIEWS.join(', ')})`
  );
}

export async function handleDiagramAction(
  paths: string[] | undefined,
  options: DiagramCommandOptions
): Promise<void> {
  const view = parseView(options.view);
  const maxNodes = parseOptionalPositiveInt(options.maxNodes, '--max-nodes') ?? 60;
  const depth = parseOptionalNonNegativeInt(options.depth, '--depth');

  if (paths && paths.length > 0) {
    if (options.path && options.path.length > 0) {
      throw new UsageError('positional path and --path are exclusive: give roots one way or the other');
    }
    if (options.graph) {
      throw new UsageError('--graph reads a saved graph; it cannot be combined with positional paths');
    }
    options = { ...options, path: [...paths] };
  }

  assertContextExclusive(options, paths);

  let serialized;
  if (options.graph) {
    const building = (options.path?.length ?? 0) > 0 || options.lens || options.scope;
    if (building) {
      throw new UsageError('--graph reads a saved graph; it cannot be combined with --path, --lens or --scope');
    }
    serialized = readSerializedGraph(options.graph);
  } else {
    const cli = {
      path: options.path ?? [],
      lens: options.lens,
      scope: options.scope,
      context: options.context,
      language: options.language ?? options.lang ?? [],
      config: options.config,
    };
    const config = loadConfig(cli.config, cli.path[0], { resolvePaths: true, confine: confineFor(cli, false) });
    const { mergedOptions } = resolveRunOptions(cli, config);
    if (view === 'cfg' || view === 'dfg') {
      const asked = new Set<string>(mergedOptions.with ?? []);
      if (view === 'cfg') asked.add('cf');
      if (view === 'dfg') asked.add('df');
      mergedOptions.with = [...asked];
    }
    validateRunRoots(mergedOptions, options.config);
    const note = matchNote(mergedOptions.match);
    if (note) Logger.info(note);
    const built = await buildGraphForRoots(mergedOptions, options.config, {
      format: 'json',
      quiet: true,
      cache: true,
    });
    if (built.cache && built.cache.length > 1) Logger.info(cacheLine(built.cache));
    Logger.info(coverageLine(built.coverage, built.cache));
    serialized = built.graph;
  }

  const symbolFilter = (options.symbol && options.symbol.length > 0) ? options.symbol : options.catch;
  let output: string;
  if (view === 'architecture') {
    const graph = new GraphSerializer().deserialize(serialized);
    const hasCommunity = graph.someNode((_id: string, attrs: Record<string, any>) => typeof attrs.community === 'number' && attrs.community >= 0);
    if (!hasCommunity) {
      cluster(graph);
    }
    output = renderMermaid(graph, {
      view,
      anchor: options.anchor,
      catch: symbolFilter,
      depth,
      maxNodes,
      root: serialized.metadata?.projectPath,
    });
  } else {
    output = renderMermaid(serialized, {
      view,
      anchor: options.anchor,
      catch: symbolFilter,
      depth,
      maxNodes,
      root: serialized.metadata?.projectPath,
    });
  }

  if (options.output) {
    const outFile = resolvePath(options.output)!;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, output, 'utf-8');
    Logger.success(`Mermaid diagram written to ${outFile}`);
    return;
  }

  process.stdout.write(output);
}

export function registerDiagramCommand(program: Command): Command {
  const cmd = addGraphSourceOptions(
    program
      .command('diagram')
      .description('Export deterministic Mermaid architecture, call, CFG, or DFG diagrams')
      .argument('[paths...]', 'Root directories to analyze (same as --path; not combinable with it)')
  )
    .option('--view <view>', 'Diagram view: architecture (default), calls, cfg, dfg', 'architecture')
    .option('--anchor <target>', 'Anchor file or symbol to center BFS on')
    .option('--symbol <pattern>', 'Match function/class name (prefix ! to negate) (repeatable)', (value: string, prev: string[] = []) => prev.concat([value]), [])
    .option('--depth <n>', 'Maximum BFS depth from --anchor')
    .option('--max-nodes <n>', 'Maximum nodes to render (default: 60)', '60')
    .option('-o, --output <file>', 'Write Mermaid output to file instead of stdout')
    .action(handleDiagramAction);

  bindFlag(cmd, 'view', staticValues('architecture', 'calls', 'cfg', 'dfg'));
  return declareEffect(cmd, 'read', 'yes');
}
