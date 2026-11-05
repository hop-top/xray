import { Xray } from '../lib/xray';
import * as fs from 'fs';
import * as path from 'path';
import { styles, fileProgress } from '../lib/tui';
import { QueryResolver } from '../lib/query-resolver';
import { Logger, LogLevel } from '../lib/logger';
import { loadConfig, mergeConfig, getScopes, getScope, mergeScopeWithBase, validateScanRoots } from '../lib/config';
import { CodedError, FileWriteError, NotFoundError, UsageError } from '../lib/error/types';
import { resolveFormatFlags } from '../lib/output-format';
import { GraphSerializer } from '../lib/graph/serializer';
import { deriveRootLabels, mergeSerializedGraphs } from '../lib/graph/merge';
import { GraphCache, optionsDigest, rootFingerprint } from '../lib/cache/graph-cache';
import { resolveCrossRootReferences } from '../lib/graph/cross-root';
import { graphToEdgesCsv, graphToNodesCsv, graphToXml } from '../lib/graph/export';
import type { SerializedGraph } from '../lib/query/types';
import { FileScanner } from '../lib/scanner';
import { StrategyLoader } from '../lib/strategy/loader';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyRunner } from '../lib/strategy/runner';
import { XrayScopeConfig } from '../types/xray-config';
import {
  createStrategyContext,
  normalizeExtensionOptions,
  resolvePath,
  resolveOutputPath,
} from './common';
import { ChunkedRenderer } from '../lib/renderer/chunked-renderer';
import { applyStashedInsights } from '../lib/renderer/insight';
import { buildShareSummary, resolveShareOutputPath } from '../lib/share-summary';
import { CommonAnalysisOptions } from '../types/command-options';
import { applyPreset, resolvePreset } from '../lib/plugins/presets';
import { openCacheDbPath } from '../lib/storage';
import type { Xray as XrayType, ParseCoverage } from '../lib/xray';
import { emitPlan, previewing } from './side-effect';
import type { Effect } from './kit-cli';
import type { Command } from 'commander';

/**
 * Resolve every `--preset <spec>` flag in order and apply the
 * resulting plugin presets to the given Xray instance. Repeatable
 * flags compose via `applyPreset`'s `useIfAbsent` path so duplicate
 * plugins across presets register exactly once.
 *
 * A single failing preset is logged as a warning and skipped — the
 * map command must still render the default graph output even if a
 * user-supplied preset is broken (spec C-2 + C-5 back-compat).
 */
const applyPresetFlags = async (
  xray: XrayType,
  specs: string[] | undefined,
  currentPath: string
): Promise<void> => {
  if (!specs || specs.length === 0) return;
  for (const spec of specs) {
    try {
      const preset = await resolvePreset(spec);
      await applyPreset(xray as unknown as Parameters<typeof applyPreset>[0], preset, {
        root: currentPath,
      }, { presetName: spec });
    } catch (err) {
      Logger.warn(
        `[presets] failed to apply "${spec}": ${(err as Error).message}`
      );
    }
  }
};

const configureFromStrategies = async (options: CommonAnalysisOptions): Promise<{
  match: string[];
  catch: string[];
  detectedStrategies: string[];
}> => {
  const match: string[] = [];
  const catchPatterns: string[] = [];
  const detectedStrategies: string[] = [];

  const paths = (options.path && options.path.length > 0 ? options.path : [process.cwd()]).map(resolvePath).filter(Boolean) as string[];

  if (paths.length === 0) {
    return { match, catch: catchPatterns, detectedStrategies };
  }

  const projectPath = paths[0];
  const loader = new StrategyLoader();
  const context = createStrategyContext(projectPath, options);
  const detector = new StrategyDetector(loader, context);
  const extensions = await loader.discoverExtensions();
  const extensionMap = new Map(
    extensions.map(extension => [extension.name, extension])
  );

  // Detect in memory: persisting here writes `.xray/` into the project,
  // which is also the default graph output file.
  const detected = await detector.detectExtensions(extensions);

  if (detected.length === 0) {
    return { match, catch: catchPatterns, detectedStrategies };
  }

  for (const strategy of detected) {
    detectedStrategies.push(strategy.name);

    const resolvedExtension = extensionMap.get(strategy.name);
    if (!resolvedExtension) continue;

    if (resolvedExtension.fileTypes) {
      const fileTypes = resolvedExtension.fileTypes();
      for (const ext of fileTypes) {
        const pattern = `*${ext}`;
        if (!match.includes(pattern)) {
          match.push(pattern);
        }
      }
    }

    if (resolvedExtension.ignorePatterns) {
      const ignorePatterns = resolvedExtension.ignorePatterns();
      for (const pattern of ignorePatterns) {
        if (!catchPatterns.includes(pattern)) {
          catchPatterns.push(pattern);
        }
      }
    }
  }

  return { match, catch: catchPatterns, detectedStrategies };
};

