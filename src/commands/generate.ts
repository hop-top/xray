import { Xray } from '../lib/xray';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { QueryResolver } from '../lib/query-resolver';
import * as cliProgress from 'cli-progress';
import { Logger } from '../lib/logger';
import { loadConfig, mergeConfig, getScopes, getScope, mergeScopeWithBase } from '../lib/config';
import { FileWriteError } from '../lib/error/types';
import { FileScanner } from '../lib/scanner';
import { StrategyLoader } from '../lib/strategy/loader';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyContextImpl } from '../lib/strategy/context';
import { StrategyRunner } from '../lib/strategy/runner';
import { XrayScopeConfig } from '../types/xray-config';
import { resolvePath, resolveOutputPath } from './common';
import { ChunkedRenderer } from '../lib/renderer/chunked-renderer';
import { buildShareSummary, resolveShareOutputPath } from '../lib/share-summary';
import { CommonAnalysisOptions } from '../types/command-options';

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
  const context = new StrategyContextImpl(projectPath);
  const detector = new StrategyDetector(loader, context);

  const detected = await detector.runDetection();

  if (detected.length === 0) {
    return { match, catch: catchPatterns, detectedStrategies };
  }

  for (const strategy of detected) {
    detectedStrategies.push(strategy.name);

    const fullStrategy = loader.discoverStrategies().then(strategies =>
      strategies.find(s => s.name === strategy.name)
    );

    const resolvedStrategy = await fullStrategy;
    if (!resolvedStrategy) continue;

    if (resolvedStrategy.fileTypes) {
      const fileTypes = resolvedStrategy.fileTypes();
      for (const ext of fileTypes) {
        const pattern = `*${ext}`;
        if (!match.includes(pattern)) {
          match.push(pattern);
        }
      }
    }

    if (resolvedStrategy.ignorePatterns) {
      const ignorePatterns = resolvedStrategy.ignorePatterns();
      for (const pattern of ignorePatterns) {
        if (!catchPatterns.includes(pattern)) {
          catchPatterns.push(pattern);
        }
      }
    }
  }

  return { match, catch: catchPatterns, detectedStrategies };
};

