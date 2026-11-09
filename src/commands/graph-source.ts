/**
 * Where `impact` and `query` get their graph: a saved graph (`--graph`) or
 * one built in memory for the resolved roots exactly as `map --format json`
 * does (config, `--lens`, `--scope`; no strategy auto-detect), reusing the
 * parse cache and writing no map file.
 */
import type { Command } from 'commander';
import type { SerializedGraph } from '../lib/query/types';
import type { ParseCoverage } from '../lib/xray';
import { quotePattern } from '../lib/path-match';
import { Logger } from '../lib/logger';
import { loadConfig } from '../lib/config';
import { UsageError } from '../lib/error/types';
import { graphFileArg } from './common';
import { buildGraphForRoots, cacheLine, confineFor, resolveRunOptions, validateRunRoots, type BuiltGraph } from './generate';
import { readSerializedGraph } from './query';

export interface GraphSourceOptions {
  graph?: string;
  path?: string[];
  lens?: string;
  scope?: string;
  lang?: string[];
  config?: string;
}

/** Add `--graph`, `-p/--path`, `--lens`, `--scope`, `--lang` (the graph source flags). */
export function addGraphSourceOptions(cmd: Command): Command {
  return cmd
    .option('--graph <file>', 'Read a saved graph (map --format json) instead of building one', graphFileArg)
    .option('-p, --path <path>', 'Root directory to analyze (repeatable) [default: config paths or current directory]',
      (value: string, previous: string[]) => previous.concat([value]), [])
    .option('--lens <name>', 'Use named lens (config-file option overlay)')
    .option('--scope <name>', 'Use specific scope from config file')
    .option('--lang <list>', 'Languages to parse, comma-separated names or bundles (repeatable)',
      (value: string, previous: string[]) => previous.concat(value.split(',').map(s => s.trim()).filter(Boolean)), []);
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

/**
 * One stderr line when a config `match` narrowed the graph: impact has no
 * `--match`, so callers outside the patterns would go unreported silently.
 */
export function matchNote(patterns: readonly string[] | undefined): string | null {
  if (!patterns || patterns.length === 0) return null;
  return `note: config "match" narrows the graph to ${patterns.map((p) => quotePattern(p)).join(', ')}; results in other files are not reported`;
}

export async function obtainGraph(options: GraphSourceOptions): Promise<SerializedGraph> {
  if (options.graph) {
    const building = (options.path?.length ?? 0) > 0 || options.lens || options.scope;
    if (building) {
      throw new UsageError('--graph reads a saved graph; it cannot be combined with --path, --lens or --scope');
    }
    return readSerializedGraph(options.graph);
  }
  const cli = { path: options.path ?? [], lens: options.lens, scope: options.scope, lang: options.lang ?? [], config: options.config };
  // no output file is written: only scan roots and query files must stay in their project.
  const config = loadConfig(cli.config, cli.path[0], { resolvePaths: true, confine: confineFor(cli, false) });
  const { mergedOptions } = resolveRunOptions(cli, config);
  validateRunRoots(mergedOptions, options.config);
  const note = matchNote(mergedOptions.match);
  if (note) Logger.info(note);
  const built = await buildGraphForRoots(mergedOptions, options.config, { format: 'json', quiet: true, cache: true });
  if (built.cache) Logger.info(cacheLine(built.cache));
  Logger.info(coverageLine(built.coverage, built.cache));
  return built.graph;
}