/** Write `content` to `file`, creating missing parent directories. */
const writeFileEnsuringDir = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/**
 * Write a graph in a graph format. JSON/XML: one file at `outputPath`.
 * CSV: two files, `<base>.nodes.csv` and `<base>.edges.csv`, where `<base>`
 * is `outputPath` without a trailing `.csv`. Returns the files written.
 */
const writeGraphOutput = (
  graph: SerializedGraph,
  format: 'json' | 'csv' | 'xml',
  outputPath: string
): string[] => {
  const files: Array<[string, string]> =
    format === 'json'
      ? [[outputPath, JSON.stringify(graph, null, 2) + '\n']]
      : format === 'xml'
        ? [[outputPath, graphToXml(graph)]]
        : (() => {
            const base = outputPath.replace(/\.csv$/i, '');
            return [
              [`${base}.nodes.csv`, graphToNodesCsv(graph)],
              [`${base}.edges.csv`, graphToEdgesCsv(graph)],
            ] as Array<[string, string]>;
          })();
  for (const [file, content] of files) {
    try {
      writeFileEnsuringDir(file, content);
    } catch (err: any) {
      throw new FileWriteError(file, err);
    }
  }
  return files.map(([f]) => f);
};

/**
 * Validate (and absolutize) `mergedOptions.path` in place: a missing CLI
 * root is NotFoundError; missing config roots warn and are skipped; no
 * root left is NotFoundError. A missing root must never produce an empty
 * map with exit 0.
 */
export const validateRunRoots = (mergedOptions: any, configPath?: string): void => {
  if (mergedOptions.path && mergedOptions.path.length > 0) {
    mergedOptions.path = validateScanRoots(
      mergedOptions.path.map(resolvePath).filter(Boolean) as string[],
      mergedOptions.pathSource ?? 'cli',
      configPath
    );
  }
};

/** Scan roots to analyze: resolved `path` entries, or the cwd. */
const runRoots = (mergedOptions: any): string[] =>
  (mergedOptions.path && mergedOptions.path.length > 0 ? mergedOptions.path : [process.cwd()])
    .map(resolvePath).filter(Boolean) as string[];

/** `--with` features as Xray feature flags. */
const featuresOf = (mergedOptions: any) => {
  const withFeatures = new Set(mergedOptions.with || []);
  return {
    vars: withFeatures.has('vars'),
    incs: withFeatures.has('incs'),
    docs: withFeatures.has('docs'),
    cost: withFeatures.has('cost'),
    cf: withFeatures.has('cf'),
    df: withFeatures.has('df'),
  };
};

export interface BuiltGraph {
  /** One graph merged across every root (single root: unprefixed). */
  graph: SerializedGraph;
  /** Per-root inputs for `--share` summaries. */
  shareInputs: Array<{ currentPath: string; rankedNodes: any; graph: any }>;
  /** Parse coverage summed across roots. */
  coverage: ParseCoverage;
  /** Merged-graph cache outcome per root, in root order (only when `cache` was used). */
  cache?: Array<{ label: string; hit: boolean }>;
}