// Helper function to run a single xray generation
export const runSingleXray = async (mergedOptions: any, scopeName?: string) => {
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
  const paths = (mergedOptions.path && mergedOptions.path.length > 0 ? mergedOptions.path : [process.cwd()]).map(resolvePath).filter(Boolean) as string[];
  const anchor = resolvePath(mergedOptions.anchor);

  // Determine format first (needed for output path resolution)
  const format: 'txt' | 'csv' | 'xml' | 'json' =
    mergedOptions.json ? 'json' :
    mergedOptions.csv ? 'csv' :
    mergedOptions.xml ? 'xml' : 'txt';

  const outputPath = resolveOutputPath(mergedOptions.output, format);
  const shareOption = mergedOptions.share;
  const shareRequested = shareOption !== undefined && shareOption !== false;
  const commandUsed = getCommandString();

  if (scopeName) {
    Logger.info(`Running scope: ${chalk.bold(scopeName)}`);
  }
  Logger.info(`Analyzing repo at: ${paths.join(', ')}`);

  // Parse features from --with flags
  const withFeatures = new Set(mergedOptions.with || []);
  const features = {
    vars: withFeatures.has('vars'),
    incs: withFeatures.has('incs'),
    docs: withFeatures.has('docs'),
    cost: withFeatures.has('cost'),
    cf: withFeatures.has('cf'),
    df: withFeatures.has('df'),
  };

  // Resolve queries
  const queries = QueryResolver.resolve(mergedOptions.query || []);

  // Determine diagram type
  const diagram: 'mermaid' | 'dot' = mergedOptions.dot ? 'dot' : 'mermaid';

  // Setup progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Parsing |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} Files || Current: {file}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });

  // Determine if chunked output is enabled
  const chunkedEnabled = mergedOptions.chunked !== false;

  // Process each path and collect results
  if (chunkedEnabled) {
    // Chunked output mode - generate multiple files per directory
    for (let i = 0; i < paths.length; i++) {
      const currentPath = paths[i];
      if (paths.length > 1) {
        Logger.info(`\nProcessing path ${i + 1}/${paths.length}: ${currentPath}`);
      }

      let barStarted = false;

      const xray = new Xray({
        path: currentPath,
        limit: parseInt(mergedOptions.limit),
        anchor,
        depth: mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        features,
        queries,
        match: mergedOptions.match || [],
        catch: mergedOptions.catch || [],
        format,
        diagram,
        chunked: true,
        onProgress: (current, total, file) => {
          if (!barStarted) {
            progressBar.start(total, 0, { file: 'Starting...' });
            barStarted = true;
          }
          progressBar.update(current, { file });
          if (current >= total) {
            progressBar.stop();
          }
        }
      });

      // Build the graph
      const { rankedNodes, graph } = await xray.buildGraph();

      // Use chunked renderer
      const includeIncs = features.incs || false;
      const chunkedRenderer = new ChunkedRenderer(
        currentPath,
        rankedNodes,
        graph,
        parseInt(mergedOptions.limit),
        mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        includeIncs
      );

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
          fs.writeFileSync(sharePath, summary);
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

      let barStarted = false;

      const xray = new Xray({
        path: currentPath,
        limit: parseInt(mergedOptions.limit),
        anchor,
        depth: mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        features,
        queries,
        match: mergedOptions.match || [],
        catch: mergedOptions.catch || [],
        format,
        diagram,
        chunked: false,
        onProgress: (current, total, file) => {
          if (!barStarted) {
            progressBar.start(total, 0, { file: 'Starting...' });
            barStarted = true;
          }
          progressBar.update(current, { file });
          if (current >= total) {
            progressBar.stop();
          }
        }
      });

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
      fs.writeFileSync(outputPath!, finalOutput);
      Logger.success(`Analysis written to ${outputPath}`);
    } catch (err: any) {
      throw new FileWriteError(outputPath!, err);
    }

    if (shareRequested) {
      for (const share of shareSummaries) {
        try {
          fs.writeFileSync(share.sharePath, share.summary);
          Logger.success(`Share summary written to ${share.sharePath}`);
          Logger.info('Share this summary in a PR, doc, or AI prompt for quick context.');
        } catch (err: any) {
          throw new FileWriteError(share.sharePath, err);
        }
      }
    }
  }
};

// Shared action handler for all generation commands
export const handleGenerateAction = async (options: CommonAnalysisOptions) => {
  try {
    // Set verbose level if provided
    if (options.verbose) {
      Logger.setLevel(options.verbose);
    }

    Logger.debug('Generate action started', { options });

    // Load config file
    const config = loadConfig(options.config, options.path?.[0]);

    // Handle --all-scopes flag
    if (options.allScopes) {
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
        const mergedOptions = mergeConfig({ ...mergedScope } as any, {}, undefined);
        await runSingleXray(mergedOptions, scopeName);
      }

      return;
    }

    // Handle --scope flag
    if (options.scope) {
      const scopeConfig = getScope(config, options.scope);

      if (!scopeConfig) {
        Logger.error(`Scope "${options.scope}" not found in config file`);
        process.exit(1);
      }

      const mergedScope = config ? mergeScopeWithBase(config, scopeConfig) : scopeConfig;
      const mergedOptions = mergeConfig({ ...mergedScope } as any, options, undefined);
      await runSingleXray(mergedOptions, options.scope);

      return;
    }

    // Regular flow: merge config with CLI options
    const mergedOptions = mergeConfig(config, options, options.preset);
    await runSingleXray(mergedOptions);

  } catch (error) {
    Logger.error('Error generating analysis:', error);
    process.exit(1);
  }
};

const getCommandString = (): string => {
  const args = process.argv.slice(2);
  return args.length > 0 ? `xray ${args.join(' ')}` : 'xray';
};