/** Build options a cached root graph depends on (see graph-cache.ts). */
const graphOptionsOf = (mergedOptions: any) => ({
  features: featuresOf(mergedOptions),
  languages: mergedOptions.languages ?? null,
  queries: mergedOptions.query ?? null,
  match: mergedOptions.match ?? null,
  catch: mergedOptions.catch ?? null,
  anchor: resolvePath(mergedOptions.anchor) ?? null,
});

/** `cache: <label> hit · <label> miss` (stderr line of multi-root builds). */
export const cacheLine = (cache: NonNullable<BuiltGraph['cache']>): string =>
  `cache: ${cache.map(c => `${c.label} ${c.hit ? 'hit' : 'miss'}`).join(' · ')}`;

/**
 * Build the graph `map --format json` writes, without writing it: one
 * Xray pipeline per distinct root (presets applied), serialized and
 * merged. Roots must already be validated (`validateRunRoots`).
 * `quiet` drops per-root progress and info logs (warnings still show).
 * `cache` (multi-root, no presets) serves unchanged roots and the merged
 * graph from the project's cache db; `shareInputs` then omits cached roots.
 */
export const buildGraphForRoots = async (
  mergedOptions: any,
  configPath: string | undefined,
  opts: { format?: 'json' | 'csv' | 'xml'; quiet?: boolean; cache?: boolean } = {}
): Promise<BuiltGraph> => {
  const uniquePaths = Array.from(new Set(runRoots(mergedOptions)));
  const cwd = process.cwd();
  const useCache = Boolean(opts.cache) && uniquePaths.length > 1 &&
    !(Array.isArray(mergedOptions.preset) && mergedOptions.preset.length > 0);
  const graphCache = useCache
    ? new GraphCache(openCacheDbPath(cwd), optionsDigest(graphOptionsOf(mergedOptions)))
    : null;
  const fingerprints = graphCache ? uniquePaths.map(rootFingerprint) : [];
  const hits: boolean[] = [];
  const quiet = Boolean(opts.quiet) && Logger.getLevel() < LogLevel.DEBUG;
  const progressQuiet = quiet || Boolean(mergedOptions.quiet) || Logger.getLevel() < LogLevel.INFO;
  const parts: Array<{ root: string; graph: SerializedGraph }> = [];
  const shareInputs: BuiltGraph['shareInputs'] = [];
  const coverage: ParseCoverage = { files: 0, parsed: 0, skipped: [] };
  const prevLevel = Logger.getLevel();
  if (quiet && prevLevel > LogLevel.WARN) Logger.setLevel(LogLevel.WARN);
  try {
    for (let i = 0; i < uniquePaths.length; i++) {
      const currentPath = uniquePaths[i];
      const cached = graphCache?.getRoot(currentPath, fingerprints[i]) ?? null;
      hits.push(cached !== null);
      if (cached) {
        parts.push({ root: currentPath, graph: cached.graph });
        coverage.files += cached.coverage.files;
        coverage.parsed += cached.coverage.parsed;
        coverage.skipped.push(...cached.coverage.skipped);
        continue;
      }
      if (uniquePaths.length > 1) {
        Logger.info(`\nProcessing path ${i + 1}/${uniquePaths.length}: ${currentPath}`);
      }
      const progress = fileProgress({ label: 'Parsing', quiet: progressQuiet });
      const xray = new Xray({
        path: currentPath,
        limit: parseInt(mergedOptions.limit),
        anchor: resolvePath(mergedOptions.anchor),
        depth: mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        features: featuresOf(mergedOptions),
        queries: QueryResolver.resolve(mergedOptions.query || []),
        match: mergedOptions.match || [],
        catch: mergedOptions.catch || [],
        languages: mergedOptions.languages,
        configPath,
        format: opts.format ?? 'json',
        diagram: mergedOptions.outputDiagram ?? (mergedOptions.dot ? 'dot' : 'mermaid'),
        chunked: false,
        onProgress: (current, total, file) => progress.update(current, total, file)
      });
      await applyPresetFlags(xray, mergedOptions.preset, currentPath);
      const { rankedNodes, graph } = await xray.buildGraph();
      // Multi-root: keep unresolved references for the cross-root pass.
      parts.push({
        root: currentPath,
        graph: new GraphSerializer().serialize(graph, currentPath, { references: uniquePaths.length > 1 }),
      });
      shareInputs.push({ currentPath, rankedNodes, graph });
      const c = xray.getLastCoverage() ?? { files: 0, parsed: 0, skipped: [] };
      coverage.files += c.files;
      coverage.parsed += c.parsed;
      coverage.skipped.push(...c.skipped);
      graphCache?.putRoot(currentPath, { fingerprint: fingerprints[i], graph: parts[parts.length - 1].graph, coverage: c });
    }
  } catch (err) {
    graphCache?.close();
    throw err;
  } finally {
    if (Logger.getLevel() !== prevLevel) Logger.setLevel(prevLevel);
  }
  if (!graphCache) {
    return { graph: resolveCrossRootReferences(mergeSerializedGraphs(parts)), shareInputs, coverage };
  }
  try {
    let graph = hits.every(Boolean) ? graphCache.getMerged(uniquePaths, cwd, fingerprints) : null;
    if (!graph) {
      graph = resolveCrossRootReferences(mergeSerializedGraphs(parts, cwd));
      graphCache.putMerged(uniquePaths, cwd, fingerprints, graph);
    }
    const labels = deriveRootLabels(uniquePaths, cwd);
    return { graph, shareInputs, coverage, cache: labels.map((r, i) => ({ label: r.label, hit: hits[i] })) };
  } finally {
    graphCache.close();
  }
};

/**
 * What a run would write, from the resolved options alone (no analysis).
 * Text output is chunked: one file per directory or community, named
 * after the analysis, so the pattern is listed rather than each name.
 */
const plannedWrites = (
  mergedOptions: any,
  format: 'txt' | 'csv' | 'xml' | 'json',
  outputPath: string,
  paths: string[]
): Effect[] => {
  const effects: Effect[] = [];
  const write = (target: string, detail: string) =>
    effects.push({ kind: fs.existsSync(target) ? 'update' : 'create', target, reversible: false, detail });
  const chunked = mergedOptions.chunked !== false && format === 'txt';
  if (format === 'csv') {
    const base = outputPath.replace(/\.csv$/i, '');
    write(`${base}.nodes.csv`, 'graph nodes');
    write(`${base}.edges.csv`, 'graph edges');
  } else if (chunked) {
    const ext = path.extname(outputPath) || '.md';
    effects.push({
      kind: 'write',
      target: `${outputPath.replace(ext, '')}_*${ext}`,
      reversible: false,
      detail: 'one file per directory or community; names known after analysis',
    });
  } else {
    write(outputPath, format === 'txt' ? 'analysis' : `graph (${format})`);
  }
  const shareOption = mergedOptions.share;
  if (shareOption !== undefined && shareOption !== false) {
    paths.forEach((p, i) => write(resolveShareOutputPath({
      outputPath, projectPath: p, shareOption, pathIndex: i, totalPaths: paths.length,
    }), 'share summary'));
  }
  return effects;
};

// Helper function to run a single xray generation. With `plan`, nothing is
// analyzed or written: the files a real run would write are appended to it.
export const runSingleXray = async (
  mergedOptions: any,
  scopeName?: string,
  configPath: string | undefined = mergedOptions.config,
  plan?: Effect[]
) => {
  validateRunRoots(mergedOptions, configPath);

  // Determine format first (needed for output path resolution)
  // `outputFormat` is the resolved --format/legacy-flag/config selection;
  // the boolean chain is the fallback for callers passing raw flags.
  const format: 'txt' | 'csv' | 'xml' | 'json' =
    mergedOptions.outputFormat ??
    (mergedOptions.json ? 'json' :
     mergedOptions.csv ? 'csv' :
     mergedOptions.xml ? 'xml' : 'txt');

  const outputPath = resolveOutputPath(mergedOptions.output, format, mergedOptions.chunked !== false);

  if (plan) {
    plan.push(...plannedWrites(mergedOptions, format, outputPath!, runRoots(mergedOptions)));
    return;
  }

  // Auto-configure from detected strategies if enabled
  // Only auto-detect when no path is explicitly provided (unless --detect is used)
  const hasExplicitPath = mergedOptions.path && mergedOptions.path.length > 0;
  const shouldAutoDetect = !hasExplicitPath || mergedOptions.detect;

  let autoConfigured = false;
  let detectedStrategies: string[] = [];

  if (shouldAutoDetect && !mergedOptions.skipDetect) {
    const { match, catch: catchPatterns, detectedStrategies: strategies } = await configureFromStrategies(mergedOptions);

    if (strategies.length > 0) {
      detectedStrategies = strategies;

      // Merge auto-configured patterns with existing ones
      if (match.length > 0) {
        const existingMatch = mergedOptions.match || [];
        const newMatchPatterns = match.filter(p => !existingMatch.includes(p));
        if (newMatchPatterns.length > 0) {
          mergedOptions.match = existingMatch.concat(newMatchPatterns);
          autoConfigured = true;
        }
      }

      if (catchPatterns.length > 0) {
        const existingCatch = mergedOptions.catch || [];
        const newCatchPatterns = catchPatterns.filter(p => !existingCatch.includes(p));
        if (newCatchPatterns.length > 0) {
          mergedOptions.catch = existingCatch.concat(newCatchPatterns);
          autoConfigured = true;
        }
      }
    }
  }

  // Log detected strategies and auto-configuration status
  if (detectedStrategies.length > 0) {
    Logger.info(`Detected strategies: ${detectedStrategies.join(', ')}`);
    if (autoConfigured) {
      Logger.info('Auto-configured paths from detected strategies');
    }
  }

  // Resolve paths relative to PWD
  const paths = runRoots(mergedOptions);
  const anchor = resolvePath(mergedOptions.anchor);

  const shareOption = mergedOptions.share;
  const shareRequested = shareOption !== undefined && shareOption !== false;
  const commandUsed = getCommandString();

  if (scopeName) {
    Logger.info(`Running scope: ${styles(process.stderr).bold(scopeName)}`);
  }
  Logger.info(`Analyzing repo at: ${paths.join(', ')}`);

  // Parse features from --with flags
  const features = featuresOf(mergedOptions);

  // Resolve queries
  const queries = QueryResolver.resolve(mergedOptions.query || []);

  // Determine diagram type
  const diagram: 'mermaid' | 'dot' =
    mergedOptions.outputDiagram ?? (mergedOptions.dot ? 'dot' : 'mermaid');

  // Parse progress: suppressed under --quiet / below info level and on
  // non-TTY stderr (see fileProgress).
  const progressQuiet = Boolean(mergedOptions.quiet) || Logger.getLevel() < LogLevel.INFO;
  const newProgress = () => fileProgress({ label: 'Parsing', quiet: progressQuiet });

  // Determine if chunked output is enabled
  const chunkedEnabled = mergedOptions.chunked !== false;

  if (format === 'json' || format === 'csv' || format === 'xml') {
    // Graph formats (json | csv | xml) are not renderings: chunking (a
    // token-budget concern of the text renderers) does not apply, and one
    // graph (merged across all --path roots) is written with or without
    // --no-chunk.
    if (chunkedEnabled) Logger.debug(`--format ${format}: chunking does not apply; writing the graph once`);
    const { graph: merged, shareInputs } = await buildGraphForRoots(mergedOptions, configPath, { format });
    const written = writeGraphOutput(merged, format, outputPath!);
    for (const f of written) Logger.success(`Graph written to ${f}`);

    if (shareRequested) {
      shareInputs.forEach(({ currentPath, rankedNodes, graph }, i) => {
        const sharePath = resolveShareOutputPath({
          outputPath: outputPath!,
          projectPath: currentPath,
          shareOption,
          pathIndex: i,
          totalPaths: shareInputs.length
        });
        const summary = buildShareSummary({
          projectPath: currentPath,
          outputPath: outputPath!,
          chunked: false,
          rankedNodes,
          graph,
          command: commandUsed,
          detectedStrategies,
          tokenLimit: parseInt(mergedOptions.limit)
        });
        try {
          writeFileEnsuringDir(sharePath, summary);
          Logger.success(`Share summary written to ${sharePath}`);
          Logger.info('Share this summary in a PR, doc, or AI prompt for quick context.');
        } catch (err: any) {
          throw new FileWriteError(sharePath, err);
        }
      });
    }
    return;
  }

  // Process each path and collect results
  if (chunkedEnabled) {
    // Chunked output mode - generate multiple files per directory
    for (let i = 0; i < paths.length; i++) {
      const currentPath = paths[i];
      if (paths.length > 1) {
        Logger.info(`\nProcessing path ${i + 1}/${paths.length}: ${currentPath}`);
      }

      const progress = newProgress();

      const xray = new Xray({
        path: currentPath,
        limit: parseInt(mergedOptions.limit),
        anchor,
        depth: mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        features,
        queries,
        match: mergedOptions.match || [],
        catch: mergedOptions.catch || [],
        languages: mergedOptions.languages,
        configPath,
        format,
        diagram,
        chunked: true,
        onProgress: (current, total, file) => progress.update(current, total, file)
      });

      // Apply any --preset plugin bundles before building the graph
      // so plugins can subscribe to the full pipeline lifecycle.
      await applyPresetFlags(xray, mergedOptions.preset, currentPath);

      // Build the graph
      const { rankedNodes, graph } = await xray.buildGraph();

      // Use chunked renderer
      const includeIncs = features.incs || false;
      const groupingOpt: 'directory' | 'community' =
        mergedOptions.group === 'community' ? 'community' : 'directory';
      const chunkedRenderer = new ChunkedRenderer({
        root: currentPath,
        ranked: rankedNodes,
        graph,
        tokenLimit: parseInt(mergedOptions.limit),
        maxDepth: mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        includeImports: includeIncs,
        grouping: groupingOpt,
      });

      // Drain insights stashed by plugins on `render:start` into the
      // real renderer. The renderer instance carried by render:start in
      // the chunked path is observability-only — `buildGraph()`
      // constructs it for the event payload but `generate.ts` (here)
      // constructs the renderer that actually writes chunks. Plugins
      // (e.g. question-generator) stash their insights so they can be
      // re-applied here. See `src/lib/renderer/insight.ts`.
      applyStashedInsights(xray, chunkedRenderer);

      const { chunks, metadata, rootChunk } = await chunkedRenderer.renderChunked(outputPath!);

      // Write all chunks to disk
      let filesWritten = 0;
      for (const [chunkPath, content] of chunks.entries()) {
        try {
          fs.writeFileSync(chunkPath, content);
          filesWritten++;
        } catch (err: any) {
          throw new FileWriteError(chunkPath, err);
        }
      }

      Logger.success(`Analysis written to ${filesWritten} chunk files`);
      Logger.info(`Root chunk: ${rootChunk}`);
      Logger.info(`Total chunks: ${metadata.length}`);

      // Display summary
      if (metadata.length > 0) {
        Logger.info('\nChunk Summary:');
        metadata.forEach(m => {
          const indent = '  '.repeat(m.depth);
          Logger.info(`${indent}${m.directory} (${m.fileCount} files, ${m.tokenCount} tokens)`);
        });
      }

      if (shareRequested) {
        const sharePath = resolveShareOutputPath({
          outputPath: outputPath!,
          projectPath: currentPath,
          shareOption,
          pathIndex: i,
          totalPaths: paths.length
        });

        const summary = buildShareSummary({
          projectPath: currentPath,
          outputPath: outputPath!,
          rootChunk,
          chunked: true,
          metadata,
          rankedNodes,
          graph,
          command: commandUsed,
          detectedStrategies,
          tokenLimit: parseInt(mergedOptions.limit)
        });

        try {
          writeFileEnsuringDir(sharePath, summary);
          Logger.success(`Share summary written to ${sharePath}`);
          Logger.info('Share this summary in a PR, doc, or AI prompt for quick context.');
        } catch (err: any) {
          throw new FileWriteError(sharePath, err);
        }
      }
    }
  } else {
    // Single file output mode (original behavior)
    const outputs: string[] = [];
    const shareSummaries: Array<{ sharePath: string; summary: string; projectPath: string }> = [];

    for (let i = 0; i < paths.length; i++) {
      const currentPath = paths[i];
      if (paths.length > 1) {
        Logger.info(`\nProcessing path ${i + 1}/${paths.length}: ${currentPath}`);
      }

      const progress = newProgress();

      const xray = new Xray({
        path: currentPath,
        limit: parseInt(mergedOptions.limit),
        anchor,
        depth: mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        features,
        queries,
        match: mergedOptions.match || [],
        catch: mergedOptions.catch || [],
        languages: mergedOptions.languages,
        configPath,
        format,
        diagram,
        chunked: false,
        onProgress: (current, total, file) => progress.update(current, total, file)
      });

      // Apply --preset plugin bundles before run() so plugins
      // subscribe to the full pipeline lifecycle on the non-chunked
      // path too.
      await applyPresetFlags(xray, mergedOptions.preset, currentPath);

      const result = await xray.run();

      // Add path header for multi-path output
      if (paths.length > 1) {
        outputs.push(`\n${'='.repeat(80)}\nPath: ${currentPath}\n${'='.repeat(80)}\n${result}`);
      } else {
        outputs.push(result as string);
      }

      if (shareRequested) {
        const { graph, rankedNodes } = xray.getLastGraph();
        if (graph && rankedNodes) {
          const sharePath = resolveShareOutputPath({
            outputPath: outputPath!,
            projectPath: currentPath,
            shareOption,
            pathIndex: i,
            totalPaths: paths.length
          });

          const summary = buildShareSummary({
            projectPath: currentPath,
            outputPath: outputPath!,
            chunked: false,
            rankedNodes,
            graph,
            command: commandUsed,
            detectedStrategies,
            tokenLimit: parseInt(mergedOptions.limit)
          });

          shareSummaries.push({ sharePath, summary, projectPath: currentPath });
        } else {
          Logger.warn('Share summary skipped (graph data unavailable).');
        }
      }
    }

    const finalOutput = outputs.join('\n');

    try {
      writeFileEnsuringDir(outputPath!, finalOutput);
      Logger.success(`Analysis written to ${outputPath}`);
    } catch (err: any) {
      throw new FileWriteError(outputPath!, err);
    }

    if (shareRequested) {
      for (const share of shareSummaries) {
        try {
          writeFileEnsuringDir(share.sharePath, share.summary);
          Logger.success(`Share summary written to ${share.sharePath}`);
          Logger.info('Share this summary in a PR, doc, or AI prompt for quick context.');
        } catch (err: any) {
          throw new FileWriteError(share.sharePath, err);
        }
      }
    }
  }
};

/**
 * `--lens` overlays the base config; `--scope` / `--all-scopes` replace it.
 * Combined, the lens would be dropped silently: UsageError (exit 2).
 */
export const assertLensNotScoped = (options: { lens?: string; scope?: string; allScopes?: boolean }): void => {
  if (!options.lens) return;
  if (options.allScopes) throw new UsageError('--all-scopes and --lens are exclusive');
  if (options.scope) throw new UsageError('--scope and --lens are exclusive');
};

/**
 * Merge config with CLI options the way `map` does: `--scope <name>`
 * (scope over base config; NotFoundError when undefined) or the regular
 * flow (config, `--lens` overlay, CLI options on top). `config` defaults
 * to the one `loadConfig` finds for `--config` / the first `--path`.
 */
export const resolveRunOptions = (
  normalizedOptions: any,
  config: ReturnType<typeof loadConfig> = loadConfig(normalizedOptions.config, normalizedOptions.path?.[0], { resolvePaths: true })
): { mergedOptions: any; scopeName?: string } => {
  assertLensNotScoped(normalizedOptions);
  if (normalizedOptions.scope) {
    const scopeConfig = getScope(config, normalizedOptions.scope);
    if (!scopeConfig) {
      throw new NotFoundError(`Scope "${normalizedOptions.scope}" not found in config file`);
    }
    const mergedScope = config ? mergeScopeWithBase(config, scopeConfig) : scopeConfig;
    return {
      mergedOptions: mergeConfig({ ...mergedScope } as any, normalizedOptions, undefined),
      scopeName: normalizedOptions.scope,
    };
  }
  return { mergedOptions: mergeConfig(config, normalizedOptions, normalizedOptions.lens) };
};

/**
 * Commander action for `map|scan|graph [paths...]`: positional roots are
 * `--path` roots, so config discovery from the first root, the existence
 * check and multi-root merging all see one input shape. Both forms
 * together are ambiguous: usage error.
 */
export const handleGenerateCommand = async (
  paths: string[] | undefined,
  options: CommonAnalysisOptions,
  cmd?: Command
) => {
  if (paths && paths.length > 0) {
    if (options.path && options.path.length > 0) {
      throw new UsageError(
        'positional path and --path are exclusive: give roots one way or the other'
      );
    }
    options = { ...options, path: [...paths] };
  }
  return handleGenerateAction(options, cmd && previewing(cmd) ? cmd : undefined);
};

// Shared action handler for all generation commands
export const handleGenerateAction = async (options: CommonAnalysisOptions, previewOf?: Command) => {
  const plan: Effect[] | undefined = previewOf ? [] : undefined;
  try {
    // Resolve --format / legacy flags first: a conflict is a usage error
    // that must surface before any config loading or analysis.
    const resolvedFormat = resolveFormatFlags(options);
    const normalizedOptions = {
      ...normalizeExtensionOptions(options),
      outputFormat: resolvedFormat.format,
      outputDiagram: resolvedFormat.diagram,
    };

    // Set verbose level if provided
    if (normalizedOptions.verbose) {
      Logger.setLevel(normalizedOptions.verbose);
    }

    Logger.debug('Generate action started', { options: normalizedOptions });

    assertLensNotScoped(normalizedOptions);

    // Load config file
    const config = loadConfig(
      normalizedOptions.config,
      normalizedOptions.path?.[0],
      { resolvePaths: true }
    );

    // Handle --all-scopes flag
    if (normalizedOptions.allScopes) {
      const scopes = getScopes(config);
      const scopeNames = Object.keys(scopes);

      if (scopeNames.length === 0) {
        Logger.error('No scopes defined in config file');
        process.exit(1);
      }

      Logger.info(`Running ${scopeNames.length} scopes: ${scopeNames.join(', ')}`);

      for (const scopeName of scopeNames) {
        const scopeConfig = scopes[scopeName];
        const mergedScope = config ? mergeScopeWithBase(config, scopeConfig) : scopeConfig;
        const mergedOptions = mergeConfig(
          { ...mergedScope } as any,
          {
            extensions: normalizedOptions.extensions,
            outputFormat: normalizedOptions.outputFormat,
            outputDiagram: normalizedOptions.outputDiagram,
          },
          undefined
        );
        await runSingleXray(mergedOptions, scopeName, normalizedOptions.config, plan);
      }

      if (previewOf) emitPlan(previewOf, plan!, {}, resolvedFormat.format === 'json' ? 'json' : 'text');
      return;
    }

    // --scope, or the regular flow (config + --lens + CLI options)
    const { mergedOptions, scopeName } = resolveRunOptions(normalizedOptions, config);
    await runSingleXray(mergedOptions, scopeName, normalizedOptions.config, plan);
    if (previewOf) emitPlan(previewOf, plan!, {}, resolvedFormat.format === 'json' ? 'json' : 'text');

  } catch (error) {
    // CodedError (NotFoundError, UsageError, etc.) carries an exit code —
    // let the top-level dispatcher in src/index.ts emit the right code.
    if (error instanceof CodedError) {
      throw error;
    }
    Logger.error('Error generating analysis:', error);
    process.exit(1);
  }
};

const getCommandString = (): string => {
  const args = process.argv.slice(2);
  return args.length > 0 ? `xray ${args.join(' ')}` : 'xray';
};
